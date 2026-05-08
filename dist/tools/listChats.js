import { isoToMs, msToIso } from '../util/time.js';
import { personDisplayName } from '../util/messages.js';
// Sort/filter and "last message" lookups all use COALESCE(sent_at, received_at)
// so a freshly-synced client (where received_at clusters at sync time) still
// orders chats by their actual most-recent activity.
const TIME = `COALESCE(m.sent_at, m.received_at)`;
export function listChats(db, input) {
    const params = [];
    const havingClauses = [];
    if (!input.include_empty)
        havingClauses.push(`real_messages > 0`);
    if (input.min_messages !== undefined) {
        havingClauses.push(`real_messages >= ?`);
        params.push(input.min_messages);
    }
    const whereClauses = [];
    if (input.is_group === true)
        whereClauses.push(`c.type = 'group'`);
    if (input.is_group === false)
        whereClauses.push(`c.type = 'private'`);
    const sinceMs = isoToMs(input.since);
    if (sinceMs !== undefined) {
        havingClauses.push(`last_time_key >= ?`);
        params.push(sinceMs);
    }
    // Subqueries: prefer the most-recent body-bearing message for the preview,
    // but fall back to the most-recent real message of any kind so the type
    // column still reflects what actually happened (e.g. an attachment).
    const sql = `
    SELECT
      c.id AS id,
      c.type AS type,
      c.name AS name,
      c.profileFullName AS profileFullName,
      c.profileName AS profileName,
      c.profileFamilyName AS profileFamilyName,
      c.e164 AS e164,
      c.serviceId AS serviceId,
      c.members AS members,
      COUNT(CASE WHEN m.type IN ('incoming','outgoing') THEN 1 END) AS real_messages,
      MAX(CASE WHEN m.type IN ('incoming','outgoing') THEN ${TIME} END) AS last_time_key,
      (SELECT body FROM messages m2
        WHERE m2.conversationId = c.id
          AND m2.type IN ('incoming','outgoing')
          AND m2.body IS NOT NULL AND m2.body <> ''
        ORDER BY COALESCE(m2.sent_at, m2.received_at) DESC LIMIT 1) AS last_body,
      (SELECT type FROM messages m3
        WHERE m3.conversationId = c.id
          AND m3.type IN ('incoming','outgoing')
        ORDER BY COALESCE(m3.sent_at, m3.received_at) DESC LIMIT 1) AS last_type
    FROM conversations c
    LEFT JOIN messages m ON m.conversationId = c.id
    ${whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : ''}
    GROUP BY c.id
    ${havingClauses.length ? `HAVING ${havingClauses.join(' AND ')}` : ''}
    ORDER BY last_time_key DESC NULLS LAST
    LIMIT ?
  `;
    params.push(input.limit);
    const rows = db.prepare(sql).all(...params);
    return rows.map((r) => {
        const display = personDisplayName({
            name: r.name,
            profileFullName: r.profileFullName,
            profileName: r.profileName,
            profileFamilyName: r.profileFamilyName,
            e164: r.e164,
            serviceId: r.serviceId,
        });
        const memberCount = r.type === 'group' && r.members
            ? r.members.split(/\s+/).filter(Boolean).length
            : null;
        const preview = r.last_body
            ? r.last_body.length > 200
                ? r.last_body.slice(0, 200) + '…'
                : r.last_body
            : null;
        return {
            id: r.id,
            name: display,
            type: r.type,
            is_group: r.type === 'group',
            member_count: memberCount,
            total_messages: r.real_messages,
            last_message_date: msToIso(r.last_time_key),
            last_message_preview: preview,
            last_message_type: r.last_type,
        };
    });
}
//# sourceMappingURL=listChats.js.map