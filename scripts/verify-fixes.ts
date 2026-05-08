import { openSignalDb } from '../src/db.js';
import { listChats } from '../src/tools/listChats.js';
import { getRecentMessages } from '../src/tools/getRecentMessages.js';

const { db } = openSignalDb();

console.log('\n=== Bobby Fishkin (was preview=null) ===');
const allDms = listChats(db, { include_empty: false, is_group: false, limit: 200 });
console.log(allDms.find((c) => c.name === 'Bobby Fishkin'));

console.log('\n=== Edge-case display names (phone or short-id only) ===');
console.log(allDms.filter((c) => c.name.startsWith('user-') || c.name.match(/^\+\d/)));

console.log('\n=== Recent messages — date / sent_at / received_at split ===');
const recent = getRecentMessages(db, {
  sender: 'any',
  only_with_body: true,
  exclude_system: true,
  limit: 3,
  offset: 0,
});
for (const m of recent) {
  console.log({
    chat: m.chat_name,
    date: m.date,
    sent_at: m.sent_at,
    received_at: m.received_at,
  });
}

console.log('\n=== since filter (last 24h, top 3) ===');
const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
const last24 = getRecentMessages(db, {
  since: sinceIso,
  sender: 'any',
  only_with_body: true,
  exclude_system: true,
  limit: 3,
  offset: 0,
});
console.log({ since: sinceIso, count: last24.length, samples: last24.map((m) => m.date) });
