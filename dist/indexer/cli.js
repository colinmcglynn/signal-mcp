#!/usr/bin/env node
import { createClient as createDashboardClient } from '../dashboard.js';
import { closeSignalDb, openSignalDb } from '../db.js';
import { closeFtsDb, defaultFtsDbPath, openFtsDb } from './db.js';
import { syncOnce } from './sync.js';
const dashboard = createDashboardClient('signal-mcp-reindex');
function parseArgs(argv) {
    const out = { backfill: false, quiet: false, help: false };
    for (const arg of argv) {
        if (arg === '--backfill')
            out.backfill = true;
        else if (arg === '--quiet' || arg === '-q')
            out.quiet = true;
        else if (arg === '--help' || arg === '-h')
            out.help = true;
    }
    return out;
}
function usage() {
    console.log(`signal-mcp-reindex — run one FTS5 sync pass over Signal Desktop's database.

Usage: signal-mcp-reindex [--backfill] [--quiet]

  --backfill   Reset the watermark and reindex every eligible message.
               Use on first run, after a schema change, or after deleting the FTS DB.
  --quiet, -q  Suppress progress output. Only print the final summary.
  --help, -h   Show this message.

Env:
  SIGNAL_DIR              Override Signal Desktop's data dir.
  SIGNAL_MCP_FTS_DB       Override the FTS DB path (default:
                          ~/Library/Application Support/signal-mcp-fts/fts.db).
`);
}
function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        usage();
        return;
    }
    const ftsPath = defaultFtsDbPath();
    const signal = openSignalDb();
    const fts = openFtsDb(ftsPath);
    const log = args.quiet ? () => undefined : (s) => process.stderr.write(`  ${s}\n`);
    if (!args.quiet) {
        process.stderr.write(`signal-mcp-reindex: signal=${signal.signalDir} fts=${ftsPath} ` +
            `mode=${args.backfill ? 'backfill' : 'incremental'}\n`);
    }
    dashboard.publishPhase('indexing', { mode: args.backfill ? 'backfill' : 'incremental' });
    try {
        const stats = syncOnce(signal.db, fts.db, { backfill: args.backfill, progress: log });
        process.stderr.write(`done in ${stats.durationMs}ms: ` +
            `inserted=${stats.inserted} updated=${stats.updated} deleted=${stats.deleted} ` +
            `batches=${stats.batches}\n`);
        dashboard.publishPhase('idle', {
            event: 'reindex_done',
            inserted: stats.inserted,
            updated: stats.updated,
            deleted: stats.deleted,
            duration_ms: stats.durationMs,
        });
    }
    catch (err) {
        const exc = err;
        dashboard.log('ERROR', `reindex failed: ${exc.name}: ${exc.message}`);
        dashboard.publishPhase('idle', { event: 'reindex_failed' });
        throw err;
    }
    finally {
        closeFtsDb(fts);
        closeSignalDb();
    }
}
main();
//# sourceMappingURL=cli.js.map