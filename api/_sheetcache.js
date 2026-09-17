/* ════════════════════════════════════════════════════════════════════════════
   _sheetcache.js — read cache, retry and stale-fallback for Google Sheets.

   WHY
   ---
   The Sheets quota that bites is "Read requests per minute per USER", and the
   user is the SERVICE ACCOUNT — so every dashboard load, every viewer, and the
   15-minute Apps Script all draw on ONE budget of 60 reads a minute. One
   dashboard request reads six tabs (plus the live connectivity file), so a
   handful of people opening the page in the same minute is enough to exhaust
   it, and the endpoint then 500s with "Quota exceeded".

   Three mechanisms, in the order they matter:

   1. CACHE. A module-level store, shared by every request the same warm
      instance serves. The underlying data only changes every 15 minutes, so a
      60-90s TTL costs nothing in freshness and removes almost all the reads.
      Long-lived reference tabs (the roster) get a much longer TTL.

   2. IN-FLIGHT DEDUPE. Two requests arriving together for the same tab share
      one API call instead of racing to make two.

   3. RETRY, THEN STALE. A 429 is retried with jittered backoff; if it still
      fails and we hold ANY previous copy, that copy is served rather than
      failing the page. A dashboard a minute stale is strictly better than an
      error screen, and the staleness is reported so the UI can say so.

   Never add a cache-busting parameter to defeat this: a hard refresh that
   bypassed the cache is exactly what produced the quota error.
   ════════════════════════════════════════════════════════════════════════════ */

const store = new Map();     // tab -> { values, at, stale:boolean }
const inflight = new Map();  // tab -> Promise

/* Per-tab TTLs. The roster changes when someone joins; the call feeds change
   every 15 minutes; nothing here changes every second. */
export const TTL = {
  'Ozontel': 75000,
  'hourly': 75000,
  'speed': 120000,
  'speed_leads': 120000,
  'LRM_TL_MAP': 600000,
  'Inbound_perf': 75000,
  'MS Schedule Inventory': 300000,
  _default: 90000,
};
const ttlFor = (tab) => TTL[tab] || TTL._default;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isThrottle = (e) => /quota|rate limit|rateLimitExceeded|429|too many/i.test(String((e && e.message) || e));

/* Read a tab through the cache. `reader` is the app's own readSheet, so auth
   and the spreadsheet id stay where they already live. Throws only when there
   is no cached copy at all to fall back on. */
export async function cachedRead(reader, tab) {
  const now = Date.now();
  const hit = store.get(tab);
  if (hit && now - hit.at < ttlFor(tab)) return hit.values;
  if (inflight.has(tab)) return inflight.get(tab);

  const p = (async () => {
    let lastErr = null;
    // Two attempts on a throttle only. More would deepen the very queue that
    // caused it; a stale copy is the better answer past that point.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const values = await reader(tab);
        store.set(tab, { values, at: Date.now(), stale: false });
        return values;
      } catch (e) {
        lastErr = e;
        if (!isThrottle(e) || attempt === 2) break;
        await sleep(350 * Math.pow(2, attempt) + Math.random() * 250);
      }
    }
    if (hit) {
      // Serve the old copy and keep it, marked stale, so subsequent requests in
      // this minute do not each re-attempt and re-fail.
      store.set(tab, { values: hit.values, at: Date.now() - ttlFor(tab) + 15000, stale: true });
      return hit.values;
    }
    throw lastErr;
  })().finally(() => inflight.delete(tab));

  inflight.set(tab, p);
  return p;
}

/* True when anything currently held was served from a failed refresh. The UI
   shows this rather than pretending the numbers are live. */
export function anyStale() {
  for (const v of store.values()) if (v.stale) return true;
  return false;
}
