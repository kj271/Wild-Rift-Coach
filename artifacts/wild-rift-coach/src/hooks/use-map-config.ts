import { useState, useCallback } from "react";

export interface CropConfig { x: number; y: number; w: number; h: number }
export interface Point { x: number; y: number }
export interface LanePaths { baron: Point[]; mid: Point[]; dragon: Point[] }

const CROP_KEY  = "wildrift_crop_config";
const LANES_KEY = "wildrift_lane_paths";

export const DEFAULT_CROP: CropConfig = { x: 0, y: 0, w: 22, h: 36 };

export const DEFAULT_LANES: LanePaths = {
  baron:  [{x:7,y:72},{x:7,y:48},{x:22,y:26},{x:44,y:8},{x:62,y:7}],
  mid:    [{x:20,y:80},{x:35,y:65},{x:50,y:50},{x:65,y:35},{x:80,y:20}],
  dragon: [{x:22,y:92},{x:40,y:83},{x:56,y:78},{x:73,y:70},{x:86,y:60}],
};

function loadCrop(): CropConfig {
  try { const s = localStorage.getItem(CROP_KEY); return s ? JSON.parse(s) : DEFAULT_CROP; }
  catch { return DEFAULT_CROP; }
}
function loadLanes(): LanePaths {
  try { const s = localStorage.getItem(LANES_KEY); return s ? JSON.parse(s) : DEFAULT_LANES; }
  catch { return DEFAULT_LANES; }
}

export function useCropConfig() {
  const [config, setConfig] = useState<CropConfig>(loadCrop);
  const save = useCallback((c: CropConfig) => {
    setConfig(c);
    localStorage.setItem(CROP_KEY, JSON.stringify(c));
  }, []);
  const reset = useCallback(() => save(DEFAULT_CROP), [save]);
  return { config, save, reset } as const;
}

export function useLanePaths() {
  const [paths, setPaths] = useState<LanePaths>(loadLanes);
  const save = useCallback((p: LanePaths) => {
    setPaths(p);
    localStorage.setItem(LANES_KEY, JSON.stringify(p));
  }, []);
  const reset = useCallback(() => save(DEFAULT_LANES), [save]);
  return { paths, save, reset } as const;
}
