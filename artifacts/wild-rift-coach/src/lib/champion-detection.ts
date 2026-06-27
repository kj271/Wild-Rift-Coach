// Minimap circle detection + personal portrait database + tower status

// ── Colour signature helpers ──────────────────────────────────────────────────
const SIG_N = 12;
const _CX = SIG_N / 2, _CY = SIG_N / 2;
const _R2 = (SIG_N / 2 - 0.5) ** 2; // inscribed-circle radius squared

/**
 * Convert image pixel data to a colour feature vector.
 * With circular=true (default), pixels outside the inscribed circle are set to
 * neutral grey (0.5,0.5,0.5). Because BOTH the saved signature and the query
 * signature use the same mask, those pixels contribute exactly 0 to the
 * distance — so the background never contaminates matching.
 */
function _sig(data: Uint8ClampedArray, circular = true): Float32Array {
  const s = new Float32Array(SIG_N * SIG_N * 3);
  for (let py = 0; py < SIG_N; py++) {
    for (let px = 0; px < SIG_N; px++) {
      const i = py * SIG_N + px;
      const dx = px - _CX + 0.5, dy = py - _CY + 0.5;
      if (circular && dx * dx + dy * dy > _R2) {
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
  cropDataUrl: string; // 48×48 thumbnail for display
  ts: number;
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

/**
 * Crop a 48×48 thumbnail from the minimap centred on the pin position.
 * sizePct is the crop width as a percentage of the minimap width.
 * Tighter crops include less background — 10% works well for champion circles.
 */
export function cropMinimapPortrait(
  minimapDataUrl: string,
  xPct: number,
  yPct: number,
  sizePct = 10,
): Promise<string | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const W = img.width, H = img.height;
      const halfPx = (sizePct / 100) * W / 2;
      const cx = (xPct / 100) * W;
      const cy = (yPct / 100) * H;
      const c = document.createElement("canvas");
      c.width = 48; c.height = 48;
      c.getContext("2d")!.drawImage(img, cx - halfPx, cy - halfPx, halfPx * 2, halfPx * 2, 0, 0, 48, 48);
      resolve(c.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => resolve(null);
    img.src = minimapDataUrl;
  });
}

/**
 * Crop the minimap at the pin's location and save the labelled portrait to
 * the personal database. Called when the user assigns a champion name to a pin.
 */
export async function saveChampPortrait(
  champName: string,
  minimapDataUrl: string,
  x: number,
  y: number,
): Promise<void> {
  const cropDataUrl = await cropMinimapPortrait(minimapDataUrl, x, y);
  if (!cropDataUrl) return;
  const sig = await sigFromUrl(cropDataUrl);
  if (!sig) return;
  await _savePortraitEntry({ champName, sig, cropDataUrl, ts: Date.now() });
}

/**
 * Match a portrait crop against the personal database.
 * Uses circular-masked signatures so the background doesn't affect the result.
 * Returns the best match or null if no entry is close enough.
 */
export async function matchPersonalDb(
  cropDataUrl: string,
): Promise<{ name: string; id: number; confidence: number } | null> {
  const entries = await getAllPortraitEntries();
  if (!entries.length) return null;
  const sig = await sigFromUrl(cropDataUrl);
  if (!sig) return null;

  let best: { name: string; id: number; d: number } | null = null;
  for (const e of entries) {
    const d = dist(sig, e.sig);
    if (!best || d < best.d) best = { name: e.champName, id: e.id!, d };
  }
  if (!best) return null;

  const THRESHOLD = 0.22; // tighter than before due to circular masking
  if (best.d > THRESHOLD) return null;
  return { name: best.name, id: best.id, confidence: +(1 - best.d / THRESHOLD).toFixed(2) };
}

// ── Blob detection ────────────────────────────────────────────────────────────
interface Blob {
  cx: number; cy: number;
  bx: number; by: number; bw: number; bh: number;
  pixels: number;
}

function findBlobs(
  data: Uint8ClampedArray,
  W: number,
  H: number,
  test: (r: number, g: number, b: number) => boolean,
  minPx: number,
  maxPx: number,
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
        const cy = (cur - cx) / W;
        cnt++; sx += cx; sy += cy;
        if (cx < x0) x0 = cx; if (cx > x1) x1 = cx;
        if (cy < y0) y0 = cy; if (cy > y1) y1 = cy;

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

      if (cnt < minPx || cnt > maxPx) continue;

      const bw = (x1 - x0 + 1) / W * 100;
      const bh = (y1 - y0 + 1) / H * 100;
      // Circularity: bounding box must be roughly square (champion circles are round)
      const aspect = Math.min(bw, bh) / Math.max(bw, bh);
      if (aspect < 0.3) continue;
      // Bounding box must span at least 3% in each dimension
      if (bw < 3 || bh < 3) continue;

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
  return b > 155 && r < 160 && b > r * 1.25 && b > g * 0.75;
}
function isRed(r: number, g: number, b: number): boolean {
  return r > 170 && g < 120 && b < 110 && r > g * 2.2;
}

/** Crop the detected blob as a 32×32 JPEG — tight to the bounding box, no extra padding. */
function cropBlobPortrait(canvas: HTMLCanvasElement, blob: Blob): string {
  const W = canvas.width, H = canvas.height;
  // Use 100% of bounding box (no extra padding — circle fills the box)
  const halfPx = (Math.max(blob.bw, blob.bh) / 100) * W / 2;
  const cx = (blob.cx / 100) * W;
  const cy = (blob.cy / 100) * H;
  const off = document.createElement("canvas");
  off.width = 32; off.height = 32;
  off.getContext("2d")!.drawImage(canvas, cx - halfPx, cy - halfPx, halfPx * 2, halfPx * 2, 0, 0, 32, 32);
  return off.toDataURL("image/jpeg", 0.8);
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

export function detectMapCircles(minimapDataUrl: string): Promise<MapDetectionResult> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const W = img.width, H = img.height;
      const area = W * H;
      const c = document.createElement("canvas");
      c.width = W; c.height = H;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const px = ctx.getImageData(0, 0, W, H).data;

      // Champion circles occupy ~0.7%–3% of minimap area.
      // Using relative bounds only (no fixed pixel min) so it scales with crop size.
      // This filters wards, baron/dragon indicators, and base structures.
      const minPx = Math.floor(area * 0.007);
      const maxPx = Math.floor(area * 0.03);

      const pt = (x: number, y: number) => ({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });

      // Player: largest green blob
      const greens = findBlobs(px, W, H, isGreen, minPx, maxPx).sort((a, b) => b.pixels - a.pixels);
      const me = greens[0] ? pt(greens[0].cx, greens[0].cy) : null;

      // Allies: up to 4 blue blobs (sorted by size — champion circles are largest)
      const blues = findBlobs(px, W, H, isBlue, minPx, maxPx)
        .sort((a, b) => b.pixels - a.pixels)
        .slice(0, 4);
      const allies: DetectedCircle[] = blues.map(b => ({
        ...pt(b.cx, b.cy),
        portraitDataUrl: cropBlobPortrait(c, b),
      }));

      // Enemies: up to 5 red blobs
      const reds = findBlobs(px, W, H, isRed, minPx, maxPx)
        .sort((a, b) => b.pixels - a.pixels)
        .slice(0, 5);
      const enemies: DetectedCircle[] = reds.map(b => ({
        ...pt(b.cx, b.cy),
        portraitDataUrl: cropBlobPortrait(c, b),
      }));

      resolve({ me, allies, enemies });
    };
    img.onerror = () => resolve({ me: null, allies: [], enemies: [] });
    img.src = minimapDataUrl;
  });
}

// ── Tower status detection ────────────────────────────────────────────────────
export interface TowerDetectionResult {
  allyDown: number[];  // indices of ally towers that appear destroyed
  enemyDown: number[]; // indices of enemy towers that appear destroyed
}

/**
 * Scan the minimap at each tower's calibrated position and decide whether the
 * tower is still standing based on the presence of team-coloured pixels.
 *
 * Ally towers show as blue when up; enemy towers show as red when up.
 * A destroyed tower's icon is absent — so very few matching pixels → down.
 */
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

      // Sample a small square centred on the tower position
      const HALF_PCT = 4; // ±4% of minimap around each tower
      const MIN_HIT  = 8; // minimum coloured pixels for tower to be "up"

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

      // Looser blue/red tests than champion-circle detection — tower icons
      // can be slightly less saturated, especially outer towers that may
      // partially overlap terrain.
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

// ── Strip-vs-strip matching (kept for API compat, no longer used) ─────────────
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

// ── Pre-warm (no-op — kept for API compat) ────────────────────────────────────
export async function prewarmChampSigs(_names: string[]): Promise<void> {}
export async function matchPortrait(
  _dataUrl: string,
  _candidates: string[],
): Promise<{ name: string; confidence: number } | null> { return null; }
