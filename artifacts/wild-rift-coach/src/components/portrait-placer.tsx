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
  const [cfg, setCfg] = useState<PortraitConfig>(() => ({
    ...DEFAULT_PORTRAIT_CONFIG,
    ...structuredClone(current),
    sizePct: current.sizePct ?? DEFAULT_PORTRAIT_CONFIG.sizePct,
  }));
  const [active, setActive] = useState<Slot>({ team: "ally", idx: 0 });
  const [zoom, setZoom] = useState(1);
  // dragging state: which dot + whether a real drag happened (to suppress tap)
  const dragging = useRef<{ slot: Slot; moved: boolean } | null>(null);

  const imgRef = useRef<HTMLDivElement>(null);
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

  // ── Convert client coords → % within image ───────────────────────────────────
  const clientToPercent = (cx: number, cy: number): PortraitPos | null => {
    if (!imgRef.current) return null;
    const rect = imgRef.current.getBoundingClientRect();
    return {
      x: clamp(Math.round(((cx - rect.left) / rect.width)  * 1000) / 10, 0, 100),
      y: clamp(Math.round(((cy - rect.top)  / rect.height) * 1000) / 10, 0, 100),
    };
  };

  // ── Tap to place (on the background, not on a dot) ───────────────────────────
  const handleContainerClick = (e: React.MouseEvent) => {
    // Ignore if a drag just finished
    if (dragging.current?.moved) { dragging.current = null; return; }
    dragging.current = null;
    const pos = clientToPercent(e.clientX, e.clientY);
    if (!pos) return;
    placeAndAdvance(active, pos);
  };

  const handleContainerTouchEnd = (e: React.TouchEvent) => {
    if (dragging.current?.moved) { dragging.current = null; return; }
    dragging.current = null;
    e.preventDefault();
    const t = e.changedTouches[0];
    const pos = clientToPercent(t.clientX, t.clientY);
    if (!pos) return;
    placeAndAdvance(active, pos);
  };

  const placeAndAdvance = (slot: Slot, pos: PortraitPos) => {
    setCfg(prev => {
      const next = structuredClone(prev);
      if (slot.team === "ally") next.allies[slot.idx] = pos;
      else next.enemies[slot.idx] = pos;
      return next;
    });
    const maxIdx = slot.team === "ally" ? 3 : 4;
    if (slot.idx < maxIdx) {
      setActive({ team: slot.team, idx: slot.idx + 1 });
    } else if (slot.team === "ally") {
      setActive({ team: "enemy", idx: 0 });
    }
  };

  // ── Drag a dot ───────────────────────────────────────────────────────────────
  const onDotPointerDown = (e: React.PointerEvent, slot: Slot) => {
    e.stopPropagation();
    e.preventDefault();
    dragging.current = { slot, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setActive(slot);
  };

  const onDotPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    dragging.current.moved = true;
    const pos = clientToPercent(e.clientX, e.clientY);
    if (!pos) return;
    const { slot } = dragging.current;
    setCfg(prev => {
      const next = structuredClone(prev);
      if (slot.team === "ally") next.allies[slot.idx] = pos;
      else next.enemies[slot.idx] = pos;
      return next;
    });
  };

  const onDotPointerUp = (e: React.PointerEvent) => {
    e.stopPropagation();
    // keep dragging.current so the parent click handler can check .moved
    setTimeout(() => { dragging.current = null; }, 50);
  };

  const reset = () => setCfg(structuredClone(DEFAULT_PORTRAIT_CONFIG));

  const slots: Slot[] = [
    ...[0,1,2,3].map(i => ({ team: "ally" as Team, idx: i })),
    ...[0,1,2,3,4].map(i => ({ team: "enemy" as Team, idx: i })),
  ];

  const dotSize = (isActive: boolean) => isActive ? Math.max(cfg.sizePct * 1.3, 18) : cfg.sizePct;

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm w-full bg-[#0b1120] border-border p-0 gap-0 max-h-[90vh] flex flex-col">
        <DialogHeader className="px-4 py-3 border-b border-border/50 shrink-0">
          <DialogTitle className="text-sm font-display tracking-wider text-primary uppercase">
            Place Portraits
          </DialogTitle>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Tap to place · Drag dots to reposition · Slider = circle size
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
          → Tap/drag <span className="font-bold">{label(active)}</span> to its portrait centre
        </p>

        {/* Zoom + size controls */}
        <div className="px-3 pb-2 flex items-center gap-2 shrink-0">
          <button onClick={zoomOut} disabled={zoom <= 1}
            className="w-7 h-7 rounded-lg border border-border/40 flex items-center justify-center text-muted-foreground hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
            <ZoomOut className="w-3 h-3"/>
          </button>
          <span className="text-[11px] font-mono text-muted-foreground w-10 text-center">
            {zoom === 1 ? "100%" : `${Math.round(zoom * 100)}%`}
          </span>
          <button onClick={zoomIn} disabled={zoom >= 12}
            className="w-7 h-7 rounded-lg border border-border/40 flex items-center justify-center text-muted-foreground hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
            <ZoomIn className="w-3 h-3"/>
          </button>

          <div className="flex-1 flex items-center gap-1.5 ml-2">
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">Circle size</span>
            <input type="range" min={2} max={14} step={0.5}
              value={cfg.sizePct}
              onChange={e => setCfg(p => ({ ...p, sizePct: parseFloat(e.target.value) }))}
              className="flex-1 accent-primary h-1"/>
            <span className="text-[10px] font-mono text-muted-foreground w-8">{cfg.sizePct.toFixed(1)}%</span>
          </div>
        </div>

        {/* Scrollable screenshot */}
        <div
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
            onClick={handleContainerClick}
            onTouchEnd={handleContainerTouchEnd}
          >
            <img src={screenshot} alt="screenshot" className="w-full h-auto block pointer-events-none" draggable={false}/>

            {/* Ally dots */}
            {cfg.allies.map((pos, i) => {
              const slot: Slot = { team: "ally", idx: i };
              const isActive = key(slot) === key(active);
              const sz = dotSize(isActive);
              return (
                <div key={`a${i}`}
                  className={cn("absolute rounded-full border-2 flex items-center justify-center font-bold select-none cursor-grab active:cursor-grabbing transition-colors touch-none",
                    isActive
                      ? "border-sky-300 bg-sky-400/90 text-white shadow-lg shadow-sky-500/50"
                      : "border-sky-500/80 bg-sky-600/70 text-white")}
                  style={{
                    left: `${pos.x}%`, top: `${pos.y}%`,
                    width: `${sz}%`, aspectRatio: "1",
                    transform: "translate(-50%, -50%)",
                    fontSize: `${sz * 0.35}%`,
                    zIndex: isActive ? 10 : 5,
                  }}
                  onPointerDown={e => onDotPointerDown(e, slot)}
                  onPointerMove={onDotPointerMove}
                  onPointerUp={onDotPointerUp}>
                  A{i+1}
                </div>
              );
            })}

            {/* Enemy dots */}
            {cfg.enemies.map((pos, i) => {
              const slot: Slot = { team: "enemy", idx: i };
              const isActive = key(slot) === key(active);
              const sz = dotSize(isActive);
              return (
                <div key={`e${i}`}
                  className={cn("absolute rounded-full border-2 flex items-center justify-center font-bold select-none cursor-grab active:cursor-grabbing transition-colors touch-none",
                    isActive
                      ? "border-red-300 bg-red-400/90 text-white shadow-lg shadow-red-500/50"
                      : "border-red-500/80 bg-red-600/70 text-white")}
                  style={{
                    left: `${pos.x}%`, top: `${pos.y}%`,
                    width: `${sz}%`, aspectRatio: "1",
                    transform: "translate(-50%, -50%)",
                    fontSize: `${sz * 0.35}%`,
                    zIndex: isActive ? 10 : 5,
                  }}
                  onPointerDown={e => onDotPointerDown(e, slot)}
                  onPointerMove={onDotPointerMove}
                  onPointerUp={onDotPointerUp}>
                  E{i+1}
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
