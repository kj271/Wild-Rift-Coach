import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  LanePaths, ZoneData, DEFAULT_LANES, DEFAULT_ZONES, Point,
} from "@/hooks/use-map-config";
import { RotateCcw, Plus, Trash2, Check, X } from "lucide-react";
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
  | { kind: "zone"; id: string }
  | null;

const LANE_CFG: Record<LaneName, { color: string; label: string }> = {
  baron:  { color: "#60A5FA", label: "Baron" },
  mid:    { color: "#FBBF24", label: "Mid" },
  dragon: { color: "#F97316", label: "Dragon" },
};

const ZONE_COLORS = [
  "#A78BFA","#34D399","#FB923C","#F472B6","#38BDF8","#4ADE80","#FACC15","#E879F9",
];

function round1(v: number) { return Math.round(v * 10) / 10; }
function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
function zoneColor(idx: number) { return ZONE_COLORS[idx % ZONE_COLORS.length]!; }

function toSvgPts(pts: Point[]) { return pts.map(p => `${p.x},${p.y}`).join(" "); }

export function ZoneEditor({ minimap, lanes: initLanes, zones: initZones, onSave, onClose }: Props) {
  const [lanes, setLanes] = useState<LanePaths>(structuredClone(initLanes));
  const [zones, setZones] = useState<ZoneData[]>(structuredClone(initZones));
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [addMode, setAddMode] = useState(false);
  const [tab, setTab] = useState<"zones" | "lanes">("zones");

  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef<DragTarget>(null);
  const didMove = useRef(false);

  const getSvgXY = (clientX: number, clientY: number) => {
    if (!svgRef.current) return null;
    const rect = svgRef.current.getBoundingClientRect();
    return {
      x: round1(clamp((clientX - rect.left) / rect.width * 100, 0, 100)),
      y: round1(clamp((clientY - rect.top) / rect.height * 100, 0, 100)),
    };
  };

  const onSvgPointerDown = (e: React.PointerEvent) => {
    if (!addMode) return;
    const pt = getSvgXY(e.clientX, e.clientY);
    if (!pt) return;
    const id = `zone_${Date.now()}`;
    const newZone: ZoneData = { id, label: "New Zone", cx: pt.x, cy: pt.y, r: 12 };
    setZones(z => [...z, newZone]);
    setSelectedZoneId(id);
    setNameInput("New Zone");
    setEditingName(true);
    setAddMode(false);
  };

  const startDragLane = (e: React.PointerEvent, lane: LaneName, idx: number) => {
    e.stopPropagation();
    (e.currentTarget as SVGElement).setPointerCapture(e.pointerId);
    dragging.current = { kind: "lane", lane, idx };
    didMove.current = false;
  };

  const startDragZone = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    (e.currentTarget as SVGElement).setPointerCapture(e.pointerId);
    dragging.current = { kind: "zone", id };
    didMove.current = false;
  };

  const onSvgPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    const pt = getSvgXY(e.clientX, e.clientY);
    if (!pt) return;
    didMove.current = true;

    if (dragging.current.kind === "lane") {
      const { lane, idx } = dragging.current;
      setLanes(p => ({
        ...p,
        [lane]: p[lane].map((wp, i) => i === idx ? pt : wp),
      }));
    } else {
      const { id } = dragging.current;
      setZones(zs => zs.map(z => z.id === id ? { ...z, cx: pt.x, cy: pt.y } : z));
    }
  };

  const onSvgPointerUp = (e: React.PointerEvent) => {
    const d = dragging.current;
    dragging.current = null;
    // If no movement it was a tap → select
    if (!didMove.current && d?.kind === "zone") {
      const id = d.id;
      if (selectedZoneId === id) {
        // second tap → start editing name
        const z = zones.find(z => z.id === id);
        if (z) { setNameInput(z.label); setEditingName(true); }
      } else {
        setSelectedZoneId(id);
        setEditingName(false);
      }
    }
  };

  const commitName = () => {
    if (!selectedZoneId) return;
    setZones(zs => zs.map(z => z.id === selectedZoneId ? { ...z, label: nameInput } : z));
    setEditingName(false);
  };

  const deleteZone = (id: string) => {
    setZones(zs => zs.filter(z => z.id !== id));
    if (selectedZoneId === id) setSelectedZoneId(null);
  };

  const resetAll = () => {
    setLanes(structuredClone(DEFAULT_LANES));
    setZones(structuredClone(DEFAULT_ZONES));
    setSelectedZoneId(null);
    setEditingName(false);
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
            Zones: drag to move, tap to select, tap again to rename · Lanes: drag dots
          </p>
        </DialogHeader>

        {/* Tab bar */}
        <div className="flex border-b border-border/30 shrink-0">
          {(["zones", "lanes"] as const).map(t => (
            <button key={t}
              onClick={() => setTab(t)}
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
            onPointerDown={addMode ? onSvgPointerDown : undefined}
            style={{ cursor: addMode ? "crosshair" : "default" }}
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
                      <circle cx={pt.x} cy={pt.y} r="5" fill="transparent"
                        style={{ cursor: "grab" }}
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
              return (
                <g key={zone.id}>
                  {/* Glow for selected */}
                  {isSelected && (
                    <circle cx={zone.cx} cy={zone.cy} r="6.5" fill={color} fillOpacity="0.25"
                      stroke={color} strokeWidth="0.8" vectorEffect="non-scaling-stroke"
                      style={{ pointerEvents: "none" }} />
                  )}
                  {/* Zone circle */}
                  <circle
                    cx={zone.cx} cy={zone.cy} r={isSelected ? "4.5" : "3.5"}
                    fill={color} fillOpacity={isSelected ? "0.9" : "0.7"}
                    stroke={isSelected ? "#fff" : "#000"}
                    strokeWidth={isSelected ? "0.7" : "0.3"}
                    vectorEffect="non-scaling-stroke"
                    style={{ cursor: "grab" }}
                    onPointerDown={e => startDragZone(e, zone.id)}
                    onPointerUp={e => onSvgPointerUp(e)}
                  />
                  {/* Label */}
                  <text x={zone.cx} y={zone.cy - 5.5} textAnchor="middle"
                    fontSize="3.5" fill="#fff" paintOrder="stroke"
                    stroke="#000" strokeWidth="1.2" strokeLinejoin="round"
                    style={{ pointerEvents: "none", userSelect: "none" }}>
                    {zone.label}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* ── Zone controls ── */}
        {tab === "zones" && (
          <div className="mx-3 mt-2 shrink-0 space-y-2">
            {/* Selected zone editor */}
            {selectedZone && (
              <div className="bg-black/40 border border-border/40 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground font-display uppercase tracking-wider">
                    Selected zone
                  </span>
                  <button onClick={() => deleteZone(selectedZone.id)}
                    className="flex items-center gap-1 text-[11px] text-red-400 hover:text-red-300 border border-red-400/30 px-2 py-1 rounded-md">
                    <Trash2 className="w-3 h-3" /> Delete
                  </button>
                </div>
                {editingName ? (
                  <div className="flex gap-2">
                    <Input autoFocus value={nameInput} onChange={e => setNameInput(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") commitName(); if (e.key === "Escape") setEditingName(false); }}
                      className="h-8 text-sm bg-black/40 border-border/50 flex-1" />
                    <button onClick={commitName} className="w-8 h-8 flex items-center justify-center rounded-md bg-primary/20 border border-primary/40 text-primary">
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => setEditingName(false)} className="w-8 h-8 flex items-center justify-center rounded-md border border-border/40 text-muted-foreground">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <button onClick={() => { setNameInput(selectedZone.label); setEditingName(true); }}
                    className="w-full text-left px-3 py-2 rounded-lg border border-border/40 text-sm text-white hover:border-primary/40 bg-black/20">
                    {selectedZone.label} <span className="text-muted-foreground text-xs ml-1">tap to rename</span>
                  </button>
                )}
                <p className="text-[10px] text-muted-foreground">
                  Position: ({selectedZone.cx}%, {selectedZone.cy}%)
                </p>
              </div>
            )}

            {/* Add zone button */}
            <button
              onClick={() => { setAddMode(a => !a); setSelectedZoneId(null); setEditingName(false); }}
              className={cn("w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border text-xs font-display tracking-wider transition-colors",
                addMode
                  ? "bg-primary/20 border-primary text-primary"
                  : "border-border/40 text-muted-foreground hover:border-primary/40 hover:text-primary bg-black/30")}>
              <Plus className="w-3.5 h-3.5" />
              {addMode ? "Tap on minimap to place zone…" : "Add New Zone"}
            </button>
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

        {/* Scrollable zone list (zones tab) */}
        {tab === "zones" && zones.length > 0 && (
          <div className="mx-3 mt-2 flex gap-1.5 flex-wrap max-h-20 overflow-y-auto shrink-0">
            {zones.map((z, i) => (
              <button key={z.id}
                onClick={() => { setSelectedZoneId(z.id); setEditingName(false); }}
                className={cn("text-[10px] px-2.5 py-1 rounded-full border transition-colors flex items-center gap-1.5",
                  selectedZoneId === z.id
                    ? "border-white/40 text-white bg-white/10"
                    : "border-border/30 text-muted-foreground hover:border-white/30")}>
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: zoneColor(i) }} />
                {z.label}
              </button>
            ))}
          </div>
        )}

        <div className="p-3 border-t border-border/30 flex gap-2 mt-auto shrink-0">
          <button onClick={resetAll}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-white border border-border/30 px-3 py-2 rounded-lg">
            <RotateCcw className="w-3 h-3" /> Reset all
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
