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

/**
 * Read Signal Desktop's safeStorage password out of the macOS login keychain.
 *
 * The credential lives under service "Signal Safe Storage". Signal Desktop writes it with
 * account "Signal Key"; older builds and the generic Electron safeStorage default use "Signal".
 * Rather than rely on those account names being current, we try them first for a precise match
 * and then fall back to a service-only lookup (no `-a`), which resolves the entry regardless of
 * the account name `security` recorded. The service name is unique to Signal, so the fallback is
 * unambiguous and survives any future rename of the account.
 */
function readMacKeychainPassword(): string {
  const attempts: Array<{ args: string[]; label: string }> = [
    { args: ['-s', 'Signal Safe Storage', '-a', 'Signal Key', '-w'], label: 'account "Signal Key"' },
    { args: ['-s', 'Signal Safe Storage', '-a', 'Signal', '-w'], label: 'account "Signal"' },
    { args: ['-s', 'Signal Safe Storage', '-w'], label: 'service-only (any account)' },
  ];
  let lastErr: Error | undefined;
  for (const { args } of attempts) {
    try {
      const out = execFileSync('security', ['find-generic-password', ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
      if (out) return out;
    } catch (err) {
      lastErr = err as Error;
    }
  }
  throw new Error(
    `Failed to read Signal's safeStorage password from the macOS login keychain ` +
      `under service "Signal Safe Storage" (tried ${attempts.map((a) => a.label).join(', ')}). ` +
      `If a keychain prompt appeared, approve it and retry. If the keychain is locked, run ` +
      `\`security unlock-keychain\` first. To confirm the entry exists, run ` +
      `\`security find-generic-password -s 'Signal Safe Storage' -w\`. ` +
      `As an escape hatch, set SIGNAL_KEY (64-char hex) to bypass the keychain, or point ` +
      `SIGNAL_DIR at a fixture directory. Underlying error: ${lastErr?.message ?? 'unknown'}`,
  );
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
    password = readMacKeychainPassword();
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
