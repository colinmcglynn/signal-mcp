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

export interface SearchMessagesInput extends MessageFilters, ScopeFilters {
  query: string;
  use_fts: boolean;
}

let ftsAvailableCache: boolean | undefined;
function ftsAvailable(db: Database.Database): boolean {
  if (ftsAvailableCache !== undefined) return ftsAvailableCache;
  const row = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='messages_fts' LIMIT 1`,
    )
    .get() as { name?: string } | undefined;
  if (!row?.name) {
    ftsAvailableCache = false;
    return false;
  }
  // Signal's messages_fts uses a custom 'signal_tokenizer' registered by Signal
  // Desktop's native code, so MATCH queries fail from third-party processes.
  // Probe once with a trivial MATCH and cache the result.
  try {
    db.prepare(`SELECT rowid FROM messages_fts WHERE messages_fts MATCH ? LIMIT 1`).all('"a"');
    ftsAvailableCache = true;
  } catch {
    ftsAvailableCache = false;
  }
  return ftsAvailableCache;
}

function escapeFtsQuery(q: string): string {
  // FTS5 MATCH treats the input as a query expression; wrap as a phrase with embedded quotes escaped.
  // Sanitizing to a single phrase keeps user input safe and predictable.
  return `"${q.replace(/"/g, '""')}"`;
}

export function searchMessages(
  db: Database.Database,
  input: SearchMessagesInput,
): MessageOut[] {
  const { where, params } = buildMessageWhere(input);

  let sql: string;
  const allParams: unknown[] = [...params];

  if (input.use_fts && ftsAvailable(db)) {
    sql = `
      SELECT ${MESSAGE_SELECT_COLUMNS}
      ${MESSAGE_FROM}
      JOIN messages_fts fts ON fts.rowid = m.rowid
      ${where ? where + ' AND ' : 'WHERE '}messages_fts MATCH ?
      ORDER BY ${TIME_KEY} DESC
      LIMIT ? OFFSET ?
    `;
    allParams.push(escapeFtsQuery(input.query), input.limit, input.offset);
  } else {
    sql = `
      SELECT ${MESSAGE_SELECT_COLUMNS}
      ${MESSAGE_FROM}
      ${where ? where + ' AND ' : 'WHERE '}m.body LIKE ?
      ORDER BY ${TIME_KEY} DESC
      LIMIT ? OFFSET ?
    `;
    allParams.push(`%${input.query}%`, input.limit, input.offset);
  }

  const rows = db.prepare(sql).all(...allParams) as RawMessageRow[];
  return rows.map(toMessageOut);
}
