// Optional integration with the personal services dashboard
// (https://github.com/colinmcglynn/personal-dashboard).
//
// If the dashboard's SQLite DB exists at ~/.services-dashboard/dashboard.db
// (or wherever SERVICES_DASHBOARD_DB points), we publish phase + heartbeat
// rows and structured log lines into it. If the DB or its schema is missing,
// every call here degrades to a no-op so signal-mcp keeps working when the
// dashboard isn't installed.
//
// This is a TypeScript port of libby-mcp's dashboard.py and the dashboard's
// own services_dashboard_client.py. We don't shell out to the Python client
// because we're already in Node and the schema is small enough to inline.
//
// signal-mcp registers two services with the dashboard: the always-on MCP
// server (service name "signal-mcp") and the reindex process (service name
// "signal-mcp-reindex"). They get separate manifests and separate phase
// state so running reindex while the server is up doesn't clobber the
// server's row.
import Database from 'better-sqlite3-multiple-ciphers';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
const DB_PATH = process.env.SERVICES_DASHBOARD_DB ??
    join(homedir(), '.services-dashboard/dashboard.db');
const VALID_LEVELS = new Set(['DEBUG', 'INFO', 'WARN', 'ERROR']);
const enabled = existsSync(DB_PATH);
function nowIso() {
    return new Date().toISOString();
}
function withDb(fn) {
    if (!enabled)
        return undefined;
    let db;
    try {
        db = new Database(DB_PATH, { timeout: 5000 });
        db.pragma('busy_timeout = 5000');
        return fn(db);
    }
    catch {
        // Schema not yet created (dashboard never started), DB locked past
        // retry, or anything else: stay quiet, dashboard is auxiliary.
        return undefined;
    }
    finally {
        db?.close();
    }
}
export function createClient(serviceName) {
    function publishPhase(phase, extra) {
        withDb((db) => {
            const now = nowIso();
            const pid = process.pid;
            const extraJson = extra ? JSON.stringify(extra) : null;
            const tx = db.transaction(() => {
                const row = db
                    .prepare(`SELECT current_phase FROM service_status WHERE service_name = ?`)
                    .get(serviceName);
                if (!row) {
                    db.prepare(`INSERT INTO service_status
               (service_name, current_phase, phase_started_at, last_heartbeat, pid, extra_json)
             VALUES (?, ?, ?, ?, ?, ?)`).run(serviceName, phase, now, now, pid, extraJson);
                    db.prepare(`INSERT INTO phase_history (service_name, from_phase, to_phase, ts)
             VALUES (?, ?, ?, ?)`).run(serviceName, null, phase, now);
                }
                else if (row.current_phase !== phase) {
                    db.prepare(`UPDATE service_status
               SET current_phase = ?, phase_started_at = ?, last_heartbeat = ?,
                   pid = ?, extra_json = ?
             WHERE service_name = ?`).run(phase, now, now, pid, extraJson, serviceName);
                    db.prepare(`INSERT INTO phase_history (service_name, from_phase, to_phase, ts)
             VALUES (?, ?, ?, ?)`).run(serviceName, row.current_phase, phase, now);
                }
                else if (extraJson !== null) {
                    db.prepare(`UPDATE service_status SET last_heartbeat = ?, pid = ?, extra_json = ?
             WHERE service_name = ?`).run(now, pid, extraJson, serviceName);
                }
                else {
                    db.prepare(`UPDATE service_status SET last_heartbeat = ?, pid = ?
             WHERE service_name = ?`).run(now, pid, serviceName);
                }
            });
            tx();
        });
    }
    function heartbeat() {
        withDb((db) => {
            db.prepare(`UPDATE service_status SET last_heartbeat = ? WHERE service_name = ?`).run(nowIso(), serviceName);
        });
    }
    function log(level, message, context) {
        withDb((db) => {
            const lvl = VALID_LEVELS.has(level) ? level : 'INFO';
            const ctxJson = context ? JSON.stringify(context) : null;
            db.prepare(`INSERT INTO logs (service_name, ts, level, message, context_json)
         VALUES (?, ?, ?, ?, ?)`).run(serviceName, nowIso(), lvl, message, ctxJson);
        });
    }
    async function withToolPhase(toolName, body, extra) {
        publishPhase('active', { tool: toolName, ...(extra ?? {}) });
        try {
            return await body();
        }
        catch (err) {
            const exc = err;
            log('ERROR', `${toolName} failed: ${exc.name}: ${exc.message}`, {
                tool: toolName,
                exc_type: exc.name,
            });
            throw err;
        }
        finally {
            publishPhase('idle', { tool: toolName });
        }
    }
    return {
        serviceName,
        isEnabled: () => enabled,
        publishPhase,
        heartbeat,
        log,
        withToolPhase,
        onStartup: () => publishPhase('idle', { event: 'server_start' }),
        onShutdown: () => publishPhase('stopped', { event: 'server_stop' }),
    };
}
//# sourceMappingURL=dashboard.js.map