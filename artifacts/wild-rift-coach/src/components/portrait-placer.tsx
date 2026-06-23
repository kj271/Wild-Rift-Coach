import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PortraitConfig, PortraitPos, DEFAULT_PORTRAIT_CONFIG } from "@/hooks/use-map-config";
import { RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  screenshot: string;
  current: PortraitConfig;
  onSave: (c: PortraitConfig) => void;
  onClose: () => void;
}

type Slot = { team: "ally" | "enemy"; idx: number };

function slotKey(s: Slot) { return `${s.team}${s.idx}`; }
function slotLabel(s: Slot) { return s.team === "ally" ? `A${s.idx + 1}` : `E${s.idx + 1}`; }

export function PortraitPlacer({ screenshot, current, onSave, onClose }: Props) {
  const [cfg, setCfg] = useState<PortraitConfig>(structuredClone(current));
  const [active, setActive] = useState<Slot>({ team: "ally", idx: 0 });
  const imgRef = useRef<HTMLDivElement>(null);

  const handleTap = (e: React.MouseEvent | React.TouchEvent) => {
    if (!imgRef.current) return;
    const rect = imgRef.current.getBoundingClientRect();
    let cx: number, cy: number;
    if ("touches" in e) {
      const t = e.touches[0] ?? e.changedTouches[0];
      cx = t.clientX; cy = t.clientY;
    } else {
      cx = e.clientX; cy = e.clientY;
    }
    const x = Math.round(((cx - rect.left) / rect.width) * 1000) / 10;
    const y = Math.round(((cy - rect.top) / rect.height) * 1000) / 10;
    const pos: PortraitPos = { x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) };
    setCfg(prev => {
      const next = structuredClone(prev);
      if (active.team === "ally") next.allies[active.idx] = pos;
      else next.enemies[active.idx] = pos;
      return next;
    });
    // Auto-advance to next portrait
    const nextIdx = active.idx + 1;
    if (nextIdx < 5) {
      setActive({ team: active.team, idx: nextIdx });
    } else if (active.team === "ally") {
      setActive({ team: "enemy", idx: 0 });
    }
    // else all placed, stay on last
  };

  const reset = () => setCfg(structuredClone(DEFAULT_PORTRAIT_CONFIG));

  const slots: Slot[] = [
    ...([0,1,2,3,4].map(i => ({ team: "ally" as const, idx: i }))),
    ...([0,1,2,3,4].map(i => ({ team: "enemy" as const, idx: i }))),
  ];

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm w-full bg-[#0b1120] border-border p-0 gap-0 max-h-[90vh] flex flex-col">
        <DialogHeader className="px-4 py-3 border-b border-border/50 shrink-0">
          <DialogTitle className="text-sm font-display tracking-wider text-primary uppercase">
            Place Portraits
          </DialogTitle>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Select a slot, then tap its centre on the screenshot. Repeats auto-advance.
          </p>
        </DialogHeader>

        {/* Slot selector */}
        <div className="px-3 pt-2.5 pb-2 flex flex-wrap gap-1.5 shrink-0">
          {slots.map(slot => {
            const isActive = slotKey(slot) === slotKey(active);
            const pos = slot.team === "ally" ? cfg.allies[slot.idx] : cfg.enemies[slot.idx];
            const placed = pos.x !== DEFAULT_PORTRAIT_CONFIG[slot.team === "ally" ? "allies" : "enemies"][slot.idx].x
              || pos.y !== DEFAULT_PORTRAIT_CONFIG[slot.team === "ally" ? "allies" : "enemies"][slot.idx].y;
            return (
              <button
                key={slotKey(slot)}
                onClick={() => setActive(slot)}
                className={cn(
                  "text-[11px] font-bold px-2.5 py-1 rounded-md border transition-all",
                  slot.team === "ally"
                    ? isActive
                      ? "bg-sky-400/30 border-sky-400 text-sky-200 ring-1 ring-sky-400"
                      : placed
                        ? "bg-sky-900/30 border-sky-700/60 text-sky-400"
                        : "bg-black/30 border-border/40 text-muted-foreground"
                    : isActive
                      ? "bg-red-400/30 border-red-400 text-red-200 ring-1 ring-red-400"
                      : placed
                        ? "bg-red-900/30 border-red-700/60 text-red-400"
                        : "bg-black/30 border-border/40 text-muted-foreground"
                )}
              >
                {slotLabel(slot)}
              </button>
            );
          })}
        </div>

        <p className="px-3 pb-1.5 text-[11px] text-amber-400/80 shrink-0">
          → Tap where <span className="font-bold">{slotLabel(active)}</span> portrait appears on the screenshot
        </p>

        {/* Screenshot tap area */}
        <div
          className="mx-3 rounded-lg overflow-hidden border border-border/40 relative cursor-crosshair shrink-0"
          ref={imgRef}
          onClick={handleTap}
          onTouchEnd={e => { e.preventDefault(); handleTap(e); }}
          style={{ userSelect: "none" }}
        >
          <img src={screenshot} alt="screenshot" className="w-full h-auto block pointer-events-none" draggable={false}/>

          {/* Ally dots */}
          {cfg.allies.map((pos, i) => {
            const slot: Slot = { team: "ally", idx: i };
            const isActive = slotKey(slot) === slotKey(active);
            return (
              <div key={`a${i}`}
                className={cn("absolute rounded-full border-2 flex items-center justify-center text-[8px] font-bold select-none pointer-events-none",
                  isActive ? "border-sky-300 bg-sky-400/80 text-white w-6 h-6 -ml-3 -mt-3" : "border-sky-400/70 bg-sky-500/50 text-white w-4 h-4 -ml-2 -mt-2")}
                style={{ left: `${pos.x}%`, top: `${pos.y}%` }}>
                {isActive ? `A${i+1}` : ""}
              </div>
            );
          })}

          {/* Enemy dots */}
          {cfg.enemies.map((pos, i) => {
            const slot: Slot = { team: "enemy", idx: i };
            const isActive = slotKey(slot) === slotKey(active);
            return (
              <div key={`e${i}`}
                className={cn("absolute rounded-full border-2 flex items-center justify-center text-[8px] font-bold select-none pointer-events-none",
                  isActive ? "border-red-300 bg-red-400/80 text-white w-6 h-6 -ml-3 -mt-3" : "border-red-400/70 bg-red-500/50 text-white w-4 h-4 -ml-2 -mt-2")}
                style={{ left: `${pos.x}%`, top: `${pos.y}%` }}>
                {isActive ? `E${i+1}` : ""}
              </div>
            );
          })}
        </div>

        <div className="p-3 border-t border-border/30 flex gap-2 mt-2 shrink-0">
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
