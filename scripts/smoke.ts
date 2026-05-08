import { openSignalDb } from '../src/db.js';
import { listChats } from '../src/tools/listChats.js';
import { getRecentMessages } from '../src/tools/getRecentMessages.js';
import { getChatMessages } from '../src/tools/getChatMessages.js';
import { searchMessages } from '../src/tools/searchMessages.js';
import { querySql } from '../src/tools/querySql.js';

const { db } = openSignalDb();

function header(s: string) {
  console.log(`\n=== ${s} ===`);
}

header('list_chats (top 5 by last activity)');
const chats = listChats(db, { include_empty: false, limit: 5 });
console.log(chats);

header('get_recent_messages (last 3, excluding system, with body)');
const recent = getRecentMessages(db, {
  sender: 'any',
  only_with_body: true,
  exclude_system: true,
  limit: 3,
  offset: 0,
});
console.log(recent);

header('get_chat_messages by chat_id (top chat above, 2 msgs)');
if (chats[0]) {
  const msgs = getChatMessages(db, {
    chat_id: chats[0].id,
    sender: 'any',
    only_with_body: true,
    exclude_system: true,
    limit: 2,
    offset: 0,
  });
  console.log(msgs);
}

header('search_messages (FTS) — query="thanks", limit 2');
const search = searchMessages(db, {
  query: 'thanks',
  use_fts: true,
  sender: 'any',
  only_with_body: true,
  exclude_system: true,
  limit: 2,
  offset: 0,
});
console.log(search);

header('query_sql — SELECT count(*) FROM messages');
const q = querySql(db, { sql: 'SELECT COUNT(*) AS n FROM messages', max_rows: 10 });
console.log(q);

header('query_sql — reject UPDATE');
try {
  querySql(db, { sql: 'UPDATE messages SET body = NULL', max_rows: 10 });
  console.log('  FAIL: should have thrown');
} catch (e) {
  console.log('  rejected:', (e as Error).message);
}

header('sender filter check — only outgoing, last 2');
const outgoing = getRecentMessages(db, {
  sender: 'me',
  only_with_body: true,
  exclude_system: true,
  limit: 2,
  offset: 0,
});
console.log(outgoing.map((m) => ({ sender: m.sender, direction: m.direction, body: m.body?.slice(0, 60) })));
