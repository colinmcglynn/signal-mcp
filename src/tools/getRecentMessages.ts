import type Database from 'better-sqlite3-multiple-ciphers';
import { type RawMessageRow, toMessageOut, type MessageOut } from '../util/messages.js';
import {
  buildMessageWhere,
  MESSAGE_FROM,
  MESSAGE_SELECT_COLUMNS,
  TIME_KEY,
  type MessageFilters,
  type ScopeFilters,
} from '../util/sql.js';

export type GetRecentMessagesInput = MessageFilters & ScopeFilters;

export function getRecentMessages(
  db: Database.Database,
  input: GetRecentMessagesInput,
): MessageOut[] {
  const { where, params } = buildMessageWhere(input);
  const sql = `
    SELECT ${MESSAGE_SELECT_COLUMNS}
    ${MESSAGE_FROM}
    ${where}
    ORDER BY ${TIME_KEY} DESC
    LIMIT ? OFFSET ?
  `;
  const rows = db.prepare(sql).all(...params, input.limit, input.offset) as RawMessageRow[];
  return rows.map(toMessageOut);
}
