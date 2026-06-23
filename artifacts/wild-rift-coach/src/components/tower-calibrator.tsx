import { useState, useRef } from "react";
import { X, Check, RotateCcw } from "lucide-react";
import { TowerConfig, TowerPos, TOWER_LABELS, DEFAULT_TOWER_CONFIG } from "@/hooks/use-map-config";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface Props {
  imageDataUrl: string;
  config: TowerConfig;
  onSave: (c: TowerConfig) => void;
  onClose: () => void;
}

const LANE_LABELS = ["Baron", "Mid", "Dragon"] as const;

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

export function TowerCalibrator({ imageDataUrl, config, onSave, onClose }: Props) {
  const [editing, setEditing] = useState<TowerConfig>({
    ally:  config.ally.map(p => p ? { ...p } : null),
    enemy: config.enemy.map(p => p ? { ...p } : null),
  });
  const [selected, setSelected] = useState<{ team: "ally" | "enemy"; idx: number } | null>(null);
  const [markerPx, setMarkerPx] = useState(28);
  const changeMarker = (delta: number) => setMarkerPx(v => Math.max(16, Math.min(56, v + delta)));
  const imgRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<{ team: "ally" | "enemy"; idx: number; moved: boolean } | null>(null);

  function clientToPercent(cx: number, cy: number): TowerPos | null {
    if (!imgRef.current) return null;
    const rect = imgRef.current.getBoundingClientRect();
    return {
      x: clamp(Math.round(((cx - rect.left) / rect.width)  * 1000) / 10, 0, 100),
      y: clamp(Math.round(((cy - rect.top)  / rect.height) * 1000) / 10, 0, 100),
    };
  }

  function setTower(team: "ally" | "enemy", idx: number, pos: TowerPos) {
    setEditing(prev => {
      const next: TowerConfig = { ally: [...prev.ally], enemy: [...prev.enemy] };
      next[team][idx] = pos;
      return next;
    });
  }

  // Tap on background → place selected tower (no auto-advance)
  function handleBgClick(e: React.MouseEvent) {
    if (dragging.current?.moved) { dragging.current = null; return; }
    dragging.current = null;
    if (!selected) return;
    const pos = clientToPercent(e.clientX, e.clientY);
    if (!pos) return;
    setTower(selected.team, selected.idx, pos);
  }

  function handleBgTouchEnd(e: React.TouchEvent) {
    if (dragging.current?.moved) { dragging.current = null; return; }
    dragging.current = null;
    if (!selected) return;
    e.preventDefault();
    const t = e.changedTouches[0];
    if (!t) return;
    const pos = clientToPercent(t.clientX, t.clientY);
    if (!pos) return;
    setTower(selected.team, selected.idx, pos);
  }

  // Drag an existing tower indicator to reposition it
  function onTowerPointerDown(e: React.PointerEvent, team: "ally" | "enemy", idx: number) {
    e.stopPropagation();
    e.preventDefault();
    dragging.current = { team, idx, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setSelected({ team, idx });
  }

  function onTowerPointerMove(e: React.PointerEvent) {
    if (!dragging.current) return;
    dragging.current.moved = true;
    const pos = clientToPercent(e.clientX, e.clientY);
    if (!pos) return;
    const { team, idx } = dragging.current;
    setTower(team, idx, pos);
  }

  function onTowerPointerUp(e: React.PointerEvent) {
    e.stopPropagation();
    dragging.current = null;
  }

  function clearTowerSlot(team: "ally" | "enemy", idx: number) {
    setEditing(prev => {
      const next: TowerConfig = { ally: [...prev.ally], enemy: [...prev.enemy] };
      next[team][idx] = null;
      return next;
    });
  }

  function handleReset() {
    setEditing({
      ally:  DEFAULT_TOWER_CONFIG.ally.map(p => p ? { ...p } : null),
      enemy: DEFAULT_TOWER_CONFIG.enemy.map(p => p ? { ...p } : null),
    });
  }

  const ALLY_COLOR  = "#38BDF8";
  const ENEMY_COLOR = "#EF4444";

  function towerLabel(idx: number) {
    return `${["B","M","D"][Math.floor(idx / 3)]}${(idx % 3) + 1}`;
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#060e1c]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40 shrink-0">
        <div>
          <span className="text-sm font-display tracking-wider uppercase text-primary">Tower Calibrator</span>
          <p className="text-[11px] text-muted-foreground mt-0.5">Select a slot · Tap map to place · Drag towers to reposition</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Calibrator marker size — only affects this view */}
          <div className="flex items-center gap-0.5 border border-border/30 rounded overflow-hidden text-muted-foreground">
            <button className="px-2 py-1 text-sm hover:text-white hover:bg-white/10 active:scale-95 leading-none"
              onClick={() => changeMarker(-4)}>−</button>
            <span className="text-[10px] w-7 text-center select-none">{markerPx}px</span>
            <button className="px-2 py-1 text-sm hover:text-white hover:bg-white/10 active:scale-95 leading-none"
              onClick={() => changeMarker(4)}>+</button>
          </div>
          <button onClick={handleReset}
            className="flex items-center gap-1 text-[10px] text-muted-foreground/60 hover:text-muted-foreground px-2 py-1 rounded border border-border/30 hover:border-border/60 active:scale-95">
            <RotateCcw className="w-3 h-3" /> Reset
          </button>
          <button onClick={onClose}
            className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-white/10 active:scale-95">
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Tower slot selectors */}
      <div className="shrink-0 px-3 pt-2.5 pb-2 border-b border-border/30 space-y-2">
        {(["ally", "enemy"] as const).map(team => (
          <div key={team}>
            <div className="text-[9px] uppercase tracking-widest font-display mb-1.5"
              style={{ color: team === "ally" ? ALLY_COLOR : ENEMY_COLOR }}>
              {team === "ally" ? "Allied" : "Enemy"} Towers
            </div>
            <div className="flex gap-1.5">
              {([0, 3, 6] as const).map(laneStart => (
                <div key={laneStart} className="flex-1 flex flex-col gap-0.5">
                  <div className="text-[8px] text-center text-muted-foreground/50 font-display">
                    {LANE_LABELS[laneStart / 3]}
                  </div>
                  <div className="flex gap-0.5">
                    {[0, 1, 2].map(ti => {
                      const idx = laneStart + ti;
                      const placed = editing[team][idx] != null;
                      const active = selected?.team === team && selected.idx === idx;
                      return (
                        <button key={idx}
                          onClick={() => setSelected(active ? null : { team, idx })}
                          onContextMenu={e => { e.preventDefault(); clearTowerSlot(team, idx); }}
                          className={cn(
                            "flex-1 text-[10px] font-bold py-2 rounded border transition-all active:scale-95",
                            active
                              ? team === "ally"
                                ? "bg-sky-500/30 border-sky-400 text-sky-300"
                                : "bg-red-500/30 border-red-400 text-red-300"
                              : placed
                                ? team === "ally"
                                  ? "bg-sky-500/10 border-sky-500/40 text-sky-400"
                                  : "bg-red-500/10 border-red-500/40 text-red-400"
                                : "bg-black/40 border-border/30 text-muted-foreground/40"
                          )}>
                          T{ti + 1}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
        <div className="flex items-center justify-between gap-2">
          {selected ? (
            <p className="text-[10px] text-amber-400/80 flex-1">
              Tap map to place {selected.team === "ally" ? "Allied" : "Enemy"} {TOWER_LABELS[selected.idx]} · Drag placed markers to reposition
            </p>
          ) : (
            <p className="text-[10px] text-muted-foreground/40 flex-1">
              Select a slot above then tap map · T1=outer · T3=inhibitor · Long-press slot to clear it
            </p>
          )}
          {selected && editing[selected.team][selected.idx] != null && (
            <button
              onClick={() => clearTowerSlot(selected.team, selected.idx)}
              className="shrink-0 text-[10px] text-red-400 border border-red-500/40 px-2 py-1 rounded hover:bg-red-500/10 active:scale-95">
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Map image — constrained by height so it never scrolls on iPad */}
      <div className="flex-1 min-h-0 overflow-hidden p-2 flex items-start justify-center">
        <div
          ref={imgRef}
          className={cn("relative h-full", selected && "cursor-crosshair")}
          style={{width:"auto"}}
          onClick={handleBgClick}
          onTouchEnd={handleBgTouchEnd}>
          <img
            src={imageDataUrl}
            alt="Minimap"
            className="h-full w-auto block pointer-events-none select-none"
            draggable={false}
          />
          {(["ally", "enemy"] as const).map(team =>
            editing[team].map((pos, idx) => {
              if (!pos) return null;
              const isActive = selected?.team === team && selected.idx === idx;
              const color = team === "ally" ? ALLY_COLOR : ENEMY_COLOR;
              return (
                <div
                  key={`${team}-${idx}`}
                  className="absolute -translate-x-1/2 -translate-y-1/2 z-10 touch-none"
                  style={{ left: `${pos.x}%`, top: `${pos.y}%` }}>
                  <div
                    className={cn(
                      "rounded border-2 flex flex-col items-center justify-center font-bold cursor-grab active:cursor-grabbing select-none transition-transform",
                      isActive && "scale-125"
                    )}
                    style={{
                      width: markerPx, height: markerPx,
                      fontSize: markerPx * 0.38,
                      background: isActive ? color + "44" : "rgba(5,12,28,0.88)",
                      borderColor: color,
                      color,
                      boxShadow: isActive ? `0 0 10px ${color}88` : `0 0 4px ${color}44`,
                    }}
                    onPointerDown={e => onTowerPointerDown(e, team, idx)}
                    onPointerMove={onTowerPointerMove}
                    onPointerUp={onTowerPointerUp}>
                    {towerLabel(idx)}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="shrink-0 px-4 py-3 flex gap-3 border-t border-border/40">
        <Button variant="outline" className="flex-1 h-11" onClick={onClose}>Cancel</Button>
        <Button className="flex-1 h-11" onClick={() => { onSave(editing); onClose(); }}>
          <Check className="w-4 h-4 mr-1.5" /> Save Towers
        </Button>
      </div>
    </div>
  );
}
