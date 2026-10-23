using System.Security.Cryptography;
using System.Text.RegularExpressions;

namespace Campo;

public sealed class RoomError(int status, string message) : Exception(message)
{
    public int Status { get; } = status;
}
public record RoomOptions(string Mode, int MaxPlayers, int DurationSeconds);
public record CellView(int Index, int Number, bool Mine, string? OwnerId);
public record PlayerView(string Id, string Name, int Score, bool Alive, bool Left, string? Reason, bool Connected, bool HasOpened, int StartIndex);
public record RoomView(string Code, string Status, string Mode, int MaxPlayers, int DurationSeconds,
    int Rows, int Cols, int Mines, int RemainingSafe, int Round, long Version, string HostId, string YouId,
    long ServerTime, long? StartedAt, long? EndsAt, long? FinishedAt, string? EndReason,
    string[] WinnerIds, PlayerView[] Players, CellView[] Cells, int[] Flags);
public record SessionView(string Code, string Token, RoomView Room);

public sealed class RoomStore(TimeProvider clock)
{
    private readonly object gate = new();
    private readonly Dictionary<string, GameRoom> rooms = new();
    private const string Alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    public SessionView Create(string? name, RoomOptions options)
    {
        GameRoom.ValidateName(name);
        if (options.Mode is not ("duel" or "ffa") || options.MaxPlayers < 2 || options.MaxPlayers > 8 ||
            (options.Mode == "duel" && options.MaxPlayers != 2) ||
            options.DurationSeconds is not (0 or 180 or 300 or 600 or 900))
            throw new RoomError(400, "La configuración de la sala no es válida.");
        lock (gate)
        {
            CleanLocked();
            if (rooms.Count >= 200) throw new RoomError(503, "Hay muchas salas abiertas. Intenta más tarde.");
            string code;
            do { code = string.Concat(Enumerable.Range(0, 6).Select(_ => Alphabet[RandomNumberGenerator.GetInt32(Alphabet.Length)])); }
            while (rooms.ContainsKey(code));
            var room = new GameRoom(code, options, clock);
            var session = room.Join(name);
            rooms.Add(code, room);
            return session;
        }
    }
    public GameRoom Get(string code)
    {
        code = code.Trim().ToUpperInvariant();
        if (!Regex.IsMatch(code, "^[A-Z2-9]{6}$")) throw new RoomError(404, "Ese código de sala no existe.");
        lock (gate)
        {
            if (!rooms.TryGetValue(code, out var room) || room.Expired)
                throw new RoomError(404, "La sala ya no existe. Crea otra o verifica el código.");
            return room;
        }
    }
    public void Sweep() { lock (gate) { CleanLocked(); } }
    private void CleanLocked()
    {
        foreach (var room in rooms.Values) room.Tick();
        foreach (var key in rooms.Where(p => p.Value.Expired).Select(p => p.Key).ToArray()) rooms.Remove(key);
    }
}

public sealed class GameRoom : IChatRoom
{
    readonly RoomChat chat = new();
    public ChatView ReadChat(string token, long after) { lock (gate) { TickLocked(); var p = Authenticate(token); Touch(p); return chat.Read(p.Id, after); } }
    public ChatView SendChat(string token, ChatPost input) { lock (gate) { TickLocked(); var p = Authenticate(token); Touch(p); return chat.Send(p.Id, p.Name, input, clock.GetUtcNow().ToUnixTimeMilliseconds()); } }

    private sealed class Player(string name, DateTimeOffset now)
    {
        public string Id { get; } = Guid.NewGuid().ToString("N");
        public string Token { get; } = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        public string Name { get; } = name;
        public int Score, StartIndex = -1;
        public bool HasOpened;
        public bool Alive = true, Left;
        public string? Reason;
        public DateTimeOffset Seen = now;
        
        public HashSet<int> Flags = [];
    }
    private sealed class Cell { public bool Mine, Open; public int Number; public string? OwnerId; }
    private readonly object gate = new();
    private readonly TimeProvider clock;
    private readonly List<Player> players = [];
    private readonly DateTimeOffset created;
    private DateTimeOffset activity;
    private Cell[] cells = [];
    private string host = "", status = "lobby";
    private string? endReason;
    private string[] winners = [];
    private DateTimeOffset? started, ends, finished;
    private int round = 0, opened;
    private long version;
    public const int Rows = 24, Cols = 40, MineCount = 180;
    public string Code { get; }
    public RoomOptions Options { get; }
    public GameRoom(string code, RoomOptions options, TimeProvider clock)
    {
        Code = code; Options = options; this.clock = clock; activity = created = clock.GetUtcNow();
    }
    public bool Expired { get { lock (gate) { return clock.GetUtcNow() - activity > TimeSpan.FromMinutes(30) || clock.GetUtcNow() - created > TimeSpan.FromHours(6); } } }
    public static string ValidateName(string? name)
    {
        name = name?.Trim();
        if (string.IsNullOrWhiteSpace(name) || name.Length > 18 || name.Any(char.IsControl))
            throw new RoomError(400, "Escribe un nombre de 1 a 18 caracteres.");
        return name;
    }
    public SessionView Join(string? rawName)
    {
        var name = ValidateName(rawName);
        lock (gate)
        {
            TickLocked();
            if (status != "lobby") throw new RoomError(409, "La partida ya empezó. Espera una nueva sala o una revancha.");
            if (players.Count >= Options.MaxPlayers) throw new RoomError(409, "La sala está llena.");
            if (players.Any(p => string.Equals(p.Name, name, StringComparison.OrdinalIgnoreCase)))
                throw new RoomError(409, "Ese nombre ya está en la sala. Elige otro.");
            var player = new Player(name, clock.GetUtcNow()); players.Add(player);
            if (host == "") host = player.Id;
            activity = clock.GetUtcNow(); version++;
            return new SessionView(Code, player.Token, View(player));
        }
    }
    public RoomView Read(string token)
    {
        lock (gate) { TickLocked(); var p = Authenticate(token); Touch(p); return View(p); }
    }
    public RoomView Start(string token, int expectedRound)
    {
        lock (gate)
        {
            TickLocked(); var p = Authenticate(token); Touch(p); RequireHost(p); RequireRound(expectedRound);
            if (status != "lobby") throw new RoomError(409, "La partida ya está en marcha.");
            if (players.Count < 2) throw new RoomError(409, "Se necesitan al menos dos jugadores.");
            round++; status = "playing"; started = clock.GetUtcNow(); ends = Options.DurationSeconds == 0 ? null : started.Value.AddSeconds(Options.DurationSeconds);
            finished = null; winners = []; endReason = null; opened = 0;
            foreach (var player in players) { player.Score = 0; player.Alive = true; player.Reason = null; player.Flags.Clear(); player.HasOpened = false; }
            Seed();
            version++; return View(p);
        }
    }
    private void Seed()
    {
        cells = Enumerable.Range(0, Rows * Cols).Select(_ => new Cell()).ToArray();
        // Reservas separadas: las minas quedan fijas y ninguna pista cambia después de abrirse.
        int[] starts = [4 * Cols + 6, 4 * Cols + 20, 4 * Cols + 33, 12 * Cols + 6,
            12 * Cols + 33, 20 * Cols + 6, 20 * Cols + 20, 20 * Cols + 33];
        RandomNumberGenerator.Shuffle(starts.AsSpan());
        for (var i = 0; i < players.Count; i++) players[i].StartIndex = starts[i];
        var safe = players.SelectMany(p => Neighbors(p.StartIndex).Append(p.StartIndex)).ToHashSet();
        var candidates = Enumerable.Range(0, cells.Length).Where(i => !safe.Contains(i)).ToArray();
        RandomNumberGenerator.Shuffle(candidates.AsSpan());
        foreach (var index in candidates.Take(MineCount)) cells[index].Mine = true;
        for (var i = 0; i < cells.Length; i++) cells[i].Number = Neighbors(i).Count(n => cells[n].Mine);

    }
    private static IEnumerable<int> Neighbors(int i)
    {
        var row = i / Cols; var col = i % Cols;
        for (var y = -1; y <= 1; y++) for (var x = -1; x <= 1; x++)
            if ((x != 0 || y != 0) && row + y >= 0 && row + y < Rows && col + x >= 0 && col + x < Cols)
                yield return (row + y) * Cols + col + x;
    }
    private bool Reserved(int index) => players.Any(p => p.Alive && !p.Left && !p.HasOpened &&
        (p.StartIndex == index || Neighbors(p.StartIndex).Contains(index)));
    private void Expand(int index, Player player)
    {
        var pending = new Stack<int>(); pending.Push(index);
        while (pending.TryPop(out var next))
        {
            var cell = cells[next];
            if (cell.Open || cell.Mine || player.Flags.Contains(next) || Reserved(next)) continue;
            cell.Open = true; cell.OwnerId = player.Id; opened++;
            foreach (var p in players) p.Flags.Remove(next);
            if (cell.Number == 0) foreach (var neighbor in Neighbors(next)) pending.Push(neighbor);
        }
    }
    public RoomView Move(string token, int index, bool flag, int expectedRound)
    {
        lock (gate)
        {
            TickLocked(); var p = Authenticate(token); Touch(p); RequireRound(expectedRound);
            if (status != "playing") throw new RoomError(409, "Esta partida no está en juego.");
            if (!p.Alive) throw new RoomError(403, "Quedaste fuera. Puedes seguir viendo la partida.");
            if (index < 0 || index >= cells.Length) throw new RoomError(400, "Casilla no válida.");
            var cell = cells[index];
            if (flag)
            {
                if (cell.Open) return View(p);
                if (Reserved(index)) throw new RoomError(409, "Las salidas seguras están reservadas para la primera apertura.");
                if (!p.Flags.Remove(index) && p.Flags.Count < MineCount) p.Flags.Add(index);
                version++; return View(p);
            }
            if (cell.Open) return View(p);
            if (p.Flags.Contains(index)) throw new RoomError(409, "Quita tu bandera antes de descubrir esta casilla.");
            var opening = !p.HasOpened;
            if (opening && index != p.StartIndex) throw new RoomError(409, "Abre primero tu salida segura marcada con una estrella.");
            if (!opening && Reserved(index)) throw new RoomError(409, "Esa zona está reservada para la primera apertura de otro jugador.");
            if (cell.Mine)
            {
                cell.Open = true; cell.OwnerId = p.Id; p.Score -= 20; p.Alive = false; p.Reason = "mine";
                foreach (var player in players) player.Flags.Remove(index);
            }
            else
            {
                p.HasOpened = true; Expand(index, p);
                if (!opening) p.Score += 10; // Un acierto vale lo mismo, sin premiar el tamaño aleatorio de una zona.
            }
            version++; CheckEnd();
            return View(p);
        }
    }
    public RoomView Rematch(string token, int expectedRound)
    {
        lock (gate)
        {
            TickLocked(); var p = Authenticate(token); Touch(p); RequireHost(p); RequireRound(expectedRound);
            if (status != "finished") throw new RoomError(409, "Espera a que termine la partida.");
            players.RemoveAll(player => player.Left || clock.GetUtcNow() - player.Seen > TimeSpan.FromSeconds(120));
            status = "lobby"; round++; cells = []; opened = 0; started = ends = finished = null; winners = []; endReason = null;
            foreach (var player in players) { player.Alive = true; player.Score = 0; player.Reason = null; player.Flags.Clear(); player.HasOpened = false; player.StartIndex = -1; }
            version++; return View(p);
        }
    }
    public void Leave(string token)
    {
        lock (gate)
        {
            TickLocked(); var p = Authenticate(token); p.Left = true; p.Alive = false; p.Reason = "left";
            if (status == "lobby") players.Remove(p);
            TransferHost(); version++; CheckEnd();
        }
    }
    public void Tick() { lock (gate) { TickLocked(); } }
    private void TickLocked()
    {
        var now = clock.GetUtcNow();
        if (status == "playing" && ends.HasValue && now >= ends) Finish("time", ends.Value);
        var absent = players.Where(p => !p.Left && now - p.Seen > TimeSpan.FromSeconds(120)).ToArray();
        foreach (var p in absent)
        {
            p.Left = true;
            if (status != "finished") { p.Alive = false; p.Reason = "disconnected"; }
            if (status == "lobby") players.Remove(p);
            version++;
        }
        TransferHost(); CheckEnd();
    }
    private void TransferHost()
    {
        if (!players.Any(p => p.Id == host && !p.Left)) host = players.FirstOrDefault(p => !p.Left)?.Id ?? "";
    }
    private void CheckEnd(DateTimeOffset? at = null)
    {
        if (status != "playing") return;
        if (players.Count(p => p.Alive && !p.Left) <= 1) Finish("survivor", at ?? clock.GetUtcNow());
        else if (opened == Rows * Cols - MineCount) Finish("cleared", at ?? clock.GetUtcNow());
    }
    private void Finish(string reason, DateTimeOffset at)
    {
        status = "finished"; endReason = reason; finished = at;
        var eligible = players.Where(p => p.HasOpened && !p.Left && p.Reason is not ("disconnected" or "left")).ToArray();
        winners = eligible.Length == 0 ? [] : eligible.Where(p => p.Score == eligible.Max(x => x.Score)).Select(p => p.Id).ToArray();
        version++;
    }
    private Player Authenticate(string token)
    {
        var p = players.FirstOrDefault(p => p.Token == token && !p.Left);
        return p ?? throw new RoomError(401, "Tu sesión terminó o no pertenece a esta sala. Vuelve a ingresar.");
    }
    private void Touch(Player p) { p.Seen = clock.GetUtcNow(); activity = p.Seen; }
    private void RequireHost(Player p) { if (p.Id != host) throw new RoomError(403, "Solo el anfitrión puede hacer esto."); }
    private void RequireRound(int expected) { if (expected != round) throw new RoomError(409, "La ronda cambió. Actualiza el estado e inténtalo de nuevo."); }
    private RoomView View(Player you)
    {
        var now = clock.GetUtcNow();
        // Nunca se envían minas ni números de las casillas ocultas durante la partida.
        var visible = cells.Select((cell, i) => (cell, i)).Where(x => x.cell.Open || status == "finished")
            .Select(x => new CellView(x.i, x.cell.Number, x.cell.Mine, x.cell.OwnerId)).ToArray();
        return new RoomView(Code, status, Options.Mode, Options.MaxPlayers, Options.DurationSeconds,
            Rows, Cols, MineCount, Rows * Cols - MineCount - opened, round, ++version, host, you.Id,
            now.ToUnixTimeMilliseconds(), started?.ToUnixTimeMilliseconds(), ends?.ToUnixTimeMilliseconds(), finished?.ToUnixTimeMilliseconds(), endReason,
            winners.ToArray(), players.Select(p => new PlayerView(p.Id, p.Name, p.Score, p.Alive, p.Left, p.Reason, now - p.Seen <= TimeSpan.FromSeconds(15) && !p.Left, p.HasOpened, p.StartIndex)).ToArray(),
            visible, you.Flags.Order().ToArray());
    }
}
