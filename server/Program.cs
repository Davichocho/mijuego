using Campo;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;

var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    Args = args,
    WebRootPath = Path.Combine(AppContext.BaseDirectory, "wwwroot")
});
builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 8192);
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<RoomStore>();
builder.Services.AddSingleton<SkeeStore>();
builder.Services.AddSingleton<TankStore>();
builder.Services.AddHostedService<TankLoop>();
builder.Services.AddHostedService<RoomCleanup>();
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = 429;
    options.AddPolicy("rooms", context => RateLimitPartition.GetFixedWindowLimiter(
        context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 20, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
    options.AddPolicy("play", context => RateLimitPartition.GetFixedWindowLimiter(
        context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 1800, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
    options.AddPolicy("tanks", context => RateLimitPartition.GetFixedWindowLimiter(
        context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 12000, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
    options.OnRejected = async (context, cancellationToken) =>
    {
        context.HttpContext.Response.Headers.RetryAfter = "5";
        await context.HttpContext.Response.WriteAsJsonAsync(new { error = "Demasiadas solicitudes. Espera unos segundos." }, cancellationToken);
    };
});
var app = builder.Build();
app.Use(async (context, next) =>
{
    context.Response.Headers.XContentTypeOptions = "nosniff";
    context.Response.Headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
    if (context.Request.Path.StartsWithSegments("/api")) context.Response.Headers.CacheControl = "no-store";
    try { await next(context); }
    catch (RoomError error)
    {
        context.Response.StatusCode = error.Status;
        await context.Response.WriteAsJsonAsync(new { error = error.Message });
    }
    catch (BadHttpRequestException)
    {
        context.Response.StatusCode = 400;
        await context.Response.WriteAsJsonAsync(new { error = "Solicitud no válida." });
    }
});
app.UseDefaultFiles();
app.UseStaticFiles(new StaticFileOptions { OnPrepareResponse = ctx => ctx.Context.Response.Headers.CacheControl = "no-cache" });
app.UseRateLimiter();
app.MapGet("/api/health", () => new { status = "ok", service = "Campo", protocol = 3 });
app.MapPost("/api/rooms", (CreateRoom input, RoomStore store) => store.Create(input.Name,
    new RoomOptions(input.Mode ?? "", input.MaxPlayers, input.DurationSeconds))).RequireRateLimiting("rooms");
app.MapPost("/api/rooms/{code}/join", (string code, JoinRoom input, RoomStore store) => store.Get(code).Join(input.Name)).RequireRateLimiting("rooms");
app.MapGet("/api/rooms/{code}", (string code, HttpContext ctx, RoomStore store) => store.Get(code).Read(Token(ctx))).RequireRateLimiting("play");
app.MapPost("/api/rooms/{code}/start", (string code, RoundRequest input, HttpContext ctx, RoomStore store) => store.Get(code).Start(Token(ctx), input.Round)).RequireRateLimiting("play");
app.MapPost("/api/rooms/{code}/reveal", (string code, MoveRequest input, HttpContext ctx, RoomStore store) => store.Get(code).Move(Token(ctx), input.Index, false, input.Round)).RequireRateLimiting("play");
app.MapPost("/api/rooms/{code}/flag", (string code, MoveRequest input, HttpContext ctx, RoomStore store) => store.Get(code).Move(Token(ctx), input.Index, true, input.Round)).RequireRateLimiting("play");
app.MapPost("/api/rooms/{code}/rematch", (string code, RoundRequest input, HttpContext ctx, RoomStore store) => store.Get(code).Rematch(Token(ctx), input.Round)).RequireRateLimiting("play");
app.MapPost("/api/rooms/{code}/leave", (string code, HttpContext ctx, RoomStore store) =>
{
    store.Get(code).Leave(Token(ctx)); return Results.Ok(new { left = true });
}).RequireRateLimiting("play");
app.MapPost("/api/skee/rooms", (CreateSkee input, SkeeStore store) => store.Create(input.Name, new(input.MaxPlayers, input.DurationSeconds))).RequireRateLimiting("rooms");
app.MapPost("/api/skee/rooms/{code}/join", (string code, JoinRoom input, SkeeStore store) => store.Get(code).Join(input.Name)).RequireRateLimiting("rooms");
app.MapGet("/api/skee/rooms/{code}", (string code, HttpContext ctx, SkeeStore store) => store.Get(code).Read(Token(ctx))).RequireRateLimiting("play");
app.MapPost("/api/skee/rooms/{code}/start", (string code, RoundRequest input, HttpContext ctx, SkeeStore store) => store.Get(code).Start(Token(ctx), input.Round)).RequireRateLimiting("play");
app.MapPost("/api/skee/rooms/{code}/shot", (string code, SkeeThrow input, HttpContext ctx, SkeeStore store) => store.Get(code).Shoot(Token(ctx), input.Round, input.Number, input.Aim, input.Power)).RequireRateLimiting("play");
app.MapPost("/api/skee/rooms/{code}/rematch", (string code, RoundRequest input, HttpContext ctx, SkeeStore store) => store.Get(code).Rematch(Token(ctx), input.Round)).RequireRateLimiting("play");
app.MapPost("/api/skee/rooms/{code}/leave", (string code, HttpContext ctx, SkeeStore store) => { store.Get(code).Leave(Token(ctx)); return Results.Ok(new { left = true }); }).RequireRateLimiting("play");
app.MapPost("/api/tanks/rooms", (CreateTank input,TankStore store)=>store.Create(input.Name,input.MaxPlayers)).RequireRateLimiting("rooms");
app.MapPost("/api/tanks/rooms/{code}/join", (string code,JoinRoom input,TankStore store)=>store.Get(code).Join(input.Name)).RequireRateLimiting("rooms");
app.MapGet("/api/tanks/rooms/{code}", (string code,HttpContext ctx,TankStore store)=>store.Get(code).Read(Token(ctx))).RequireRateLimiting("tanks");
app.MapPost("/api/tanks/rooms/{code}/input", (string code,TankInput input,HttpContext ctx,TankStore store)=>store.Get(code).Input(Token(ctx),input)).RequireRateLimiting("tanks");
app.MapPost("/api/tanks/rooms/{code}/loadout", (string code,TankLoadout input,HttpContext ctx,TankStore store)=>store.Get(code).SetLoadout(Token(ctx),input)).RequireRateLimiting("play");
app.MapPost("/api/tanks/rooms/{code}/start", (string code,RoundRequest input,HttpContext ctx,TankStore store)=>store.Get(code).Start(Token(ctx),input.Round)).RequireRateLimiting("play");
app.MapPost("/api/tanks/rooms/{code}/rematch", (string code,RoundRequest input,HttpContext ctx,TankStore store)=>store.Get(code).Rematch(Token(ctx),input.Round)).RequireRateLimiting("play");
app.MapPost("/api/tanks/rooms/{code}/leave", (string code,HttpContext ctx,TankStore store)=>{store.Get(code).Leave(Token(ctx));return Results.Ok(new{left=true});}).RequireRateLimiting("play");
app.MapRoomChat<RoomStore>("/api/rooms", (store, code) => store.Get(code), Token);
app.MapRoomChat<SkeeStore>("/api/skee/rooms", (store, code) => store.Get(code), Token);
app.MapRoomChat<TankStore>("/api/tanks/rooms", (store, code) => store.Get(code), Token);
app.Run();
static string Token(HttpContext ctx)
{
    var auth = ctx.Request.Headers.Authorization.ToString();
    if (!auth.StartsWith("Bearer ", StringComparison.Ordinal) || auth.Length != 71)
        throw new RoomError(401, "Ingresa a una sala para jugar.");
    return auth[7..];
}
record CreateSkee(string? Name, int MaxPlayers, int DurationSeconds);
record SkeeThrow(int Round, int Number, double Aim, double Power);
record CreateRoom(string? Name, string? Mode, int MaxPlayers, int DurationSeconds);
record JoinRoom(string? Name);
record RoundRequest(int Round);
record MoveRequest(int Index, int Round);
sealed class RoomCleanup(RoomStore store, SkeeStore skee) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(2));
        try { while (await timer.WaitForNextTickAsync(stoppingToken)) { store.Sweep(); skee.Sweep(); } }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
    }
}

record CreateTank(string? Name,int MaxPlayers);
sealed class TankLoop(TankStore store):BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken token){using var timer=new PeriodicTimer(TimeSpan.FromMilliseconds(50));try{while(await timer.WaitForNextTickAsync(token))store.Sweep();}catch(OperationCanceledException)when(token.IsCancellationRequested){}}
}
