import { useState, useRef, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PortraitConfig, PortraitPos, DEFAULT_PORTRAIT_CONFIG } from "@/hooks/use-map-config";
import { RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  screenshot: string;
  current: PortraitConfig;
  onSave: (c: PortraitConfig) => void;
  onClose: () => void;
}

type Team = "ally" | "enemy";
interface Slot { team: Team; idx: number }

function key(s: Slot) { return `${s.team}${s.idx}`; }
function label(s: Slot) { return s.team === "ally" ? `A${s.idx + 1}` : `E${s.idx + 1}`; }
function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

export function PortraitPlacer({ screenshot, current, onSave, onClose }: Props) {
  const [cfg, setCfg] = useState<PortraitConfig>(structuredClone(current));
  const [active, setActive] = useState<Slot>({ team: "ally", idx: 0 });
  const [zoom, setZoom] = useState(1);

  const imgRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinch = useRef<{ dist: number; startZoom: number } | null>(null);

  // ── Zoom ─────────────────────────────────────────────────────────────────────
  const zoomIn  = () => setZoom(z => clamp(Math.round((z + 0.5) * 10) / 10, 1, 12));
  const zoomOut = () => setZoom(z => clamp(Math.round((z - 0.5) * 10) / 10, 1, 12));

  const touchDist = (touches: React.TouchList) => {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) pinch.current = { dist: touchDist(e.touches), startZoom: zoom };
  }, [zoom]);
  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length !== 2 || !pinch.current) return;
    const ratio = touchDist(e.touches) / pinch.current.dist;
    setZoom(clamp(Math.round(pinch.current.startZoom * ratio * 10) / 10, 1, 12));
  }, []);
  const onTouchEnd = useCallback(() => { pinch.current = null; }, []);

  // ── Tap to place ─────────────────────────────────────────────────────────────
  const handleTap = (e: React.MouseEvent | React.TouchEvent) => {
    if (!imgRef.current) return;
    const rect = imgRef.current.getBoundingClientRect();
    let cx: number, cy: number;
    if ("touches" in e || "changedTouches" in e) {
      const te = e as React.TouchEvent;
      const t = te.changedTouches[0];
      cx = t.clientX; cy = t.clientY;
    } else {
      const me = e as React.MouseEvent;
      cx = me.clientX; cy = me.clientY;
    }
    const x = clamp(Math.round(((cx - rect.left) / rect.width)  * 1000) / 10, 0, 100);
    const y = clamp(Math.round(((cy - rect.top)  / rect.height) * 1000) / 10, 0, 100);
    const pos: PortraitPos = { x, y };

    setCfg(prev => {
      const next = structuredClone(prev);
      if (active.team === "ally") next.allies[active.idx] = pos;
      else next.enemies[active.idx] = pos;
      return next;
    });

    // Auto-advance
    if (active.idx < 4) {
      setActive({ team: active.team, idx: active.idx + 1 });
    } else if (active.team === "ally") {
      setActive({ team: "enemy", idx: 0 });
    }
  };

  const reset = () => setCfg(structuredClone(DEFAULT_PORTRAIT_CONFIG));

  const slots: Slot[] = [
    ...[0,1,2,3,4].map(i => ({ team: "ally" as Team, idx: i })),
    ...[0,1,2,3,4].map(i => ({ team: "enemy" as Team, idx: i })),
  ];

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm w-full bg-[#0b1120] border-border p-0 gap-0 max-h-[90vh] flex flex-col">
        <DialogHeader className="px-4 py-3 border-b border-border/50 shrink-0">
          <DialogTitle className="text-sm font-display tracking-wider text-primary uppercase">
            Place Portraits
          </DialogTitle>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Select a slot → tap its centre on the screenshot. Auto-advances to next slot.
          </p>
        </DialogHeader>

        {/* Slot buttons */}
        <div className="px-3 pt-2.5 pb-1 flex flex-wrap gap-1.5 shrink-0">
          {slots.map(slot => {
            const isActive = key(slot) === key(active);
            return (
              <button key={key(slot)} onClick={() => setActive(slot)}
                className={cn("text-[11px] font-bold px-2.5 py-1 rounded-md border transition-all",
                  slot.team === "ally"
                    ? isActive
                      ? "bg-sky-400/30 border-sky-400 text-sky-200 ring-1 ring-sky-400"
                      : "bg-black/30 border-sky-900/50 text-sky-600 hover:border-sky-700 hover:text-sky-400"
                    : isActive
                      ? "bg-red-400/30 border-red-400 text-red-200 ring-1 ring-red-400"
                      : "bg-black/30 border-red-900/50 text-red-600 hover:border-red-700 hover:text-red-400"
                )}>
                {label(slot)}
              </button>
            );
          })}
        </div>

        <p className="px-3 pb-1.5 text-[11px] text-amber-400/80 shrink-0">
          → Tap where <span className="font-bold">{label(active)}</span> appears on the screenshot
        </p>

        {/* Zoom controls */}
        <div className="px-3 pb-2 flex items-center gap-2 shrink-0">
          <button onClick={zoomOut} disabled={zoom <= 1}
            className="w-7 h-7 rounded-lg border border-border/40 flex items-center justify-center text-muted-foreground hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
            <ZoomOut className="w-3 h-3"/>
          </button>
          <span className="text-[11px] font-mono text-muted-foreground flex-1 text-center">
            {zoom === 1 ? "100%" : `${Math.round(zoom * 100)}%`}
          </span>
          <button onClick={zoomIn} disabled={zoom >= 12}
            className="w-7 h-7 rounded-lg border border-border/40 flex items-center justify-center text-muted-foreground hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
            <ZoomIn className="w-3 h-3"/>
          </button>
        </div>

        {/* Scrollable screenshot area — single finger scrolls, pinch zooms */}
        <div
          ref={scrollRef}
          className="mx-3 rounded-lg overflow-auto border border-border/40"
          style={{ maxHeight: "46vh" }}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          <div
            ref={imgRef}
            className="relative cursor-crosshair"
            style={{ width: `${zoom * 100}%` }}
            onClick={handleTap}
            onTouchEnd={e => { e.preventDefault(); handleTap(e); }}
          >
            <img src={screenshot} alt="screenshot" className="w-full h-auto block pointer-events-none" draggable={false}/>

            {/* Ally dots */}
            {cfg.allies.map((pos, i) => {
              const isActive = key({ team: "ally", idx: i }) === key(active);
              return (
                <div key={`a${i}`}
                  className={cn("absolute rounded-full border-2 flex items-center justify-center text-[8px] font-bold select-none pointer-events-none transition-all",
                    isActive
                      ? "border-sky-300 bg-sky-400/90 text-white shadow-lg shadow-sky-500/50"
                      : "border-sky-500/70 bg-sky-600/60 text-white")}
                  style={{
                    left: `${pos.x}%`, top: `${pos.y}%`,
                    width: isActive ? 24 : 16, height: isActive ? 24 : 16,
                    transform: `translate(-50%, -50%)`,
                    fontSize: isActive ? 8 : 0,
                  }}>
                  {isActive ? `A${i+1}` : ""}
                </div>
              );
            })}

            {/* Enemy dots */}
            {cfg.enemies.map((pos, i) => {
              const isActive = key({ team: "enemy", idx: i }) === key(active);
              return (
                <div key={`e${i}`}
                  className={cn("absolute rounded-full border-2 flex items-center justify-center text-[8px] font-bold select-none pointer-events-none transition-all",
                    isActive
                      ? "border-red-300 bg-red-400/90 text-white shadow-lg shadow-red-500/50"
                      : "border-red-500/70 bg-red-600/60 text-white")}
                  style={{
                    left: `${pos.x}%`, top: `${pos.y}%`,
                    width: isActive ? 24 : 16, height: isActive ? 24 : 16,
                    transform: `translate(-50%, -50%)`,
                    fontSize: isActive ? 8 : 0,
                  }}>
                  {isActive ? `E${i+1}` : ""}
                </div>
              );
            })}
          </div>
        </div>

        <div className="p-3 border-t border-border/30 flex gap-2 mt-1 shrink-0">
          <button onClick={reset}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-white border border-border/30 px-3 py-2 rounded-lg">
            <RotateCcw className="w-3 h-3"/> Reset
          </button>
          <Button variant="outline" className="flex-1 h-10" onClick={onClose}>Cancel</Button>
          <Button className="flex-1 h-10 font-display tracking-wider" onClick={() => { onSave(cfg); onClose(); }}>Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
