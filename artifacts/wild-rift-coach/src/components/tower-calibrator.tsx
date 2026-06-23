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

export function TowerCalibrator({ imageDataUrl, config, onSave, onClose }: Props) {
  const [editing, setEditing] = useState<TowerConfig>({
    ally:  config.ally.map(p => p ? { ...p } : null),
    enemy: config.enemy.map(p => p ? { ...p } : null),
  });
  const [selected, setSelected] = useState<{ team: "ally" | "enemy"; idx: number } | null>(null);
  const imgRef = useRef<HTMLDivElement>(null);

  function handleImageTap(e: React.MouseEvent | React.TouchEvent) {
    if (!selected || !imgRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = imgRef.current.getBoundingClientRect();
    let cx: number, cy: number;
    if ("touches" in e) {
      cx = e.touches[0]!.clientX;
      cy = e.touches[0]!.clientY;
    } else {
      cx = (e as React.MouseEvent).clientX;
      cy = (e as React.MouseEvent).clientY;
    }
    const x = Math.max(0, Math.min(100, (cx - rect.left) / rect.width * 100));
    const y = Math.max(0, Math.min(100, (cy - rect.top) / rect.height * 100));
    const pos: TowerPos = { x, y };
    setEditing(prev => {
      const next: TowerConfig = { ally: [...prev.ally], enemy: [...prev.enemy] };
      next[selected.team][selected.idx] = pos;
      return next;
    });
    // Auto-advance
    const nextIdx = selected.idx + 1;
    if (nextIdx < 9) {
      setSelected({ team: selected.team, idx: nextIdx });
    } else if (selected.team === "ally") {
      setSelected({ team: "enemy", idx: 0 });
    } else {
      setSelected(null);
    }
  }

  function clearTower(team: "ally" | "enemy", idx: number, e: React.MouseEvent) {
    e.stopPropagation();
    setEditing(prev => {
      const next: TowerConfig = { ally: [...prev.ally], enemy: [...prev.enemy] };
      next[team][idx] = null;
      return next;
    });
    setSelected({ team, idx });
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
    const lane = ["B","M","D"][Math.floor(idx / 3)]!;
    const tier = (idx % 3) + 1;
    return `${lane}${tier}`;
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#060e1c]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40 shrink-0">
        <span className="text-sm font-display tracking-wider uppercase text-primary">Tower Calibrator</span>
        <div className="flex items-center gap-2">
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
      <div className="shrink-0 px-3 pt-2.5 pb-2 border-b border-border/30 space-y-2.5">
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
        {selected ? (
          <p className="text-[10px] text-center text-amber-400/80 animate-pulse">
            Tap the map to place {selected.team === "ally" ? "Allied" : "Enemy"} {TOWER_LABELS[selected.idx]}
          </p>
        ) : (
          <p className="text-[10px] text-center text-muted-foreground/40">
            Select a tower slot above, then tap the map
          </p>
        )}
      </div>

      {/* Map image */}
      <div className="flex-1 overflow-hidden p-3 relative">
        <div
          ref={imgRef}
          className={cn("relative w-full h-full", selected && "cursor-crosshair")}
          onClick={handleImageTap}
          onTouchStart={handleImageTap}>
          <img
            src={imageDataUrl}
            alt="Minimap"
            className="w-full h-full object-contain pointer-events-none select-none"
            draggable={false}
          />
          {(["ally", "enemy"] as const).map(team =>
            editing[team].map((pos, idx) => {
              if (!pos) return null;
              const active = selected?.team === team && selected.idx === idx;
              const color = team === "ally" ? ALLY_COLOR : ENEMY_COLOR;
              return (
                <div
                  key={`${team}-${idx}`}
                  className="absolute -translate-x-1/2 -translate-y-1/2 z-10"
                  style={{ left: `${pos.x}%`, top: `${pos.y}%` }}>
                  <button
                    onClick={ev => clearTower(team, idx, ev)}
                    title={`${team === "ally" ? "Allied" : "Enemy"} ${TOWER_LABELS[idx]} — tap to clear`}
                    className={cn(
                      "w-6 h-6 rounded-sm border-2 flex items-center justify-center text-[9px] font-bold transition-all active:scale-90",
                      active && "scale-125"
                    )}
                    style={{
                      background: active ? color + "44" : "rgba(5,12,28,0.85)",
                      borderColor: color,
                      color,
                      boxShadow: active ? `0 0 8px ${color}66` : undefined,
                    }}>
                    {towerLabel(idx)}
                  </button>
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
