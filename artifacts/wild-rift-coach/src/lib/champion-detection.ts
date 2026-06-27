// Minimap circle detection + personal portrait database

// ── Colour signature helpers ──────────────────────────────────────────────────
const SIG_N = 12;

function _sig(data: Uint8ClampedArray): Float32Array {
  const s = new Float32Array(SIG_N * SIG_N * 3);
  for (let i = 0; i < SIG_N * SIG_N; i++) {
    s[i * 3]     = data[i * 4]     / 255;
    s[i * 3 + 1] = data[i * 4 + 1] / 255;
    s[i * 3 + 2] = data[i * 4 + 2] / 255;
  }
  return s;
}

function sigFromUrl(url: string, crossOrigin?: boolean): Promise<Float32Array | null> {
  return new Promise(resolve => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = "anonymous";
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
const _PDBNAME  = "wr_portrait_db_v1";
const _PSTORE   = "portraits";

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

/** Crop the minimap at a pin position and return a 48×48 thumbnail. */
export function cropMinimapPortrait(
  minimapDataUrl: string,
  xPct: number,
  yPct: number,
  sizePct = 14,
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
 * Crop the minimap at the pin's location and save the labelled portrait to the
 * personal database. Called when the user assigns a champion name to a pin.
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
 * Returns the best match or null if nothing is close enough.
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

  const THRESHOLD = 0.28;
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
      // Circularity guard: aspect ratio must be close to square (allows edge clipping)
      const aspect = Math.min(bw, bh) / Math.max(bw, bh);
      if (aspect < 0.28) continue;
      // Bounding box must be at least 2% of minimap in each dimension (filters noise)
      if (bw < 2 || bh < 2) continue;

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

function cropBlobPortrait(canvas: HTMLCanvasElement, blob: Blob): string {
  const W = canvas.width;
  const size = Math.max(blob.bw, blob.bh) * 1.5;
  const halfPx = (size / 100) * W / 2;
  const cx = (blob.cx / 100) * W;
  const cy = (blob.cy / 100) * canvas.height;
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

      // Size bounds: 0.06%–4% of minimap area — champion circles are mid-range
      const minPx = Math.max(20, Math.floor(area * 0.0006));
      const maxPx = Math.floor(area * 0.04);

      const pt = (x: number, y: number) => ({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });

      // Player: largest green blob
      const greens = findBlobs(px, W, H, isGreen, minPx, maxPx).sort((a, b) => b.pixels - a.pixels);
      const me = greens[0] ? pt(greens[0].cx, greens[0].cy) : null;

      // Allies: up to 4 blue blobs
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

// ── Strip-vs-strip matching (kept for reference, no longer used in auto flow) ──
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

// ── Pre-warm (no-op now — kept for API compat) ────────────────────────────────
export async function prewarmChampSigs(_names: string[]): Promise<void> {}
export async function matchPortrait(
  _dataUrl: string,
  _candidates: string[],
): Promise<{ name: string; confidence: number } | null> { return null; }
