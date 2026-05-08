import { isoToMs } from './time.js';
// We sort and filter by COALESCE(sent_at, received_at) because received_at is
// the local-receive timestamp — on a freshly-synced or restored client every
// backfilled message gets the same received_at (the sync time), which would
// cluster years of history at one instant. sent_at carries the actual message
// time and is preserved across syncs.
export const TIME_KEY = `COALESCE(m.sent_at, m.received_at)`;
export const MESSAGE_SELECT_COLUMNS = `
  m.id AS id,
  m.conversationId AS conversationId,
  m.type AS type,
  m.received_at AS received_at,
  m.sent_at AS sent_at,
  ${TIME_KEY} AS time_key,
  m.body AS body,
  m.sourceServiceId AS sourceServiceId,
  m.hasAttachments AS hasAttachments,
  m.hasVisualMediaAttachments AS hasVisualMediaAttachments,
  m.hasFileAttachments AS hasFileAttachments,
  c.name AS chat_name,
  c.type AS chat_type,
  c.serviceId AS chat_serviceId,
  c.profileFullName AS chat_profileFullName,
  c.profileName AS chat_profileName,
  c.profileFamilyName AS chat_profileFamilyName,
  c.e164 AS chat_e164,
  s.name AS sender_name,
  s.profileFullName AS sender_profileFullName,
  s.profileName AS sender_profileName,
  s.profileFamilyName AS sender_profileFamilyName,
  s.e164 AS sender_e164
`;
export const MESSAGE_FROM = `
  FROM messages m
  JOIN conversations c ON c.id = m.conversationId
  LEFT JOIN conversations s ON s.serviceId = m.sourceServiceId
`;
export function buildMessageWhere(filters) {
    const clauses = [];
    const params = [];
    if (filters.exclude_system) {
        clauses.push(`m.type IN ('incoming','outgoing')`);
    }
    if (filters.only_with_body) {
        clauses.push(`m.body IS NOT NULL AND m.body <> ''`);
    }
    if (filters.sender === 'me') {
        clauses.push(`m.type = 'outgoing'`);
    }
    else if (filters.sender === 'them') {
        clauses.push(`m.type = 'incoming'`);
    }
    const sinceMs = isoToMs(filters.since);
    if (sinceMs !== undefined) {
        clauses.push(`${TIME_KEY} >= ?`);
        params.push(sinceMs);
    }
    const untilMs = isoToMs(filters.until);
    if (untilMs !== undefined) {
        clauses.push(`${TIME_KEY} < ?`);
        params.push(untilMs);
    }
    if (filters.chat_ids && filters.chat_ids.length > 0) {
        const placeholders = filters.chat_ids.map(() => '?').join(',');
        clauses.push(`m.conversationId IN (${placeholders})`);
        params.push(...filters.chat_ids);
    }
    if (filters.chat_name_contains) {
        clauses.push(`(LOWER(c.name) LIKE ? OR LOWER(c.profileFullName) LIKE ? OR LOWER(c.profileName) LIKE ? OR LOWER(c.e164) LIKE ?)`);
        const like = `%${filters.chat_name_contains.toLowerCase()}%`;
        params.push(like, like, like, like);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return { where, params };
}
//# sourceMappingURL=sql.js.map