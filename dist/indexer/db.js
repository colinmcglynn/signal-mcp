import Database from 'better-sqlite3-multiple-ciphers';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { initSchema } from './schema.js';
export function defaultFtsDbPath() {
    if (process.env.SIGNAL_MCP_FTS_DB)
        return process.env.SIGNAL_MCP_FTS_DB;
    return join(homedir(), 'Library/Application Support/signal-mcp-fts/fts.db');
}
// TODO: swap to better-sqlite3-multiple-ciphers SQLCipher with a Keychain-stored key
// once we want the FTS index encrypted at rest. The schema and sync logic don't need
// to change — only the open path here.
export function openFtsDb(path = defaultFtsDbPath(), { readOnly = false } = {}) {
    const dir = dirname(path);
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true, mode: 0o700 });
    const db = new Database(path, readOnly ? { readonly: true, fileMustExist: true } : {});
    if (!readOnly) {
        db.pragma(`journal_mode = WAL`);
        db.pragma(`synchronous = NORMAL`);
        initSchema(db);
    }
    return { db, path };
}
export function closeFtsDb(fts) {
    fts.db.close();
}
//# sourceMappingURL=db.js.map