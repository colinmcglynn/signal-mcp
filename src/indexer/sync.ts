import type Database from 'better-sqlite3-multiple-ciphers';

export interface SyncStats {
  inserted: number;
  updated: number;
  deleted: number;
  batches: number;
  durationMs: number;
}

interface SourceRow {
  id: string;
  conversationId: string;
  sent_at: number;
  received_at: number | null;
  sourceServiceId: string | null;
  body: string;
}

interface Watermark {
  sent_at: number;
  guid: string;
}

const BATCH_SIZE = 500;

const REQUIRED_MESSAGE_COLS = [
  'id',
  'conversationId',
  'sent_at',
  'received_at',
  'sourceServiceId',
  'body',
  'isErased',
  'type',
];

export function assertSourceSchema(signalDb: Database.Database): void {
  const cols = signalDb.prepare(`PRAGMA table_info('messages')`).all() as Array<{ name: string }>;
  const have = new Set(cols.map((c) => c.name));
  const missing = REQUIRED_MESSAGE_COLS.filter((c) => !have.has(c));
  if (missing.length > 0) {
    throw new Error(
      `Signal messages table is missing expected columns: ${missing.join(', ')}. ` +
        `Signal Desktop may have changed its schema; run scripts/probe.ts and update the indexer.`,
    );
  }
  const edited = signalDb
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='edited_messages'`)
    .get();
  if (!edited) {
    throw new Error(
      `Signal database is missing 'edited_messages' table. Schema may have changed; run scripts/probe.ts.`,
    );
  }
}

function readWatermark(ftsDb: Database.Database): Watermark {
  const row = ftsDb
    .prepare(`SELECT watermark_sent_at, watermark_guid FROM sync_state WHERE id = 1`)
    .get() as { watermark_sent_at: number; watermark_guid: string } | undefined;
  return {
    sent_at: row?.watermark_sent_at ?? 0,
    guid: row?.watermark_guid ?? '',
  };
}

function writeWatermark(
  ftsDb: Database.Database,
  wm: Watermark,
  stats: { inserted: number; updated: number; deleted: number },
): void {
  ftsDb
    .prepare(
      `UPDATE sync_state
       SET watermark_sent_at = ?,
           watermark_guid    = ?,
           last_run_at       = ?,
           last_inserted     = ?,
           last_updated      = ?,
           last_deleted      = ?
       WHERE id = 1`,
    )
    .run(wm.sent_at, wm.guid, Date.now(), stats.inserted, stats.updated, stats.deleted);
}

function upsert(ftsDb: Database.Database, row: SourceRow): 'inserted' | 'updated' {
  const existing = ftsDb.prepare(`SELECT 1 FROM messages WHERE guid = ?`).get(row.id) as
    | { 1: number }
    | undefined;
  ftsDb
    .prepare(`DELETE FROM messages_fts WHERE guid = ?`)
    .run(row.id);
  ftsDb
    .prepare(
      `INSERT OR REPLACE INTO messages (guid, body, chat_id, sender_id, sent_at, received_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(row.id, row.body, row.conversationId, row.sourceServiceId, row.sent_at, row.received_at);
  ftsDb
    .prepare(
      `INSERT INTO messages_fts (body, guid, chat_id, sender_id, sent_at, received_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(row.body, row.id, row.conversationId, row.sourceServiceId, row.sent_at, row.received_at);
  return existing ? 'updated' : 'inserted';
}

function deleteRow(ftsDb: Database.Database, guid: string): boolean {
  const info = ftsDb.prepare(`DELETE FROM messages WHERE guid = ?`).run(guid);
  ftsDb.prepare(`DELETE FROM messages_fts WHERE guid = ?`).run(guid);
  return info.changes > 0;
}

/**
 * Run one sync pass. Returns counts of inserted/updated/deleted rows.
 *
 * The pass has three parts:
 *   1. Incremental forward scan: pull messages with (sent_at, id) > watermark, upsert each.
 *   2. Edit reconciliation: re-read current body for every messageId in edited_messages,
 *      upsert (idempotent for unchanged rows). edited_messages has no edit-time column,
 *      so we always re-check; row count is small (~hundreds).
 *   3. Delete reconciliation: any guid in our FTS that is now isErased=1 in Signal,
 *      or has been hard-deleted from messages, is removed.
 */
export function syncOnce(
  signalDb: Database.Database,
  ftsDb: Database.Database,
  { backfill = false, progress }: { backfill?: boolean; progress?: (s: string) => void } = {},
): SyncStats {
  assertSourceSchema(signalDb);
  const t0 = Date.now();

  let wm = backfill ? { sent_at: 0, guid: '' } : readWatermark(ftsDb);

  let inserted = 0;
  let updated = 0;
  let deleted = 0;
  let batches = 0;

  // Phase 1: incremental forward scan in batches.
  // Order is (sent_at, id) so we can resume cleanly with a compound watermark.
  const fetchBatch = signalDb.prepare(
    `SELECT id, conversationId, sent_at, received_at, sourceServiceId, body
     FROM messages
     WHERE body IS NOT NULL
       AND body <> ''
       AND (isErased = 0 OR isErased IS NULL)
       AND type IN ('incoming','outgoing')
       AND (sent_at > @sent_at OR (sent_at = @sent_at AND id > @guid))
     ORDER BY sent_at ASC, id ASC
     LIMIT @limit`,
  );

  while (true) {
    const rows = fetchBatch.all({
      sent_at: wm.sent_at,
      guid: wm.guid,
      limit: BATCH_SIZE,
    }) as SourceRow[];
    if (rows.length === 0) break;

    const tx = ftsDb.transaction((batch: SourceRow[]) => {
      for (const row of batch) {
        const which = upsert(ftsDb, row);
        if (which === 'inserted') inserted++;
        else updated++;
      }
      const last = batch[batch.length - 1]!;
      wm = { sent_at: last.sent_at, guid: last.id };
      writeWatermark(ftsDb, wm, { inserted, updated, deleted });
    });
    tx(rows);
    batches++;
    if (progress) progress(`forward: ${inserted + updated} processed (last sent_at=${wm.sent_at})`);
  }

  // Phase 2: edit reconciliation.
  const editIds = signalDb
    .prepare(`SELECT DISTINCT messageId FROM edited_messages WHERE messageId IS NOT NULL`)
    .all() as Array<{ messageId: string }>;
  if (editIds.length > 0) {
    const getCurrent = signalDb.prepare(
      `SELECT id, conversationId, sent_at, received_at, sourceServiceId, body
       FROM messages
       WHERE id = ?
         AND body IS NOT NULL
         AND body <> ''
         AND (isErased = 0 OR isErased IS NULL)
         AND type IN ('incoming','outgoing')`,
    );
    const tx = ftsDb.transaction((ids: Array<{ messageId: string }>) => {
      for (const { messageId } of ids) {
        const row = getCurrent.get(messageId) as SourceRow | undefined;
        if (!row) continue;
        const existingBody = ftsDb
          .prepare(`SELECT body FROM messages WHERE guid = ?`)
          .get(row.id) as { body: string } | undefined;
        if (existingBody && existingBody.body === row.body) continue;
        const which = upsert(ftsDb, row);
        if (which === 'inserted') inserted++;
        else updated++;
      }
    });
    tx(editIds);
    if (progress) progress(`edits: reconciled ${editIds.length} candidates`);
  }

  // Phase 3: delete reconciliation. Pull all currently-erased + the list of guids
  // already in our index that no longer have an indexable row in messages.
  const erased = signalDb
    .prepare(`SELECT id FROM messages WHERE isErased = 1`)
    .all() as Array<{ id: string }>;
  if (erased.length > 0) {
    const tx = ftsDb.transaction((rows: Array<{ id: string }>) => {
      for (const { id } of rows) {
        if (deleteRow(ftsDb, id)) deleted++;
      }
    });
    tx(erased);
  }

  // Catch hard-deletes: any guid in our FTS that has no row in Signal's messages at all.
  // Done in one pass via attached-style anti-join through application code (different DBs).
  const ourGuids = ftsDb.prepare(`SELECT guid FROM messages`).all() as Array<{ guid: string }>;
  if (ourGuids.length > 0) {
    const existsStmt = signalDb.prepare(`SELECT 1 FROM messages WHERE id = ? LIMIT 1`);
    const tx = ftsDb.transaction((rows: Array<{ guid: string }>) => {
      for (const { guid } of rows) {
        const found = existsStmt.get(guid);
        if (!found) {
          if (deleteRow(ftsDb, guid)) deleted++;
        }
      }
    });
    tx(ourGuids);
  }

  writeWatermark(ftsDb, wm, { inserted, updated, deleted });

  return {
    inserted,
    updated,
    deleted,
    batches,
    durationMs: Date.now() - t0,
  };
}
