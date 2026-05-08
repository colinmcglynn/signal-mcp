import { z } from 'zod';
const isoDateString = z
    .string()
    .refine((s) => !Number.isNaN(Date.parse(s)), {
    message: 'Must be an ISO 8601 timestamp',
});
export const senderEnum = z.enum(['me', 'them', 'any']);
export const messageFilterShape = {
    since: isoDateString.optional().describe('ISO 8601; only messages received at-or-after this time.'),
    until: isoDateString.optional().describe('ISO 8601; only messages received before this time.'),
    sender: senderEnum.default('any').describe("'me' = outgoing, 'them' = incoming, 'any' = both."),
    only_with_body: z
        .boolean()
        .default(true)
        .describe('Exclude messages with no body text (attachments-only, reactions, stickers).'),
    exclude_system: z
        .boolean()
        .default(true)
        .describe('Exclude system events (keychange, profile-change, group-v2-change, etc.).'),
    limit: z.number().int().min(1).max(1000).default(100),
    offset: z.number().int().min(0).default(0),
};
export const listChatsShape = {
    include_empty: z.boolean().default(false).describe('Include conversations with zero real messages.'),
    is_group: z.boolean().optional().describe('Only groups (true) or only DMs (false).'),
    min_messages: z.number().int().min(0).optional(),
    since: isoDateString.optional().describe('Only chats with activity after this ISO 8601 time.'),
    limit: z.number().int().min(1).max(1000).default(200),
};
export const getRecentMessagesShape = {
    ...messageFilterShape,
    chat_ids: z.array(z.string().min(1)).optional(),
    chat_name_contains: z
        .string()
        .min(1)
        .optional()
        .describe('Case-insensitive substring match against chat name fields.'),
};
export const getChatMessagesShape = {
    chat_id: z.string().min(1).optional(),
    chat_name: z.string().min(1).optional().describe('Exact or partial chat name (case-insensitive).'),
    ...messageFilterShape,
};
export const searchMessagesShape = {
    query: z.string().min(1).describe('Text to search for in message bodies.'),
    ...messageFilterShape,
    chat_ids: z.array(z.string().min(1)).optional(),
    chat_name_contains: z.string().min(1).optional(),
    use_fts: z
        .boolean()
        .default(true)
        .describe('Use FTS5 (messages_fts MATCH) when available; otherwise LIKE.'),
};
export const querySqlShape = {
    sql: z.string().min(1).describe('A single read-only SQL statement (SELECT/WITH/EXPLAIN/PRAGMA).'),
    params: z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
    max_rows: z.number().int().min(1).max(5000).default(500),
};
//# sourceMappingURL=schema.js.map