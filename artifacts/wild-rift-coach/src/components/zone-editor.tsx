import { useState, useRef, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { LanePaths, DEFAULT_LANES, Point } from "@/hooks/use-map-config";
import { RotateCcw } from "lucide-react";

interface Props {
  minimap: string;
  current: LanePaths;
  onSave: (p: LanePaths) => void;
  onClose: () => void;
}

type LaneName = "baron" | "mid" | "dragon";

const LANE_CONFIG: Record<LaneName, { label: string; color: string; fill: string }> = {
  baron:  { label: "Baron Lane",  color: "#60A5FA", fill: "#60A5FA33" },
  mid:    { label: "Mid Lane",    color: "#FBBF24", fill: "#FBBF2433" },
  dragon: { label: "Dragon Lane", color: "#F97316", fill: "#F9731633" },
};

function toSvgPoints(pts: Point[]) {
  return pts.map(p => `${p.x},${p.y}`).join(" ");
}

export function ZoneEditor({ minimap, current, onSave, onClose }: Props) {
  const [paths, setPaths] = useState<LanePaths>(structuredClone(current));
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef<{ lane: LaneName; idx: number } | null>(null);
  const [active, setActive] = useState<{ lane: LaneName; idx: number } | null>(null);

  const getSvgXY = useCallback((clientX: number, clientY: number) => {
    if (!svgRef.current) return null;
    const rect = svgRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, (clientX - rect.left) / rect.width * 100));
    const y = Math.max(0, Math.min(100, (clientY - rect.top) / rect.height * 100));
    return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
  }, []);

  const onSvgPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    const pt = getSvgXY(e.clientX, e.clientY);
    if (!pt) return;
    const { lane, idx } = dragging.current;
    setPaths(p => ({
      ...p,
      [lane]: p[lane].map((wp, i) => i === idx ? pt : wp),
    }));
  }, [getSvgXY]);

  const onSvgPointerUp = useCallback(() => {
    dragging.current = null;
    setActive(null);
  }, []);

  const startDrag = (e: React.PointerEvent, lane: LaneName, idx: number) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    dragging.current = { lane, idx };
    setActive({ lane, idx });
  };

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm w-full bg-[#0b1120] border-border p-0 gap-0 max-h-[90vh] flex flex-col">
        <DialogHeader className="px-4 py-3 border-b border-border/50 shrink-0">
          <DialogTitle className="text-sm font-display tracking-wider text-primary uppercase">
            Edit Lane Zones
          </DialogTitle>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Drag the dots to match each lane on your minimap.
            Blue = Baron · Yellow = Mid · Orange = Dragon
          </p>
        </DialogHeader>

        {/* Legend */}
        <div className="flex gap-4 px-4 py-2 border-b border-border/20 shrink-0">
          {(Object.entries(LANE_CONFIG) as [LaneName, typeof LANE_CONFIG[LaneName]][]).map(([k, v]) => (
            <div key={k} className="flex items-center gap-1.5">
              <div className="w-3 h-0.5 rounded-full" style={{ backgroundColor: v.color }} />
              <span className="text-[10px] text-muted-foreground">{v.label}</span>
            </div>
          ))}
        </div>

        {/* Minimap with SVG overlay */}
        <div className="relative mx-3 my-3 rounded-lg overflow-hidden border border-border/40 shrink-0">
          <img
            src={minimap}
            alt="Minimap"
            className="w-full h-auto block pointer-events-none select-none"
            draggable={false}
          />
          <svg
            ref={svgRef}
            className="absolute inset-0 w-full h-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            style={{ touchAction: "none" }}
            onPointerMove={onSvgPointerMove}
            onPointerUp={onSvgPointerUp}
            onPointerLeave={onSvgPointerUp}
          >
            {(Object.entries(paths) as [LaneName, Point[]][]).map(([lane, pts]) => {
              const cfg = LANE_CONFIG[lane];
              return (
                <g key={lane}>
                  {/* Lane line */}
                  <polyline
                    points={toSvgPoints(pts)}
                    stroke={cfg.color}
                    strokeWidth="1.2"
                    fill="none"
                    strokeOpacity="0.7"
                    strokeDasharray="2 1.5"
                    vectorEffect="non-scaling-stroke"
                  />
                  {/* Waypoint dots */}
                  {pts.map((pt, i) => {
                    const isActive = active?.lane === lane && active?.idx === i;
                    return (
                      <g key={i}>
                        {/* Hit area (larger invisible circle for easier tapping) */}
                        <circle
                          cx={pt.x} cy={pt.y} r="5"
                          fill="transparent"
                          style={{ cursor: "grab" }}
                          onPointerDown={e => startDrag(e, lane, i)}
                        />
                        {/* Visual dot */}
                        <circle
                          cx={pt.x} cy={pt.y}
                          r={isActive ? "3.5" : "2.5"}
                          fill={cfg.color}
                          stroke={isActive ? "#fff" : "#000"}
                          strokeWidth={isActive ? "0.8" : "0.4"}
                          strokeOpacity="0.8"
                          style={{ pointerEvents: "none" }}
                          vectorEffect="non-scaling-stroke"
                        />
                        {/* Index label on active */}
                        {isActive && (
                          <text
                            x={pt.x} y={pt.y - 4}
                            textAnchor="middle"
                            fontSize="3"
                            fill="#fff"
                            style={{ pointerEvents: "none", userSelect: "none" }}
                          >
                            {i === 0 ? "Start" : i === pts.length - 1 ? "End" : `P${i}`}
                          </text>
                        )}
                      </g>
                    );
                  })}
                </g>
              );
            })}
          </svg>
        </div>

        {/* Tips */}
        <div className="mx-3 mb-3 rounded-lg bg-black/30 border border-border/20 px-3 py-2 text-[10px] text-muted-foreground space-y-1 shrink-0">
          <p>• First dot = your base side · Last dot = enemy base side</p>
          <p>• Drag any dot to align it with the lane on the minimap above</p>
          <p>• After saving, re-upload a screenshot to apply the new zones</p>
        </div>

        <div className="p-3 border-t border-border/30 flex gap-2 shrink-0">
          <button
            onClick={() => setPaths(structuredClone(DEFAULT_LANES))}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-white border border-border/30 px-3 py-2 rounded-lg"
          >
            <RotateCcw className="w-3 h-3" /> Reset
          </button>
          <Button variant="outline" className="flex-1 h-10" onClick={onClose}>Cancel</Button>
          <Button
            className="flex-1 h-10 font-display tracking-wider"
            onClick={() => { onSave(paths); onClose(); }}
          >
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
