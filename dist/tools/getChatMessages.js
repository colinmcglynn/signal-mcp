import { getRecentMessages } from './getRecentMessages.js';
function resolveChatIds(db, input) {
    if (input.chat_id)
        return [input.chat_id];
    if (!input.chat_name) {
        throw new Error(`Either chat_id or chat_name must be provided.`);
    }
    const like = `%${input.chat_name.toLowerCase()}%`;
    const rows = db
        .prepare(`SELECT id FROM conversations
       WHERE LOWER(name) LIKE ?
          OR LOWER(profileFullName) LIKE ?
          OR LOWER(profileName) LIKE ?
          OR LOWER(e164) LIKE ?
       LIMIT 25`)
        .all(like, like, like, like);
    if (rows.length === 0) {
        throw new Error(`No chat matched chat_name='${input.chat_name}'.`);
    }
    return rows.map((r) => r.id);
}
export function getChatMessages(db, input) {
    const chat_ids = resolveChatIds(db, input);
    return getRecentMessages(db, { ...input, chat_ids });
}
//# sourceMappingURL=getChatMessages.js.map