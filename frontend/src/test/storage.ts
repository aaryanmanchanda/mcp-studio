// everything currently in localStorage as a plain object. goes through length/key/getItem so it behaves the
// same on a real browser Storage and on the in-memory shim in setup.ts (spreading either one differs).
export function storageDump(): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!;
    out[k] = localStorage.getItem(k)!;
  }
  return out;
}
