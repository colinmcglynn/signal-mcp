#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { existsSync } from 'node:fs';
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
async function main() {
    const { db } = openSignalDb();
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
    }, async (args) => {
        try {
            return jsonResult(listChats(db, args));
        }
        catch (err) {
            return errorResult(err);
        }
    });
    server.registerTool('get_recent_messages', {
        title: 'Get recent Signal messages',
        description: 'Cross-chat message query with date range, sender, and chat filters. Excludes system events by default.',
        inputSchema: getRecentMessagesShape,
    }, async (args) => {
        try {
            return jsonResult(getRecentMessages(db, args));
        }
        catch (err) {
            return errorResult(err);
        }
    });
    server.registerTool('get_chat_messages', {
        title: 'Get messages from one chat',
        description: 'Fetch messages from a single chat (by chat_id or chat_name) with the same filter set as get_recent_messages.',
        inputSchema: getChatMessagesShape,
    }, async (args) => {
        try {
            return jsonResult(getChatMessages(db, args));
        }
        catch (err) {
            return errorResult(err);
        }
    });
    server.registerTool('search_messages', {
        title: 'Search Signal message bodies',
        description: 'FTS5 full-text search across all message bodies. Results include a highlighted snippet ' +
            '(« and » wrap matched terms) and a BM25 score. Filters: since/until, sender, chat_ids, ' +
            'chat_name_contains. Sort by relevance (default) or recent.',
        inputSchema: searchMessagesShape,
    }, async (args) => {
        try {
            return jsonResult(searchMessages(db, getFts().db, args));
        }
        catch (err) {
            return errorResult(err);
        }
    });
    server.registerTool('query_sql', {
        title: 'Run read-only SQL',
        description: 'Execute a single read-only SQL statement (SELECT/WITH/EXPLAIN/PRAGMA) against the Signal database.',
        inputSchema: querySqlShape,
    }, async (args) => {
        try {
            return jsonResult(querySql(db, args));
        }
        catch (err) {
            return errorResult(err);
        }
    });
    const transport = new StdioServerTransport();
    await server.connect(transport);
    const shutdown = () => {
        if (ftsCached)
            closeFtsDb(ftsCached);
        closeSignalDb();
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}
main().catch((err) => {
    console.error(err instanceof Error ? err.stack ?? err.message : String(err));
    process.exit(1);
});
//# sourceMappingURL=index.js.map