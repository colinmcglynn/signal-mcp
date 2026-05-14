import { toMessageOut } from '../util/messages.js';
import { buildMessageWhere, MESSAGE_FROM, MESSAGE_SELECT_COLUMNS, TIME_KEY, } from '../util/sql.js';
/**
 * Build an FTS5 MATCH expression from a user query.
 *
 * Splits on whitespace, double-quotes each token (escaping any internal double quotes),
 * and AND-joins them. So "foo bar's baz" becomes `"foo" AND "bar's" AND "baz"`. This
 * is the most predictable thing for a casual search: every word must appear, no
 * operator parsing surprises. Power users can pass a single multi-word phrase by
 * wrapping in their own quotes in the calling client.
 */
function buildFtsMatch(query) {
    const tokens = query.trim().split(/\s+/).filter((t) => t.length > 0);
    if (tokens.length === 0) {
        throw new Error('search query must contain at least one non-whitespace token');
    }
    return tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(' AND ');
}
function ftsSearch(ftsDb, match, hardLimit) {
    const rows = ftsDb
        .prepare(`SELECT guid,
              snippet(messages_fts, 0, '«', '»', '…', 14) AS snippet,
              bm25(messages_fts) AS score
       FROM messages_fts
       WHERE messages_fts MATCH ?
       ORDER BY score
       LIMIT ?`)
        .all(match, hardLimit);
    return rows;
}
export function searchMessages(signalDb, ftsDb, input) {
    const match = buildFtsMatch(input.query);
    // Pull a generous candidate pool from FTS so post-filter (sender, date, chat) still
    // leaves at least `limit` results in most cases. 10x is plenty for typical queries.
    const hardLimit = Math.min(Math.max(input.limit * 10, 200), 2000);
    const hits = ftsSearch(ftsDb, match, hardLimit);
    if (hits.length === 0)
        return [];
    const guids = hits.map((h) => h.guid);
    const hitByGuid = new Map(hits.map((h, i) => [h.guid, { ...h, rank: i }]));
    // Pull enriched rows from Signal DB for those guids, applying the same MessageFilters
    // / ScopeFilters as get_recent_messages so the contract matches.
    const { where, params } = buildMessageWhere(input);
    const placeholders = guids.map(() => '?').join(',');
    const filterClause = where
        ? `${where} AND m.id IN (${placeholders})`
        : `WHERE m.id IN (${placeholders})`;
    const sortClause = (input.sort ?? 'relevance') === 'recent'
        ? `ORDER BY ${TIME_KEY} DESC`
        : ``; // 'relevance' → re-sort in JS using hitByGuid.rank so BM25 wins
    const sql = `
    SELECT ${MESSAGE_SELECT_COLUMNS}
    ${MESSAGE_FROM}
    ${filterClause}
    ${sortClause}
    LIMIT ? OFFSET ?
  `;
    const rows = signalDb
        .prepare(sql)
        .all(...params, ...guids, input.limit, input.offset);
    const enriched = rows.map((r) => {
        const hit = hitByGuid.get(r.id);
        return {
            ...toMessageOut(r),
            snippet: hit.snippet,
            score: hit.score,
        };
    });
    if ((input.sort ?? 'relevance') === 'relevance') {
        enriched.sort((a, b) => {
            const ra = hitByGuid.get(a.id).rank;
            const rb = hitByGuid.get(b.id).rank;
            return ra - rb;
        });
    }
    return enriched;
}
//# sourceMappingURL=searchMessages.js.map