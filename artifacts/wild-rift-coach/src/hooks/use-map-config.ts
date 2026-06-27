import { useState, useCallback } from "react";

export interface CropConfig { x: number; y: number; w: number; h: number }
export interface Point { x: number; y: number }
export interface LanePaths { baron: Point[]; mid: Point[]; dragon: Point[] }
export interface ZoneData { id: string; label: string; points: Point[] }

const CROP_KEY       = "wildrift_crop_config";
const TIMER_CROP_KEY = "wildrift_timer_crop";
const LANES_KEY      = "wildrift_lane_paths";
const ZONES_KEY      = "wildrift_zones";
const FAVORITES_KEY  = "wildrift_favorites";

export const DEFAULT_CROP: CropConfig = { x: 0, y: 0, w: 22, h: 36 };

export const DEFAULT_LANES: LanePaths = {
  baron:  [{x:7,y:72},{x:7,y:48},{x:22,y:26},{x:44,y:8},{x:62,y:7}],
  mid:    [{x:20,y:80},{x:35,y:65},{x:50,y:50},{x:65,y:35},{x:80,y:20}],
  dragon: [{x:22,y:92},{x:40,y:83},{x:56,y:78},{x:73,y:70},{x:86,y:60}],
};

export const DEFAULT_ZONES: ZoneData[] = [
  { id: "blue_base",   label: "Blue Base",   points: [{x:0,y:78},{x:18,y:78},{x:18,y:100},{x:0,y:100}] },
  { id: "red_base",    label: "Red Base",    points: [{x:82,y:0},{x:100,y:0},{x:100,y:22},{x:82,y:22}] },
  { id: "baron_pit",   label: "Top Lane Pit",    points: [{x:26,y:12},{x:46,y:12},{x:46,y:32},{x:26,y:32}] },
  { id: "dragon_pit",  label: "Bottom Lane Pit", points: [{x:50,y:69},{x:70,y:69},{x:70,y:92},{x:50,y:92}] },
  { id: "jungle_blue", label: "Blue Jungle", points: [{x:7,y:36},{x:26,y:24},{x:34,y:38},{x:22,y:60},{x:7,y:60}] },
  { id: "jungle_red",  label: "Red Jungle",  points: [{x:68,y:40},{x:93,y:30},{x:93,y:62},{x:78,y:62},{x:68,y:52}] },
];

function load<T>(key: string, fallback: T): T {
  try { const s = localStorage.getItem(key); return s ? JSON.parse(s) as T : fallback; }
  catch { return fallback; }
}

function migrateZones(raw: unknown[]): ZoneData[] {
  return raw.map((z) => {
    const zone = z as Record<string, unknown>;
    if (zone.points && Array.isArray(zone.points) && zone.points.length >= 3) {
      return zone as unknown as ZoneData;
    }
    // Old circle format {cx, cy, r} → convert to square polygon
    const cx = (zone.cx as number) ?? 50;
    const cy = (zone.cy as number) ?? 50;
    const r  = (zone.r  as number) ?? 12;
    return {
      id:     (zone.id    as string) ?? `zone_${Math.random().toString(36).slice(2)}`,
      label:  (zone.label as string) ?? "Zone",
      points: [
        { x: cx - r, y: cy - r },
        { x: cx + r, y: cy - r },
        { x: cx + r, y: cy + r },
        { x: cx - r, y: cy + r },
      ],
    } satisfies ZoneData;
  });
}

export const DEFAULT_TIMER_CROP: CropConfig = { x: 28, y: 0, w: 44, h: 13 };

// ── Individual portrait positions (v2) ──────────────────────────────────────
export interface PortraitPos { x: number; y: number } // centre as % of full screenshot
export interface PortraitConfig {
  allies:  [PortraitPos, PortraitPos, PortraitPos, PortraitPos]; // 4 other allies (you are the 5th)
  enemies: [PortraitPos, PortraitPos, PortraitPos, PortraitPos, PortraitPos];
  sizePct: number; // diameter of click circles as % of screenshot width (default 5.5)
}

const PORTRAIT_CONFIG_KEY = "wildrift_portraits_v2";

export const DEFAULT_PORTRAIT_CONFIG: PortraitConfig = {
  allies:  [{x:5,y:7},{x:14,y:7},{x:23,y:7},{x:32,y:7}],
  enemies: [{x:64,y:7},{x:73,y:7},{x:82,y:7},{x:91,y:7},{x:96,y:7}],
  sizePct: 5.5,
};

function normalizePortraitConfig(raw: PortraitConfig): PortraitConfig {
  // Trim stale data — allies must be exactly 4, enemies exactly 5
  const def = DEFAULT_PORTRAIT_CONFIG;
  return {
    allies:  ([...raw.allies].slice(0,4).concat(def.allies)).slice(0,4) as PortraitConfig["allies"],
    enemies: ([...raw.enemies].slice(0,5).concat(def.enemies)).slice(0,5) as PortraitConfig["enemies"],
    sizePct: raw.sizePct ?? def.sizePct,
  };
}

export function usePortraitConfig() {
  const [config, setConfig] = useState<PortraitConfig>(() => normalizePortraitConfig(load(PORTRAIT_CONFIG_KEY, DEFAULT_PORTRAIT_CONFIG)));
  const save = useCallback((c: PortraitConfig) => { const n = normalizePortraitConfig(c); setConfig(n); localStorage.setItem(PORTRAIT_CONFIG_KEY, JSON.stringify(n)); }, []);
  return { config, save } as const;
}

// Legacy key kept only for ALL_CONFIG_KEYS cleanup
const PORTRAIT_BAR_KEY = "wildrift_portrait_bar";

export function useCropConfig() {
  const [config, setConfig] = useState<CropConfig>(() => load(CROP_KEY, DEFAULT_CROP));
  const save = useCallback((c: CropConfig) => { setConfig(c); localStorage.setItem(CROP_KEY, JSON.stringify(c)); }, []);
  const reset = useCallback(() => save(DEFAULT_CROP), [save]);
  return { config, save, reset } as const;
}

export function useTimerCropConfig() {
  const [config, setConfig] = useState<CropConfig>(() => load(TIMER_CROP_KEY, DEFAULT_TIMER_CROP));
  const save = useCallback((c: CropConfig) => { setConfig(c); localStorage.setItem(TIMER_CROP_KEY, JSON.stringify(c)); }, []);
  return { config, save } as const;
}

// ── Portrait strip crop (ally/enemy portraits area for respawn timers) ────────
const PORTRAIT_STRIP_KEY = "wildrift_portrait_strip_v1";
export const DEFAULT_PORTRAIT_STRIP: CropConfig = { x: 0, y: 0, w: 100, h: 14 };

export function usePortraitStripConfig() {
  const [config, setConfig] = useState<CropConfig>(() => load(PORTRAIT_STRIP_KEY, DEFAULT_PORTRAIT_STRIP));
  const save = useCallback((c: CropConfig) => { setConfig(c); localStorage.setItem(PORTRAIT_STRIP_KEY, JSON.stringify(c)); }, []);
  return { config, save } as const;
}

export function useLanePaths() {
  const [paths, setPaths] = useState<LanePaths>(() => load(LANES_KEY, DEFAULT_LANES));
  const save = useCallback((p: LanePaths) => { setPaths(p); localStorage.setItem(LANES_KEY, JSON.stringify(p)); }, []);
  const reset = useCallback(() => save(DEFAULT_LANES), [save]);
  return { paths, save, reset } as const;
}

export function useZones() {
  const [zones, setZones] = useState<ZoneData[]>(() => {
    const raw = load<unknown[]>(ZONES_KEY, DEFAULT_ZONES as unknown[]);
    if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_ZONES;
    return migrateZones(raw);
  });
  const save = useCallback((z: ZoneData[]) => { setZones(z); localStorage.setItem(ZONES_KEY, JSON.stringify(z)); }, []);
  const reset = useCallback(() => save(DEFAULT_ZONES), [save]);
  return { zones, save, reset } as const;
}

export function useFavoriteChamps() {
  const [favorites, setFavorites] = useState<string[]>(() => load(FAVORITES_KEY, []));
  const toggle = useCallback((champ: string) => {
    setFavorites(prev => {
      const next = prev.includes(champ) ? prev.filter(c => c !== champ) : [...prev, champ];
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
      return next;
    });
  }, []);
  return { favorites, toggle } as const;
}

// ── Tower positions (on minimap, % of minimap width/height) ──────────────────
export interface TowerPos { x: number; y: number }

export interface TowerConfig {
  ally:  (TowerPos | null)[];  // 9 slots: [B-T1,B-T2,B-T3, M-T1,M-T2,M-T3, D-T1,D-T2,D-T3]
  enemy: (TowerPos | null)[];
}

export const TOWER_LABELS = [
  "Top T1","Top T2","Top T3",
  "Mid T1","Mid T2","Mid T3",
  "Bottom T1","Bottom T2","Bottom T3",
] as const;

const TOWER_CONFIG_KEY = "wildrift_towers_v1";

export const DEFAULT_TOWER_CONFIG: TowerConfig = {
  ally: [
    {x:12,y:55},{x:10,y:38},{x:12,y:20},
    {x:32,y:70},{x:22,y:60},{x:15,y:48},
    {x:42,y:85},{x:30,y:82},{x:18,y:78},
  ],
  enemy: [
    {x:55,y:10},{x:72,y:10},{x:85,y:15},
    {x:68,y:30},{x:78,y:38},{x:85,y:52},
    {x:58,y:58},{x:70,y:68},{x:82,y:80},
  ],
};

export function useTowerConfig() {
  const [config, setConfig] = useState<TowerConfig>(() => load(TOWER_CONFIG_KEY, DEFAULT_TOWER_CONFIG));
  const save = useCallback((c: TowerConfig) => { setConfig(c); localStorage.setItem(TOWER_CONFIG_KEY, JSON.stringify(c)); }, []);
  return { config, save } as const;
}

export const ALL_CONFIG_KEYS = [
  CROP_KEY, TIMER_CROP_KEY, PORTRAIT_STRIP_KEY, PORTRAIT_BAR_KEY, PORTRAIT_CONFIG_KEY,
  LANES_KEY, ZONES_KEY, FAVORITES_KEY, TOWER_CONFIG_KEY,
  "wr_dead_slot_boxes", "wr_obj_pit_config", "wr_strip_detect_config",
] as const;
