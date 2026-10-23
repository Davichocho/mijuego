namespace Campo;

public record ChatPost(string? Text, string? ClientId);
public record ChatMessage(long Id, string PlayerId, string Name, string Text, long At, string ClientId);
public record ChatView(string YouId, long LatestId, ChatMessage[] Messages);
public interface IChatRoom
{
    ChatView ReadChat(string token, long after);
    ChatView SendChat(string token, ChatPost message);
}

// Owned by the room: history and rate limits disappear with that room.
// Call under the room's existing lock, after authenticating its player.
public sealed class RoomChat
{
    readonly List<ChatMessage> messages = [];
    long nextId;
    public ChatView Read(string playerId, long after) => new(playerId, nextId,
        messages.Where(m => m.Id > Math.Max(0, after)).ToArray());
    public ChatView Send(string playerId, string name, ChatPost input, long now)
    {
        var text = input.Text?.Trim();
        if (string.IsNullOrWhiteSpace(text) || text.Length > 280 || text.Any(char.IsControl))
            throw new RoomError(400, "Escribe un mensaje de 1 a 280 caracteres, en una sola línea.");
        if (!Guid.TryParse(input.ClientId, out var clientId)) throw new RoomError(400, "El mensaje necesita un identificador válido.");
        var id = clientId.ToString("N");
        if (messages.Any(m => m.PlayerId == playerId && m.ClientId == id)) return Read(playerId, 0);
        var last = messages.LastOrDefault(m => m.PlayerId == playerId);
        if (last != null && now - last.At < 1000) throw new RoomError(429, "Espera un segundo antes de enviar otro mensaje.");
        messages.Add(new(++nextId, playerId, name, text, now, id));
        if (messages.Count > 60) messages.RemoveAt(0);
        return Read(playerId, 0);
    }
}
