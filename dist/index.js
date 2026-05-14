#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { existsSync } from 'node:fs';
import { createClient as createDashboardClient } from './dashboard.js';
import { openSignalDb, closeSignalDb } from './db.js';
import { closeFtsDb, defaultFtsDbPath, openFtsDb } from './indexer/db.js';
import { listChatsShape, getRecentMessagesShape, getChatMessagesShape, searchMessagesShape, querySqlShape, } from './schema.js';
import { listChats } from './tools/listChats.js';
import { getRecentMessages } from './tools/getRecentMessages.js';
import { getChatMessages } from './tools/getChatMessages.js';
import { searchMessages } from './tools/searchMessages.js';
import { querySql } from './tools/querySql.js';
function jsonResult(value) {
    return {
        content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    };
}
function errorResult(err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
        isError: true,
        content: [{ type: 'text', text: `Error: ${message}` }],
    };
}
function wrapTool(toolName, fn) {
    return async (args) => {
        return dashboard.withToolPhase(toolName, async () => {
            try {
                return jsonResult(fn(args));
            }
            catch (err) {
                return errorResult(err);
            }
        });
    };
}
const dashboard = createDashboardClient('signal-mcp');
async function main() {
    // Publish "starting" before anything that can hang (Keychain prompt,
    // SQLCipher decrypt) so the dashboard always reflects that signal-mcp tried
    // to come up. If we never reach "idle", that's a useful signal on its own.
    dashboard.publishPhase('starting', { event: 'open_signal_db' });
    let signal;
    try {
        signal = openSignalDb();
    }
    catch (err) {
        const exc = err;
        dashboard.log('ERROR', `failed to open Signal DB: ${exc.message}`);
        dashboard.publishPhase('error', { event: 'open_signal_db_failed', message: exc.message });
        throw err;
    }
    const { db } = signal;
    // The FTS side index is built by signal-mcp-reindex. We open it lazily so the server
    // still starts (and the non-search tools still work) if the user hasn't run reindex yet.
    let ftsCached;
    function getFts() {
        if (ftsCached)
            return ftsCached;
        const path = defaultFtsDbPath();
        if (!existsSync(path)) {
            throw new Error(`FTS index not found at ${path}. Run \`signal-mcp-reindex --backfill\` to build it.`);
        }
        ftsCached = openFtsDb(path, { readOnly: true });
        return ftsCached;
    }
    const server = new McpServer({ name: 'signal-mcp', version: '0.1.0' }, {
        capabilities: { tools: {} },
        instructions: "Read-only access to Signal Desktop's local message database. " +
            'Use list_chats to discover conversations, get_recent_messages for cross-chat queries, ' +
            'get_chat_messages for a single chat, search_messages for full-text search, and ' +
            'query_sql for arbitrary read-only SQL. All timestamps are ISO 8601.',
    });
    server.registerTool('list_chats', {
        title: 'List Signal chats',
        description: 'List Signal conversations with last-message metadata. Filters: include_empty, is_group, min_messages, since.',
        inputSchema: listChatsShape,
    }, wrapTool('list_chats', (args) => listChats(db, args)));
    server.registerTool('get_recent_messages', {
        title: 'Get recent Signal messages',
        description: 'Cross-chat message query with date range, sender, and chat filters. Excludes system events by default.',
        inputSchema: getRecentMessagesShape,
    }, wrapTool('get_recent_messages', (args) => getRecentMessages(db, args)));
    server.registerTool('get_chat_messages', {
        title: 'Get messages from one chat',
        description: 'Fetch messages from a single chat (by chat_id or chat_name) with the same filter set as get_recent_messages.',
        inputSchema: getChatMessagesShape,
    }, wrapTool('get_chat_messages', (args) => getChatMessages(db, args)));
    server.registerTool('search_messages', {
        title: 'Search Signal message bodies',
        description: 'FTS5 full-text search across all message bodies. Results include a highlighted snippet ' +
            '(« and » wrap matched terms) and a BM25 score. Filters: since/until, sender, chat_ids, ' +
            'chat_name_contains. Sort by relevance (default) or recent.',
        inputSchema: searchMessagesShape,
    }, wrapTool('search_messages', (args) => searchMessages(db, getFts().db, args)));
    server.registerTool('query_sql', {
        title: 'Run read-only SQL',
        description: 'Execute a single read-only SQL statement (SELECT/WITH/EXPLAIN/PRAGMA) against the Signal database.',
        inputSchema: querySqlShape,
    }, wrapTool('query_sql', (args) => querySql(db, args)));
    // Publish "idle" once the server is ready to accept tool calls. Earlier
    // "starting" → "idle" transition makes the dashboard show actual readiness.
    dashboard.onStartup();
    // Keep the heartbeat fresh between tool calls so the dashboard can
    // distinguish "alive and idle" from "stopped". 60s is well under the
    // manifest's heartbeat_timeout_seconds.
    const heartbeatTimer = setInterval(() => dashboard.heartbeat(), 60_000);
    heartbeatTimer.unref();
    const shutdown = (signal) => {
        clearInterval(heartbeatTimer);
        dashboard.onShutdown();
        if (ftsCached)
            closeFtsDb(ftsCached);
        closeSignalDb();
        // Allow the dashboard write to flush before we exit. better-sqlite3 is
        // synchronous so this is just defense-in-depth against any future
        // refactor that introduces an async path.
        process.exit(signal === 'EXIT' ? 0 : 0);
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    // Catch normal exits (stdin EOF → transport closes → SDK calls process.exit).
    // process.on('exit') runs even on natural termination.
    process.on('exit', () => {
        clearInterval(heartbeatTimer);
        dashboard.onShutdown();
    });
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
main().catch((err) => {
    console.error(err instanceof Error ? err.stack ?? err.message : String(err));
    process.exit(1);
});
//# sourceMappingURL=index.js.map