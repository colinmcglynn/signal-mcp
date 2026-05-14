import Database from 'better-sqlite3-multiple-ciphers';
import { execFileSync } from 'node:child_process';
import { createDecipheriv, pbkdf2Sync } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

export interface SignalDb {
  db: Database.Database;
  signalDir: string;
}

let cached: SignalDb | undefined;

export function defaultSignalDir(): string {
  if (process.env.SIGNAL_DIR) return process.env.SIGNAL_DIR;
  const home = homedir();
  switch (platform()) {
    case 'darwin':
      return join(home, 'Library/Application Support/Signal');
    case 'win32':
      return join(process.env.APPDATA ?? join(home, 'AppData/Roaming'), 'Signal');
    default:
      return join(home, '.config/Signal');
  }
}

interface SignalConfig {
  key?: string;
  encryptedKey?: string;
}

function decryptElectronSafeStorage(encryptedHex: string): string {
  const buf = Buffer.from(encryptedHex, 'hex');
  const prefix = buf.subarray(0, 3).toString('utf8');
  if (prefix !== 'v10' && prefix !== 'v11') {
    throw new Error(`Unexpected safeStorage prefix '${prefix}' (expected v10/v11).`);
  }
  const ciphertext = buf.subarray(3);

  let password: string;
  if (platform() === 'darwin') {
    // Signal Desktop uses "Signal Key" as the keychain account name; older builds and the
    // generic Electron safeStorage default use "Signal". Try both before failing.
    const candidateAccounts = ['Signal Key', 'Signal'];
    let lastErr: Error | undefined;
    let found: string | undefined;
    for (const account of candidateAccounts) {
      try {
        found = execFileSync(
          'security',
          ['find-generic-password', '-s', 'Signal Safe Storage', '-a', account, '-w'],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
        ).trim();
        break;
      } catch (err) {
        lastErr = err as Error;
      }
    }
    if (!found) {
      throw new Error(
        `Failed to read Signal's safeStorage password from macOS Keychain ` +
          `(tried accounts: ${candidateAccounts.join(', ')}). ` +
          `Approve the keychain prompt or run with SIGNAL_DIR pointing at a fixture. ` +
          `Underlying error: ${lastErr?.message ?? 'unknown'}`,
      );
    }
    password = found;
  } else if (platform() === 'linux' && prefix === 'v10') {
    password = 'peanuts';
  } else {
    throw new Error(
      `Decrypting Signal's encryptedKey on platform '${platform()}' with prefix '${prefix}' is not yet supported. ` +
        `Decrypt the key manually and set SIGNAL_KEY, or run a fixture via SIGNAL_DIR.`,
    );
  }

  const aesKey = pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1');
  const iv = Buffer.alloc(16, 0x20);
  const decipher = createDecipheriv('aes-128-cbc', aesKey, iv);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  if (!/^[0-9a-fA-F]{64}$/.test(plaintext)) {
    throw new Error(`Decrypted Signal key is not a 64-char hex string (got length ${plaintext.length}).`);
  }
  return plaintext;
}

export function loadKey(signalDir: string): string {
  if (process.env.SIGNAL_KEY && /^[0-9a-fA-F]{64}$/.test(process.env.SIGNAL_KEY)) {
    return process.env.SIGNAL_KEY;
  }
  const cfgPath = join(signalDir, 'config.json');
  if (!existsSync(cfgPath)) {
    throw new Error(`Signal config.json not found at ${cfgPath}. Set SIGNAL_DIR to override.`);
  }
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8')) as SignalConfig;
  if (cfg.key && /^[0-9a-fA-F]{64}$/.test(cfg.key)) return cfg.key;
  if (cfg.encryptedKey) return decryptElectronSafeStorage(cfg.encryptedKey);
  throw new Error(`Signal config.json has no 'key' or 'encryptedKey' field.`);
}

export function openSignalDb(signalDir = defaultSignalDir()): SignalDb {
  if (cached && cached.signalDir === signalDir) return cached;

  const dbPath = join(signalDir, 'sql/db.sqlite');
  if (!existsSync(dbPath)) {
    throw new Error(`Signal db.sqlite not found at ${dbPath}.`);
  }

  const key = loadKey(signalDir);
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });

  // Order matters: cipher + legacy version must be set before key.
  db.pragma(`cipher='sqlcipher'`);
  db.pragma(`legacy=4`);
  db.pragma(`key="x'${key}'"`);
  db.pragma(`query_only=ON`);

  // Touch sqlite_master to force decryption now and surface a clear error if the key is wrong.
  try {
    db.prepare(`SELECT name FROM sqlite_master LIMIT 1`).get();
  } catch (err) {
    db.close();
    throw new Error(
      `Failed to open Signal database (likely wrong key or unsupported SQLCipher version): ${
        (err as Error).message
      }`,
    );
  }

  cached = { db, signalDir };
  return cached;
}

export function closeSignalDb(): void {
  if (cached) {
    cached.db.close();
    cached = undefined;
  }
}
