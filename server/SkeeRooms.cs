using System.Security.Cryptography;
namespace Campo;

public record SkeeOptions(int MaxPlayers, int DurationSeconds);
public record SkeeShot(int Number, double X, double Y, int Points);
public record SkeePlayerView(string Id, string Name, int Score, bool Left, bool Connected, SkeeShot[] Shots);
public record SkeeView(string Code, string Status, int Round, string HostId, string YouId, int MaxPlayers,
    int DurationSeconds, int Balls, long ServerTime, long? EndsAt, string? EndReason, string[] WinnerIds, SkeePlayerView[] Players);
public record SkeeSession(string Code, string Token, SkeeView Room);

public sealed class SkeeStore(TimeProvider clock)
{
    readonly object gate = new();
    readonly Dictionary<string, SkeeRoom> rooms = new();
    public SkeeSession Create(string? name, SkeeOptions options)
    {
        GameRoom.ValidateName(name);
        if (options.MaxPlayers is < 2 or > 8 || !new[] { 0, 120, 180, 300 }.Contains(options.DurationSeconds))
            throw new RoomError(400, "Elige de 2 a 8 jugadores y un tiempo válido.");
        lock (gate)
        {
            Sweep();
            if (rooms.Count >= 200) throw new RoomError(503, "Hay muchas salas abiertas. Intenta más tarde.");
            const string alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
            string code;
            do { code = new string(Enumerable.Range(0, 6).Select(_ => alphabet[RandomNumberGenerator.GetInt32(alphabet.Length)]).ToArray()); } while (rooms.ContainsKey(code));
            var room = new SkeeRoom(code, options, clock);
            rooms.Add(code, room);
            return room.Join(name);
        }
    }
    public SkeeRoom Get(string code)
    {
        lock (gate)
        {
            if (!rooms.TryGetValue(code.Trim().ToUpperInvariant(), out var room) || room.Expired)
                throw new RoomError(404, "La sala Skee-Ball no existe o ha caducado.");
            return room;
        }
    }
    public void Sweep()
    {
        lock (gate) foreach (var pair in rooms.ToArray()) { pair.Value.Tick(); if (pair.Value.Expired) rooms.Remove(pair.Key); }
    }
}

public sealed class SkeeRoom(string code, SkeeOptions options, TimeProvider clock) : IChatRoom
{
    readonly RoomChat chat = new();
    public ChatView ReadChat(string token, long after) { lock (gate) { var p = Auth(token); return chat.Read(p.Id, after); } }
    public ChatView SendChat(string token, ChatPost input) { lock (gate) { var p = Auth(token); return chat.Send(p.Id, p.Name, input, Now); } }

    sealed class Player(string name, long now)
    {
        public string Id = Guid.NewGuid().ToString("N"), Token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)), Name = name;
        public long Seen = now, LastShot;
        public bool Left;
        public List<SkeeShot> Shots = new();
    }
    readonly object gate = new();
    readonly List<Player> players = new();
    readonly long created = clock.GetUtcNow().ToUnixTimeMilliseconds();
    long touched = clock.GetUtcNow().ToUnixTimeMilliseconds();
    string status = "lobby", host = "";
    int round;
    long? endsAt;
    string? reason;
    string[] winners = [];
    long Now => clock.GetUtcNow().ToUnixTimeMilliseconds();
    public bool Expired { get { lock (gate) return Now - touched > 1_800_000 || Now - created > 21_600_000; } }
    public void Tick() { lock (gate) Update(); }
    void Update()
    {
        foreach (var p in players.Where(p => !p.Left && Now - p.Seen > 120_000)) p.Left = true;
        if (!players.Any(p => p.Id == host && !p.Left)) host = players.FirstOrDefault(p => !p.Left)?.Id ?? "";
        if (status != "playing") return;
        var eligible = players.Where(p => !p.Left).ToArray();
        if (endsAt <= Now) Finish("time");
        else if (eligible.Length == 0 || eligible.All(p => p.Shots.Count == 9)) Finish("balls");
    }
    void Finish(string why)
    {
        status = "finished"; reason = why;
        var eligible = players.Where(p => !p.Left && p.Shots.Count > 0).ToArray();
        winners = eligible.Length == 0 ? [] : eligible.Where(p => p.Shots.Sum(s => s.Points) == eligible.Max(x => x.Shots.Sum(s => s.Points))).Select(p => p.Id).ToArray();
    }
    Player Auth(string token)
    {
        Update();
        var p = players.FirstOrDefault(p => p.Token == token && !p.Left) ?? throw new RoomError(401, "Tu sesión terminó. Vuelve a ingresar a una sala.");
        p.Seen = touched = Now; return p;
    }
    void Round(int value) { if (value != round) throw new RoomError(409, "La ronda cambió. Actualiza la partida."); }
    public SkeeSession Join(string? rawName)
    {
        var name = GameRoom.ValidateName(rawName);
        lock (gate)
        {
            Update();
            if (status != "lobby") throw new RoomError(409, "Esta partida ya comenzó. Espera una revancha.");
            if (players.Count(p => !p.Left) >= options.MaxPlayers) throw new RoomError(409, "La sala está llena.");
            if (players.Any(p => !p.Left && p.Name.Equals(name, StringComparison.OrdinalIgnoreCase))) throw new RoomError(409, "Ese nombre ya está en la sala.");
            players.RemoveAll(p => p.Left);
            var p = new Player(name, Now); players.Add(p); if (host == "") host = p.Id; touched = Now;
            return new(code, p.Token, View(p));
        }
    }
    SkeeView View(Player p) => new(code, status, round, host, p.Id, options.MaxPlayers, options.DurationSeconds, 9, Now, endsAt, reason, winners,
        players.Select(x => new SkeePlayerView(x.Id, x.Name, x.Shots.Sum(s => s.Points), x.Left, !x.Left && Now - x.Seen < 15_000, x.Shots.ToArray())).ToArray());
    public SkeeView Read(string token) { lock (gate) { var p = Auth(token); return View(p); } }
    public SkeeView Start(string token, int expectedRound)
    {
        lock (gate)
        {
            var p = Auth(token); Round(expectedRound);
            if (p.Id != host) throw new RoomError(403, "Solo el anfitrión puede comenzar.");
            if (status != "lobby" || players.Count(p => !p.Left) < 2) throw new RoomError(409, "Se necesitan al menos dos jugadores en la sala.");
            players.RemoveAll(p => p.Left); status = "playing"; endsAt = options.DurationSeconds == 0 ? null : Now + options.DurationSeconds * 1000L;
            return View(p);
        }
    }
    // Same geometry as the visible target board; the server alone awards points.
    public static SkeeShot Calculate(int number, double aim, double power)
    {
        if (!double.IsFinite(aim) || !double.IsFinite(power) || aim < -1 || aim > 1 || power < 0 || power > 1)
            throw new RoomError(400, "La dirección o la fuerza no son válidas.");
        double x = 300 + aim * 220, y = 410 - power * 345;
        (double x, double y, double r, int points)[] targets = [(135,100,26,100),(465,100,26,100),(300,85,25,50),(300,145,27,40),(300,210,30,30),(300,280,34,20),(300,360,40,10)];
        var points = targets.FirstOrDefault(t => Math.Pow(x - t.x, 2) + Math.Pow(y - t.y, 2) <= t.r * t.r).points;
        return new(number, x, y, points);
    }
    public SkeeView Shoot(string token, int expectedRound, int number, double aim, double power)
    {
        lock (gate)
        {
            var p = Auth(token); Round(expectedRound);
            if (number >= 1 && number <= p.Shots.Count) return View(p); // Retrying a request never spends another ball.
            if (status != "playing") throw new RoomError(409, "La ronda no está en juego.");
            if (number != p.Shots.Count + 1 || number > 9) throw new RoomError(409, "Ese lanzamiento ya no está disponible.");
            if (p.Shots.Count > 0 && Now - p.LastShot < 1100) throw new RoomError(409, "Espera a que termine tu lanzamiento.");
            var shot = Calculate(number, aim, power);
            p.Shots.Add(shot); p.LastShot = Now; Update(); return View(p);
        }
    }
    public SkeeView Rematch(string token, int expectedRound)
    {
        lock (gate)
        {
            var p = Auth(token); Round(expectedRound);
            if (p.Id != host) throw new RoomError(403, "Solo el anfitrión puede preparar la revancha.");
            if (status != "finished") throw new RoomError(409, "La partida todavía no termina.");
            players.RemoveAll(x => x.Left); foreach (var x in players) { x.Shots.Clear(); x.LastShot = 0; }
            round++; status = "lobby"; endsAt = null; winners = []; reason = null; return View(p);
        }
    }
    public void Leave(string token) { lock (gate) { var p = Auth(token); p.Left = true; Update(); } }
}
