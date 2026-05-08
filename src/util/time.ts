export function isoToMs(iso: string | undefined): number | undefined {
  if (iso === undefined) return undefined;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    throw new Error(`Invalid ISO 8601 timestamp: '${iso}'`);
  }
  return ms;
}

export function msToIso(ms: number | null | undefined): string | null {
  if (ms === null || ms === undefined || ms === 0) return null;
  return new Date(ms).toISOString();
}
