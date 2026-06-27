// Minimap circle detection + personal portrait database + tower status

// ── Colour signature helpers ──────────────────────────────────────────────────
const SIG_N = 12;
const _CX = SIG_N / 2, _CY = SIG_N / 2;
// Use 72% of inscribed circle radius — excludes the coloured ring border so only
// the portrait interior pixels contribute to the matching signature.
const _SIG_R = SIG_N * 0.36;
const _R2 = _SIG_R ** 2;

/**
 * Colour signature with tight circular mask.
 * Only the inner 72% of the inscribed circle (portrait interior) contributes.
 * Out-of-circle pixels → neutral grey (0.5) so they contribute 0 to distance.
 */
function _sig(data: Uint8ClampedArray): Float32Array {
  const s = new Float32Array(SIG_N * SIG_N * 3);
  for (let py = 0; py < SIG_N; py++) {
    for (let px = 0; px < SIG_N; px++) {
      const i = py * SIG_N + px;
      const dx = px - _CX + 0.5, dy = py - _CY + 0.5;
      if (dx * dx + dy * dy > _R2) {
        s[i * 3] = 0.5; s[i * 3 + 1] = 0.5; s[i * 3 + 2] = 0.5;
      } else {
        s[i * 3]     = data[i * 4]     / 255;
        s[i * 3 + 1] = data[i * 4 + 1] / 255;
        s[i * 3 + 2] = data[i * 4 + 2] / 255;
      }
    }
  }
  return s;
}

/**
 * Apply a circular mask to a canvas in-place.
 * Pixels outside `radius` from the centre are replaced with neutral dark grey
 * so they contribute 0 to the colour signature (same as _sig's neutral 0.5).
 * The image is composited onto a solid dark-navy background so the JPEG doesn't
 * encode grey as compressed-white artefacts.
 */
function _applyCircularMaskToCanvas(
  off: HTMLCanvasElement,
  radius: number,
): HTMLCanvasElement {
  const size = off.width; // square canvas
  const ctx  = off.getContext("2d")!;

  // Use destination-in to clip to circle, then overlay on dark bg
  ctx.save();
  ctx.globalCompositeOperation = "destination-in";
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Composite the clipped portrait onto a solid dark-navy background
  const bg = document.createElement("canvas");
  bg.width = size; bg.height = size;
  const bgCtx = bg.getContext("2d")!;
  bgCtx.fillStyle = "#0a0a1a";
  bgCtx.fillRect(0, 0, size, size);
  bgCtx.drawImage(off, 0, 0);
  return bg;
}

function sigFromUrl(url: string): Promise<Float32Array | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = SIG_N; c.height = SIG_N;
        const ctx = c.getContext("2d")!;
        ctx.drawImage(img, 0, 0, SIG_N, SIG_N);
        resolve(_sig(ctx.getImageData(0, 0, SIG_N, SIG_N).data));
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function dist(a: Float32Array, b: Float32Array): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += (a[i] - b[i]) ** 2;
  return Math.sqrt(d / a.length);
}

// ── Personal portrait database ────────────────────────────────────────────────
const _PDBNAME = "wr_portrait_db_v1";
const _PSTORE  = "portraits";

export interface PortraitDbEntry {
  id?: number;
  champName: string;
  sig: Float32Array;
  cropDataUrl: string;
  ts: number;
  cropPct?: number; // crop size used when saving
}

function _openPortraitDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(_PDBNAME, 1);
    r.onupgradeneeded = () => {
      const store = r.result.createObjectStore(_PSTORE, { keyPath: "id", autoIncrement: true });
      store.createIndex("champName", "champName", { unique: false });
    };
    r.onsuccess = () => res(r.result);
    r.onerror   = () => rej(r.error);
  });
}

export async function getAllPortraitEntries(): Promise<PortraitDbEntry[]> {
  try {
    const db = await _openPortraitDb();
    return new Promise((res, rej) => {
      const req = db.transaction(_PSTORE, "readonly").objectStore(_PSTORE).getAll();
      req.onsuccess = () => res(req.result as PortraitDbEntry[]);
      req.onerror   = () => rej(req.error);
    });
  } catch { return []; }
}

export async function deletePortraitEntry(id: number): Promise<void> {
  const db = await _openPortraitDb();
  return new Promise((res, rej) => {
    const tx = db.transaction(_PSTORE, "readwrite");
    tx.objectStore(_PSTORE).delete(id);
    tx.oncomplete = () => res();
    tx.onerror    = () => rej(tx.error);
  });
}

async function _savePortraitEntry(entry: Omit<PortraitDbEntry, "id">): Promise<void> {
  const db = await _openPortraitDb();
  return new Promise((res, rej) => {
    const tx = db.transaction(_PSTORE, "readwrite");
    tx.objectStore(_PSTORE).add(entry);
    tx.oncomplete = () => res();
    tx.onerror    = () => rej(tx.error);
  });
}

// Serialisable form of a portrait entry (Float32Array → number[])
interface PortraitDbEntryJson {
  champName: string;
  sig: number[];
  cropDataUrl: string;
  ts: number;
  cropPct?: number;
}

/** Download all portrait entries as a JSON file. */
export async function exportPortraitDb(): Promise<number> {
  const entries = await getAllPortraitEntries();
  const payload: PortraitDbEntryJson[] = entries.map(e => ({
    champName: e.champName,
    sig: Array.from(e.sig),
    cropDataUrl: e.cropDataUrl,
    ts: e.ts,
    cropPct: e.cropPct,
  }));
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `wr-portraits-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  return entries.length;
}

/** Import portrait entries from a JSON file produced by exportPortraitDb.
 *  Returns the number of entries written. */
export async function importPortraitDb(
  file: File,
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  const text = await file.text();
  const raw = JSON.parse(text) as unknown;
  if (!Array.isArray(raw)) throw new Error("Invalid portrait DB file");
  const entries = raw as PortraitDbEntryJson[];
  let count = 0;
  for (const e of entries) {
    await _savePortraitEntry({
      champName: e.champName,
      sig: new Float32Array(e.sig),
      cropDataUrl: e.cropDataUrl,
      ts: e.ts,
      cropPct: e.cropPct,
    });
    count++;
    onProgress?.(count, entries.length);
  }
  return count;
}

/**
 * Crop a square patch from the minimap centred on (xPct, yPct).
 * cropSizePct controls how wide the crop is as a % of the minimap width.
 * Smaller values = tighter crop = more portrait, less ring border.
 */
export function cropMinimapPortrait(
  minimapDataUrl: string,
  xPct: number,
  yPct: number,
  cropSizePct: number,
): Promise<string | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const W = img.width, H = img.height;
      const halfPx = (cropSizePct / 100) * W / 2;
      const cx = (xPct / 100) * W;
      const cy = (yPct / 100) * H;
      const c = document.createElement("canvas");
      c.width = 48; c.height = 48;
      c.getContext("2d")!.drawImage(img, cx - halfPx, cy - halfPx, halfPx * 2, halfPx * 2, 0, 0, 48, 48);
      // Mask out the ring border — only the portrait interior is saved
      const masked = _applyCircularMaskToCanvas(c, 48 * 0.72);
      resolve(masked.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => resolve(null);
    img.src = minimapDataUrl;
  });
}

/**
 * Crop the minimap at the pin location and save to personal DB.
 * cropSizePct must match the value used in detectMapCircles so signatures are comparable.
 */
export async function saveChampPortrait(
  champName: string,
  minimapDataUrl: string,
  x: number,
  y: number,
  cropSizePct: number,
): Promise<void> {
  const cropDataUrl = await cropMinimapPortrait(minimapDataUrl, x, y, cropSizePct);
  if (!cropDataUrl) return;
  const sig = await sigFromUrl(cropDataUrl);
  if (!sig) return;
  await _savePortraitEntry({ champName, sig, cropDataUrl, ts: Date.now(), cropPct: cropSizePct });
}

/**
 * In-memory cache: entry id → fresh sig derived from cropDataUrl using the
 * current _sig function. Re-deriving on every call ensures old entries (saved
 * with a looser ring mask) are re-evaluated against the same mask as detection
 * crops, so stored sig values are never used directly.
 */
const _freshSigCache = new Map<number, Float32Array>();

/** Invalidate a specific entry from the fresh-sig cache (e.g. after deletion). */
export function invalidateSigCache(id: number): void {
  _freshSigCache.delete(id);
}

/** Match a portrait crop against the personal DB. */
export async function matchPersonalDb(
  cropDataUrl: string,
): Promise<{ name: string; id: number; confidence: number } | null> {
  const entries = await getAllPortraitEntries();
  if (!entries.length) return null;
  const sig = await sigFromUrl(cropDataUrl);
  if (!sig) return null;

  // Re-derive sigs from stored images using the current (tighter) mask.
  // This ensures old entries saved with a looser ring mask are re-evaluated
  // consistently with fresh detection crops. Results are cached in memory.
  const freshEntries = await Promise.all(
    entries.map(async e => {
      let fresh = _freshSigCache.get(e.id!);
      if (!fresh) {
        fresh = (await sigFromUrl(e.cropDataUrl)) ?? e.sig;
        _freshSigCache.set(e.id!, fresh);
      }
      return { ...e, sig: fresh };
    }),
  );

  let best: { name: string; id: number; d: number } | null = null;
  for (const e of freshEntries) {
    const d = dist(sig, e.sig);
    if (!best || d < best.d) best = { name: e.champName, id: e.id!, d };
  }
  if (!best) return null;

  const THRESHOLD = 0.16;
  if (best.d > THRESHOLD) return null;
  return { name: best.name, id: best.id, confidence: +(1 - best.d / THRESHOLD).toFixed(2) };
}

// ── Adjustable detection config ───────────────────────────────────────────────
export interface DetectConfig {
  /** Min R value for enemy ring pixels. Default 130. Lower = catches dimmer reds. */
  redBright: number;
  /** r/g ratio threshold. Default 1.5. Lower = catches more orange-ish reds. */
  redRatio: number;
  /** Min B value for ally ring pixels. Default 110. */
  blueBright: number;
  /** b/g ratio threshold. Default 1.08. */
  blueRatio: number;
  /**
   * Enemy ring interior solid-ratio cap. Default 0.60.
   * Champions with red portraits (Irelia, Darius…) have team-coloured interiors
   * so this must be higher than the ally threshold (0.38). Raise if enemies are
   * missed; lower if wards/minions get falsely detected as champions.
   */
  enemyRingThreshold: number;
  /**
   * Estimated diameter of one champion ring as % of minimap width. Default 8.
   * Wild Rift scales portrait sizes dynamically — increase when portraits look
   * larger (zoomed-in minimap), decrease when smaller (zoomed-out).
   * Drives: NMS exclusion radius, blob split threshold, min/max bbox bounds.
   */
  typicalRing: number;
}
export const DEFAULT_DETECT_CFG: DetectConfig = {
  redBright: 130, redRatio: 1.5,
  blueBright: 110, blueRatio: 1.08,
  enemyRingThreshold: 0.60,
  typicalRing: 8,
};
const DETECT_CFG_KEY = "wr_detect_cfg";
export function loadDetectConfig(): DetectConfig {
  try {
    const raw = localStorage.getItem(DETECT_CFG_KEY);
    return raw ? { ...DEFAULT_DETECT_CFG, ...JSON.parse(raw) } : { ...DEFAULT_DETECT_CFG };
  } catch { return { ...DEFAULT_DETECT_CFG }; }
}
export function saveDetectConfig(cfg: DetectConfig): void {
  localStorage.setItem(DETECT_CFG_KEY, JSON.stringify(cfg));
}

// ── Blob detection ────────────────────────────────────────────────────────────
interface Blob {
  cx: number; cy: number;
  bx: number; by: number; bw: number; bh: number;
  pixels: number;
}

/**
 * Find connected colour blobs, filtered by bounding box + ring-shape check.
 *
 * solid=false (default) → champion rings: keep blobs whose interior is NOT team-coloured
 * solid=true            → minion fills:   keep blobs whose interior IS team-coloured
 *
 * Ring-shape check samples the centre 10% of the bbox per dimension.
 * If >30% team-coloured → solid; <30% → ring.
 */
function findBlobs(
  data: Uint8ClampedArray,
  W: number,
  H: number,
  test: (r: number, g: number, b: number) => boolean,
  minBBoxPct: number,
  maxBBoxPct: number,
  solid = false,
  aspectMin = 0.45,
  ringThreshold = 0.38,
): Blob[] {
  const visited = new Uint8Array(W * H);
  const out: Blob[] = [];

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      if (visited[idx]) continue;
      const pi = idx * 4;
      if (!test(data[pi], data[pi + 1], data[pi + 2])) continue;

      let cnt = 0, sx = 0, sy = 0;
      let x0 = x, x1 = x, y0 = y, y1 = y;
      const stk: number[] = [idx];
      visited[idx] = 1;

      while (stk.length) {
        const cur = stk.pop()!;
        const cx = cur % W;
        const cy2 = (cur - cx) / W;
        cnt++; sx += cx; sy += cy2;
        if (cx < x0) x0 = cx; if (cx > x1) x1 = cx;
        if (cy2 < y0) y0 = cy2; if (cy2 > y1) y1 = cy2;

        for (const delta of [-1, 1, -W, W]) {
          const n = cur + delta;
          if (n < 0 || n >= W * H || visited[n]) continue;
          if (delta === -1 && cx === 0) continue;
          if (delta === 1 && cx === W - 1) continue;
          const npi = n * 4;
          if (test(data[npi], data[npi + 1], data[npi + 2])) {
            visited[n] = 1;
            stk.push(n);
          }
        }
      }

      // ── Bounding-box size filter ──────────────────────────────────────────
      const bw = (x1 - x0 + 1) / W * 100;
      const bh = (y1 - y0 + 1) / H * 100;
      if (bw < minBBoxPct || bh < minBBoxPct) continue;
      if (bw > maxBBoxPct || bh > maxBBoxPct) continue;

      // ── Circularity filter — champion rings are roughly circular ─────────
      const aspect = Math.min(bw, bh) / Math.max(bw, bh);
      if (aspect < aspectMin) continue;

      // ── Ring-shape filter: champion circles have non-team-coloured interiors ──
      // Sample the centre 20% of the bbox. If >30% of those pixels are team-
      // coloured the blob is a solid circle (ward/objective), not a ring.
      const icx = ((x0 + x1) >> 1);
      const icy = ((y0 + y1) >> 1);
      const ihw = Math.max(1, Math.round((x1 - x0 + 1) * 0.10));
      const ihh = Math.max(1, Math.round((y1 - y0 + 1) * 0.10));
      let intColor = 0, intTotal = 0;
      for (let dy = -ihh; dy <= ihh; dy++) {
        for (let dx = -ihw; dx <= ihw; dx++) {
          const ipx = icx + dx, ipy = icy + dy;
          if (ipx < 0 || ipx >= W || ipy < 0 || ipy >= H) continue;
          intTotal++;
          const ni = (ipy * W + ipx) * 4;
          if (test(data[ni], data[ni + 1], data[ni + 2])) intColor++;
        }
      }
      // solid=false (champion ring): reject if interior IS team-coloured (ward/minion)
      // solid=true  (minion fill):   reject if interior is NOT team-coloured (ring)
      const solidRatio = intTotal > 0 ? intColor / intTotal : 0;
      if (!solid && solidRatio > ringThreshold) continue;
      if (solid  && solidRatio < 0.15) continue; // loosened: catch shallow-filled minion shapes

      out.push({
        cx: sx / cnt / W * 100,
        cy: sy / cnt / H * 100,
        bx: x0 / W * 100, by: y0 / H * 100, bw, bh,
        pixels: cnt,
      });
    }
  }
  return out;
}

function isGreen(r: number, g: number, b: number): boolean {
  return g > 145 && r < 120 && b < 130 && g > r * 1.7 && g > b * 1.5;
}
function isBlue(r: number, g: number, b: number): boolean {
  // Lowered brightness floor + relaxed ratios to catch dimmer/darker ally rings
  // Still rejects teal wards (b ≈ g) via b > g * 1.08
  return b > 110 && r < 180 && b > r * 1.08 && b > g * 1.08;
}
function isRed(r: number, g: number, b: number): boolean {
  // Relaxed ratio (1.5 → was 2.0) to catch dimmer enemy rings on dark jungle terrain
  return r > 130 && g < 120 && b < 115 && r > g * 1.5;
}

// ── Minion wave detection ─────────────────────────────────────────────────────

export type MinionLane = "Top" | "Mid" | "Bot";
export interface MinionWavePin { lane: MinionLane; x: number; y: number }
export interface MinionWaveResult { ally: MinionWavePin[]; enemy: MinionWavePin[] }

/**
 * Classify a point as a lane or return null (river/jungle).
 * Uses both cx (0-100) and cy (0-100) to reject baron pit and JG areas.
 *
 * WR minimap geometry (origin top-left):
 *   Top lane  → upper-right strip  (cy < 35 AND cx > 40)
 *   Bot lane  → lower-left strip   (cy > 65 AND cx < 60)
 *   Mid lane  → diagonal corridor  |cx + cy - 100| < 22
 *   Everything else → river/JG → null (rejected)
 */
function _minionLane(cx: number, cy: number): MinionLane | null {
  if (cy < 35 && cx > 40) return "Top";
  if (cy > 65 && cx < 60) return "Bot";
  if (Math.abs(cx + cy - 100) < 22) return "Mid";
  return null; // river / jungle — no lane pin
}

/** Cluster blobs within maxDist of each other (single-linkage). */
function _cluster(blobs: Blob[], maxDist: number): Blob[][] {
  const labels = new Int32Array(blobs.length).fill(-1);
  let next = 0;
  for (let i = 0; i < blobs.length; i++) {
    for (let j = 0; j < i; j++) {
      if (labels[j] < 0) continue;
      const dx = blobs[i].cx - blobs[j].cx, dy = blobs[i].cy - blobs[j].cy;
      if (dx * dx + dy * dy < maxDist * maxDist) { labels[i] = labels[j]; break; }
    }
    if (labels[i] < 0) labels[i] = next++;
  }
  const map = new Map<number, Blob[]>();
  for (let i = 0; i < blobs.length; i++) {
    const k = labels[i];
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(blobs[i]);
  }
  return [...map.values()];
}

/**
 * Detect minion wave positions on the minimap.
 *
 * Individual minion icons are SOLID FILLED (circle + diamond shapes).
 * They're detected as small solid blobs (1.5–6% bbox), then clustered
 * spatially. Each cluster of ≥2 blobs → one wave pin at its centroid.
 * At most ONE wave pin per lane per team is returned.
 *
 * Red blobs → enemy wave   Blue blobs → ally wave
 */
export function detectMinionWaves(minimapDataUrl: string): Promise<MinionWaveResult> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const W = img.width, H = img.height;
      const c = document.createElement("canvas");
      c.width = W; c.height = H;
      c.getContext("2d")!.drawImage(img, 0, 0);
      const px = c.getContext("2d")!.getImageData(0, 0, W, H).data;

      // Minion blobs are small solid fills (1.5–6% bbox per dimension)
      const MIN = 1.5, MAX = 6;
      const allyBlobs  = findBlobs(px, W, H, isBlue, MIN, MAX, true);
      const enemyBlobs = findBlobs(px, W, H, isRed,  MIN, MAX, true);

      const toWavePins = (blobs: Blob[]): MinionWavePin[] => {
        const clusters = _cluster(blobs, 18); // 18% distance threshold (catch spread-out waves)
        const byLane = new Map<MinionLane, Blob[]>();
        for (const cl of clusters) {
          if (cl.length < 2) continue; // lone pixel/dot → skip
          const cx = cl.reduce((s, b) => s + b.cx, 0) / cl.length;
          const cy = cl.reduce((s, b) => s + b.cy, 0) / cl.length;
          const lane = _minionLane(cx, cy);
          if (!lane) continue; // river / jungle → reject
          const existing = byLane.get(lane);
          // Keep the cluster with the most blobs per lane (densest wave)
          if (!existing || cl.length > existing.length) byLane.set(lane, cl);
        }
        const pins: MinionWavePin[] = [];
        for (const [lane, cl] of byLane) {
          const cx = cl.reduce((s, b) => s + b.cx, 0) / cl.length;
          const cy = cl.reduce((s, b) => s + b.cy, 0) / cl.length;
          pins.push({ lane, x: Math.round(cx * 10) / 10, y: Math.round(cy * 10) / 10 });
        }
        return pins;
      };

      resolve({ ally: toWavePins(allyBlobs), enemy: toWavePins(enemyBlobs) });
    };
    img.onerror = () => resolve({ ally: [], enemy: [] });
    img.src = minimapDataUrl;
  });
}

/** Point-to-polyline distance in % coordinates. */
function _distToPath(cx: number, cy: number, path: {x:number;y:number}[]): number {
  let min = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i+1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx*dx + dy*dy;
    let t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((cx-a.x)*dx + (cy-a.y)*dy) / len2));
    const nx = a.x + t*dx, ny = a.y + t*dy;
    min = Math.min(min, Math.sqrt((cx-nx)**2 + (cy-ny)**2));
  }
  return min;
}

/**
 * Detect minion waves ONLY within calibrated lane corridors.
 *
 * For each lane (Top/Mid/Bot), scans only blobs within `corridorPct` (default 8%)
 * of the calibrated lane path. Among those blobs, picks the most-advanced one:
 *   – Ally  (blue): furthest from ally base (0%, 100%) = most pushed toward enemy
 *   – Enemy (red):  furthest from enemy base (100%, 0%) = most pushed toward ally
 *
 * Returns at most one ally pin and one enemy pin per lane.
 * Returns no pin for a lane when no blobs are found inside its corridor
 * (coach.tsx falls back to the calibrated lane midpoint default).
 */
export function detectMinionWavesInLanes(
  minimapDataUrl: string,
  lanes: { baron: {x:number;y:number}[]; mid: {x:number;y:number}[]; dragon: {x:number;y:number}[] },
  corridorPct = 8,
): Promise<MinionWaveResult> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const W = img.width, H = img.height;
      const c = document.createElement("canvas");
      c.width = W; c.height = H;
      c.getContext("2d")!.drawImage(img, 0, 0);
      const px = c.getContext("2d")!.getImageData(0, 0, W, H).data;

      const MIN = 1.5, MAX = 6;
      const allyBlobs  = findBlobs(px, W, H, isBlue, MIN, MAX, true);
      const enemyBlobs = findBlobs(px, W, H, isRed,  MIN, MAX, true);

      // Distance from ally base (bottom-left 0,100) and enemy base (top-right 100,0)
      const dAllyBase  = (b: Blob) => Math.sqrt(b.cx**2 + (100-b.cy)**2);
      const dEnemyBase = (b: Blob) => Math.sqrt((100-b.cx)**2 + b.cy**2);

      const laneEntries: [MinionLane, {x:number;y:number}[]][] = [
        ["Top", lanes.baron],
        ["Mid", lanes.mid],
        ["Bot", lanes.dragon],
      ];

      const allyPins:  MinionWavePin[] = [];
      const enemyPins: MinionWavePin[] = [];

      for (const [lane, path] of laneEntries) {
        if (path.length < 2) continue;

        const allyInLane  = allyBlobs .filter(b => _distToPath(b.cx, b.cy, path) <= corridorPct);
        const enemyInLane = enemyBlobs.filter(b => _distToPath(b.cx, b.cy, path) <= corridorPct);

        if (allyInLane.length > 0) {
          const best = allyInLane.reduce((a, b) => dAllyBase(b) > dAllyBase(a) ? b : a);
          allyPins.push({ lane, x: Math.round(best.cx*10)/10, y: Math.round(best.cy*10)/10 });
        }
        if (enemyInLane.length > 0) {
          const best = enemyInLane.reduce((a, b) => dEnemyBase(b) > dEnemyBase(a) ? b : a);
          enemyPins.push({ lane, x: Math.round(best.cx*10)/10, y: Math.round(best.cy*10)/10 });
        }
      }

      resolve({ ally: allyPins, enemy: enemyPins });
    };
    img.onerror = () => resolve({ ally: [], enemy: [] });
    img.src = minimapDataUrl;
  });
}

/**
 * Crop the blob portrait using cropSizePct — MUST match what saveChampPortrait uses
 * so that detection and DB signatures have the same framing and scale.
 */
function cropBlobPortrait(canvas: HTMLCanvasElement, blob: Blob, cropSizePct: number): string {
  const W = canvas.width, H = canvas.height;
  const halfPx = (cropSizePct / 100) * W / 2;
  const cx = (blob.cx / 100) * W;
  const cy = (blob.cy / 100) * H;
  const off = document.createElement("canvas");
  off.width = 48; off.height = 48;
  off.getContext("2d")!.drawImage(canvas, cx - halfPx, cy - halfPx, halfPx * 2, halfPx * 2, 0, 0, 48, 48);
  // Mask out the ring border — only the portrait interior contributes to sig
  const masked = _applyCircularMaskToCanvas(off, 48 * 0.72);
  return masked.toDataURL("image/jpeg", 0.8);
}

// ── Main circle detection ─────────────────────────────────────────────────────
export interface DetectedCircle {
  x: number; y: number;
  portraitDataUrl: string | null;
}

export interface MapDetectionResult {
  me: { x: number; y: number } | null;
  allies: DetectedCircle[];
  enemies: DetectedCircle[];
}

/**
 * Detect champion circle rings on the minimap.
 *
 * cropSizePct controls portrait cropping — must match what saveChampPortrait uses
 * so detection and DB signatures are comparable. Default 12% works well for most
 * iPad minimap crops; reduce if crop shows too much ring border, increase if
 * portrait is cut off.
 */
export function detectMapCircles(
  minimapDataUrl: string,
  cropSizePct = 12,
  cfg?: Partial<DetectConfig>,
): Promise<MapDetectionResult> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const W = img.width, H = img.height;
      const c = document.createElement("canvas");
      c.width = W; c.height = H;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const px = ctx.getImageData(0, 0, W, H).data;

      const config = { ...DEFAULT_DETECT_CFG, ...cfg };

      // Per-config color testers (replace module-level isBlue/isRed for this call)
      const _isBlue = (r: number, g: number, b: number) =>
        b > config.blueBright && r < 180 && b > r * config.blueRatio && b > g * config.blueRatio;
      const _isRed = (r: number, g: number, b: number) =>
        r > config.redBright && g < 120 && b < 115 && r > g * config.redRatio;

      // All size bounds derived from typicalRing so they scale with minimap zoom.
      // typicalRing is the estimated champion circle diameter as % of minimap width.
      const TYPICAL_RING  = config.typicalRing;
      const MIN_BBOX      = Math.max(3, TYPICAL_RING * 0.55); // allies/me min
      const MAX_BBOX      = TYPICAL_RING * 3.0;               // filter structures
      const MIN_BBOX_ENEMY = Math.max(2, TYPICAL_RING * 0.4); // smaller — catch partial arcs

      const pt = (x: number, y: number) => ({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });

      const greens = findBlobs(px, W, H, isGreen, MIN_BBOX, MAX_BBOX)
        .sort((a, b) => b.pixels - a.pixels);
      const me = greens[0] ? pt(greens[0].cx, greens[0].cy) : null;

      // aspectMin lowered to 0.35 (from 0.45) — catches crescent/partial-arc shapes
      // when another champion is overlapping and occluding part of the ring.
      // Ally ring threshold stays conservative (0.38) so blue wards are filtered out.
      const blues = findBlobs(px, W, H, _isBlue, MIN_BBOX, MAX_BBOX, false, 0.35, 0.38)
        .sort((a, b) => b.pixels - a.pixels)
        .slice(0, 4);
      const allies: DetectedCircle[] = blues.map(b => ({
        ...pt(b.cx, b.cy),
        portraitDataUrl: cropBlobPortrait(c, b, cropSizePct),
      }));

      // Enemy detection: lower min bbox + relaxed aspect (0.35) to catch
      // partial arcs when circles cluster near each other.
      // Higher ring threshold (config.enemyRingThreshold) so champions with red
      // portraits (Irelia, Darius…) aren't incorrectly rejected as solid blobs.
      const rawReds = findBlobs(px, W, H, _isRed, MIN_BBOX_ENEMY, MAX_BBOX, false, 0.35, config.enemyRingThreshold)
        .sort((a, b) => b.pixels - a.pixels);

      // Split large merged blobs into N evenly-spaced pins along their longer axis.
      // n = round(bigAxis / TYPICAL_RING), capped 1–5.
      const splitReds: Blob[] = [];
      for (const b of rawReds) {
        const bigAxis = Math.max(b.bw, b.bh);
        const smallAxis = Math.min(b.bw, b.bh);
        const n = Math.min(5, Math.max(1, Math.round(bigAxis / TYPICAL_RING)));
        // Only split elongated blobs (bigAxis clearly longer than smallAxis).
        // A single large portrait is roughly square (ratio ≈ 1), so bigAxis/smallAxis < 1.4
        // means it's one big circle — don't split it into phantom pins.
        if (n > 1 && smallAxis / bigAxis > 0.25 && bigAxis / smallAxis > 1.4) {
          // n overlapping rings — place pins at (k+0.5)/n along the longer axis
          const piecePixels = Math.round(b.pixels / n);
          for (let k = 0; k < n; k++) {
            const t = (k + 0.5) / n;
            if (b.bw >= b.bh) {
              splitReds.push({ ...b, cx: b.bx + b.bw * t, pixels: piecePixels });
            } else {
              splitReds.push({ ...b, cy: b.by + b.bh * t, pixels: piecePixels });
            }
          }
        } else {
          splitReds.push(b);
        }
      }

      // NMS: remove red blobs whose centre falls within ~1.3× typical ring of any ally.
      // Ally portraits (e.g. Garen, Darius) can have red/warm tones in their interior;
      // with a raised ring threshold these form a false red blob right on top of the ally.
      const EXCLUSION_RADIUS = TYPICAL_RING * 1.3;
      const bluePositions = blues.map(b => ({ cx: b.cx, cy: b.cy }));
      const filteredSplitReds = splitReds.filter(r =>
        !bluePositions.some(a => {
          const dx = r.cx - a.cx, dy = r.cy - a.cy;
          return Math.sqrt(dx * dx + dy * dy) < EXCLUSION_RADIUS;
        })
      );

      const reds = filteredSplitReds
        .sort((a, b) => b.pixels - a.pixels)
        .slice(0, 5);
      const enemies: DetectedCircle[] = reds.map(b => ({
        ...pt(b.cx, b.cy),
        portraitDataUrl: cropBlobPortrait(c, b, cropSizePct),
      }));

      resolve({ me, allies, enemies });
    };
    img.onerror = () => resolve({ me: null, allies: [], enemies: [] });
    img.src = minimapDataUrl;
  });
}

// ── Tower status detection ────────────────────────────────────────────────────
export interface TowerDetectionResult {
  allyDown: number[];
  enemyDown: number[];
}

export function detectTowerStatus(
  minimapDataUrl: string,
  allyPositions: Array<{ x: number; y: number } | null>,
  enemyPositions: Array<{ x: number; y: number } | null>,
): Promise<TowerDetectionResult> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const W = img.width, H = img.height;
      const c = document.createElement("canvas");
      c.width = W; c.height = H;
      c.getContext("2d")!.drawImage(img, 0, 0);
      const data = c.getContext("2d")!.getImageData(0, 0, W, H).data;

      const HALF_PCT = 4;
      const MIN_HIT  = 8;

      const countColor = (
        xPct: number, yPct: number,
        test: (r: number, g: number, b: number) => boolean,
      ): number => {
        const cx = Math.round(xPct / 100 * W);
        const cy = Math.round(yPct / 100 * H);
        const hw = Math.round(HALF_PCT / 100 * W);
        const hh = Math.round(HALF_PCT / 100 * H);
        let n = 0;
        for (let dy = -hh; dy <= hh; dy++) {
          for (let dx = -hw; dx <= hw; dx++) {
            const px2 = cx + dx, py2 = cy + dy;
            if (px2 < 0 || px2 >= W || py2 < 0 || py2 >= H) continue;
            const i = (py2 * W + px2) * 4;
            if (test(data[i], data[i + 1], data[i + 2])) n++;
          }
        }
        return n;
      };

      const isBlueTower = (r: number, g: number, b: number) =>
        b > 130 && b > r * 1.15 && b > g * 0.72;
      const isRedTower = (r: number, g: number, b: number) =>
        r > 145 && r > g * 1.7 && r > b * 1.5;

      const allyDown: number[] = [];
      const enemyDown: number[] = [];

      allyPositions.forEach((pos, idx) => {
        if (!pos) return;
        if (countColor(pos.x, pos.y, isBlueTower) < MIN_HIT) allyDown.push(idx);
      });
      enemyPositions.forEach((pos, idx) => {
        if (!pos) return;
        if (countColor(pos.x, pos.y, isRedTower) < MIN_HIT) enemyDown.push(idx);
      });

      resolve({ allyDown, enemyDown });
    };
    img.onerror = () => resolve({ allyDown: [], enemyDown: [] });
    img.src = minimapDataUrl;
  });
}

// ── Strip-vs-strip matching (kept for API compat) ─────────────────────────────
export async function matchCropToStrip(
  minimapCrop: string,
  stripCrops: Array<string | null>,
): Promise<number | null> {
  const sig = await sigFromUrl(minimapCrop);
  if (!sig) return null;
  let bestIdx = -1, bestDist = Infinity;
  for (let i = 0; i < stripCrops.length; i++) {
    const s = stripCrops[i];
    if (!s) continue;
    const ss = await sigFromUrl(s);
    if (!ss) continue;
    const d = dist(sig, ss);
    if (d < bestDist) { bestDist = d; bestIdx = i; }
  }
  return bestIdx === -1 ? null : bestIdx;
}

export async function prewarmChampSigs(_names: string[]): Promise<void> {}
export async function matchPortrait(
  _dataUrl: string,
  _candidates: string[],
): Promise<{ name: string; confidence: number } | null> { return null; }

// ── Dead-champion detection via portrait strip death timers ───────────────────

export interface DeadChampResult {
  /** 0-based slot indices for ally team (top section of the portrait strip). */
  allySlots: number[];
  /** 0-based slot indices for enemy team (bottom section of the portrait strip). */
  enemySlots: number[];
}

export interface DeadDetectOptions {
  /**
   * Y% [0–100] of strip height where the ally section ends and the enemy section
   * begins.  Default 50 (even split).  Set to 100 if the strip shows allies only.
   */
  splitY?: number;
  /**
   * Y% [0–100] within each section to START scanning for red pixels.
   * Default 0 (scan the entire section).
   */
  sectionScanY0?: number;
  /**
   * Y% [0–100] within each section to STOP scanning for red pixels.
   * Default 100 (scan the entire section).
   */
  sectionScanY1?: number;
}

/**
 * Scan a cropped portrait-strip image for red death-timer text and return
 * which champion slots are dead for each team.
 *
 * The strip is split horizontally at `opts.splitY` (default 50%).
 * Pixels above the split → ally slots; pixels below → enemy slots.
 * Within each half, only the sub-band [sectionScanY0, sectionScanY1] is scanned.
 * Each section is divided into `slotsPerTeam` equal columns; columns with
 * ≥ 20 red pixels (r > 190, g < 90, b < 90) are flagged as dead.
 */
export function detectDeadChampions(
  stripDataUrl: string,
  slotsPerTeam = 5,
  opts: DeadDetectOptions = {},
): Promise<DeadChampResult> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const W = img.width, H = img.height;
      const c = document.createElement("canvas");
      c.width = W; c.height = H;
      c.getContext("2d")!.drawImage(img, 0, 0);
      const data = c.getContext("2d")!.getImageData(0, 0, W, H).data;

      const splitPx   = H * (opts.splitY  ?? 50)  / 100;  // pixel row of ally/enemy boundary
      const scan0Frac = (opts.sectionScanY0 ?? 0)   / 100;  // within-section fraction start
      const scan1Frac = (opts.sectionScanY1 ?? 100) / 100;  // within-section fraction end

      // Pixel rows to scan for each section
      const allyScanY0  = Math.round(splitPx * scan0Frac);
      const allyScanY1  = Math.round(splitPx * scan1Frac);
      const enemyScanY0 = Math.round(splitPx + (H - splitPx) * scan0Frac);
      const enemyScanY1 = Math.round(splitPx + (H - splitPx) * scan1Frac);

      const slotW = W / slotsPerTeam;
      const allyCount  = new Array<number>(slotsPerTeam).fill(0);
      const enemyCount = new Array<number>(slotsPerTeam).fill(0);

      for (let y = 0; y < H; y++) {
        const inAlly  = y >= allyScanY0  && y < allyScanY1;
        const inEnemy = y >= enemyScanY0 && y < enemyScanY1;
        if (!inAlly && !inEnemy) continue;

        for (let x = 0; x < W; x++) {
          const idx = (y * W + x) * 4;
          const r = data[idx], g = data[idx + 1], b = data[idx + 2];
          if (r > 190 && g < 90 && b < 90 && r > g * 2.5) {
            const slot = Math.min(Math.floor(x / slotW), slotsPerTeam - 1);
            if (inAlly)  allyCount[slot]++;
            if (inEnemy) enemyCount[slot]++;
          }
        }
      }

      const THRESHOLD = 20;
      const allySlots  = allyCount.map((n,i) => n >= THRESHOLD ? i : -1).filter(i => i >= 0);
      const enemySlots = enemyCount.map((n,i) => n >= THRESHOLD ? i : -1).filter(i => i >= 0);

      resolve({ allySlots, enemySlots });
    };
    img.onerror = () => resolve({ allySlots: [], enemySlots: [] });
    img.src = stripDataUrl;
  });
}

// ── Per-slot box-based dead detection ────────────────────────────────────────

/** A rectangle region on the portrait strip expressed as % of strip dimensions. */
export interface SlotBox { x: number; y: number; w: number; h: number }

/**
 * Detect dead champion slots by scanning user-configured rectangles for bright
 * red death-timer text (r>190, g<90, b<90).  Each slot has its own box so the
 * user can calibrate exactly where each champion's countdown number appears.
 */
export function detectDeadBySlotBoxes(
  stripDataUrl: string,
  allyBoxes: SlotBox[],
  enemyBoxes: SlotBox[],
): Promise<DeadChampResult> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const W = img.width, H = img.height;
      const c = document.createElement("canvas");
      c.width = W; c.height = H;
      c.getContext("2d")!.drawImage(img, 0, 0);
      const data = c.getContext("2d")!.getImageData(0, 0, W, H).data;

      const scanBox = (box: SlotBox): number => {
        const x0 = Math.round(Math.max(0, box.x * W / 100));
        const x1 = Math.round(Math.min(W, (box.x + box.w) * W / 100));
        const y0 = Math.round(Math.max(0, box.y * H / 100));
        const y1 = Math.round(Math.min(H, (box.y + box.h) * H / 100));
        let count = 0;
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const idx = (y * W + x) * 4;
            const r = data[idx], g = data[idx + 1], b = data[idx + 2];
            if (r > 190 && g < 90 && b < 90 && r > g * 2.5) count++;
          }
        }
        return count;
      };

      const THRESHOLD = 15;
      const allySlots  = allyBoxes.map((box, i) => scanBox(box) >= THRESHOLD ? i : -1).filter(i => i >= 0);
      const enemySlots = enemyBoxes.map((box, i) => scanBox(box) >= THRESHOLD ? i : -1).filter(i => i >= 0);
      resolve({ allySlots, enemySlots });
    };
    img.onerror = () => resolve({ allySlots: [], enemySlots: [] });
    img.src = stripDataUrl;
  });
}

/** @deprecated Use detectDeadChampions instead */
export function detectDeadSlots(
  stripDataUrl: string,
  numSlots = 5,
): Promise<number[]> {
  return detectDeadChampions(stripDataUrl, numSlots).then(r => r.allySlots);
}
