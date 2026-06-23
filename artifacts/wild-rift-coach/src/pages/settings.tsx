import { useRef, useState } from "react";
import { Link } from "wouter";
import { useListModels } from "@workspace/api-client-react";
import { useModelStorage } from "@/hooks/use-model-storage";
import { ALL_CONFIG_KEYS } from "@/hooks/use-map-config";
import { useSystemPrompt, DEFAULT_SYSTEM_PROMPT } from "@/hooks/use-system-prompt";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown, Check, ArrowLeft, Settings2, Download, Upload, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

export default function SettingsPage() {
  const [model, setModel] = useModelStorage();
  const { data: models, isLoading } = useListModels();
  const [open, setOpen] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const { prompt, save: savePrompt, reset: resetPrompt, isCustom } = useSystemPrompt();
  const [promptDraft, setPromptDraft] = useState(prompt);

  const selectedModel = models?.find(m => m.id === model);

  const exportConfig = () => {
    const data: Record<string, unknown> = {};
    for (const key of ALL_CONFIG_KEYS) {
      const val = localStorage.getItem(key);
      if (val) {
        try { data[key] = JSON.parse(val); } catch { data[key] = val; }
      }
    }
    if (model) data["wildrift_model"] = model;
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
              Choose the OpenRouter model to power your macro advice.
              Models with larger context windows are recommended for full game state analysis.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                Primary Model
              </label>
              {isLoading ? (
                <Skeleton className="h-10 w-full" />
              ) : (
                <Popover open={open} onOpenChange={setOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={open}
                      className="w-full justify-between bg-black/40 border-border hover:bg-black/60 hover:text-primary transition-colors"
                    >
                      <span className="truncate">
                        {selectedModel ? selectedModel.name : "Select a model..."}
                      </span>
                      <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0 border-border bg-card/95 backdrop-blur-xl shadow-2xl">
                    <Command className="bg-transparent">
                      <CommandInput placeholder="Search models..." className="border-none focus:ring-0" />
                      <CommandList className="max-h-[300px] overflow-y-auto">
                        <CommandEmpty>No model found.</CommandEmpty>
                        <CommandGroup>
                          {models?.map((m) => (
                            <CommandItem
                              key={m.id}
                              value={m.id}
                              onSelect={(currentValue) => {
                                setModel(currentValue === model ? null : currentValue);
                                setOpen(false);
                              }}
                              className="flex items-start justify-between py-3 cursor-pointer"
                            >
                              <div className="flex flex-col gap-1 pr-4">
                                <span className={cn("font-medium", model === m.id ? "text-primary" : "text-foreground")}>
                                  {m.name}
                                </span>
                                {m.description && (
                                  <span className="text-xs text-muted-foreground line-clamp-2">
                                    {m.description}
                                  </span>
                                )}
                              </div>
                              <div className="flex flex-col items-end gap-1 shrink-0">
                                <Check className={cn("h-4 w-4 text-primary", model === m.id ? "opacity-100" : "opacity-0")} />
                                {m.pricing && (
                                  <span className="text-[10px] text-muted-foreground font-mono">
                                    {m.pricing.prompt}
                                  </span>
                                )}
                              </div>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
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
              Exported file includes: crop calibration, zone polygons, lane waypoints, favourite champions, and selected model.
              It does NOT include game session data (screenshots, pins, advice).
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
