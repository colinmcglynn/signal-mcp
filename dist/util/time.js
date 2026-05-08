export function isoToMs(iso) {
    if (iso === undefined)
        return undefined;
    const ms = Date.parse(iso);
    if (Number.isNaN(ms)) {
        throw new Error(`Invalid ISO 8601 timestamp: '${iso}'`);
    }
    return ms;
}
export function msToIso(ms) {
    if (ms === null || ms === undefined || ms === 0)
        return null;
    return new Date(ms).toISOString();
}
//# sourceMappingURL=time.js.map