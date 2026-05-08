import type Database from 'better-sqlite3-multiple-ciphers';

export interface QuerySqlInput {
  sql: string;
  params?: Array<string | number | boolean | null>;
  max_rows: number;
}

const READ_PREFIX = /^\s*(SELECT|WITH|EXPLAIN|PRAGMA)\b/i;

function stripComments(sql: string): string {
  // Remove /* ... */ and -- ... \n comments before checking the leading keyword.
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\n]*/g, '')
    .trim();
}

export function querySql(
  db: Database.Database,
  input: QuerySqlInput,
): { columns: string[]; rows: unknown[][]; truncated: boolean; row_count: number } {
  const stripped = stripComments(input.sql);
  if (!READ_PREFIX.test(stripped)) {
    throw new Error(
      `Only read-only statements (SELECT, WITH, EXPLAIN, PRAGMA) are allowed.`,
    );
  }
  if (/;\s*\S/.test(stripped)) {
    throw new Error(`Multiple statements are not allowed.`);
  }

  const stmt = db.prepare(input.sql);
  const params = input.params ?? [];

  let rows: Record<string, unknown>[];
  try {
    stmt.raw(false);
    rows = stmt.all(...params) as Record<string, unknown>[];
  } catch (err) {
    // Some PRAGMA statements don't return rows; fall back to run().
    if ((err as Error).message?.includes('does not return data')) {
      stmt.run(...params);
      return { columns: [], rows: [], truncated: false, row_count: 0 };
    }
    throw err;
  }

  const truncated = rows.length > input.max_rows;
  const limited = truncated ? rows.slice(0, input.max_rows) : rows;
  const columns = limited.length > 0 ? Object.keys(limited[0]!) : [];
  const rowsArr = limited.map((r) => columns.map((c) => r[c] ?? null));

  return { columns, rows: rowsArr, truncated, row_count: limited.length };
}
