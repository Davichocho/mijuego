using System.Security.Cryptography;
namespace Campo;
public record TankInput(int Round, long Sequence, int X, int Y, int AimX, int AimY, bool Fire, bool Ultimate = false);
public record TankPlayerView(string Id,string Name,double X,double Y,double Aim,int Hp,int Score,bool Left,long RespawnAt,long ShieldUntil,long LastFire,int Deaths,string Style,int Color,string Ultimate,long UltimateReadyAt,long UltimateShieldUntil);
public record TankLoadout(int Round,string? Style,int Color,string? Ultimate);
public record TankWallView(int Index,int Hp);
public record TankBulletView(long Id,double X,double Y,double Vx,double Vy,string Owner);
public record TankEvent(long Id,string Kind,double X,double Y,string Actor,string? Target,long At);
public record TankView(string Code,string Status,int Round,string HostId,string YouId,int MaxPlayers,long ServerTime,long EndsAt,string[] Map,TankPlayerView[] Players,TankBulletView[] Bullets,string[] WinnerIds,long StartsAt,TankEvent[] Events,TankWallView[] Walls);
public record TankSession(string Code,string Token,TankView Room);
public sealed class TankStore(TimeProvider clock)
{
    readonly object gate=new(); readonly Dictionary<string,TankRoom> rooms=new();
    public TankSession Create(string? name,int capacity)
    {
        GameRoom.ValidateName(name);if(capacity is <2 or >8)throw new RoomError(400,"Elige entre 2 y 8 jugadores.");
        lock(gate){Sweep();if(rooms.Count>=100)throw new RoomError(503,"Hay muchas salas. Intenta más tarde.");string code;
        do{code=Convert.ToHexString(RandomNumberGenerator.GetBytes(3));}while(rooms.ContainsKey(code));
        var room=new TankRoom(code,capacity,clock);rooms.Add(code,room);return room.Join(name);}
    }
    public TankRoom Get(string code){lock(gate){if(!rooms.TryGetValue(code.ToUpperInvariant(),out var room)||room.Expired)throw new RoomError(404,"La sala de tanques no existe o caducó.");return room;}}
    public void Sweep(){lock(gate)foreach(var p in rooms.ToArray()){p.Value.Tick();if(p.Value.Expired)rooms.Remove(p.Key);}}
}
public sealed class TankRoom(string code,int capacity,TimeProvider clock) : IChatRoom
{
    readonly RoomChat chat = new();
    public ChatView ReadChat(string token, long after) { lock (gate) { var p = Auth(token); return chat.Read(p.Id, after); } }
    public ChatView SendChat(string token, ChatPost input) { lock (gate) { var p = Auth(token); return chat.Send(p.Id, p.Name, input, Now); } }

    sealed class Player(string name,long now){public string Id=Guid.NewGuid().ToString("N"),Token=Convert.ToHexString(RandomNumberGenerator.GetBytes(32)),Name=name;public double X,Y,Aim;public int Hp=3,Score,Deaths;public bool Left;public long Seen=now,InputAt,Sequence=-1,LastFire,RespawnAt,ShieldUntil;public int Dx,Dy;public bool Fire,QueuedFire;public string Style="classic",Ultimate="shield";public int Color;public long UltimateReadyAt,UltimateShieldUntil;}
    sealed class Bullet{public long Id;public double X,Y,Vx,Vy;public string Owner="";public long Until;}
    readonly object gate=new();readonly List<Player> players=[];readonly List<Bullet> bullets=[];readonly List<TankEvent> events=[];long eventId,bulletId,starts;readonly Dictionary<int,int> wallDamage=[];
    readonly long created=clock.GetUtcNow().ToUnixTimeMilliseconds();long touched=clock.GetUtcNow().ToUnixTimeMilliseconds(),sim=clock.GetUtcNow().ToUnixTimeMilliseconds(),ends;
    string status="lobby",host="";int round;string[] map=GenerateMaze();string[] winners=[];
    long Now=>clock.GetUtcNow().ToUnixTimeMilliseconds();
    public bool Expired{get{lock(gate)return Now-touched>1_800_000||Now-created>21_600_000;}}
    public static string[] GenerateMaze()
    {
        var grid=Enumerable.Range(0,15).Select(_=>Enumerable.Repeat('#',21).ToArray()).ToArray();var stack=new Stack<(int x,int y)>();grid[1][1]='.';stack.Push((1,1));
        while(stack.Count>0){var c=stack.Peek();var choices=new[]{(2,0),(-2,0),(0,2),(0,-2)}.Select(d=>(x:c.x+d.Item1,y:c.y+d.Item2)).Where(n=>n.x>0&&n.x<20&&n.y>0&&n.y<14&&grid[n.y][n.x]=='#').ToArray();if(choices.Length==0){stack.Pop();continue;}var n=choices[RandomNumberGenerator.GetInt32(choices.Length)];grid[(c.y+n.y)/2][(c.x+n.x)/2]='.';grid[n.y][n.x]='.';stack.Push(n);}
        // Remove dead ends and mirror the routes, creating equal cover at opposite ends.
        for(int pass=0;pass<2;pass++)
            for(int y=1;y<14;y++)for(int x=1;x<20;x++)
                if(grid[y][x]=='.')
                {
                    var directions=new[]{(1,0),(-1,0),(0,1),(0,-1)};
                    if(directions.Count(d=>grid[y+d.Item2][x+d.Item1]=='.')!=1)continue;
                    var exits=directions.Where(d=>x+2*d.Item1>0&&x+2*d.Item1<20&&y+2*d.Item2>0&&y+2*d.Item2<14&&grid[y+d.Item2][x+d.Item1]=='#'&&grid[y+2*d.Item2][x+2*d.Item1]=='.').ToArray();
                    if(exits.Length>0){var d=exits[RandomNumberGenerator.GetInt32(exits.Length)];grid[y+d.Item2][x+d.Item1]='.';}
                }
        for(int y=1;y<14;y++)for(int x=1;x<20;x++)if(grid[y][x]=='.')grid[14-y][20-x]='.';
        // Central courtyard and four approach lanes remain connected to the maze.
        for(int y=5;y<=9;y++)for(int x=8;x<=12;x++)grid[y][x]='.';
        return grid.Select(r=>new string(r)).ToArray();
    }
    bool Wall(double x,double y,double radius){int left=(int)Math.Floor((x-radius)/40),right=(int)Math.Floor((x+radius)/40),top=(int)Math.Floor((y-radius)/40),bottom=(int)Math.Floor((y+radius)/40);for(int yy=top;yy<=bottom;yy++)for(int xx=left;xx<=right;xx++)if(xx<0||xx>=21||yy<0||yy>=15||map[yy][xx]=='#')return true;return false;}
    void Spawn(Player p,long now)
    {
        var spots=new List<(double x,double y)>();for(int y=1;y<14;y++)for(int x=1;x<20;x++)if(map[y][x]=='.')spots.Add((x*40+20,y*40+20));
        var alive=players.Where(q=>q!=p&&!q.Left&&q.Hp>0).ToArray();var chosen=spots.OrderByDescending(s=>alive.Length==0?RandomNumberGenerator.GetInt32(1000):alive.Min(q=>Math.Pow(q.X-s.x,2)+Math.Pow(q.Y-s.y,2))).First();
        p.X=chosen.x;p.Y=chosen.y;p.Hp=3;p.RespawnAt=0;p.ShieldUntil=now+2000;p.Dx=p.Dy=0;p.Fire=p.QueuedFire=false;p.UltimateShieldUntil=0;
    }
    public TankView SetLoadout(string token,TankLoadout input)
    {
        lock(gate)
        {
            var p=Auth(token);CheckRound(input.Round);
            if(status!="lobby")throw new RoomError(409,"Elige tu estilo y ulti antes de iniciar la ronda.");
            if(input.Style is not ("classic" or "scout" or "heavy")||input.Color is <0 or >7||input.Ultimate is not ("shield" or "repair" or "burst"))
                throw new RoomError(400,"El estilo, color o ulti no son válidos.");
            p.Style=input.Style;p.Color=input.Color;p.Ultimate=input.Ultimate;return View(p);
        }
    }
    void FireBullet(Player p,double angle,long time)
    {
        bullets.Add(new Bullet{Id=++bulletId,X=p.X,Y=p.Y,Vx=Math.Cos(angle)*4,Vy=Math.Sin(angle)*4,Owner=p.Id,Until=time+2500});
    }
    void ActivateUltimate(Player p,long time)
    {
        if(p.Hp==0||time<starts||time<p.UltimateReadyAt)return;
        // A full-health repair does not consume the ability.
        if(p.Ultimate=="repair"&&p.Hp==3)return;
        p.UltimateReadyAt=time+25000;
        if(p.Ultimate=="shield")p.UltimateShieldUntil=time+3000;
        else if(p.Ultimate=="repair")p.Hp=Math.Min(3,p.Hp+2);
        else {p.LastFire=time;p.ShieldUntil=0;p.QueuedFire=false;foreach(var angle in new[]{p.Aim-.22,p.Aim,p.Aim+.22})FireBullet(p,angle,time);}
        Emit("ulti-"+p.Ultimate,p.X,p.Y,p.Id,null,time);
    }
    void HitWall(Bullet bullet,long time)
    {
        for(int y=(int)Math.Floor((bullet.Y-3)/40);y<=(int)Math.Floor((bullet.Y+3)/40);y++)
        for(int x=(int)Math.Floor((bullet.X-3)/40);x<=(int)Math.Floor((bullet.X+3)/40);x++)
        {
            if(x<0||y<0||x>=21||y>=15)continue;
            if(map[y][x]!='#')continue;
            if(x==0||x==20||y==0||y==14){Emit("wall",bullet.X,bullet.Y,bullet.Owner,null,time);return;}
            int index=y*21+x,hp=wallDamage.GetValueOrDefault(index,4)-1;
            if(hp==0){var row=map[y].ToCharArray();row[x]='.';map[y]=new string(row);wallDamage.Remove(index);Emit("wall-break",x*40+20,y*40+20,bullet.Owner,null,time);}
            else{wallDamage[index]=hp;Emit("wall-damage",bullet.X,bullet.Y,bullet.Owner,null,time);}
            return;
        }
    }
    void Emit(string kind,double x,double y,string actor,string? target,long at)
    {
        events.Add(new(++eventId,kind,x,y,actor,target,at));
        if(events.Count>128)events.RemoveRange(0,events.Count-128);
    }
    public void Tick(){lock(gate)Update();}
    void Update()
    {
        var now=Now;events.RemoveAll(e=>now-e.At>4000);foreach(var p in players.Where(p=>!p.Left&&now-p.Seen>30_000)){p.Left=true;p.Fire=false;}
        if(!players.Any(p=>p.Id==host&&!p.Left))host=players.FirstOrDefault(p=>!p.Left)?.Id??"";
        if(status!="playing"){sim=now;return;}
        if(players.Count(p=>!p.Left)<2||now>=ends){Finish();return;}
        // Bounded catch-up; inputs expire so a lost connection cannot keep moving/firing.
        if(now-sim>500)sim=now-500;
        while(sim+10<=now&&status=="playing") {sim+=10;if(sim>=starts)Step(sim);}
    }
    void Step(long time)
    {
        foreach(var p in players.Where(p=>!p.Left))
        {
            if(p.Hp==0){if(time>=p.RespawnAt){Spawn(p,time);Emit("spawn",p.X,p.Y,p.Id,null,time);}continue;}
            if(time-p.InputAt>300){p.QueuedFire=false;continue;}
            double scale=p.Dx!=0&&p.Dy!=0?Math.Sqrt(.5):1,dx=p.Dx*1.5*scale,dy=p.Dy*1.5*scale;
            if(!Wall(p.X+dx,p.Y,10))p.X+=dx;if(!Wall(p.X,p.Y+dy,10))p.Y+=dy;
            if((p.Fire||p.QueuedFire)&&time-p.LastFire>=500){p.QueuedFire=false;p.LastFire=time;p.ShieldUntil=0;FireBullet(p,p.Aim,time);Emit("shot",p.X,p.Y,p.Id,null,time);}
        }
        foreach(var b in bullets.ToArray())
        {
            b.X+=b.Vx;b.Y+=b.Vy;if(time>=b.Until||Wall(b.X,b.Y,3)){if(time<b.Until)HitWall(b,time);bullets.Remove(b);continue;}
            var hit=players.FirstOrDefault(p=>!p.Left&&p.Hp>0&&p.Id!=b.Owner&&p.ShieldUntil<=time&&p.UltimateShieldUntil<=time&&Math.Pow(p.X-b.X,2)+Math.Pow(p.Y-b.Y,2)<169);
            if(hit==null)continue;bullets.Remove(b);hit.Hp--;Emit(hit.Hp==0?"destroy":"hit",hit.X,hit.Y,b.Owner,hit.Id,time);if(hit.Hp==0){hit.Deaths++;hit.RespawnAt=time+1500;hit.Fire=hit.QueuedFire=false;hit.UltimateShieldUntil=0;var owner=players.FirstOrDefault(p=>p.Id==b.Owner&&!p.Left);if(owner!=null){owner.Score++;if(owner.Score>=5){Finish();return;}}}
        }
    }
    void Finish(){status="finished";bullets.Clear();var active=players.Where(p=>!p.Left).ToArray();winners=active.Length==0?[]:active.Where(p=>p.Score==active.Max(q=>q.Score)).Select(p=>p.Id).ToArray();}
    Player Auth(string token){Update();var p=players.FirstOrDefault(p=>p.Token==token&&!p.Left)??throw new RoomError(401,"Tu sesión terminó. Vuelve a ingresar.");p.Seen=touched=Now;return p;}
    void CheckRound(int r){if(r!=round)throw new RoomError(409,"La ronda cambió. Actualiza la partida.");}
    TankView View(Player p)=>new(code,status,round,host,p.Id,capacity,Now,ends,map.ToArray(),players.Select(q=>new TankPlayerView(q.Id,q.Name,q.X,q.Y,q.Aim,q.Hp,q.Score,q.Left,q.RespawnAt,q.ShieldUntil,q.LastFire,q.Deaths,q.Style,q.Color,q.Ultimate,q.UltimateReadyAt,q.UltimateShieldUntil)).ToArray(),bullets.Select(b=>new TankBulletView(b.Id,b.X,b.Y,b.Vx*100,b.Vy*100,b.Owner)).ToArray(),winners,starts,events.ToArray(),wallDamage.Select(w=>new TankWallView(w.Key,w.Value)).ToArray());
    public TankSession Join(string? raw){var name=GameRoom.ValidateName(raw);lock(gate){Update();if(status!="lobby")throw new RoomError(409,"La partida ya comenzó.");if(players.Count(p=>!p.Left)>=capacity)throw new RoomError(409,"Sala llena.");if(players.Any(p=>!p.Left&&p.Name.Equals(name,StringComparison.OrdinalIgnoreCase)))throw new RoomError(409,"Ese nombre ya está en uso.");players.RemoveAll(p=>p.Left);var p=new Player(name,Now){Color=players.Count%8};players.Add(p);if(host=="")host=p.Id;Spawn(p,Now);touched=Now;return new(code,p.Token,View(p));}}
    public TankView Read(string token){lock(gate){var p=Auth(token);return View(p);}}
    public TankView Start(string token,int r){lock(gate){var p=Auth(token);CheckRound(r);if(p.Id!=host)throw new RoomError(403,"Solo el anfitrión puede iniciar.");if(status!="lobby"||players.Count(q=>!q.Left)<2)throw new RoomError(409,"Se necesitan dos jugadores.");players.RemoveAll(q=>q.Left);map=GenerateMaze();foreach(var q in players){q.Hp=0;q.Score=q.Deaths=0;q.Sequence=-1;q.LastFire=0;}starts=Now+3000;events.Clear();bullets.Clear();wallDamage.Clear();foreach(var q in players){Spawn(q,starts);q.UltimateReadyAt=starts;}sim=Now;ends=starts+180_000;status="playing";return View(p);}}
    public TankView Input(string token,TankInput input){lock(gate){var p=Auth(token);CheckRound(input.Round);if(input.X is <-1 or >1||input.Y is <-1 or >1||input.AimX is <-1 or >1||input.AimY is <-1 or >1||input.Sequence<0)throw new RoomError(400,"Controles inválidos.");if(status=="playing"&&input.Sequence>p.Sequence){p.Sequence=input.Sequence;p.Dx=input.X;p.Dy=input.Y;if(input.Fire&&!p.Fire&&Now>=starts)p.QueuedFire=true;p.Fire=input.Fire&&Now>=starts;p.InputAt=Now;if(input.AimX!=0||input.AimY!=0)p.Aim=Math.Atan2(input.AimY,input.AimX);if(input.Ultimate)ActivateUltimate(p,Now);}return View(p);}}
    public TankView Rematch(string token,int r){lock(gate){var p=Auth(token);CheckRound(r);if(p.Id!=host)throw new RoomError(403,"Solo el anfitrión puede preparar la revancha.");if(status!="finished")throw new RoomError(409,"La partida no ha terminado.");players.RemoveAll(q=>q.Left);round++;status="lobby";ends=starts=0;winners=[];events.Clear();bullets.Clear();foreach(var q in players){q.Score=q.Deaths=0;q.Sequence=-1;q.LastFire=q.UltimateReadyAt=0;Spawn(q,Now);}return View(p);}}
    public void Leave(string token){lock(gate){var p=Auth(token);p.Left=true;p.Fire=false;Update();}}
}
