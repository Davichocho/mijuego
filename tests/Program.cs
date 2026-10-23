using Campo;
using System.Reflection;
using System.Collections;
using System.Collections.Concurrent;

var passed = 0;
void Test(string name, Action body) { body(); Console.WriteLine($"PASS {name}"); passed++; }
void Assert(bool condition, string message = "Assertion failed") { if (!condition) throw new Exception(message); }
void Reject(int status, Action action)
{
    try { action(); } catch (RoomError e) { Assert(e.Status == status, $"Expected {status}, got {e.Status}: {e.Message}"); return; }
    throw new Exception($"Expected error {status}");
}
object Field(object value, string name) => (value.GetType().GetField(name, BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance)?.GetValue(value) ?? value.GetType().GetProperty(name)!.GetValue(value))!;
void Set(object value, string name, object data) => value.GetType().GetField(name, BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance)!.SetValue(value, data);
(bool mine, bool open, int number, int index)[] Inspect(GameRoom room) => ((IEnumerable)Field(room,"cells")).Cast<object>()
    .Select((c,i) => ((bool)Field(c,"Mine"),(bool)Field(c,"Open"),(int)Field(c,"Number"),i)).ToArray();
(GameRoom room, FakeClock clock, SessionView[] people) Setup(int count = 3, int seconds = 0)
{
    var clock = new FakeClock(); var room = new GameRoom("ABC234",new("ffa",count,seconds),clock);
    var people = Enumerable.Range(0,count).Select(i=>room.Join($"Jugador {i+1}")).ToArray(); room.Start(people[0].Token,0);
    return (room,clock,people);
}
RoomView Read(GameRoom room, SessionView[] people) => room.Read(people[0].Token);
RoomView Play(GameRoom room, SessionView player, int index)
{
    var view=room.Read(player.Token); return room.Move(player.Token,index,false,view.Round);
}
void OpenAll(GameRoom room, SessionView[] people)
{
    foreach(var player in people) Play(room,player,room.Read(player.Token).Players.Single(p=>p.Id==player.Room.YouId).StartIndex);
}
int Safe(GameRoom room) => Inspect(room).First(c=>!c.mine&&!c.open).index;
int Mine(GameRoom room) => Inspect(room).First(c=>c.mine&&!c.open).index;
IEnumerable<int> Neighbors(int index)
{
    var row=index/40;var col=index%40;
    for(var dy=-1;dy<=1;dy++) for(var dx=-1;dx<=1;dx++)
        if((dx!=0||dy!=0)&&row+dy>=0&&row+dy<24&&col+dx>=0&&col+dx<40) yield return (row+dy)*40+col+dx;
}
Test("Input validation, capacity, unique names, host permissions and tokens",()=>
{
    var store=new RoomStore(new FakeClock()); Reject(400,()=>store.Create(" ",new("duel",2,300)));
    Reject(400,()=>store.Create("Ana",new("duel",4,300))); Reject(400,()=>store.Create("Ana",new("ffa",9,300)));
    Reject(400,()=>store.Create("Ana",new("ffa",4,42))); var a=store.Create("Ana",new("duel",2,300));var room=store.Get(a.Code);
    Reject(409,()=>room.Join("ana"));Reject(409,()=>room.Start(a.Token,0));var b=room.Join("Luis");Reject(409,()=>room.Join("Más"));
    Reject(403,()=>room.Start(b.Token,0));Reject(401,()=>room.Read("fake"));Assert(a.Token.Length==64&&a.Code.Length==6);
});
Test("Fully closed start, fixed 180 mines and no hidden numbers in snapshots",()=>
{
    var (room,_,people)=Setup(8);var view=Read(room,people);var board=Inspect(room);
    Assert(view.Cells.Length==0&&view.RemainingSafe==780&&board.Count(c=>c.mine)==180);
    Assert(view.Players.Select(p=>p.StartIndex).Distinct().Count()==8);
    Assert(view.Players.All(p=>p.Score==0&&!p.HasOpened));Reject(409,()=>room.Join("Late"));
});
Test("All players can open simultaneously, safely and without altering revealed clues",()=>
{
    var (room,_,people)=Setup(8);var original=Inspect(room);
    Parallel.ForEach(people,player=>Play(room,player,room.Read(player.Token).Players.Single(p=>p.Id==player.Room.YouId).StartIndex));
    var view=Read(room,people);Assert(view.Players.All(p=>p.HasOpened&&p.Score==0));Assert(view.Cells.All(c=>!c.Mine));
    foreach(var p in view.Players) foreach(var i in Neighbors(p.StartIndex).Append(p.StartIndex))Assert(view.Cells.Any(c=>c.Index==i));
    Assert(Inspect(room).Select(c=>(c.mine,c.number)).SequenceEqual(original.Select(c=>(c.mine,c.number))));
});
Test("Blank expansion matches flood fill and protects unopened personal areas",()=>
{
    var (room,_,people)=Setup();var before=Read(room,people);var actor=before.Players[0];var board=Inspect(room);
    var reserved=before.Players.Skip(1).SelectMany(p=>Neighbors(p.StartIndex).Append(p.StartIndex)).ToHashSet();
    var expected=new HashSet<int>();var queue=new Stack<int>();queue.Push(actor.StartIndex);
    while(queue.TryPop(out var i)){if(board[i].mine||reserved.Contains(i)||!expected.Add(i))continue;if(board[i].number==0)foreach(var j in Neighbors(i))queue.Push(j);}
    var result=Play(room,people[0],actor.StartIndex);Assert(result.Cells.Select(c=>c.Index).ToHashSet().SetEquals(expected));
    Assert(result.Cells.Length>=9&&result.Cells.All(c=>!c.Mine));
    foreach(var pending in result.Players.Where(p=>!p.HasOpened))Assert(!result.Cells.Any(c=>c.Index==pending.StartIndex));
});
Test("A player can play repeatedly without waiting for any other player to open",()=>
{
    var (room,_,people)=Setup();var initial=Read(room,people);var player=people[2];
    Reject(409,()=>Play(room,player,Mine(room)));
    Play(room,player,initial.Players[2].StartIndex);
    for(var n=0;n<5;n++)
    {
        var view=Read(room,people);var reserved=view.Players.Where(p=>!p.HasOpened).SelectMany(p=>Neighbors(p.StartIndex).Append(p.StartIndex)).ToHashSet();
        Play(room,player,Inspect(room).First(c=>!c.mine&&!c.open&&!reserved.Contains(c.index)).index);
    }
    var result=Read(room,people);Assert(result.Players[2].Score==50);Assert(result.Players.Take(2).All(p=>!p.HasOpened&&p.Score==0));
});
Test("Simultaneous competition and duplicate clicks score a shared cell exactly once",()=>
{
    var (room,_,people)=Setup();OpenAll(room,people);var index=Safe(room);var before=Read(room,people);
    Parallel.For(0,90,i=>room.Move(people[i%3].Token,index,false,before.Round));
    var result=Read(room,people);Assert(result.Players.Sum(p=>p.Score)==10);Assert(result.Cells.Count(c=>c.Index==index)==1);
});
Test("Flags are private, block own reveals and clear when another player opens the cell",()=>
{
    var (room,_,people)=Setup();OpenAll(room,people);var view=Read(room,people);var index=Safe(room);
    room.Move(people[0].Token,index,true,view.Round);Assert(room.Read(people[1].Token).Flags.Length==0);
    Reject(409,()=>Play(room,people[0],index));Play(room,people[1],index);Assert(room.Read(people[0].Token).Flags.Length==0);
    Assert(Read(room,people).Players[1].Score==10);
});
Test("Thinking while connected has no per-move deadline, penalty or elimination",()=>
{
    var (room,clock,people)=Setup();OpenAll(room,people);
    for(var n=0;n<10;n++){clock.Advance(60);foreach(var player in people)room.Read(player.Token);room.Tick();}
    var view=Read(room,people);Assert(view.Status=="playing"&&view.Players.All(p=>p.Alive&&p.Score==0));
    Play(room,people[1],Safe(room));Play(room,people[1],Safe(room));Assert(Read(room,people).Players[1].Score==20);
});
Test("Mines eliminate and deduct twenty; a high-scoring eliminated player can win",()=>
{
    var (room,_,people)=Setup();OpenAll(room,people);
    var leader=((IEnumerable)Field(room,"players")).Cast<object>().First();Set(leader,"Score",80);
    var result=Play(room,people[0],Mine(room));Assert(!result.Players[0].Alive&&result.Players[0].Score==60&&result.Status=="playing");
    Reject(403,()=>Play(room,people[0],Safe(room)));result=Play(room,people[1],Mine(room));
    Assert(result.Status=="finished"&&result.WinnerIds.SequenceEqual(new[]{people[0].Room.YouId}));
});
Test("General deadline still ends the match and preserves ties",()=>
{
    var (room,clock,people)=Setup(seconds:180);OpenAll(room,people);
    clock.Advance(90);foreach(var player in people)room.Read(player.Token);clock.Advance(90);room.Tick();
    var result=Read(room,people);Assert(result.Status=="finished"&&result.EndReason=="time"&&result.WinnerIds.Length==3);
    Assert(result.FinishedAt==result.EndsAt);Reject(409,()=>Play(room,people[0],0));
});
Test("Clearing the field awards ten per manual decision, not per automatically revealed cell",()=>
{
    var (room,_,people)=Setup();OpenAll(room,people);var moves=0;
    while(Read(room,people).Status=="playing"){Play(room,people[moves%3],Safe(room));moves++;}
    var result=Read(room,people);Assert(result.EndReason=="cleared"&&result.RemainingSafe==0);Assert(result.Players.Sum(p=>p.Score)==moves*10);
});
Test("Leave, host transfer and rematch reset state and reject previous-round requests",()=>
{
    var (room,_,people)=Setup();OpenAll(room,people);room.Leave(people[0].Token);Assert(room.Read(people[1].Token).HostId==people[1].Room.YouId);
    room.Leave(people[2].Token);var view=room.Read(people[1].Token);Assert(view.WinnerIds.SequenceEqual(new[]{people[1].Room.YouId}));
    view=room.Rematch(people[1].Token,view.Round);room.Join("Nuevo");view=room.Start(people[1].Token,view.Round);
    Assert(view.Cells.Length==0&&view.Players.All(p=>!p.HasOpened&&p.Score==0));Reject(409,()=>room.Move(people[1].Token,0,false,1));
});
Test("Disconnected players still leave after 120 seconds, rooms expire and indices are validated",()=>
{
    var clock=new FakeClock();var store=new RoomStore(clock);var a=store.Create("Ana",new("duel",2,0));var room=store.Get(a.Code);var b=room.Join("Luis");
    clock.Advance(100);room.Read(b.Token);clock.Advance(21);room.Tick();Assert(room.Read(b.Token).HostId==b.Room.YouId);Reject(401,()=>room.Read(a.Token));
    room.Join("Sofía");var view=room.Start(b.Token,0);Reject(400,()=>room.Move(b.Token,-1,false,view.Round));Reject(400,()=>room.Move(b.Token,960,false,view.Round));
    clock.Advance(1801);store.Sweep();Reject(404,()=>store.Get(a.Code));
});

Test("Skee scoring matches every target, misses and validates input",()=>
{
    (double x,double y,int points)[] targets=[(135,100,100),(465,100,100),(300,85,50),(300,145,40),(300,210,30),(300,280,20),(300,360,10),(80,410,0)];
    foreach(var t in targets) Assert(SkeeRoom.Calculate(1,(t.x-300)/220,(410-t.y)/345).Points==t.points);
    Reject(400,()=>SkeeRoom.Calculate(1,double.NaN,.5));Reject(400,()=>SkeeRoom.Calculate(1,0,double.PositiveInfinity));
    Reject(400,()=>SkeeRoom.Calculate(1,1.01,.5));Reject(400,()=>SkeeRoom.Calculate(1,0,-.1));
});
Test("Skee lobby enforces capacity, host, authentication and names",()=>
{
    var clock=new FakeClock();var store=new SkeeStore(clock);
    Reject(400,()=>store.Create("Ana",new(9,180)));Reject(400,()=>store.Create("Ana",new(2,7)));
    var a=store.Create("Ana",new(2,180));var room=store.Get(a.Code.ToLower());
    Reject(409,()=>room.Start(a.Token,0));Reject(409,()=>room.Join("ANA"));
    var b=room.Join("Luis");Reject(409,()=>room.Join("Otra"));Reject(401,()=>room.Read("invalid"));Reject(403,()=>room.Start(b.Token,0));
    room.Start(a.Token,0);Reject(409,()=>room.Join("Otra"));Reject(409,()=>room.Shoot(a.Token,1,1,0,.5));
});
Test("Skee simultaneous shots are independent and duplicate requests are idempotent",()=>
{
    var clock=new FakeClock();var room=new SkeeRoom("ABC234",new(2,0),clock);var a=room.Join("Ana");var b=room.Join("Luis");room.Start(a.Token,0);
    Parallel.For(0,20,i=>room.Shoot(i%2==0?a.Token:b.Token,0,1,-.75,310d/345));
    var state=room.Read(a.Token);Assert(state.Players.All(p=>p.Score==100&&p.Shots.Length==1));
    Reject(409,()=>room.Shoot(a.Token,0,2,0,.5));Reject(409,()=>room.Shoot(a.Token,0,3,0,.5));
    clock.Advance(1.1);room.Shoot(a.Token,0,2,0,50d/345);Assert(room.Read(a.Token).Players[0].Score==110);
});
Test("Skee gives each player nine balls, waits for others, ties and resets rematches",()=>
{
    var clock=new FakeClock();var room=new SkeeRoom("ABC234",new(2,0),clock);var a=room.Join("Ana");var b=room.Join("Luis");room.Start(a.Token,0);
    for(int i=1;i<=9;i++){room.Shoot(a.Token,0,i,0,50d/345);clock.Advance(1.2);}
    Assert(room.Read(a.Token).Status=="playing");Reject(409,()=>room.Shoot(a.Token,0,10,0,.5));
    for(int i=1;i<=9;i++){room.Shoot(b.Token,0,i,0,50d/345);clock.Advance(1.2);}
    var state=room.Read(a.Token);Assert(state.Status=="finished"&&state.WinnerIds.Length==2&&state.Players.All(p=>p.Score==90));
    Assert(room.Shoot(a.Token,0,9,0,.7).Players[0].Score==90);Reject(403,()=>room.Rematch(b.Token,0));
    state=room.Rematch(a.Token,0);Assert(state.Round==1&&state.Status=="lobby"&&state.Players.All(p=>p.Shots.Length==0&&p.Score==0));
    room.Start(a.Token,1);Reject(409,()=>room.Shoot(a.Token,0,1,0,.5));
});
Test("Skee deadline is server controlled and no-shot players cannot win",()=>
{
    var clock=new FakeClock();var room=new SkeeRoom("ABC234",new(2,120),clock);var a=room.Join("Ana");var b=room.Join("Luis");room.Start(a.Token,0);
    room.Shoot(a.Token,0,1,0,325d/345);clock.Advance(90);room.Read(a.Token);room.Read(b.Token);clock.Advance(30);
    var state=room.Read(b.Token);Assert(state.Status=="finished"&&state.EndReason=="time"&&state.WinnerIds.SequenceEqual(new[]{a.Room.YouId}));
    Reject(409,()=>room.Shoot(b.Token,0,1,0,.5));
});
Test("Skee disconnect excludes score, transfers host and expires rooms",()=>
{
    var clock=new FakeClock();var store=new SkeeStore(clock);var a=store.Create("Ana",new(2,0));var room=store.Get(a.Code);var b=room.Join("Luis");room.Start(a.Token,0);
    room.Shoot(a.Token,0,1,-.75,310d/345);clock.Advance(90);room.Read(b.Token);clock.Advance(31);room.Tick();
    Assert(room.Read(b.Token).HostId==b.Room.YouId);Reject(401,()=>room.Read(a.Token));
    for(int i=1;i<=9;i++){room.Shoot(b.Token,0,i,0,50d/345);clock.Advance(1.2);}
    Assert(room.Read(b.Token).WinnerIds.SequenceEqual(new[]{b.Room.YouId}));
    clock.Advance(1801);store.Sweep();Reject(404,()=>store.Get(a.Code));
});

(TankRoom room,FakeClock clock,TankSession a,TankSession b) TankSetup(string ultimate="shield",string style="classic",int color=0)
{
 var c=new FakeClock();var r=new TankRoom("ABC123",2,c);var a=r.Join("Ana");var b=r.Join("Luis");r.SetLoadout(a.Token,new(0,style,color,ultimate));r.Start(a.Token,0);c.Advance(3);r.Tick();return(r,c,a,b);
}
object TankPerson(TankRoom room,int index)=>((IEnumerable)Field(room,"players")).Cast<object>().ElementAt(index);
void OpenTankMap(TankRoom room)=>Set(room,"map",Enumerable.Range(0,15).Select(y=>y==0||y==14?new string('#',21):"#"+new string('.',19)+"#").ToArray());
Test("Tank mazes have connected corridors and solid exterior walls",()=>
{
 for(int n=0;n<10;n++){var map=TankRoom.GenerateMaze();var seen=new HashSet<(int,int)>();var q=new Queue<(int x,int y)>();q.Enqueue((1,1));while(q.TryDequeue(out var c)){if(!seen.Add(c))continue;foreach(var d in new[]{(1,0),(-1,0),(0,1),(0,-1)}){var x=c.x+d.Item1;var y=c.y+d.Item2;if(y>=0&&y<15&&x>=0&&x<21&&map[y][x]=='.'&&!seen.Contains((x,y)))q.Enqueue((x,y));}}Assert(seen.Count==map.Sum(r=>r.Count(c=>c=='.')));Assert(map[0].All(c=>c=='#')&&map[14].All(c=>c=='#')&&map.All(r=>r[0]=='#'&&r[20]=='#'));}
});
Test("Tank arenas are symmetric with an open central courtyard",()=>
{
 for(int n=0;n<30;n++){var map=TankRoom.GenerateMaze();for(int y=0;y<15;y++)for(int x=0;x<21;x++)Assert(map[y][x]==map[14-y][20-x]);for(int y=5;y<=9;y++)for(int x=8;x<=12;x++)Assert(map[y][x]=='.');}
});
Test("Tank countdown blocks movement and shots and preserves the full round time",()=>
{
 var clock=new FakeClock();var room=new TankRoom("ABC123",2,clock);var a=room.Join("Ana");room.Join("Luis");var state=room.Start(a.Token,0);var x=state.Players[0].X;Assert(state.StartsAt-state.ServerTime==3000&&state.EndsAt-state.StartsAt==180000);
 room.Input(a.Token,new(0,1,1,0,1,0,true));clock.Advance(.2);state=room.Read(a.Token);Assert(state.Players[0].X==x&&state.Bullets.Length==0&&state.Events.Length==0);
 clock.Advance(2.8);room.Tick();state=room.Read(a.Token);Assert(state.Players[0].ShieldUntil>state.ServerTime);
});
Test("Tank short fire taps are queued once, with authoritative shot and hit events",()=>
{
 var(room,clock,a,b)=TankSetup();OpenTankMap(room);var p=TankPerson(room,0);var target=TankPerson(room,1);Set(p,"X",100d);Set(p,"Y",100d);Set(target,"X",200d);Set(target,"Y",100d);Set(target,"ShieldUntil",0L);
 room.Input(a.Token,new(0,1,0,0,1,0,true));room.Input(a.Token,new(0,2,0,0,1,0,false));
 for(int i=0;i<5;i++){clock.Advance(.1);room.Tick();}var state=room.Read(a.Token);Assert(state.Players[1].Hp==2&&state.Events.Count(e=>e.Kind=="shot")==1&&state.Events.Count(e=>e.Kind=="hit")==1);Assert(state.Events.Select(e=>e.Id).Distinct().Count()==state.Events.Length);Assert(state.Players[0].LastFire>0);
});
Test("Tank permissions, names, capacity, input validation and old rounds",()=>
{
 var clock=new FakeClock();var store=new TankStore(clock);Reject(400,()=>store.Create("Ana",9));var a=store.Create("Ana",2);var room=store.Get(a.Code);Reject(409,()=>room.Join("ANA"));var b=room.Join("Luis");Reject(409,()=>room.Join("Otra"));Reject(403,()=>room.Start(b.Token,0));Reject(401,()=>room.Read("bad"));room.Start(a.Token,0);Reject(409,()=>room.Input(a.Token,new(1,1,0,0,0,0,false)));Reject(400,()=>room.Input(a.Token,new(0,1,2,0,0,0,false)));
});
Test("Tank movement respects walls, aim is independent, stale inputs stop",()=>
{
 var(room,clock,a,b)=TankSetup();OpenTankMap(room);var p=TankPerson(room,0);Set(p,"X",60d);Set(p,"Y",60d);
 room.Input(a.Token,new(0,1,-1,0,0,1,false));for(int i=0;i<4;i++){clock.Advance(.1);room.Tick();}
 var v=room.Read(a.Token).Players[0];Assert(v.X>=50&&v.X<60&&Math.Abs(v.Aim-Math.PI/2)<.001);
 room.Input(a.Token,new(0,2,1,0,-1,0,false));clock.Advance(.1);room.Tick();var x=room.Read(a.Token).Players[0].X;Assert(x>v.X);
 room.Input(a.Token,new(0,1,-1,0,0,1,false));clock.Advance(.1);room.Tick();Assert(room.Read(a.Token).Players[0].X>x);
 clock.Advance(.3);room.Tick();x=room.Read(a.Token).Players[0].X;clock.Advance(.3);room.Tick();Assert(room.Read(a.Token).Players[0].X==x);
});
Test("Tank server awards five kills and resets a rematch",()=>
{
 var(room,clock,a,b)=TankSetup();OpenTankMap(room);var p=TankPerson(room,0);var target=TankPerson(room,1);
 for(int kill=0;kill<5;kill++){Set(p,"X",100d);Set(p,"Y",100d);Set(target,"X",200d);Set(target,"Y",100d);Set(target,"Hp",1);Set(target,"ShieldUntil",0L);room.Input(a.Token,new(0,kill+1,0,0,1,0,true));for(int j=0;j<6;j++){clock.Advance(.1);room.Tick();}Assert(room.Read(a.Token).Players[0].Score==kill+1);}
 var result=room.Read(a.Token);Assert(result.Status=="finished"&&result.WinnerIds.SequenceEqual(new[]{a.Room.YouId}));Reject(403,()=>room.Rematch(b.Token,0));result=room.Rematch(a.Token,0);Assert(result.Round==1&&result.Status=="lobby"&&result.Players.All(p=>p.Score==0&&p.Hp==3));
});
Test("Tank bullets cannot pass walls or spawn protection; destroyed tanks respawn",()=>
{
 var(room,clock,a,b)=TankSetup();OpenTankMap(room);var p=TankPerson(room,0);var target=TankPerson(room,1);Set(p,"X",100d);Set(p,"Y",100d);Set(target,"X",200d);Set(target,"Y",100d);
 room.Input(a.Token,new(0,1,0,0,1,0,true));for(int j=0;j<5;j++){clock.Advance(.1);room.Tick();}Assert(room.Read(a.Token).Players[1].Hp==3);
 var map=(string[])Field(room,"map");var row=map[2].ToCharArray();row[4]='#';map[2]=new string(row);Set(target,"ShieldUntil",0L);room.Input(a.Token,new(0,2,0,0,1,0,true));for(int j=0;j<5;j++){clock.Advance(.1);room.Tick();}Assert(room.Read(a.Token).Players[1].Hp==3);
 OpenTankMap(room);Set(target,"Hp",1);room.Input(a.Token,new(0,3,0,0,1,0,true));for(int j=0;j<5;j++){clock.Advance(.1);room.Tick();}Assert(room.Read(a.Token).Players[1].Hp==0);
 for(int j=0;j<20;j++){clock.Advance(.1);room.Tick();}var view=room.Read(b.Token);Assert(view.Players[1].Hp==3&&view.Players[1].ShieldUntil>view.ServerTime);
});
Test("Tank timeout, disconnect and host transfer are server controlled",()=>
{
 var(room,clock,a,b)=TankSetup();for(int i=0;i<9;i++){clock.Advance(20);room.Read(a.Token);room.Read(b.Token);}Assert(room.Read(a.Token).Status=="finished"&&room.Read(a.Token).WinnerIds.Length==2);
 room.Rematch(a.Token,0);clock.Advance(20);room.Read(b.Token);clock.Advance(11);room.Tick();Assert(room.Read(b.Token).HostId==b.Room.YouId);Reject(401,()=>room.Read(a.Token));
});

Test("Shared chat validates messages, deduplicates retries, limits rate and bounds history",()=>
{
 var chat=new RoomChat();var id=Guid.NewGuid().ToString();var post=new ChatPost(" Hola <b>equipo</b> ",id);
 var first=chat.Send("p1","Ana",post,10000);Assert(first.Messages.Single().Text=="Hola <b>equipo</b>");
 Assert(chat.Send("p1","Ana",post,10001).LatestId==1);Reject(429,()=>chat.Send("p1","Ana",new("Otra",Guid.NewGuid().ToString()),10002));
 Reject(400,()=>chat.Send("p1","Ana",new("",id),11000));Reject(400,()=>chat.Send("p1","Ana",new(new string('x',281),id),11000));Reject(400,()=>chat.Send("p1","Ana",new("a\nb",id),11000));Reject(400,()=>chat.Send("p1","Ana",new("Hola","bad"),11000));
 for(int i=0;i<70;i++)chat.Send("p1","Ana",new("Mensaje "+i,Guid.NewGuid().ToString()),12000+i*1000);
 var history=chat.Read("p2",0);Assert(history.Messages.Length==60&&history.LatestId==71&&history.Messages[0].Id==12);Assert(chat.Read("p2",70).Messages.Single().Id==71);
});
Test("Every game uses authenticated room-scoped chat, including identical room codes",()=>
{
 var clock=new FakeClock();var mines=new GameRoom("ABC234",new("duel",2,0),clock);var ma=mines.Join("Ana");var mb=mines.Join("Luis");
 var skee=new SkeeRoom("ABC234",new(2,0),clock);var sa=skee.Join("Ana");skee.Join("Luis");
 var tanks=new TankRoom("ABC234",2,clock);var ta=tanks.Join("Ana");var tb=tanks.Join("Luis");
 IChatRoom[] rooms=[mines,skee,tanks];string[] tokens=[ma.Token,sa.Token,ta.Token];
 for(int i=0;i<3;i++){var view=rooms[i].SendChat(tokens[i],new("Sala "+i,Guid.NewGuid().ToString()));Assert(view.Messages.Single().Name=="Ana");Reject(401,()=>rooms[i].ReadChat(tokens[(i+1)%3],0));}
 Assert(mines.ReadChat(mb.Token,0).Messages.Single().Text=="Sala 0");Assert(skee.ReadChat(sa.Token,0).Messages.Single().Text=="Sala 1");
 tanks.Start(ta.Token,0);tanks.Leave(tb.Token);tanks.Rematch(ta.Token,0);Assert(tanks.ReadChat(ta.Token,0).Messages.Single().Text=="Sala 2");Reject(401,()=>tanks.SendChat(tb.Token,new("Fuera",Guid.NewGuid().ToString())));
 mines.Leave(mb.Token);Reject(401,()=>mines.ReadChat(mb.Token,0));skee.Leave(sa.Token);Reject(401,()=>skee.ReadChat(sa.Token,0));
});
Test("Tank loadouts validate ownership, style and color and cannot change during combat",()=>
{
 var clock=new FakeClock();var room=new TankRoom("ABC123",2,clock);var a=room.Join("Ana");var b=room.Join("Luis");
 Reject(400,()=>room.SetLoadout(a.Token,new(0,"invalid",0,"shield")));Reject(400,()=>room.SetLoadout(a.Token,new(0,"heavy",9,"shield")));Reject(400,()=>room.SetLoadout(a.Token,new(0,"heavy",1,"invalid")));
 var view=room.SetLoadout(a.Token,new(0,"scout",5,"burst"));Assert(view.Players[0].Style=="scout"&&view.Players[0].Color==5&&view.Players[0].Ultimate=="burst"&&view.Players[1].Style=="classic");
 room.Start(a.Token,0);Reject(409,()=>room.SetLoadout(a.Token,new(0,"heavy",1,"shield")));Assert(room.Read(a.Token).Players.All(p=>p.Hp==3));
});
Test("Tank shield ultimate lasts three seconds, survives firing and respects cooldown",()=>
{
 var(room,clock,a,b)=TankSetup();OpenTankMap(room);var attacker=TankPerson(room,0);var target=TankPerson(room,1);Set(attacker,"X",100d);Set(attacker,"Y",100d);Set(target,"X",200d);Set(target,"Y",100d);Set(target,"ShieldUntil",0L);
 var activated=room.Input(b.Token,new(0,1,0,0,0,1,true,true));var ready=activated.Players[1].UltimateReadyAt;Assert(ready-activated.ServerTime==25000);
 room.Input(a.Token,new(0,1,0,0,1,0,true));for(int j=0;j<6;j++){clock.Advance(.1);room.Tick();}Assert(room.Read(a.Token).Players[1].Hp==3&&room.Read(b.Token).Players[1].UltimateShieldUntil>room.Read(b.Token).ServerTime);
 Assert(room.Input(b.Token,new(0,2,0,0,0,1,false,true)).Players[1].UltimateReadyAt==ready);
 clock.Advance(3);room.Tick();room.Input(a.Token,new(0,2,0,0,1,0,true));for(int j=0;j<5;j++){clock.Advance(.1);room.Tick();}Assert(room.Read(a.Token).Players[1].Hp==2);
});
Test("Tank repair caps health, never spends a full-health cast and cannot be spammed",()=>
{
 var(room,clock,a,b)=TankSetup("repair");var player=TankPerson(room,0);var first=room.Read(a.Token).Players[0].UltimateReadyAt;
 Assert(room.Input(a.Token,new(0,1,0,0,1,0,false,true)).Players[0].UltimateReadyAt==first);
 Set(player,"Hp",1);var healed=room.Input(a.Token,new(0,2,0,0,1,0,false,true));Assert(healed.Players[0].Hp==3);Set(player,"Hp",1);
 Assert(room.Input(a.Token,new(0,3,0,0,1,0,false,true)).Players[0].Hp==1);Set(player,"Hp",0);Assert(room.Input(a.Token,new(0,4,0,0,1,0,false,true)).Players[0].Hp==0);
});
Test("Tank burst creates exactly three shots; sequences and countdown prevent duplicate ultimates",()=>
{
 var(room,clock,a,b)=TankSetup("burst");var fired=room.Input(a.Token,new(0,1,0,0,1,0,false,true));Assert(fired.Bullets.Length==3&&fired.Events.Count(e=>e.Kind=="ulti-burst")==1);
 Assert(room.Input(a.Token,new(0,1,0,0,1,0,false,true)).Bullets.Length==3);Assert(room.Input(a.Token,new(0,2,0,0,1,0,false,true)).Events.Count(e=>e.Kind=="ulti-burst")==1);
 var c=new FakeClock();var r=new TankRoom("DEF123",2,c);var x=r.Join("X");r.Join("Y");r.Start(x.Token,0);var v=r.Input(x.Token,new(0,1,0,0,1,0,false,true));Assert(v.Events.Length==0&&v.Players[0].UltimateShieldUntil==0);
});
Test("Four hits destroy interior walls; snapshots stay immutable and routes open for everyone",()=>
{
 var(room,clock,a,b)=TankSetup();OpenTankMap(room);var rows=(string[])Field(room,"map");var line=rows[2].ToCharArray();line[4]='#';rows[2]=new string(line);var shooter=TankPerson(room,0);var target=TankPerson(room,1);Set(shooter,"X",100d);Set(shooter,"Y",100d);Set(target,"X",600d);Set(target,"Y",500d);var original=room.Read(a.Token);
 for(int n=1;n<=4;n++){room.Input(a.Token,new(0,n,0,0,1,0,true));for(int j=0;j<6;j++){clock.Advance(.1);room.Tick();}var v=room.Read(b.Token);if(n<4)Assert(v.Map[2][4]=='#'&&v.Walls.Single().Hp==4-n);else Assert(v.Map[2][4]=='.'&&v.Walls.Length==0);}
 Assert(original.Map[2][4]=='#');Assert(room.Read(a.Token).Events.Any(e=>e.Kind=="wall-break"));Set(shooter,"X",145d);room.Input(a.Token,new(0,5,1,0,1,0,false));for(int j=0;j<3;j++){clock.Advance(.1);room.Tick();}Assert(room.Read(a.Token).Players[0].X>160);
 room.Leave(b.Token);room.Rematch(a.Token,0);room.Join("Nuevo");var restart=room.Start(a.Token,1);Assert(restart.Walls.Length==0&&restart.Players[0].UltimateShieldUntil==0&&restart.Players[0].UltimateReadyAt==restart.StartsAt);
});
Test("Arena borders remain indestructible after repeated hits",()=>
{
 var(room,clock,a,b)=TankSetup();OpenTankMap(room);var p=TankPerson(room,0);Set(p,"X",60d);Set(p,"Y",100d);
 for(int n=1;n<=6;n++){room.Input(a.Token,new(0,n,0,0,-1,0,true));for(int j=0;j<6;j++){clock.Advance(.1);room.Tick();}}
 var state=room.Read(a.Token);Assert(state.Map[2][0]=='#'&&state.Walls.Length==0);
});
Console.WriteLine($"{passed} multiplayer tests passed.");
sealed class FakeClock : TimeProvider
{
    private DateTimeOffset now=new(2026,10,22,12,0,0,TimeSpan.Zero);
    public override DateTimeOffset GetUtcNow()=>now;
    public void Advance(double seconds)=>now=now.AddSeconds(seconds);
}
