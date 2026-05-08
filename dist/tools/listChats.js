import { isoToMs, msToIso } from '../util/time.js';
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
        havingClauses.push(`last_received_at >= ?`);
        params.push(sinceMs);
    }
    const sql = `
    SELECT
      c.id AS id,
      c.type AS type,
      c.name AS name,
      c.profileFullName AS profileFullName,
      c.profileName AS profileName,
      c.e164 AS e164,
      c.members AS members,
      COUNT(CASE WHEN m.type IN ('incoming','outgoing') THEN 1 END) AS real_messages,
      MAX(CASE WHEN m.type IN ('incoming','outgoing') THEN m.received_at END) AS last_received_at,
      (SELECT body FROM messages
        WHERE conversationId = c.id
          AND type IN ('incoming','outgoing')
        ORDER BY received_at DESC LIMIT 1) AS last_body,
      (SELECT type FROM messages
        WHERE conversationId = c.id
          AND type IN ('incoming','outgoing')
        ORDER BY received_at DESC LIMIT 1) AS last_type
    FROM conversations c
    LEFT JOIN messages m ON m.conversationId = c.id
    ${whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : ''}
    GROUP BY c.id
    ${havingClauses.length ? `HAVING ${havingClauses.join(' AND ')}` : ''}
    ORDER BY last_received_at DESC NULLS LAST
    LIMIT ?
  `;
    params.push(input.limit);
    const rows = db.prepare(sql).all(...params);
    return rows.map((r) => {
        const display = r.name || r.profileFullName || r.profileName || r.e164 || '(unknown)';
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
            last_message_date: msToIso(r.last_received_at),
            last_message_preview: preview,
            last_message_type: r.last_type,
        };
    });
}
//# sourceMappingURL=listChats.js.map