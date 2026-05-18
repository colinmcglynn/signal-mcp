# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build      # tsc → dist/
npm run dev        # tsx, runs the server directly from src/ (stdio)
npm run probe      # dump Signal DB schema/FTS/types (read-only, hits keychain)
npm run reindex    # run the FTS sync; pass --backfill for a full rebuild
npm test           # vitest run (no test files exist yet at time of writing)
npx tsx scripts/smoke.ts   # exercise every MCP tool end-to-end against the live DB
node dist/indexer/cli.js [--backfill|--help]   # production indexer entry
```

Single test (once tests exist): `npx vitest run path/to/file.test.ts -t "name pattern"`.

There is no lint step configured.

## Architecture

**Two binaries, one process model.** `dist/index.js` is the MCP server (stdio transport, spawned by the Claude client). `dist/indexer/cli.js` (`signal-mcp-reindex`) is a separate CLI that owns the FTS side index. They share `src/db.ts` (Signal DB open + key decryption) and `src/indexer/db.ts` (FTS DB open) but are otherwise independent processes.

**Read-only invariant — preserve it.** Signal's DB is opened with `better-sqlite3-multiple-ciphers` in `readonly: true` mode and the server immediately sets `PRAGMA query_only=ON` ([src/db.ts](src/db.ts)). The `query_sql` tool additionally screens statements at the SQL layer. Any change that introduces a write path against Signal's DB is a regression of the project's stated guarantee — don't add one.

**Signal DB open is lazy.** `openSignalDb()` is called from a `getDb()` closure inside [src/index.ts](src/index.ts) on the first tool invocation, not at server startup. This matters because Claude Desktop respawns the MCP server on every session reconnect and an eager open triggers a macOS Keychain prompt for `node` — even in sessions that never touch Signal. The module-level `cached` in [src/db.ts](src/db.ts) makes subsequent opens within one process free. Don't move the open back to `main()`.

**Key derivation path.** `loadKey()` in [src/db.ts](src/db.ts) reads Signal's `config.json`, finds `encryptedKey`, strips a `v10`/`v11` prefix, and decrypts the SafeStorage password via `security find-generic-password -s "Signal Safe Storage" -a "Signal Key" -w` (falling back to account `Signal` for older builds). The password is then run through PBKDF2-HMAC-SHA1 (`saltysalt`, 1003 iters, 16 bytes) with a 16-byte `0x20` IV to derive the SQLCipher AES-128-CBC key. `SIGNAL_KEY` (64-char hex) and `SIGNAL_DIR` (override data dir, useful for fixtures) bypass this path entirely.

**FTS side index.** Signal's own `messages_fts` uses a custom tokenizer registered only by Signal Desktop's native code, so `MATCH` fails from any other process. The workaround is a separate **plaintext** SQLite at `~/Library/Application Support/signal-mcp-fts/fts.db` (override with `SIGNAL_MCP_FTS_DB`) that the reindexer keeps in sync. `search_messages` joins back to Signal's DB by id for display fields — the FTS index only stores what's needed to rank and snippet. There's a `TODO` in `src/indexer/db.ts` marking where to swap in SQLCipher if encryption-at-rest becomes a goal.

**Reindexer is three reconciliation passes** (see [src/indexer/sync.ts](src/indexer/sync.ts)): a forward `(sent_at, id)` watermark scan, an edits pass that re-upserts every `messageId` in Signal's `edited_messages`, and a deletions pass that drops FTS rows for `isErased=1` and hard-deleted ids. All three passes must remain idempotent so users can run `--backfill` or restart mid-sync without corrupting the watermark in `sync_state`.

**Tool plumbing.** Each tool is a pure function `(db, args) → result` under [src/tools/](src/tools/). [src/index.ts](src/index.ts) wires them up via `wrapTool(name, fn)` which (a) catches errors and shapes them as `isError` MCP responses and (b) brackets the call with `dashboard.withToolPhase` for phase/log telemetry. `searchMessages` is the one tool that takes both the Signal DB and the FTS DB; everything else takes just the Signal DB.

**Optional dashboard integration.** [src/dashboard.ts](src/dashboard.ts) writes phase/heartbeat/log rows into the personal services dashboard's SQLite at `~/.services-dashboard/dashboard.db` (override with `SERVICES_DASHBOARD_DB`). It auto-no-ops when the DB doesn't exist — **keep this graceful**, the project must run on machines without the dashboard installed. Two service names are registered separately: `signal-mcp` (the server) and `signal-mcp-reindex` (the CLI), with manifests under `~/.services-dashboard/services/`.

**Cross-platform reality.** macOS is the only fully-supported path. On Linux, `safeStorage` v10 uses the literal password `peanuts`; v11 (libsecret/KWallet) is not implemented. Windows is not implemented. For both, callers must supply `SIGNAL_KEY` directly.

## Editing flow

The MCP server is spawned per-session by the Claude client from `dist/index.js`. If you edit `src/`, you must `npm run build` and either kill running `signal-mcp/dist/index.js` processes (Claude Desktop will respawn them) or restart the Claude client. The `dev` script (`tsx src/index.ts`) is useful when iterating outside the client.
