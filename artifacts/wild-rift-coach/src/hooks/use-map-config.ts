import { useState, useCallback } from "react";

export interface CropConfig { x: number; y: number; w: number; h: number }
export interface Point { x: number; y: number }
export interface LanePaths { baron: Point[]; mid: Point[]; dragon: Point[] }
export interface ZoneData { id: string; label: string; points: Point[] }

const CROP_KEY      = "wildrift_crop_config";
const LANES_KEY     = "wildrift_lane_paths";
const ZONES_KEY     = "wildrift_zones";
const FAVORITES_KEY = "wildrift_favorites";

export const DEFAULT_CROP: CropConfig = { x: 0, y: 0, w: 22, h: 36 };

export const DEFAULT_LANES: LanePaths = {
  baron:  [{x:7,y:72},{x:7,y:48},{x:22,y:26},{x:44,y:8},{x:62,y:7}],
  mid:    [{x:20,y:80},{x:35,y:65},{x:50,y:50},{x:65,y:35},{x:80,y:20}],
  dragon: [{x:22,y:92},{x:40,y:83},{x:56,y:78},{x:73,y:70},{x:86,y:60}],
};

export const DEFAULT_ZONES: ZoneData[] = [
  { id: "blue_base",   label: "Blue Base",   points: [{x:0,y:78},{x:18,y:78},{x:18,y:100},{x:0,y:100}] },
  { id: "red_base",    label: "Red Base",    points: [{x:82,y:0},{x:100,y:0},{x:100,y:22},{x:82,y:22}] },
  { id: "baron_pit",   label: "Baron Pit",   points: [{x:26,y:12},{x:46,y:12},{x:46,y:32},{x:26,y:32}] },
  { id: "dragon_pit",  label: "Dragon Pit",  points: [{x:50,y:69},{x:70,y:69},{x:70,y:92},{x:50,y:92}] },
  { id: "jungle_blue", label: "Blue Jungle", points: [{x:7,y:36},{x:26,y:24},{x:34,y:38},{x:22,y:60},{x:7,y:60}] },
  { id: "jungle_red",  label: "Red Jungle",  points: [{x:68,y:40},{x:93,y:30},{x:93,y:62},{x:78,y:62},{x:68,y:52}] },
];

function load<T>(key: string, fallback: T): T {
  try { const s = localStorage.getItem(key); return s ? JSON.parse(s) as T : fallback; }
  catch { return fallback; }
}

export function useCropConfig() {
  const [config, setConfig] = useState<CropConfig>(() => load(CROP_KEY, DEFAULT_CROP));
  const save = useCallback((c: CropConfig) => { setConfig(c); localStorage.setItem(CROP_KEY, JSON.stringify(c)); }, []);
  const reset = useCallback(() => save(DEFAULT_CROP), [save]);
  return { config, save, reset } as const;
}

export function useLanePaths() {
  const [paths, setPaths] = useState<LanePaths>(() => load(LANES_KEY, DEFAULT_LANES));
  const save = useCallback((p: LanePaths) => { setPaths(p); localStorage.setItem(LANES_KEY, JSON.stringify(p)); }, []);
  const reset = useCallback(() => save(DEFAULT_LANES), [save]);
  return { paths, save, reset } as const;
}

export function useZones() {
  const [zones, setZones] = useState<ZoneData[]>(() => load(ZONES_KEY, DEFAULT_ZONES));
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
