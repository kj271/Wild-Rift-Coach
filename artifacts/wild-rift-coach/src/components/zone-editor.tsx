import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LanePaths, ZoneData, DEFAULT_LANES, DEFAULT_ZONES, Point } from "@/hooks/use-map-config";
import { RotateCcw, Plus, Trash2, Check, X, Eraser } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  minimap: string;
  lanes: LanePaths;
  zones: ZoneData[];
  onSave: (lanes: LanePaths, zones: ZoneData[]) => void;
  onClose: () => void;
}

type LaneName = "baron" | "mid" | "dragon";
type DragTarget =
  | { kind: "lane"; lane: LaneName; idx: number }
  | { kind: "zonePt"; zoneId: string; ptIdx: number }
  | null;

const LANE_CFG: Record<LaneName, { color: string; label: string }> = {
  baron:  { color: "#60A5FA", label: "Top" },
  mid:    { color: "#FBBF24", label: "Mid" },
  dragon: { color: "#F97316", label: "Bottom" },
};

const ZONE_COLORS = [
  "#A78BFA","#34D399","#FB923C","#F472B6","#38BDF8","#4ADE80","#FACC15","#E879F9",
];

function round1(v: number) { return Math.round(v * 10) / 10; }
function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
function zoneColor(idx: number) { return ZONE_COLORS[idx % ZONE_COLORS.length]!; }
function toSvgPts(pts: Point[]) { return pts.map(p => `${p.x},${p.y}`).join(" "); }

function pointInPolygon(px: number, py: number, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i]!.x, yi = polygon[i]!.y;
    const xj = polygon[j]!.x, yj = polygon[j]!.y;
    const intersect = ((yi > py) !== (yj > py)) &&
      (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function insertAtNearestEdge(pts: Point[], newPt: Point): Point[] {
  if (pts.length < 2) return [...pts, newPt];
  let bestDist = Infinity, bestIdx = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!, b = pts[(i + 1) % pts.length]!;
    const dx = b.x - a.x, dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((newPt.x - a.x) * dx + (newPt.y - a.y) * dy) / lenSq));
    const dist = Math.hypot(newPt.x - (a.x + t * dx), newPt.y - (a.y + t * dy));
    if (dist < bestDist) { bestDist = dist; bestIdx = i; }
  }
  const result = [...pts];
  result.splice(bestIdx + 1, 0, newPt);
  return result;
}

export function ZoneEditor({ minimap, lanes: initLanes, zones: initZones, onSave, onClose }: Props) {
  const [lanes, setLanes] = useState<LanePaths>(structuredClone(initLanes));
  const [zones, setZones] = useState<ZoneData[]>(structuredClone(initZones));
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [drawMode, setDrawMode] = useState(false);
  const [drawingPts, setDrawingPts] = useState<Point[]>([]);
  const [deletePointMode, setDeletePointMode] = useState(false);
  const [addPointMode, setAddPointMode] = useState(false);
  const [tab, setTab] = useState<"zones" | "lanes">("zones");

  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef<DragTarget>(null);
  const didMove = useRef(false);

  const getSvgXY = (clientX: number, clientY: number): Point | null => {
    if (!svgRef.current) return null;
    const rect = svgRef.current.getBoundingClientRect();
    return {
      x: round1(clamp((clientX - rect.left) / rect.width * 100, 0, 100)),
      y: round1(clamp((clientY - rect.top) / rect.height * 100, 0, 100)),
    };
  };

  const onSvgPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const pt = getSvgXY(e.clientX, e.clientY);
    if (!pt) return;

    if (drawMode) {
      setDrawingPts(p => [...p, pt]);
      return;
    }

    if (addPointMode && selectedZoneId) {
      setZones(zs => zs.map(z =>
        z.id === selectedZoneId ? { ...z, points: insertAtNearestEdge(z.points, pt) } : z
      ));
      return;
    }

    // Try to select a zone by point-in-polygon
    for (const zone of [...zones].reverse()) {
      if (pointInPolygon(pt.x, pt.y, zone.points)) {
        setSelectedZoneId(zone.id);
        setDeletePointMode(false);
        setAddPointMode(false);
        return;
      }
    }
    setSelectedZoneId(null);
    setDeletePointMode(false);
    setAddPointMode(false);
  };

  const startDragLane = (e: React.PointerEvent, lane: LaneName, idx: number) => {
    e.stopPropagation();
    (e.currentTarget as SVGElement).setPointerCapture(e.pointerId);
    dragging.current = { kind: "lane", lane, idx };
    didMove.current = false;
  };

  const startDragZonePt = (e: React.PointerEvent, zoneId: string, ptIdx: number) => {
    e.stopPropagation();
    if (deletePointMode) {
      const zone = zones.find(z => z.id === zoneId);
      if (zone && zone.points.length > 3) {
        setZones(zs => zs.map(z =>
          z.id === zoneId ? { ...z, points: z.points.filter((_, i) => i !== ptIdx) } : z
        ));
      }
      return;
    }
    (e.currentTarget as SVGElement).setPointerCapture(e.pointerId);
    dragging.current = { kind: "zonePt", zoneId, ptIdx };
    didMove.current = false;
  };

  const onSvgPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    const pt = getSvgXY(e.clientX, e.clientY);
    if (!pt) return;
    didMove.current = true;

    if (dragging.current.kind === "lane") {
      const { lane, idx } = dragging.current;
      setLanes(p => ({ ...p, [lane]: p[lane].map((wp, i) => i === idx ? pt : wp) }));
    } else {
      const { zoneId, ptIdx } = dragging.current;
      setZones(zs => zs.map(z =>
        z.id === zoneId ? { ...z, points: z.points.map((p, i) => i === ptIdx ? pt : p) } : z
      ));
    }
  };

  const onSvgPointerUp = () => { dragging.current = null; };

  const finishDraw = () => {
    if (drawingPts.length < 3) return;
    const id = `zone_${Date.now()}`;
    const newZone: ZoneData = { id, label: "New Zone", points: drawingPts };
    setZones(z => [...z, newZone]);
    setSelectedZoneId(id);
    setNameInput("New Zone");
    setEditingName(true);
    setDrawMode(false);
    setDrawingPts([]);
  };

  const cancelDraw = () => { setDrawMode(false); setDrawingPts([]); };

  const commitName = () => {
    if (!selectedZoneId) return;
    setZones(zs => zs.map(z => z.id === selectedZoneId ? { ...z, label: nameInput } : z));
    setEditingName(false);
  };

  const deleteZone = (id: string) => {
    setZones(zs => zs.filter(z => z.id !== id));
    if (selectedZoneId === id) { setSelectedZoneId(null); setDeletePointMode(false); setAddPointMode(false); }
  };

  const resetAll = () => {
    setLanes(structuredClone(DEFAULT_LANES));
    setZones(structuredClone(DEFAULT_ZONES));
    setSelectedZoneId(null); setDrawMode(false); setDrawingPts([]);
    setDeletePointMode(false); setAddPointMode(false); setEditingName(false);
  };

  const selectedZone = zones.find(z => z.id === selectedZoneId);

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm w-full bg-[#0b1120] border-border p-0 gap-0 max-h-[90vh] flex flex-col">
        <DialogHeader className="px-4 py-3 border-b border-border/50 shrink-0">
          <DialogTitle className="text-sm font-display tracking-wider text-primary uppercase">
            Edit Map Zones &amp; Lanes
          </DialogTitle>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {tab === "zones"
              ? drawMode ? "Tap minimap to add polygon vertices" : "Tap inside zone to select · drag vertices to reshape"
              : "Drag dots to adjust lane waypoints"}
          </p>
        </DialogHeader>

        {/* Tab bar */}
        <div className="flex border-b border-border/30 shrink-0">
          {(["zones", "lanes"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={cn("flex-1 py-2.5 text-xs font-display uppercase tracking-widest transition-colors",
                tab === t ? "text-primary border-b-2 border-primary" : "text-muted-foreground hover:text-white")}>
              {t}
            </button>
          ))}
        </div>

        {/* Minimap + SVG */}
        <div className="relative mx-3 mt-3 rounded-lg overflow-hidden border border-border/40 shrink-0"
          style={{ touchAction: "none" }}>
          <img src={minimap} alt="Minimap" className="w-full h-auto block pointer-events-none select-none" draggable={false} />
          <svg
            ref={svgRef}
            className="absolute inset-0 w-full h-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            onPointerMove={onSvgPointerMove}
            onPointerUp={onSvgPointerUp}
            onPointerDown={onSvgPointerDown}
            style={{ cursor: drawMode || addPointMode ? "crosshair" : "default" }}
          >
            {/* ── Lanes ── */}
            {tab === "lanes" && (Object.entries(lanes) as [LaneName, Point[]][]).map(([lane, pts]) => {
              const cfg = LANE_CFG[lane];
              return (
                <g key={lane}>
                  <polyline points={toSvgPts(pts)} stroke={cfg.color} strokeWidth="1"
                    fill="none" strokeOpacity="0.6" strokeDasharray="2 1.5" vectorEffect="non-scaling-stroke" />
                  {pts.map((pt, i) => (
                    <g key={i}>
                      <circle cx={pt.x} cy={pt.y} r="5" fill="transparent" style={{ cursor: "grab" }}
                        onPointerDown={e => startDragLane(e, lane, i)} />
                      <circle cx={pt.x} cy={pt.y} r="2.8" fill={cfg.color}
                        stroke="#000" strokeWidth="0.4" strokeOpacity="0.7"
                        style={{ pointerEvents: "none" }} vectorEffect="non-scaling-stroke" />
                    </g>
                  ))}
                </g>
              );
            })}

            {/* ── Zones ── */}
            {tab === "zones" && zones.map((zone, i) => {
              const color = zoneColor(i);
              const isSelected = zone.id === selectedZoneId;
              const pts = zone.points;
              if (pts.length < 2) return null;
              const svgPts = toSvgPts(pts);

              return (
                <g key={zone.id}>
                  {/* Filled polygon */}
                  <polygon points={svgPts}
                    fill={color} fillOpacity={isSelected ? 0.35 : 0.18}
                    stroke={color} strokeWidth={isSelected ? "1.2" : "0.6"}
                    strokeOpacity={isSelected ? 0.9 : 0.5}
                    vectorEffect="non-scaling-stroke"
                    style={{ pointerEvents: "none" }}
                  />

                  {/* Zone label */}
                  {(() => {
                    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
                    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
                    return (
                      <text x={cx} y={cy + 1.2} textAnchor="middle"
                        fontSize={isSelected ? "4" : "3.5"} fill={isSelected ? "#fff" : color}
                        paintOrder="stroke" stroke="#000" strokeWidth="1.5" strokeLinejoin="round"
                        style={{ pointerEvents: "none", userSelect: "none" }}>
                        {zone.label}
                      </text>
                    );
                  })()}

                  {/* Edge midpoint "+" insertion buttons (selected zone, addPointMode) */}
                  {isSelected && addPointMode && pts.map((pt, idx) => {
                    const next = pts[(idx + 1) % pts.length]!;
                    const mx = (pt.x + next.x) / 2, my = (pt.y + next.y) / 2;
                    return (
                      <g key={`mid-${idx}`}>
                        <circle cx={mx} cy={my} r="4" fill="#fff" fillOpacity="0.15"
                          stroke="#fff" strokeWidth="0.6" strokeOpacity="0.5"
                          vectorEffect="non-scaling-stroke" style={{ pointerEvents: "none" }} />
                        <text x={mx} y={my + 1.4} textAnchor="middle" fontSize="3.5"
                          fill="#fff" fillOpacity="0.7" style={{ pointerEvents: "none", userSelect: "none" }}>+</text>
                      </g>
                    );
                  })}

                  {/* Vertex dots (selected zone) */}
                  {isSelected && pts.map((pt, idx) => (
                    <g key={`pt-${idx}`}>
                      <circle cx={pt.x} cy={pt.y} r="5.5" fill="transparent"
                        style={{ cursor: deletePointMode ? "pointer" : "grab" }}
                        onPointerDown={e => startDragZonePt(e, zone.id, idx)} />
                      <circle cx={pt.x} cy={pt.y} r="3"
                        fill={deletePointMode ? "#EF4444" : "#fff"}
                        stroke={deletePointMode ? "#ef4444" : color}
                        strokeWidth="0.8" vectorEffect="non-scaling-stroke"
                        style={{ pointerEvents: "none" }} />
                    </g>
                  ))}
                </g>
              );
            })}

            {/* ── Drawing preview ── */}
            {drawMode && drawingPts.length > 0 && (
              <g>
                {drawingPts.length >= 2 && (
                  <polyline points={toSvgPts(drawingPts)} stroke="#A78BFA" strokeWidth="1.2"
                    fill="none" strokeDasharray="2 1.5" vectorEffect="non-scaling-stroke" />
                )}
                {drawingPts.length >= 3 && (
                  <line x1={drawingPts[drawingPts.length - 1]!.x} y1={drawingPts[drawingPts.length - 1]!.y}
                    x2={drawingPts[0]!.x} y2={drawingPts[0]!.y}
                    stroke="#A78BFA" strokeWidth="0.6" strokeOpacity="0.5"
                    strokeDasharray="1.5 1.5" vectorEffect="non-scaling-stroke" />
                )}
                {drawingPts.map((pt, i) => (
                  <circle key={i} cx={pt.x} cy={pt.y} r="2.5"
                    fill={i === 0 ? "#A78BFA" : "#fff"} stroke="#000" strokeWidth="0.4"
                    vectorEffect="non-scaling-stroke" style={{ pointerEvents: "none" }} />
                ))}
              </g>
            )}
          </svg>
        </div>

        {/* ── Zone controls ── */}
        {tab === "zones" && (
          <div className="mx-3 mt-2 shrink-0 space-y-2">

            {/* Draw mode toolbar */}
            {drawMode ? (
              <div className="bg-violet-500/10 border border-violet-500/30 rounded-lg p-3 space-y-2">
                <p className="text-[11px] text-violet-300 text-center font-display tracking-wide">
                  {drawingPts.length === 0 ? "Tap minimap to start drawing polygon"
                    : drawingPts.length < 3 ? `${drawingPts.length} point${drawingPts.length > 1 ? "s" : ""} — need at least 3`
                    : `${drawingPts.length} points — ready to finish`}
                </p>
                <div className="flex gap-2">
                  <button onClick={cancelDraw}
                    className="flex-1 py-2 rounded-lg border border-border/40 text-xs text-muted-foreground hover:text-white">
                    Cancel
                  </button>
                  <button onClick={finishDraw} disabled={drawingPts.length < 3}
                    className={cn("flex-1 py-2 rounded-lg border text-xs font-display tracking-wider transition-colors",
                      drawingPts.length >= 3
                        ? "bg-violet-500/20 border-violet-500/60 text-violet-300 hover:bg-violet-500/30"
                        : "opacity-40 border-border/30 text-muted-foreground cursor-not-allowed")}>
                    Finish Zone
                  </button>
                </div>
              </div>
            ) : selectedZone ? (
              <div className="bg-black/40 border border-border/40 rounded-lg p-3 space-y-2">
                {/* Name row */}
                <div className="flex items-center gap-2">
                  {editingName ? (
                    <>
                      <Input autoFocus value={nameInput} onChange={e => setNameInput(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") commitName(); if (e.key === "Escape") setEditingName(false); }}
                        className="h-8 text-sm bg-black/40 border-border/50 flex-1" />
                      <button onClick={commitName}
                        className="w-8 h-8 flex items-center justify-center rounded-md bg-primary/20 border border-primary/40 text-primary">
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => setEditingName(false)}
                        className="w-8 h-8 flex items-center justify-center rounded-md border border-border/40 text-muted-foreground">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </>
                  ) : (
                    <button onClick={() => { setNameInput(selectedZone.label); setEditingName(true); }}
                      className="flex-1 text-left px-3 py-2 rounded-lg border border-border/40 text-sm text-white hover:border-primary/40 bg-black/20">
                      {selectedZone.label} <span className="text-muted-foreground text-xs ml-1">tap to rename</span>
                    </button>
                  )}
                </div>

                {/* Point editing buttons */}
                <div className="flex gap-2">
                  <button
                    onClick={() => { setAddPointMode(a => !a); setDeletePointMode(false); }}
                    className={cn("flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border text-[11px] font-display tracking-wider transition-colors",
                      addPointMode
                        ? "bg-emerald-500/20 border-emerald-500/60 text-emerald-400"
                        : "border-border/40 text-muted-foreground hover:border-emerald-500/40 hover:text-emerald-400")}>
                    <Plus className="w-3 h-3" />
                    {addPointMode ? "Tap to add pt" : "Add Point"}
                  </button>
                  <button
                    onClick={() => { setDeletePointMode(d => !d); setAddPointMode(false); }}
                    className={cn("flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border text-[11px] font-display tracking-wider transition-colors",
                      deletePointMode
                        ? "bg-red-500/20 border-red-500/60 text-red-400"
                        : "border-border/40 text-muted-foreground hover:border-red-500/40 hover:text-red-400")}>
                    <Eraser className="w-3 h-3" />
                    {deletePointMode ? "Tap vertex to del" : "Delete Point"}
                  </button>
                  <button onClick={() => deleteZone(selectedZone.id)}
                    className="px-3 py-2 rounded-lg border border-red-400/30 text-red-400 hover:bg-red-500/10 text-[11px] flex items-center gap-1">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {selectedZone.points.length} vertices
                  {deletePointMode && selectedZone.points.length <= 3 && " · need 4+ to delete any"}
                </p>
              </div>
            ) : null}

            {/* Add new zone / zone list */}
            {!drawMode && (
              <div className="flex gap-2 items-start flex-wrap">
                <button
                  onClick={() => { setDrawMode(true); setDrawingPts([]); setSelectedZoneId(null); setDeletePointMode(false); setAddPointMode(false); }}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border/40 text-[11px] text-muted-foreground hover:border-violet-500/50 hover:text-violet-400 bg-black/30 font-display tracking-wider transition-colors">
                  <Plus className="w-3 h-3" /> New Zone
                </button>
                {zones.map((z, i) => (
                  <button key={z.id}
                    onClick={() => { setSelectedZoneId(selectedZoneId === z.id ? null : z.id); setDeletePointMode(false); setAddPointMode(false); }}
                    className={cn("flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border text-[10px] transition-colors",
                      selectedZoneId === z.id
                        ? "border-white/40 text-white bg-white/10"
                        : "border-border/30 text-muted-foreground hover:border-white/30")}>
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: zoneColor(i) }} />
                    {z.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Lane legend ── */}
        {tab === "lanes" && (
          <div className="mx-3 mt-2 rounded-lg bg-black/30 border border-border/20 px-3 py-2 text-[10px] text-muted-foreground shrink-0 space-y-1">
            {(Object.entries(LANE_CFG) as [LaneName, typeof LANE_CFG[LaneName]][]).map(([k, v]) => (
              <div key={k} className="flex items-center gap-2">
                <div className="w-4 h-0.5 rounded-full shrink-0" style={{ backgroundColor: v.color }} />
                <span>{v.label} Lane · first dot = your base · last dot = enemy base</span>
              </div>
            ))}
          </div>
        )}

        <div className="p-3 border-t border-border/30 flex gap-2 mt-auto shrink-0">
          <button onClick={resetAll}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-white border border-border/30 px-3 py-2 rounded-lg">
            <RotateCcw className="w-3 h-3" /> Reset
          </button>
          <Button variant="outline" className="flex-1 h-10" onClick={onClose}>Cancel</Button>
          <Button className="flex-1 h-10 font-display tracking-wider"
            onClick={() => { onSave(lanes, zones); onClose(); }}>
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
