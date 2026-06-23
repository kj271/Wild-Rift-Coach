import { useState, useRef, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CropConfig, DEFAULT_CROP } from "@/hooks/use-map-config";
import { RotateCcw, ZoomIn, ZoomOut } from "lucide-react";

interface Props {
  screenshot: string;
  current: CropConfig;
  defaultConfig?: CropConfig;
  title?: string;
  onSave: (c: CropConfig) => void;
  onClose: () => void;
}

type Handle = "move" | "nw" | "ne" | "sw" | "se";
function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
function round1(v: number) { return Math.round(v * 10) / 10; }

export function CropCalibrator({ screenshot, current, defaultConfig, title, onSave, onClose }: Props) {
  const [cfg, setCfg] = useState<CropConfig>({ ...current });
  const [zoom, setZoom] = useState(1);

  const scrollRef = useRef<HTMLDivElement>(null);
  // containerRef points to the scaled inner div (coordinate reference for drags)
  const containerRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ handle: Handle; sx: number; sy: number; sc: CropConfig } | null>(null);
  const pinch = useRef<{ dist: number; startZoom: number } | null>(null);

  // ── Pointer drag for crop handles ───────────────────────────────────────────
  const startDrag = (e: React.PointerEvent, handle: Handle) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { handle, sx: e.clientX, sy: e.clientY, sc: { ...cfg } };
  };

  const onMove = (e: React.PointerEvent) => {
    if (!drag.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const dx = (e.clientX - drag.current.sx) / rect.width * 100;
    const dy = (e.clientY - drag.current.sy) / rect.height * 100;
    const s = drag.current.sc;
    const MIN = 2;

    let next: CropConfig;
    if (drag.current.handle === "move") {
      next = { x: round1(clamp(s.x + dx, 0, 100 - s.w)), y: round1(clamp(s.y + dy, 0, 100 - s.h)), w: s.w, h: s.h };
    } else if (drag.current.handle === "nw") {
      const x = round1(clamp(s.x + dx, 0, s.x + s.w - MIN));
      const y = round1(clamp(s.y + dy, 0, s.y + s.h - MIN));
      next = { x, y, w: round1(s.x + s.w - x), h: round1(s.y + s.h - y) };
    } else if (drag.current.handle === "ne") {
      const y = round1(clamp(s.y + dy, 0, s.y + s.h - MIN));
      next = { x: s.x, y, w: round1(clamp(s.w + dx, MIN, 100 - s.x)), h: round1(s.y + s.h - y) };
    } else if (drag.current.handle === "sw") {
      const x = round1(clamp(s.x + dx, 0, s.x + s.w - MIN));
      next = { x, y: s.y, w: round1(s.x + s.w - x), h: round1(clamp(s.h + dy, MIN, 100 - s.y)) };
    } else {
      next = { x: s.x, y: s.y, w: round1(clamp(s.w + dx, MIN, 100 - s.x)), h: round1(clamp(s.h + dy, MIN, 100 - s.y)) };
    }
    setCfg(next);
  };

  const onUp = () => { drag.current = null; };

  // ── Pinch-to-zoom (touch) ────────────────────────────────────────────────────
  const touchDist = (touches: React.TouchList) => {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      pinch.current = { dist: touchDist(e.touches), startZoom: zoom };
    }
  }, [zoom]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length !== 2 || !pinch.current) return;
    const ratio = touchDist(e.touches) / pinch.current.dist;
    const sz = pinch.current.startZoom;
    setZoom(clamp(Math.round(sz * ratio * 10) / 10, 1, 12));
  }, []);

  const onTouchEnd = useCallback(() => { pinch.current = null; }, []);

  // ── Zoom buttons ─────────────────────────────────────────────────────────────
  const zoomIn  = () => setZoom(z => clamp(Math.round((z + 0.5) * 10) / 10, 1, 12));
  const zoomOut = () => setZoom(z => clamp(Math.round((z - 0.5) * 10) / 10, 1, 12));

  const r = cfg.x + cfg.w;
  const b = cfg.y + cfg.h;

  // Handle style: individual handles block touch so they get pointer events for drag
  const handleStyle: React.CSSProperties = { touchAction: "none" };

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm w-full bg-[#0b1120] border-border p-0 gap-0 max-h-[90vh] flex flex-col">
        <DialogHeader className="px-4 py-3 border-b border-border/50 shrink-0">
          <DialogTitle className="text-sm font-display tracking-wider text-primary uppercase">
            {title ?? "Crop Area"}
          </DialogTitle>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Drag box · drag corners to resize · pinch or ± to zoom · scroll/swipe to pan
          </p>
        </DialogHeader>

        {/* Zoom controls */}
        <div className="px-3 pt-2.5 pb-1 flex items-center gap-2 shrink-0">
          <button onClick={zoomOut} disabled={zoom <= 1}
            className="w-8 h-8 rounded-lg border border-border/40 flex items-center justify-center text-muted-foreground hover:text-white hover:border-primary/40 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <span className="text-xs font-mono text-muted-foreground flex-1 text-center">
            {zoom === 1 ? "100%" : `${Math.round(zoom * 100)}%`}
          </span>
          <button onClick={zoomIn} disabled={zoom >= 12}
            className="w-8 h-8 rounded-lg border border-border/40 flex items-center justify-center text-muted-foreground hover:text-white hover:border-primary/40 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
        </div>

        {/*
          Outer wrapper: overflow-auto so the browser's native scroll handles panning.
          touchAction is left to the browser default — single-finger swipe = pan scroll.
          The pinch gesture is detected in onTouchStart/onTouchMove here.
        */}
        <div
          ref={scrollRef}
          className="mx-3 rounded-lg overflow-auto border border-border/40"
          style={{ maxHeight: "52vh" }}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          {/*
            Inner container: scaled to zoom level.
            touchAction NOT set here so the browser can scroll the outer wrapper when
            the user swipes with one finger. Pointer drag on handles still works because
            handles call setPointerCapture and have touchAction:"none" on themselves.
          */}
          <div
            ref={containerRef}
            className="relative select-none"
            style={{ width: `${zoom * 100}%` }}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          >
            <img src={screenshot} alt="screenshot" className="w-full h-auto block pointer-events-none" draggable={false} />

            {/* Darkened overlay */}
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute top-0 left-0 right-0 bg-black/65" style={{ height: `${cfg.y}%` }} />
              <div className="absolute left-0 right-0 bg-black/65" style={{ top: `${b}%`, bottom: 0 }} />
              <div className="absolute bg-black/65" style={{ top: `${cfg.y}%`, left: 0, width: `${cfg.x}%`, height: `${cfg.h}%` }} />
              <div className="absolute bg-black/65" style={{ top: `${cfg.y}%`, left: `${r}%`, right: 0, height: `${cfg.h}%` }} />
            </div>

            {/* Crop box */}
            <div
              className="absolute border-2 border-yellow-400"
              style={{ left: `${cfg.x}%`, top: `${cfg.y}%`, width: `${cfg.w}%`, height: `${cfg.h}%` }}
            >
              {/* Centre move handle — touchAction:none so it captures pointer correctly */}
              <div
                className="absolute inset-4 cursor-move"
                style={handleStyle}
                onPointerDown={e => startDrag(e, "move")}
              />

              {/* Corner handles */}
              {([
                ["nw", "top-0 left-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize"],
                ["ne", "top-0 right-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize"],
                ["sw", "bottom-0 left-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize"],
                ["se", "bottom-0 right-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize"],
              ] as [Handle, string][]).map(([h, cls]) => (
                <div key={h}
                  className={`absolute w-7 h-7 bg-yellow-400 rounded-sm shadow-lg ${cls}`}
                  style={handleStyle}
                  onPointerDown={e => startDrag(e, h)}
                />
              ))}

              {/* Edge midpoints (visual only) */}
              <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-1.5 bg-yellow-400/60 rounded-full pointer-events-none" />
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 w-4 h-1.5 bg-yellow-400/60 rounded-full pointer-events-none" />
              <div className="absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-4 bg-yellow-400/60 rounded-full pointer-events-none" />
              <div className="absolute right-0 top-1/2 translate-x-1/2 -translate-y-1/2 w-1.5 h-4 bg-yellow-400/60 rounded-full pointer-events-none" />
            </div>
          </div>
        </div>

        {/* Live coordinate readout */}
        <div className="mx-3 mt-2 mb-2 flex gap-4 text-[11px] font-mono text-muted-foreground bg-black/30 rounded-lg px-3 py-2 shrink-0">
          <span>X <span className="text-primary">{cfg.x}%</span></span>
          <span>Y <span className="text-primary">{cfg.y}%</span></span>
          <span>W <span className="text-primary">{cfg.w}%</span></span>
          <span>H <span className="text-primary">{cfg.h}%</span></span>
        </div>

        <div className="p-3 border-t border-border/30 flex gap-2 shrink-0">
          <button
            onClick={() => setCfg({ ...(defaultConfig ?? DEFAULT_CROP) })}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-white border border-border/30 px-3 py-2 rounded-lg"
          >
            <RotateCcw className="w-3 h-3" /> Reset
          </button>
          <Button variant="outline" className="flex-1 h-10" onClick={onClose}>Cancel</Button>
          <Button className="flex-1 h-10 font-display tracking-wider" onClick={() => { onSave(cfg); onClose(); }}>Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
