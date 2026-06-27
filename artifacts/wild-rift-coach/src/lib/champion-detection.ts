// Champion portrait matching (Data Dragon) + green circle "me" detector

const DD_BASE = "https://ddragon.leagueoflegends.com";
const SIG_N = 16; // 16×16 downsample → 16*16*3 = 768 values per sig
const THRESHOLD = 0.22; // normalised Euclidean distance cutoff (tune if needed)

// ── Data Dragon version ───────────────────────────────────────────────────────
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

// Display name → Data Dragon champion ID
export function toChampId(name: string): string {
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

// Wild Rift-only champions not on Data Dragon
const WR_ONLY = new Set(["Norra", "Mel"]);

// ── IDB signature cache ───────────────────────────────────────────────────────
const _IDB_NAME = "wr_champ_sigs_v1";
const _IDB_STORE = "sigs";

function _openSigDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(_IDB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(_IDB_STORE);
    r.onsuccess = () => res(r.result);
    r.onerror   = () => rej(r.error);
  });
}
async function _getSig(key: string): Promise<Float32Array | null> {
  try {
    const db = await _openSigDb();
    return new Promise((res, rej) => {
      const r2 = db.transaction(_IDB_STORE, "readonly").objectStore(_IDB_STORE).get(key);
      r2.onsuccess = () => res((r2.result as Float32Array) ?? null);
      r2.onerror   = () => rej(r2.error);
    });
  } catch { return null; }
}
async function _setSig(key: string, sig: Float32Array): Promise<void> {
  try {
    const db = await _openSigDb();
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(_IDB_STORE, "readwrite");
      tx.objectStore(_IDB_STORE).put(sig, key);
      tx.oncomplete = () => res();
      tx.onerror    = () => rej(tx.error);
    });
  } catch {}
}

// ── Signature computation ─────────────────────────────────────────────────────
const _memCache = new Map<string, Float32Array | null>();

function _sigFromImageData(data: Uint8ClampedArray): Float32Array {
  const sig = new Float32Array(SIG_N * SIG_N * 3);
  for (let i = 0; i < SIG_N * SIG_N; i++) {
    sig[i * 3]     = data[i * 4]     / 255;
    sig[i * 3 + 1] = data[i * 4 + 1] / 255;
    sig[i * 3 + 2] = data[i * 4 + 2] / 255;
  }
  return sig;
}

function _sigFromUrl(url: string, crossOrigin?: boolean): Promise<Float32Array | null> {
  return new Promise(resolve => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = SIG_N; c.height = SIG_N;
        const ctx = c.getContext("2d")!;
        ctx.drawImage(img, 0, 0, SIG_N, SIG_N);
        resolve(_sigFromImageData(ctx.getImageData(0, 0, SIG_N, SIG_N).data));
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function _dist(a: Float32Array, b: Float32Array): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += (a[i] - b[i]) ** 2;
  return Math.sqrt(d / a.length);
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Fetch (and cache) colour signature for a champion. */
export async function getChampSig(name: string): Promise<Float32Array | null> {
  if (WR_ONLY.has(name)) return null;
  if (_memCache.has(name)) return _memCache.get(name)!;

  const cached = await _getSig(name);
  if (cached) { _memCache.set(name, cached); return cached; }

  const ver = await ddVersion();
  const id  = toChampId(name);
  const url = `${DD_BASE}/cdn/${ver}/img/champion/${id}.png`;
  const sig = await _sigFromUrl(url, true);

  _memCache.set(name, sig);
  if (sig) await _setSig(name, sig);
  return sig;
}

/** Pre-warm the cache for all champions in the background. */
export async function prewarmChampSigs(names: string[]): Promise<void> {
  for (const n of names) await getChampSig(n);
}

/**
 * Compare a cropped portrait data-URL against every candidate champion.
 * Returns best match + confidence (0–1), or null if nothing is close enough.
 */
export async function matchPortrait(
  portraitDataUrl: string,
  candidates: string[],
): Promise<{ name: string; confidence: number } | null> {
  const sig = await _sigFromUrl(portraitDataUrl);
  if (!sig) return null;

  const pairs = await Promise.all(
    candidates
      .filter(n => !WR_ONLY.has(n))
      .map(async n => ({ n, s: await getChampSig(n) }))
  );

  let best: { name: string; dist: number } | null = null;
  for (const { n, s } of pairs) {
    if (!s) continue;
    const d = _dist(sig, s);
    if (!best || d < best.dist) best = { name: n, dist: d };
  }

  if (!best || best.dist > THRESHOLD) return null;
  return { name: best.name, confidence: +(1 - best.dist / THRESHOLD).toFixed(2) };
}

/**
 * Scan minimap for the player's bright-green selection circle.
 * Returns {x, y} as percentages (0–100) of minimap dimensions, or null.
 */
export function detectGreenCircle(minimapDataUrl: string): Promise<{ x: number; y: number } | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const W = img.width, H = img.height;
      const c = document.createElement("canvas");
      c.width = W; c.height = H;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const px = ctx.getImageData(0, 0, W, H).data;

      let sx = 0, sy = 0, n = 0;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          const r = px[i], g = px[i + 1], b = px[i + 2];
          // Bright, highly saturated green — player circle
          if (g > 155 && r < 110 && b < 120 && g > r * 1.9 && g > b * 1.6) {
            sx += x; sy += y; n++;
          }
        }
      }

      if (n < 15) { resolve(null); return; }
      resolve({
        x: Math.round((sx / n / W) * 1000) / 10,
        y: Math.round((sy / n / H) * 1000) / 10,
      });
    };
    img.onerror = () => resolve(null);
    img.src = minimapDataUrl;
  });
}
