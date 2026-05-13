import type Database from 'better-sqlite3-multiple-ciphers';

export const FTS_SCHEMA_VERSION = 1;

export const FTS_DDL = `
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  guid          TEXT PRIMARY KEY,
  body          TEXT NOT NULL,
  chat_id       TEXT NOT NULL,
  sender_id     TEXT,
  sent_at       INTEGER NOT NULL,
  received_at   INTEGER
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_messages_sent_at ON messages(sent_at, guid);
CREATE INDEX IF NOT EXISTS idx_messages_chat    ON messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender  ON messages(sender_id);

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  body,
  guid UNINDEXED,
  chat_id UNINDEXED,
  sender_id UNINDEXED,
  sent_at UNINDEXED,
  received_at UNINDEXED,
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TABLE IF NOT EXISTS sync_state (
  id                 INTEGER PRIMARY KEY CHECK (id = 1),
  watermark_sent_at  INTEGER NOT NULL DEFAULT 0,
  watermark_guid     TEXT NOT NULL DEFAULT '',
  last_run_at        INTEGER NOT NULL DEFAULT 0,
  last_inserted      INTEGER NOT NULL DEFAULT 0,
  last_updated       INTEGER NOT NULL DEFAULT 0,
  last_deleted       INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO sync_state (id) VALUES (1);
`;

// WITHOUT ROWID on the source table breaks the standard external-content FTS trigger pattern
// (rowid wouldn't be stable). Instead we manage FTS rows manually in sync.ts using DELETE+INSERT
// keyed on guid via the UNINDEXED column. This is fine for our scale (~10k rows).

export function initSchema(db: Database.Database): void {
  db.exec(FTS_DDL);
  const cur = db.prepare(`SELECT version FROM schema_version LIMIT 1`).get() as
    | { version: number }
    | undefined;
  if (!cur) {
    db.prepare(`INSERT INTO schema_version (version) VALUES (?)`).run(FTS_SCHEMA_VERSION);
  } else if (cur.version !== FTS_SCHEMA_VERSION) {
    throw new Error(
      `FTS DB schema version ${cur.version} does not match expected ${FTS_SCHEMA_VERSION}. ` +
        `Delete the FTS DB and rerun with --backfill to recreate.`,
    );
  }
}
