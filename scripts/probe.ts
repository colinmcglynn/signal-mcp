import { openSignalDb } from '../src/db.js';

const { db } = openSignalDb();

function header(s: string) {
  console.log('\n=== ' + s + ' ===');
}

header('sqlite_master tables (relevant)');
const tables = db
  .prepare(
    `SELECT name, type FROM sqlite_master
     WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'
     ORDER BY name`,
  )
  .all() as Array<{ name: string; type: string }>;
for (const t of tables) console.log(`  ${t.type.padEnd(5)}  ${t.name}`);

header('FTS detection');
const fts = tables.find((t) => /messages_fts/i.test(t.name));
console.log(fts ? `  found: ${fts.name} (${fts.type})` : '  no messages_fts table');

header('messages columns');
const msgCols = db.prepare(`PRAGMA table_info('messages')`).all();
console.log(msgCols);

header('conversations columns');
const convCols = db.prepare(`PRAGMA table_info('conversations')`).all();
console.log(convCols);

header('message type histogram');
const types = db
  .prepare(
    `SELECT type, COUNT(*) AS n
     FROM messages
     GROUP BY type
     ORDER BY n DESC
     LIMIT 30`,
  )
  .all();
console.log(types);

header('row counts');
const counts = {
  conversations: (db.prepare(`SELECT COUNT(*) AS n FROM conversations`).get() as { n: number }).n,
  messages: (db.prepare(`SELECT COUNT(*) AS n FROM messages`).get() as { n: number }).n,
};
console.log(counts);

header('sample conversation rows (no json blob)');
const sampleConv = db
  .prepare(
    `SELECT id, type, name, profileName, e164, serviceId,
            (SELECT COUNT(*) FROM messages WHERE conversationId = conversations.id) AS msgs
     FROM conversations
     ORDER BY active_at DESC NULLS LAST
     LIMIT 5`,
  )
  .all();
console.log(sampleConv);

header('sample message keys (one row, json parsed for top-level keys)');
const sampleMsg = db
  .prepare(
    `SELECT id, conversationId, type, received_at, sent_at, body IS NOT NULL AS has_body,
            sourceServiceId, hasAttachments, json
     FROM messages
     WHERE type IN ('incoming','outgoing') AND body IS NOT NULL
     ORDER BY received_at DESC
     LIMIT 1`,
  )
  .get() as { json?: string } | undefined;
if (sampleMsg) {
  const { json: rawJson, ...rest } = sampleMsg as Record<string, unknown> & { json?: string };
  console.log(rest);
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson) as Record<string, unknown>;
      console.log('  json top-level keys:', Object.keys(parsed));
    } catch {
      console.log('  json: <unparseable>');
    }
  }
}

header('group sample with members');
const group = db
  .prepare(
    `SELECT id, name, type, members, json
     FROM conversations
     WHERE type='group'
     LIMIT 1`,
  )
  .get() as { id?: string; name?: string; members?: string; json?: string } | undefined;
if (group) {
  console.log('  id:', group.id, 'name:', group.name);
  console.log('  members column:', group.members);
  try {
    const parsed = JSON.parse(group.json ?? '{}') as Record<string, unknown>;
    console.log('  conversation.json keys:', Object.keys(parsed));
    if (parsed.membersV2) console.log('  membersV2 sample:', JSON.stringify(parsed.membersV2).slice(0, 200));
  } catch {}
}

header('FTS schema if present');
if (fts) {
  try {
    const ftsCols = db.prepare(`PRAGMA table_info('${fts.name}')`).all();
    console.log(ftsCols);
    const example = db.prepare(`SELECT * FROM ${fts.name} LIMIT 1`).all();
    console.log('  example row:', example);
  } catch (e) {
    console.log('  PRAGMA failed:', (e as Error).message);
  }
}
