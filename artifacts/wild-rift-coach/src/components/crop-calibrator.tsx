import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CropConfig, DEFAULT_CROP } from "@/hooks/use-map-config";
import { RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  screenshot: string;
  current: CropConfig;
  onSave: (c: CropConfig) => void;
  onClose: () => void;
}

function SliderRow({
  label, value, min, max, step = 1, unit = "%",
  onChange,
}: {
  label: string; value: number; min: number; max: number; step?: number;
  unit?: string; onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center">
        <span className="text-[11px] font-display uppercase tracking-wider text-muted-foreground">{label}</span>
        <span className="text-xs font-mono text-primary font-bold">{value}{unit}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full accent-primary h-1.5 rounded-full cursor-pointer"
      />
    </div>
  );
}

export function CropCalibrator({ screenshot, current, onSave, onClose }: Props) {
  const [cfg, setCfg] = useState<CropConfig>(current);

  const update = (key: keyof CropConfig) => (v: number) =>
    setCfg(p => ({ ...p, [key]: v }));

  const right = cfg.x + cfg.w;
  const bottom = cfg.y + cfg.h;
  const overflow = right > 100 || bottom > 100;

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm w-full bg-[#0b1120] border-border p-0 gap-0 max-h-[90vh] flex flex-col">
        <DialogHeader className="px-4 py-3 border-b border-border/50 shrink-0">
          <DialogTitle className="text-sm font-display tracking-wider text-primary uppercase">
            Set Minimap Crop Area
          </DialogTitle>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Adjust the yellow box until it covers exactly your minimap.
            This saves and is used for every future screenshot.
          </p>
        </DialogHeader>

        {/* Screenshot preview with crop box */}
        <div className="relative mx-3 mt-3 rounded-lg overflow-hidden border border-border/40 shrink-0">
          <img src={screenshot} alt="Screenshot" className="w-full h-auto block select-none" draggable={false} />
          {/* Dark overlay outside crop */}
          <div className="absolute inset-0 pointer-events-none">
            {/* top */}
            <div className="absolute top-0 left-0 right-0 bg-black/60" style={{ height: `${cfg.y}%` }} />
            {/* bottom */}
            <div className="absolute bottom-0 left-0 right-0 bg-black/60" style={{ height: `${100 - bottom}%` }} />
            {/* left */}
            <div className="absolute bg-black/60" style={{ top: `${cfg.y}%`, left: 0, width: `${cfg.x}%`, height: `${cfg.h}%` }} />
            {/* right */}
            <div className="absolute bg-black/60" style={{ top: `${cfg.y}%`, right: 0, width: `${100 - right}%`, height: `${cfg.h}%` }} />
            {/* crop border */}
            <div
              className={cn("absolute border-2", overflow ? "border-red-400" : "border-yellow-400")}
              style={{ left: `${cfg.x}%`, top: `${cfg.y}%`, width: `${cfg.w}%`, height: `${cfg.h}%` }}
            >
              {/* corner handles */}
              {["top-0 left-0","top-0 right-0","bottom-0 left-0","bottom-0 right-0"].map(pos => (
                <div key={pos} className={cn("absolute w-3 h-3 border-2 border-yellow-400 bg-yellow-400/20", pos,
                  pos.includes("right") ? "-translate-x-full" : "translate-x-0",
                  pos.includes("bottom") ? "-translate-y-full" : "translate-y-0",
                )} />
              ))}
            </div>
          </div>
        </div>

        {overflow && (
          <p className="text-[11px] text-red-400 text-center mt-1 shrink-0">
            Crop box exceeds image bounds — reduce left/top or width/height
          </p>
        )}

        {/* Sliders */}
        <div className="p-4 space-y-4 overflow-y-auto flex-1">
          <SliderRow label="Left edge"  value={cfg.x} min={0} max={80} onChange={update("x")} />
          <SliderRow label="Top edge"   value={cfg.y} min={0} max={80} onChange={update("y")} />
          <SliderRow label="Width"      value={cfg.w} min={5} max={70} onChange={update("w")} />
          <SliderRow label="Height"     value={cfg.h} min={5} max={70} onChange={update("h")} />

          {/* Cropped preview */}
          <div className="space-y-1.5">
            <span className="text-[11px] font-display uppercase tracking-wider text-muted-foreground">
              Cropped preview
            </span>
            <div className="rounded-lg overflow-hidden border border-border/40 bg-black/40">
              <div
                className="w-full overflow-hidden"
                style={{ paddingBottom: `${(cfg.h / cfg.w) * 100}%`, position: "relative" }}
              >
                <img
                  src={screenshot}
                  alt="Crop preview"
                  className="absolute inset-0 w-full h-full select-none"
                  style={{
                    objectFit: "none",
                    objectPosition: `-${cfg.x}% -${cfg.y}%`,
                    width: `${100 / (cfg.w / 100)}%`,
                    height: `${100 / (cfg.h / 100)}%`,
                    transform: `translate(${-cfg.x / cfg.w * 100}%, ${-cfg.y / cfg.h * 100}%)`,
                  }}
                  draggable={false}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="p-3 border-t border-border/30 flex gap-2 shrink-0">
          <button
            onClick={() => setCfg(DEFAULT_CROP)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-white border border-border/30 px-3 py-2 rounded-lg"
          >
            <RotateCcw className="w-3 h-3" /> Reset
          </button>
          <Button variant="outline" className="flex-1 h-10" onClick={onClose}>Cancel</Button>
          <Button className="flex-1 h-10 font-display tracking-wider" disabled={overflow}
            onClick={() => { onSave(cfg); onClose(); }}>
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
