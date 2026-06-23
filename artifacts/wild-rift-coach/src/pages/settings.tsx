import { useCallback, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useListModels, ModelInfo } from "@workspace/api-client-react";
import { useModelStorage } from "@/hooks/use-model-storage";
import { ALL_CONFIG_KEYS } from "@/hooks/use-map-config";
import { useSystemPrompt, DEFAULT_SYSTEM_PROMPT } from "@/hooks/use-system-prompt";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown, Check, ArrowLeft, Settings2, Download, Upload, RotateCcw, Star, Search } from "lucide-react";
import { cn } from "@/lib/utils";

const FAV_MODELS_KEY = "wildrift_fav_models";

interface ModelRowProps {
  m: ModelInfo;
  isFav: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onToggleFav: () => void;
}

function ModelRow({ m, isFav, isSelected, onSelect, onToggleFav }: ModelRowProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-0 border-b border-border/20 active:bg-slate-700/40 transition-colors",
        isSelected && "bg-slate-800/60"
      )}
      style={{ minHeight: "60px" }}
    >
      {/* Star — large tap area, 56px wide */}
      <button
        onClick={e => { e.stopPropagation(); onToggleFav(); }}
        className="shrink-0 flex items-center justify-center"
        style={{ width: 56, minHeight: 60 }}
      >
        <Star className={cn("w-5 h-5", isFav ? "fill-amber-400 text-amber-400" : "text-muted-foreground/25")} />
      </button>

      {/* Label — tappable to select */}
      <div
        onClick={onSelect}
        className="flex-1 min-w-0 flex items-center justify-between pr-4 cursor-pointer"
        style={{ minHeight: 60 }}
      >
        <div className="min-w-0">
          <div className={cn("font-medium text-sm leading-snug", isSelected ? "text-primary" : "text-foreground")}>
            {m.name}
          </div>
          {m.pricing && (
            <div className="text-[11px] text-muted-foreground font-mono mt-0.5">{m.pricing.prompt}</div>
          )}
        </div>
        {isSelected && <Check className="w-5 h-5 text-primary shrink-0 ml-3" />}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const [model, setModel] = useModelStorage();
  const { data: models, isLoading } = useListModels();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const { prompt, save: savePrompt, reset: resetPrompt, isCustom } = useSystemPrompt();
  const [promptDraft, setPromptDraft] = useState(prompt);

  const [favModels, setFavModels] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(FAV_MODELS_KEY) ?? "[]"); } catch { return []; }
  });

  const toggleFavModel = useCallback((id: string) => {
    setFavModels(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      localStorage.setItem(FAV_MODELS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const handleSelect = useCallback((id: string) => {
    setModel(id === model ? null : id);
    setOpen(false);
    setSearch("");
  }, [model, setModel]);

  const selectedModel = useMemo(() => models?.find(m => m.id === model), [models, model]);

  const { favList, otherList } = useMemo(() => {
    const q = search.toLowerCase();
    const all = models ?? [];
    const filtered = q ? all.filter(m =>
      m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)
    ) : all;
    return {
      favList: filtered.filter(m => favModels.includes(m.id)),
      otherList: filtered.filter(m => !favModels.includes(m.id)),
    };
  }, [models, favModels, search]);

  const exportConfig = () => {
    const data: Record<string, unknown> = {};
    for (const key of ALL_CONFIG_KEYS) {
      const val = localStorage.getItem(key);
      if (val) {
        try { data[key] = JSON.parse(val); } catch { data[key] = val; }
      }
    }
    if (model) data["wildrift_model"] = model;
    const customPrompt = localStorage.getItem("wildrift_system_prompt");
    if (customPrompt) data["wildrift_system_prompt"] = customPrompt;
    const favs = localStorage.getItem(FAV_MODELS_KEY);
    if (favs) data[FAV_MODELS_KEY] = JSON.parse(favs);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "wildrift-coach-config.json"; a.click();
    URL.revokeObjectURL(url);
  };

  const importConfig = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const raw = JSON.parse(ev.target?.result as string) as Record<string, unknown>;
        let count = 0;
        for (const [key, value] of Object.entries(raw)) {
          localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
          count++;
        }
        setImportMsg(`✓ Imported ${count} setting${count !== 1 ? "s" : ""} — reload to apply`);
        setTimeout(() => window.location.reload(), 1200);
      } catch {
        setImportMsg("✗ Invalid config file");
        setTimeout(() => setImportMsg(null), 3000);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  return (
    <div className="min-h-screen bg-background text-foreground p-4 md:p-6 lg:p-8 flex justify-center">
      <div className="w-full max-w-2xl space-y-6">
        <header className="flex items-center gap-4 border-b border-border pb-4">
          <Link href="/">
            <Button variant="ghost" size="icon" className="shrink-0 text-muted-foreground hover:text-foreground">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-primary flex items-center gap-2">
              <Settings2 className="w-6 h-6" />
              Settings
            </h1>
            <p className="text-sm text-muted-foreground">Configure your tactical AI advisor</p>
          </div>
        </header>

        {/* ── AI Model ── */}
        <Card className="border-border bg-card/50 backdrop-blur-sm shadow-xl shadow-black/20">
          <CardHeader>
            <CardTitle className="text-xl">AI Model Selection</CardTitle>
            <CardDescription>
              Choose the OpenRouter model to power your macro advice. Star models to pin them at the top for quick access.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Favourite quick-picks */}
            {favList.length > 0 && !search && (
              <div className="flex flex-wrap gap-2">
                {(models?.filter(m => favModels.includes(m.id)) ?? []).map(m => (
                  <button
                    key={m.id}
                    onClick={() => { setModel(model === m.id ? null : m.id); }}
                    className={cn(
                      "flex items-center gap-1.5 text-xs px-3 py-2 rounded-full border transition-all active:scale-95",
                      model === m.id
                        ? "bg-slate-700 border-slate-400 text-white"
                        : "bg-black/30 border-border/40 text-muted-foreground hover:border-slate-400/60 hover:text-slate-300"
                    )}
                  >
                    <Star className={cn("w-3 h-3", model === m.id ? "fill-primary text-primary" : "fill-amber-400/60")} />
                    {m.name}
                  </button>
                ))}
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium leading-none">
                Select model
              </label>
              {isLoading ? (
                <Skeleton className="h-12 w-full" />
              ) : (
                <>
                  <Button
                    variant="outline"
                    onClick={() => setOpen(true)}
                    className="w-full justify-between h-12 bg-black/40 border-border hover:bg-black/60 hover:text-primary transition-colors text-base"
                  >
                    <span className="truncate">
                      {selectedModel ? selectedModel.name : "Search & select a model..."}
                    </span>
                    <ChevronDown className="ml-2 h-5 w-5 shrink-0 opacity-50" />
                  </Button>

                  {/* Dialog — always renders as a centered modal, immune to keyboard/viewport clipping */}
                  <Dialog open={open} onOpenChange={o => { setOpen(o); if (!o) setSearch(""); }}>
                    <DialogContent className="p-0 gap-0 bg-[#0b1120] border-border max-w-sm w-full flex flex-col" style={{ maxHeight: "75vh" }}>
                      <DialogHeader className="px-4 py-3 border-b border-border/50 shrink-0">
                        <DialogTitle className="text-sm font-display tracking-wider text-primary uppercase">
                          Select AI Model
                        </DialogTitle>
                      </DialogHeader>

                      {/* Search input */}
                      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/40 shrink-0 bg-[#0b1120]">
                        <Search className="w-4 h-4 text-muted-foreground shrink-0" />
                        <input
                          type="text"
                          value={search}
                          onChange={e => setSearch(e.target.value)}
                          placeholder="Search models..."
                          className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
                          autoComplete="off"
                          autoCorrect="off"
                          autoCapitalize="off"
                        />
                        {search && (
                          <button onClick={() => setSearch("")} className="text-muted-foreground text-lg leading-none px-1">×</button>
                        )}
                      </div>

                      {/* Model list — plain div, native iOS scroll */}
                      <div
                        className="flex-1 min-h-0 overflow-y-auto"
                        style={{ WebkitOverflowScrolling: "touch" } as React.CSSProperties}
                      >
                        {favList.length === 0 && otherList.length === 0 && (
                          <p className="text-center text-muted-foreground text-sm py-8">No models found</p>
                        )}
                        {favList.length > 0 && (
                          <>
                            <div className="px-4 py-2 text-[10px] tracking-widest uppercase text-muted-foreground/60 bg-black/20 sticky top-0">
                              ⭐ Favourites
                            </div>
                            {favList.map(m => (
                              <ModelRow
                                key={m.id}
                                m={m}
                                isFav={true}
                                isSelected={model === m.id}
                                onSelect={() => handleSelect(m.id)}
                                onToggleFav={() => toggleFavModel(m.id)}
                              />
                            ))}
                          </>
                        )}
                        {otherList.length > 0 && (
                          <>
                            {favList.length > 0 && (
                              <div className="px-4 py-2 text-[10px] tracking-widest uppercase text-muted-foreground/60 bg-black/20 sticky top-0">
                                All models
                              </div>
                            )}
                            {otherList.map(m => (
                              <ModelRow
                                key={m.id}
                                m={m}
                                isFav={false}
                                isSelected={model === m.id}
                                onSelect={() => handleSelect(m.id)}
                                onToggleFav={() => toggleFavModel(m.id)}
                              />
                            ))}
                          </>
                        )}
                      </div>
                    </DialogContent>
                  </Dialog>
                </>
              )}
              {!model && !isLoading && (
                <p className="text-sm text-destructive font-medium mt-2">
                  You must select a model to receive advice.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ── AI Instructions ── */}
        <Card className="border-border bg-card/50 backdrop-blur-sm shadow-xl shadow-black/20">
          <CardHeader>
            <CardTitle className="text-xl flex items-center justify-between">
              AI Instructions
              {isCustom && (
                <span className="text-xs font-normal text-amber-400 bg-amber-400/10 border border-amber-400/30 px-2 py-0.5 rounded-full">
                  customised
                </span>
              )}
            </CardTitle>
            <CardDescription>
              The system prompt sent to the AI before every analysis. Edit to give the AI extra context,
              change its tone, or add your own rules. Revert to restore the default.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <textarea
              className="w-full min-h-[280px] bg-black/40 border border-border/60 rounded-lg p-3 text-sm font-mono text-foreground resize-y focus:outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/30 leading-relaxed"
              value={promptDraft}
              onChange={e => setPromptDraft(e.target.value)}
              spellCheck={false}
            />
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex items-center gap-2"
                onClick={() => { setPromptDraft(DEFAULT_SYSTEM_PROMPT); resetPrompt(); }}
              >
                <RotateCcw className="w-3.5 h-3.5" /> Revert to default
              </Button>
              <Button
                className="flex-1"
                disabled={promptDraft === prompt}
                onClick={() => savePrompt(promptDraft)}
              >
                Save instructions
              </Button>
            </div>
            {promptDraft !== prompt && (
              <p className="text-xs text-amber-400/80">Unsaved changes — hit Save to apply.</p>
            )}
          </CardContent>
        </Card>

        {/* ── Config Backup ── */}
        <Card className="border-border bg-card/50 backdrop-blur-sm shadow-xl shadow-black/20">
          <CardHeader>
            <CardTitle className="text-xl">Config Backup</CardTitle>
            <CardDescription>
              Export all settings (zones, lanes, crop, favorites, model) as a JSON file.
              Import on another device to restore everything instantly.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-3">
              <Button onClick={exportConfig} className="flex items-center gap-2 flex-1">
                <Download className="w-4 h-4" /> Export Settings
              </Button>
              <Button variant="outline" className="flex items-center gap-2 flex-1"
                onClick={() => importRef.current?.click()}>
                <Upload className="w-4 h-4" /> Import Settings
              </Button>
              <input ref={importRef} type="file" accept=".json" className="hidden" onChange={importConfig} />
            </div>
            {importMsg && (
              <p className={cn("text-sm font-medium", importMsg.startsWith("✓") ? "text-emerald-400" : "text-destructive")}>
                {importMsg}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Exported file includes: crop calibration, zone polygons, lane waypoints, favourite champions, favourite models, and selected model.
              It does NOT include game session data (screenshots, pins, advice).
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
