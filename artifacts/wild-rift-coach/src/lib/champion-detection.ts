// Minimap circle detection + in-game portrait strip matching

// ── Blob detection ─────────────────────────────────────────────────────────────
interface Blob {
  cx: number; cy: number; // centroid as % of image dims
  bx: number; by: number; bw: number; bh: number; // bounding box as % of dims
  pixels: number;
}

function findBlobs(
  data: Uint8ClampedArray,
  W: number,
  H: number,
  test: (r: number, g: number, b: number) => boolean,
  minPx = 30,
  maxPx = 6000,
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
        const cx = cur % W, cy = (cur - cx) / W;
        cnt++; sx += cx; sy += cy;
        if (cx < x0) x0 = cx; if (cx > x1) x1 = cx;
        if (cy < y0) y0 = cy; if (cy > y1) y1 = cy;

        for (const delta of [-1, 1, -W, W]) {
          const n = cur + delta;
          if (n < 0 || n >= W * H || visited[n]) continue;
          // prevent left/right wrap
          if (delta === -1 && cx === 0) continue;
          if (delta === 1 && cx === W - 1) continue;
          const npi = n * 4;
          if (test(data[npi], data[npi + 1], data[npi + 2])) {
            visited[n] = 1;
            stk.push(n);
          }
        }
      }

      if (cnt >= minPx && cnt <= maxPx) {
        out.push({
          cx: (sx / cnt / W) * 100,
          cy: (sy / cnt / H) * 100,
          bx: (x0 / W) * 100, by: (y0 / H) * 100,
          bw: ((x1 - x0 + 1) / W) * 100,
          bh: ((y1 - y0 + 1) / H) * 100,
          pixels: cnt,
        });
      }
    }
  }
  return out;
}

// ── Color predicates ──────────────────────────────────────────────────────────
// Wild Rift player selection ring: bright saturated green
function isGreen(r: number, g: number, b: number): boolean {
  return g > 145 && r < 120 && b < 130 && g > r * 1.7 && g > b * 1.5;
}
// Ally ring: bright blue / cyan-blue
function isBlue(r: number, g: number, b: number): boolean {
  return b > 160 && r < 150 && b > r * 1.3;
}
// Enemy ring: bright red / red-orange
function isRed(r: number, g: number, b: number): boolean {
  return r > 170 && g < 130 && b < 120 && r > g * 2.0;
}

// ── Portrait crop from canvas ─────────────────────────────────────────────────
function cropBlobPortrait(
  canvas: HTMLCanvasElement,
  blob: Blob,
  sizeOverridePct?: number,
): string {
  const W = canvas.width, H = canvas.height;
  const size = sizeOverridePct ?? Math.max(blob.bw, blob.bh) * 1.4;
  const halfPx = (size / 100) * W / 2;
  const cx = (blob.cx / 100) * W;
  const cy = (blob.cy / 100) * H;

  const off = document.createElement("canvas");
  off.width = 32; off.height = 32;
  off.getContext("2d")!.drawImage(
    canvas,
    cx - halfPx, cy - halfPx, halfPx * 2, halfPx * 2,
    0, 0, 32, 32,
  );
  return off.toDataURL("image/jpeg", 0.8);
}

// ── Main detection ────────────────────────────────────────────────────────────
export interface DetectedCircle {
  x: number; y: number; // % of minimap dims
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
      const c = document.createElement("canvas");
      c.width = W; c.height = H;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const px = ctx.getImageData(0, 0, W, H).data;
      const area = W * H;

      // Player: largest green blob
      const greenBlobs = findBlobs(px, W, H, isGreen, 15, Math.floor(area * 0.06))
        .sort((a, b) => b.pixels - a.pixels);
      const me = greenBlobs[0]
        ? { x: Math.round(greenBlobs[0].cx * 10) / 10, y: Math.round(greenBlobs[0].cy * 10) / 10 }
        : null;

      // Allies: blue blobs, up to 4
      const blueBlobs = findBlobs(px, W, H, isBlue, 25, Math.floor(area * 0.08))
        .sort((a, b) => b.pixels - a.pixels)
        .slice(0, 4);
      const allies: DetectedCircle[] = blueBlobs.map(b => ({
        x: Math.round(b.cx * 10) / 10,
        y: Math.round(b.cy * 10) / 10,
        portraitDataUrl: cropBlobPortrait(c, b),
      }));

      // Enemies: red blobs, up to 5
      const redBlobs = findBlobs(px, W, H, isRed, 25, Math.floor(area * 0.08))
        .sort((a, b) => b.pixels - a.pixels)
        .slice(0, 5);
      const enemies: DetectedCircle[] = redBlobs.map(b => ({
        x: Math.round(b.cx * 10) / 10,
        y: Math.round(b.cy * 10) / 10,
        portraitDataUrl: cropBlobPortrait(c, b),
      }));

      resolve({ me, allies, enemies });
    };
    img.onerror = () => resolve({ me: null, allies: [], enemies: [] });
    img.src = minimapDataUrl;
  });
}

// ── Color signature helpers ───────────────────────────────────────────────────
const SIG_N = 12; // 12×12 for comparison

function sigFromData(data: Uint8ClampedArray): Float32Array {
  const sig = new Float32Array(SIG_N * SIG_N * 3);
  for (let i = 0; i < SIG_N * SIG_N; i++) {
    sig[i * 3]     = data[i * 4]     / 255;
    sig[i * 3 + 1] = data[i * 4 + 1] / 255;
    sig[i * 3 + 2] = data[i * 4 + 2] / 255;
  }
  return sig;
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
        resolve(sigFromData(ctx.getImageData(0, 0, SIG_N, SIG_N).data));
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

/**
 * Match a minimap portrait crop against portrait strip thumbnails
 * (in-game art vs in-game art — much more accurate than Data Dragon).
 * Returns the index of the best-matching strip crop, or null if no match.
 */
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

  // Accept any match — we just want the closest one among the strip slots
  if (bestIdx === -1) return null;
  return bestIdx;
}

// ── Data Dragon (kept for champion name lookup from strip thumbnails) ──────────
const DD_BASE = "https://ddragon.leagueoflegends.com";
let _ver: string | null = null;

async function ddVersion(): Promise<string> {
  if (_ver) return _ver;
  try {
    const r = await fetch(`${DD_BASE}/api/versions.json`);
    const v = (await r.json()) as string[];
    _ver = v[0] ?? "14.24.1";
  } catch { _ver = "14.24.1"; }
  return _ver!;
}

function toChampId(name: string): string {
  const MAP: Record<string, string> = {
    "Aurelion Sol": "AurelionSol",
    "Cho'Gath": "Chogath",
    "Dr. Mundo": "DrMundo",
    "Jarvan IV": "JarvanIV",
    "Kai'Sa": "Kaisa",
    "Kha'Zix": "Khazix",
    "Kog'Maw": "KogMaw",
    "LeBlanc": "Leblanc",
    "Lee Sin": "LeeSin",
    "Master Yi": "MasterYi",
    "Miss Fortune": "MissFortune",
    "Nunu": "NunuAndWillump",
    "Twisted Fate": "TwistedFate",
    "Xin Zhao": "XinZhao",
    "Wukong": "MonkeyKing",
  };
  return MAP[name] ?? name.replace(/[\s'.]/g, "");
}

const WR_ONLY = new Set(["Norra", "Mel"]);
const _IDB = "wr_champ_sigs_v1", _STORE = "sigs";
const _mem = new Map<string, Float32Array | null>();

function _openDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(_IDB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(_STORE);
    r.onsuccess = () => res(r.result);
    r.onerror   = () => rej(r.error);
  });
}
async function _getIdb(k: string): Promise<Float32Array | null> {
  try {
    const db = await _openDb();
    return new Promise((res, rej) => {
      const r2 = db.transaction(_STORE, "readonly").objectStore(_STORE).get(k);
      r2.onsuccess = () => res((r2.result as Float32Array) ?? null);
      r2.onerror   = () => rej(r2.error);
    });
  } catch { return null; }
}
async function _setIdb(k: string, sig: Float32Array) {
  try {
    const db = await _openDb();
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(_STORE, "readwrite");
      tx.objectStore(_STORE).put(sig, k);
      tx.oncomplete = () => res();
      tx.onerror    = () => rej(tx.error);
    });
  } catch {}
}

async function getChampSig(name: string): Promise<Float32Array | null> {
  if (WR_ONLY.has(name)) return null;
  if (_mem.has(name)) return _mem.get(name)!;
  const cached = await _getIdb(name);
  if (cached) { _mem.set(name, cached); return cached; }
  const ver = await ddVersion();
  const url = `${DD_BASE}/cdn/${ver}/img/champion/${toChampId(name)}.png`;
  const sig = await sigFromUrl(url, true);
  _mem.set(name, sig);
  if (sig) await _setIdb(name, sig);
  return sig;
}

/** Pre-warm Data Dragon champion portrait cache in background. */
export async function prewarmChampSigs(names: string[]): Promise<void> {
  for (const n of names) await getChampSig(n);
}

/**
 * Match a portrait data-URL against Data Dragon champion images.
 * Best used on portrait STRIP thumbnails (same art quality as Data Dragon).
 */
export async function matchPortrait(
  dataUrl: string,
  candidates: string[],
): Promise<{ name: string; confidence: number } | null> {
  const sig = await sigFromUrl(dataUrl);
  if (!sig) return null;

  const THRESHOLD = 0.22;
  const results = await Promise.all(
    candidates.filter(n => !WR_ONLY.has(n)).map(async n => {
      const s = await getChampSig(n);
      return s ? { n, d: dist(sig, s) } : null;
    })
  );

  let best: { n: string; d: number } | null = null;
  for (const r of results) {
    if (!r) continue;
    if (!best || r.d < best.d) best = r;
  }

  if (!best || best.d > THRESHOLD) return null;
  return { name: best.n, confidence: +(1 - best.d / THRESHOLD).toFixed(2) };
}
