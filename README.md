# signal-mcp

A Node/TypeScript [MCP](https://modelcontextprotocol.io) server that reads
Signal Desktop's encrypted SQLite database directly and exposes richer query
tools than the original Python `signal-mcp-server`.

> **Read-only.** The database is opened with `readonly: true` and
> `query_only=ON`. The server cannot modify Signal's data.

## Requirements

* macOS, with Signal Desktop installed and at least signed in once.
* Node.js 20+.
* On first run you'll see one macOS Keychain prompt — approve it (and check
  *Always Allow* if you don't want to be asked again). The server reads the
  Signal `safeStorage` password from your login keychain to decrypt the
  SQLCipher key.

## Install

### Step 1 — clone and install deps

```bash
git clone https://github.com/jagypus/signal-mcp.git
cd signal-mcp
npm install
```

The repo ships a pre-built `dist/` so no compile step is needed; `npm install`
just pulls runtime deps.

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
| `search_messages` | Full-text-ish search across all message bodies. Falls back to `LIKE`. |
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

### Search caveat

`messages_fts` exists but uses Signal's custom `signal_tokenizer` which is
registered only by Signal Desktop's native code. Third-party readers can't run
`MATCH` queries against it, so `search_messages` probes once and silently
falls back to `body LIKE '%query%'`.

## Environment

| Var | Effect |
|---|---|
| `SIGNAL_DIR` | Override default Signal data directory (useful for fixtures). |
| `SIGNAL_KEY` | 64-char hex SQLCipher key, bypassing `config.json`/Keychain. |

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
    searchMessages.ts
    querySql.ts
scripts/
  probe.ts             # live-DB schema dump
  smoke.ts             # live-DB end-to-end check
```

## License

MIT — see [LICENSE](./LICENSE).

This project is not affiliated with or endorsed by Signal Messenger LLC.
Signal Desktop itself is licensed under AGPL-3.0; this project does not
redistribute or modify any Signal code, it only reads the local SQLite
database that Signal Desktop creates on your own machine.

