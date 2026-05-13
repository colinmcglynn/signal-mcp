# signal-mcp

A Node/TypeScript [MCP](https://modelcontextprotocol.io) server that reads
Signal Desktop's encrypted SQLite database directly. Forked from
[jagypus/signal-mcp](https://github.com/jagypus/signal-mcp) and extended with a
real FTS5 full-text search index over message bodies.

> **Read-only.** The database is opened with `readonly: true` and
> `query_only=ON`. The server cannot modify Signal's data, and there is no
> linked Signal device anywhere in the stack — no `signal-cli`, no send path.

## Why fork

The upstream's `search_messages` claims FTS but silently falls back to
`body LIKE '%query%'` because Signal Desktop's `messages_fts` table uses a
custom `signal_tokenizer` registered only by Signal Desktop's native code, so
`MATCH` queries from third-party processes fail.

This fork builds a separate plaintext FTS5 SQLite index at
`~/Library/Application Support/signal-mcp-fts/fts.db` and maintains it via a
`signal-mcp-reindex` command. `search_messages` now actually ranks by BM25,
returns highlighted snippets, and supports multi-term queries.

## Requirements

* macOS, with Signal Desktop installed and at least signed in once.
* Node.js 20+.
* On first run you'll see one macOS Keychain prompt — approve it (and check
  *Always Allow* if you don't want to be asked again). The server reads the
  Signal `safeStorage` password from your login keychain to decrypt the
  SQLCipher key.

## Install

### Step 1 — clone, install, build the FTS index

```bash
git clone https://github.com/colinmcglynn/signal-mcp.git
cd signal-mcp
npm install
npm run build               # compile to dist/
node dist/indexer/cli.js --backfill   # first-time FTS backfill (~10s for 10k messages)
```

The first `--backfill` walks your entire message history and writes the FTS
index to `~/Library/Application Support/signal-mcp-fts/fts.db`. After that,
`node dist/indexer/cli.js` (no `--backfill`) does an incremental sync — run it
whenever you want fresh search.

### Step 2 — register with your Claude client

The two clients share the same MCP server JSON shape but read it from
different files. Pick whichever you use.

#### Claude Code

One-liner via the CLI:

```bash
claude mcp add signal --scope user -- node "$(pwd)/dist/index.js"
```

Or edit `~/.claude.json` (or a project `.mcp.json`) and add:

```json
{
  "mcpServers": {
    "signal": {
      "command": "node",
      "args": ["/Users/you/signal-mcp/dist/index.js"]
    }
  }
}
```

#### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)
or `%APPDATA%\Claude\claude_desktop_config.json` (Windows) and add:

```json
{
  "mcpServers": {
    "signal": {
      "command": "node",
      "args": ["/Users/you/signal-mcp/dist/index.js"]
    }
  }
}
```

Then fully quit and relaunch Claude Desktop — it only reads this file at
startup. (Claude Code picks up `claude mcp add` immediately, but you'll need
to restart any active sessions.)

### Step 3 — verify

* **Claude Code:** `claude mcp list` should include `signal`.
* **Claude Desktop:** check the connectors / tools panel; the five `signal`
  tools should be listed.

Then ask: *"List my Signal chats."*

### Updating

```bash
cd /path/to/signal-mcp
git pull
npm install
```

Restart Claude Desktop, or restart your Claude Code session, to pick up
changes.

### Removing

```bash
# Claude Code:
claude mcp remove signal

# Claude Desktop: delete the "signal" entry from claude_desktop_config.json,
# then relaunch the app.

rm -rf /path/to/signal-mcp
```

### Why not `npm install -g git+https://...`?

It looks attractive but currently fails on npm 11.x: the global-install path
mishandles native-dep install scripts (`better-sqlite3-multiple-ciphers`) and
partially-extracts the package tarball, leaving a broken install. The
clone-and-register flow above sidesteps the issue entirely.

## Tools

| Tool | Purpose |
|---|---|
| `list_chats` | List conversations with last-message metadata, filterable by group/DM, message count, and recency. |
| `get_recent_messages` | Cross-chat message query with date range, sender, and chat filters. |
| `get_chat_messages` | Same filter set, scoped to a single chat (by id or name). |
| `search_messages` | FTS5 full-text search against the side index. Multi-term, BM25 ranking, highlighted snippets. |
| `query_sql` | Read-only SQL passthrough (`SELECT`/`WITH`/`EXPLAIN`/`PRAGMA`). |

All inputs are validated with Zod. Timestamps are ISO 8601 in/out.

## Filtering rules

* `exclude_system` (default `true`) keeps only `type IN ('incoming','outgoing')`,
  filtering out `keychange`, `profile-change`, `group-v2-change`,
  `timer-notification`, etc.
* `only_with_body` (default `true`) excludes attachment-only / reaction /
  sticker rows where `body IS NULL`.
* `sender`: `me` (outgoing), `them` (incoming), `any` (both).

## Development

```bash
git clone https://github.com/jagypus/signal-mcp.git
cd signal-mcp
npm install
npm run build               # compile to dist/
npm run dev                 # tsx, stdio (no build step)
npm run probe               # dump schema/FTS/types against the live DB
npx tsx scripts/smoke.ts    # exercise every tool against the live DB
```

## How it opens the DB

Signal Desktop on macOS stores the SQLCipher v4 database at
`~/Library/Application Support/Signal/sql/db.sqlite`. Modern Signal versions
store the SQLCipher key encrypted in `config.json` under `encryptedKey` using
Electron's `safeStorage`:

* Strip `v10`/`v11` prefix → AES-128-CBC ciphertext.
* Encryption key = PBKDF2-HMAC-SHA1(password, "saltysalt", 1003 iters, 16 bytes).
* On macOS, `password` is fetched via `security find-generic-password -s "Signal Safe Storage" -a "Signal" -w` (one keychain prompt the first time).
* IV is 16 bytes of `0x20`.

The plaintext is the 64-char hex SQLCipher key. Older Signal builds with a
plaintext `key` in `config.json` are also supported.

The DB is opened with `better-sqlite3-multiple-ciphers` in `readonly: true`
mode and `query_only=ON` is set as a belt-and-braces guard. Opening while
Signal Desktop is running works fine because SQLCipher uses WAL.

### How the FTS side index works

Signal's own `messages_fts` is unusable from outside Signal Desktop (custom
tokenizer registered by native code). We work around this with a separate
plaintext SQLite database at
`~/Library/Application Support/signal-mcp-fts/fts.db` containing:

* A `messages` table with one row per indexable message (incoming/outgoing,
  body non-empty, not erased).
* A `messages_fts` virtual table (FTS5, `unicode61` tokenizer with diacritic
  folding — works for English and most Latin-script languages) that the
  `search_messages` tool queries with `MATCH` and ranks with `bm25()`.
* A `sync_state` row holding the `(sent_at, id)` watermark used for resumable
  incremental sync.

`signal-mcp-reindex` does three things on each pass:

1. **Forward scan** — pull rows with `(sent_at, id) > watermark`, upsert into
   the FTS DB in batches of 500. Backfill walks from `(0, "")`.
2. **Edit reconciliation** — re-read current body for every `messageId` in
   Signal's `edited_messages` table and upsert. Idempotent.
3. **Delete reconciliation** — remove FTS rows for messages now marked
   `isErased=1`, plus any hard-deletes that vanished from Signal's `messages`.

The side index is plaintext SQLite. If you want it encrypted at rest, the open
site in `src/indexer/db.ts` is marked with a `TODO` showing where to swap in
SQLCipher with a Keychain-stored key.

### `signal-mcp-reindex`

```bash
# manual happy path
node dist/indexer/cli.js              # incremental
node dist/indexer/cli.js --backfill   # force full reindex
node dist/indexer/cli.js --help
```

If you want it on a schedule, copy
`scripts/com.colinmcglynn.signal-mcp-reindex.plist.template` to
`~/Library/LaunchAgents/`, edit the placeholders, and `launchctl load -w` it.
The template's header comment walks through the steps.

## Environment

| Var | Effect |
|---|---|
| `SIGNAL_DIR` | Override default Signal data directory (useful for fixtures). |
| `SIGNAL_KEY` | 64-char hex SQLCipher key, bypassing `config.json`/Keychain. |
| `SIGNAL_MCP_FTS_DB` | Override the FTS side-index DB path (default: `~/Library/Application Support/signal-mcp-fts/fts.db`). |

## Cross-platform notes

* macOS: handled.
* Linux: `safeStorage` v10 uses the literal password `peanuts`. v11 (libsecret/KWallet) is not implemented — set `SIGNAL_KEY` explicitly.
* Windows: not implemented — set `SIGNAL_KEY` explicitly.

## Project layout

```
src/
  index.ts             # MCP server bootstrap
  db.ts                # connection + safeStorage key decryption
  schema.ts            # zod input shapes
  util/
    time.ts            # iso <-> ms
    messages.ts        # row shaping, display name resolution
    sql.ts             # shared filter SQL
  tools/
    listChats.ts
    getRecentMessages.ts
    getChatMessages.ts
    searchMessages.ts    # FTS5 MATCH against the side index
    querySql.ts
  indexer/
    db.ts                # open/create the FTS side DB
    schema.ts            # FTS DDL + schema_version guard
    sync.ts              # incremental + edit/delete reconciliation
    cli.ts               # `signal-mcp-reindex` entry
scripts/
  probe.ts                            # live-DB schema dump
  smoke.ts                            # live-DB end-to-end check
  com.colinmcglynn.signal-mcp-reindex.plist.template  # optional launchd agent
```

## License

MIT — see [LICENSE](./LICENSE).

This project is not affiliated with or endorsed by Signal Messenger LLC.
Signal Desktop itself is licensed under AGPL-3.0; this project does not
redistribute or modify any Signal code, it only reads the local SQLite
database that Signal Desktop creates on your own machine.

