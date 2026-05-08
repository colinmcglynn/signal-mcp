import { toMessageOut } from '../util/messages.js';
import { buildMessageWhere, MESSAGE_FROM, MESSAGE_SELECT_COLUMNS, TIME_KEY, } from '../util/sql.js';
export function getRecentMessages(db, input) {
    const { where, params } = buildMessageWhere(input);
    const sql = `
    SELECT ${MESSAGE_SELECT_COLUMNS}
    ${MESSAGE_FROM}
    ${where}
    ORDER BY ${TIME_KEY} DESC
    LIMIT ? OFFSET ?
  `;
    const rows = db.prepare(sql).all(...params, input.limit, input.offset);
    return rows.map(toMessageOut);
}
//# sourceMappingURL=getRecentMessages.js.map