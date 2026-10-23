namespace Campo;

public static class ChatEndpoints
{
    // Future games implement IChatRoom and register their room resolver here.
    public static void MapRoomChat<TStore>(this WebApplication app, string prefix,
        Func<TStore, string, IChatRoom> resolve, Func<HttpContext, string> token) where TStore : notnull
    {
        app.MapGet(prefix + "/{code}/chat", (string code, long? after, HttpContext context) =>
            resolve(context.RequestServices.GetRequiredService<TStore>(), code).ReadChat(token(context), after ?? 0))
            .RequireRateLimiting("play");
        app.MapPost(prefix + "/{code}/chat", (string code, ChatPost input, HttpContext context) =>
            resolve(context.RequestServices.GetRequiredService<TStore>(), code).SendChat(token(context), input))
            .RequireRateLimiting("play");
    }
}
