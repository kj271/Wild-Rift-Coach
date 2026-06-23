import { useState, useRef, useCallback } from "react";
import { Link } from "wouter";
import { useModelStorage } from "@/hooks/use-model-storage";
import {
  GameContext,
  useCreateOpenrouterConversation,
  useListOpenrouterConversations,
  useGetOpenrouterConversation,
  getGetOpenrouterConversationQueryKey,
  getListOpenrouterConversationsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Target, Settings, AlertCircle, Loader2, Send, Upload, MessageSquare, X, Search, ChevronDown, ChevronUp
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Wild Rift champion roster ────────────────────────────────────────────────
const CHAMPIONS = [
  "Ahri","Akali","Akshan","Alistar","Amumu","Annie","Ashe","Aurelion Sol",
  "Blitzcrank","Brand","Braum","Camille","Corki","Darius","Diana","Dr. Mundo",
  "Draven","Ekko","Evelynn","Ezreal","Fiora","Fizz","Galio","Garen","Gragas",
  "Graves","Irelia","Janna","Jarvan IV","Jax","Jayce","Jinx","Kai'Sa","Karma",
  "Katarina","Kennen","Kha'Zix","Kog'Maw","Lee Sin","Leona","Lucian","Lulu",
  "Lux","Malphite","Malzahar","Master Yi","Miss Fortune","Nami","Nasus",
  "Nunu","Olaf","Orianna","Pantheon","Riven","Seraphine","Sett","Singed",
  "Sona","Soraka","Teemo","Thresh","Tristana","Tryndamere","Twisted Fate",
  "Twitch","Varus","Vayne","Veigar","Vi","Viego","Vladimir","Wukong","Xayah",
  "Xin Zhao","Yasuo","Yone","Yuumi","Zed","Ziggs","Zilean","Zoe","Zyra",
];

const ROLES = ["Top","Jungle","Mid","ADC","Support"] as const;
type Role = typeof ROLES[number];

const LOCATIONS = [
  "Top Lane","Mid Lane","Bot Lane","Dragon Pit","Baron Pit",
  "Jungle","River","Base","Turret",
] as const;
type Location = typeof LOCATIONS[number];

type ObjStatus = "up" | "down";

interface ChampionPickerProps {
  open: boolean;
  title: string;
  selected: string[];
  max: number;
  onClose: () => void;
  onSelect: (champs: string[]) => void;
}

function ChampionPicker({ open, title, selected, max, onClose, onSelect }: ChampionPickerProps) {
  const [search, setSearch] = useState("");
  const filtered = CHAMPIONS.filter(c => c.toLowerCase().includes(search.toLowerCase()));

  const toggle = (c: string) => {
    if (selected.includes(c)) {
      onSelect(selected.filter(s => s !== c));
    } else if (selected.length < max) {
      onSelect([...selected, c]);
    }
  };

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm w-full bg-[#0b1120] border-border p-0 gap-0 max-h-[80vh] flex flex-col">
        <DialogHeader className="p-4 border-b border-border/50 shrink-0">
          <DialogTitle className="text-sm font-display tracking-wider text-primary uppercase">
            {title}
            {max > 1 && <span className="text-muted-foreground font-normal ml-2">({selected.length}/{max})</span>}
          </DialogTitle>
        </DialogHeader>
        <div className="p-3 border-b border-border/30 shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              autoFocus
              placeholder="Search champion..."
              className="pl-9 h-9 bg-black/40 border-border/50 text-sm"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>
        {selected.length > 0 && (
          <div className="px-3 pt-2 pb-1 flex flex-wrap gap-1.5 shrink-0">
            {selected.map(c => (
              <button
                key={c}
                onClick={() => toggle(c)}
                className="text-xs px-2.5 py-1 rounded-full bg-primary/20 text-primary border border-primary/40 flex items-center gap-1.5 active:scale-95 transition-transform"
              >
                {c} <X className="w-3 h-3" />
              </button>
            ))}
          </div>
        )}
        <div className="overflow-y-auto flex-1 p-2">
          <div className="grid grid-cols-3 gap-1.5">
            {filtered.map(c => {
              const sel = selected.includes(c);
              const full = !sel && selected.length >= max;
              return (
                <button
                  key={c}
                  onClick={() => toggle(c)}
                  disabled={full}
                  className={cn(
                    "rounded-md px-2 py-2.5 text-xs font-medium text-center transition-all active:scale-95",
                    sel
                      ? "bg-primary/25 text-primary border border-primary/50 shadow-[0_0_8px_rgba(var(--primary),0.2)]"
                      : full
                        ? "bg-black/20 text-muted-foreground/40 border border-border/20 cursor-not-allowed"
                        : "bg-black/30 text-slate-300 border border-border/30 hover:border-primary/30 hover:text-primary hover:bg-primary/10"
                  )}
                >
                  {c}
                </button>
              );
            })}
          </div>
          {filtered.length === 0 && (
            <p className="text-center text-muted-foreground text-xs py-8">No champions found</p>
          )}
        </div>
        <div className="p-3 border-t border-border/30 shrink-0">
          <Button className="w-full h-10 font-display tracking-wider" onClick={onClose}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Slot button for champion slots ───────────────────────────────────────────
function ChampSlot({ champ, onClick, accent = false }: { champ: string | null; onClick: () => void; accent?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border transition-all active:scale-95 py-2 px-1 text-center min-w-0",
        champ
          ? accent
            ? "bg-accent/10 border-accent/40 text-accent"
            : "bg-primary/10 border-primary/30 text-primary"
          : "bg-black/30 border-border/30 text-muted-foreground hover:border-primary/30"
      )}
    >
      {champ ? (
        <span className="text-[10px] leading-tight font-semibold break-words w-full">{champ}</span>
      ) : (
        <span className="text-[10px] text-muted-foreground/50">+ Pick</span>
      )}
    </button>
  );
}

// ── Objective toggle ─────────────────────────────────────────────────────────
function ObjToggle({
  label, value, onChange, color = "primary"
}: { label: string; value: ObjStatus | null; onChange: (v: ObjStatus | null) => void; color?: "primary" | "accent" | "red" }) {
  const colors = {
    primary: { on: "bg-primary/20 border-primary text-primary", off: "bg-black/30 border-border/40 text-muted-foreground hover:border-primary/40" },
    accent:  { on: "bg-accent/20 border-accent text-accent", off: "bg-black/30 border-border/40 text-muted-foreground hover:border-accent/40" },
    red:     { on: "bg-red-500/20 border-red-500 text-red-400", off: "bg-black/30 border-border/40 text-muted-foreground hover:border-red-400/40" },
  }[color];

  const tap = (v: ObjStatus) => onChange(value === v ? null : v);

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-display uppercase tracking-wider text-muted-foreground/70 text-center">{label}</span>
      <div className="flex gap-1">
        <button
          onClick={() => tap("up")}
          className={cn("flex-1 text-xs font-bold py-1.5 rounded border transition-all active:scale-95", value === "up" ? colors.on : colors.off)}
        >
          UP
        </button>
        <button
          onClick={() => tap("down")}
          className={cn("flex-1 text-xs font-bold py-1.5 rounded border transition-all active:scale-95", value === "down" ? "bg-red-500/20 border-red-500 text-red-400" : colors.off)}
        >
          DOWN
        </button>
      </div>
    </div>
  );
}

// ── Inline streaming chat line ────────────────────────────────────────────────
interface StreamingMsg { role: "user" | "assistant"; content: string; streaming?: boolean }

export default function CoachPage() {
  const queryClient = useQueryClient();
  const [model] = useModelStorage();

  // ── Screenshot ──────────────────────────────────────────────────────────────
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Context state ───────────────────────────────────────────────────────────
  const [gameTimeSecs, setGameTimeSecs] = useState(0);
  const [myRole, setMyRole] = useState<Role | null>(null);
  const [location, setLocation] = useState<Location | null>(null);
  const [myChamp, setMyChamp] = useState<string | null>(null);
  const [allies, setAllies] = useState<string[]>([]);
  const [enemies, setEnemies] = useState<string[]>([]);
  const [dragon, setDragon] = useState<ObjStatus | null>(null);
  const [baron, setBaron] = useState<ObjStatus | null>(null);
  const [herald, setHerald] = useState<ObjStatus | null>(null);

  // ── Champion picker state ───────────────────────────────────────────────────
  type PickerTarget = "myChamp" | "allies" | "enemies" | null;
  const [picker, setPicker] = useState<PickerTarget>(null);

  // ── Advice ──────────────────────────────────────────────────────────────────
  const [advice, setAdvice] = useState("");
  const [isAdvising, setIsAdvising] = useState(false);
  const [contextOpen, setContextOpen] = useState(true);

  // ── Chat ─────────────────────────────────────────────────────────────────────
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null);
  const [chatMessages, setChatMessages] = useState<StreamingMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isChatting, setIsChatting] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const { data: conversations } = useListOpenrouterConversations();
  const { data: conversationData } = useGetOpenrouterConversation(
    activeConversationId as number,
    { query: { enabled: !!activeConversationId, queryKey: getGetOpenrouterConversationQueryKey(activeConversationId as number) } }
  );
  const createConversation = useCreateOpenrouterConversation();

  // ── Format time ─────────────────────────────────────────────────────────────
  const formatTime = (secs: number) => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;

  // ── Build context for API ───────────────────────────────────────────────────
  const buildContext = useCallback((): GameContext => ({
    gameTime: gameTimeSecs > 0 ? formatTime(gameTimeSecs) : null,
    myRole: myRole ?? null,
    myLocation: location ?? null,
    allyChampions: allies.length ? allies.join(", ") : null,
    enemyChampions: enemies.length ? enemies.join(", ") : null,
    dragonStatus: dragon ?? null,
    baronStatus: baron ?? null,
    riftHeraldStatus: herald ?? null,
    goldDiff: null,
    score: null,
    additionalNotes: myChamp ? `I am playing ${myChamp}` : null,
  }), [gameTimeSecs, myRole, location, allies, enemies, dragon, baron, herald, myChamp]);

  // ── File upload ─────────────────────────────────────────────────────────────
  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = e => {
      const result = e.target?.result as string;
      if (result) setImageBase64(result);
    };
    reader.readAsDataURL(file);
  };

  // ── Get advice ──────────────────────────────────────────────────────────────
  const getAdvice = async () => {
    if (!model) return;
    setIsAdvising(true);
    setAdvice("");
    try {
      const BASE = import.meta.env.BASE_URL;
      const base64Data = imageBase64?.split(",")[1] ?? null;
      const res = await fetch(`${BASE}api/coach/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, imageBase64: base64Data, context: buildContext() }),
      });
      if (!res.ok) throw new Error("API error");
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const d = JSON.parse(line.slice(6));
            if (d.content) setAdvice(p => p + d.content);
            if (d.done && !activeConversationId) {
              const conv = await createConversation.mutateAsync({ data: { title: `Game ${formatTime(gameTimeSecs)}`, model } });
              setActiveConversationId(conv.id);
              queryClient.invalidateQueries({ queryKey: getListOpenrouterConversationsQueryKey() });
            }
          } catch {}
        }
      }
    } catch {
      setAdvice("Error getting advice. Check your model in Settings and try again.");
    } finally {
      setIsAdvising(false);
    }
  };

  // ── Send chat ────────────────────────────────────────────────────────────────
  const sendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !model) return;

    let convId = activeConversationId;
    if (!convId) {
      const conv = await createConversation.mutateAsync({ data: { title: `Game ${formatTime(gameTimeSecs)}`, model } });
      convId = conv.id;
      setActiveConversationId(conv.id);
      queryClient.invalidateQueries({ queryKey: getListOpenrouterConversationsQueryKey() });
    }

    const msg = chatInput.trim();
    setChatInput("");
    setIsChatting(true);
    setChatMessages(p => [...p, { role: "user", content: msg }, { role: "assistant", content: "", streaming: true }]);

    try {
      const BASE = import.meta.env.BASE_URL;
      const res = await fetch(`${BASE}api/openrouter/conversations/${convId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: msg, model, context: buildContext() }),
      });
      if (!res.ok) throw new Error("API error");
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const d = JSON.parse(line.slice(6));
            if (d.content) {
              setChatMessages(p => {
                const next = [...p];
                const last = next[next.length - 1];
                if (last && last.streaming) last.content += d.content;
                return next;
              });
              chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
            }
            if (d.done) {
              setChatMessages(p => p.map((m, i) => i === p.length - 1 ? { ...m, streaming: false } : m));
              queryClient.invalidateQueries({ queryKey: getGetOpenrouterConversationQueryKey(convId!) });
            }
          } catch {}
        }
      }
    } catch {
      setChatMessages(p => p.map((m, i) => i === p.length - 1 ? { ...m, content: "Error — try again.", streaming: false } : m));
    } finally {
      setIsChatting(false);
    }
  };

  const hasContext = myChamp || allies.length || enemies.length || myRole || location || dragon || baron || herald || gameTimeSecs > 0;
  const canAdvise = !!model && !isAdvising && (!!imageBase64 || hasContext);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-background/90 backdrop-blur border-b border-border/40">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
          <h1 className="font-display text-lg font-bold tracking-tight">
            MACRO<span className="text-primary">COACH</span>
          </h1>
          <Link href="/settings">
            <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-white">
              <Settings className="w-5 h-5" />
            </Button>
          </Link>
        </div>
      </header>

      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-4 space-y-4">

        {/* No model warning */}
        {!model && (
          <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3 flex items-start gap-3">
            <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            <div className="text-sm">
              <span className="font-semibold text-destructive">No AI model selected.</span>
              <Link href="/settings">
                <span className="ml-2 underline text-destructive/80 cursor-pointer">Go to Settings</span>
              </Link>
            </div>
          </div>
        )}

        {/* Screenshot upload */}
        <div
          className={cn(
            "relative rounded-lg border-2 border-dashed transition-colors cursor-pointer overflow-hidden",
            imageBase64 ? "border-primary/40 h-36" : "border-border/40 hover:border-primary/30 h-24 flex items-center justify-center"
          )}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
        >
          {imageBase64 ? (
            <>
              <img src={imageBase64} alt="Screenshot" className="absolute inset-0 w-full h-full object-cover opacity-50" />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="bg-black/60 rounded-lg px-3 py-1.5 flex items-center gap-2 text-xs text-white border border-white/20">
                  <Upload className="w-3 h-3" /> Tap to change screenshot
                </div>
              </div>
              <button
                className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/70 border border-white/20 flex items-center justify-center text-white hover:bg-red-500/30"
                onClick={e => { e.stopPropagation(); setImageBase64(null); }}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </>
          ) : (
            <div className="flex flex-col items-center gap-1 text-muted-foreground">
              <Upload className="w-5 h-5" />
              <span className="text-xs">Tap to upload screenshot (optional)</span>
            </div>
          )}
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
        </div>

        {/* Context panel */}
        <div className="bg-card/40 border border-border/40 rounded-xl overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-display tracking-wider uppercase text-muted-foreground"
            onClick={() => setContextOpen(o => !o)}
          >
            <span className="flex items-center gap-2">
              Game Context
              {hasContext && <span className="w-2 h-2 rounded-full bg-primary inline-block" />}
            </span>
            {contextOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          {contextOpen && (
            <div className="px-4 pb-4 space-y-5 border-t border-border/30">

              {/* Game time slider */}
              <div className="pt-4">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs text-muted-foreground uppercase tracking-wider font-display">Game Time</span>
                  <span className="font-display text-primary text-base font-bold">{formatTime(gameTimeSecs)}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1800}
                  step={30}
                  value={gameTimeSecs}
                  onChange={e => setGameTimeSecs(Number(e.target.value))}
                  className="w-full accent-primary h-2 rounded-full cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground/50 mt-1">
                  <span>0:00</span><span>10:00</span><span>20:00</span><span>30:00</span>
                </div>
              </div>

              {/* My champion */}
              <div>
                <span className="text-xs text-muted-foreground uppercase tracking-wider font-display">My Champion</span>
                <div className="mt-2">
                  <button
                    onClick={() => setPicker("myChamp")}
                    className={cn(
                      "w-full py-2.5 rounded-lg border text-sm font-medium transition-all active:scale-[0.98]",
                      myChamp
                        ? "bg-accent/15 border-accent/50 text-accent"
                        : "bg-black/30 border-border/40 text-muted-foreground hover:border-accent/40"
                    )}
                  >
                    {myChamp ?? "+ Select your champion"}
                    {myChamp && <span className="ml-2 text-xs opacity-60">(tap to change)</span>}
                  </button>
                </div>
              </div>

              {/* Role */}
              <div>
                <span className="text-xs text-muted-foreground uppercase tracking-wider font-display">Role</span>
                <div className="flex gap-2 mt-2 flex-wrap">
                  {ROLES.map(r => (
                    <button
                      key={r}
                      onClick={() => setMyRole(myRole === r ? null : r)}
                      className={cn(
                        "flex-1 min-w-0 py-2 rounded-lg text-xs font-bold border transition-all active:scale-95 font-display tracking-wide",
                        myRole === r
                          ? "bg-primary/20 border-primary text-primary shadow-[0_0_10px_rgba(var(--primary),0.2)]"
                          : "bg-black/30 border-border/40 text-muted-foreground hover:border-primary/30"
                      )}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              {/* Location */}
              <div>
                <span className="text-xs text-muted-foreground uppercase tracking-wider font-display">My Location</span>
                <div className="flex gap-2 mt-2 flex-wrap">
                  {LOCATIONS.map(loc => (
                    <button
                      key={loc}
                      onClick={() => setLocation(location === loc ? null : loc)}
                      className={cn(
                        "px-3 py-1.5 rounded-full text-xs font-medium border transition-all active:scale-95",
                        location === loc
                          ? "bg-primary/20 border-primary text-primary"
                          : "bg-black/30 border-border/40 text-muted-foreground hover:border-primary/30 hover:text-slate-300"
                      )}
                    >
                      {loc}
                    </button>
                  ))}
                </div>
              </div>

              {/* Allies */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-muted-foreground uppercase tracking-wider font-display">Allies <span className="text-primary">{allies.length}/4</span></span>
                  {allies.length > 0 && (
                    <button className="text-[10px] text-muted-foreground hover:text-white" onClick={() => setAllies([])}>Clear</button>
                  )}
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {[0, 1, 2, 3].map(i => (
                    <ChampSlot
                      key={i}
                      champ={allies[i] ?? null}
                      onClick={() => setPicker("allies")}
                    />
                  ))}
                </div>
              </div>

              {/* Enemies */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-muted-foreground uppercase tracking-wider font-display">Enemies <span className="text-red-400">{enemies.length}/5</span></span>
                  {enemies.length > 0 && (
                    <button className="text-[10px] text-muted-foreground hover:text-white" onClick={() => setEnemies([])}>Clear</button>
                  )}
                </div>
                <div className="grid grid-cols-5 gap-2">
                  {[0, 1, 2, 3, 4].map(i => (
                    <ChampSlot
                      key={i}
                      champ={enemies[i] ?? null}
                      onClick={() => setPicker("enemies")}
                      accent
                    />
                  ))}
                </div>
              </div>

              {/* Objectives */}
              <div>
                <span className="text-xs text-muted-foreground uppercase tracking-wider font-display">Objectives</span>
                <div className="grid grid-cols-3 gap-3 mt-2">
                  <ObjToggle label="Dragon" value={dragon} onChange={setDragon} color="accent" />
                  <ObjToggle label="Baron" value={baron} onChange={setBaron} color="primary" />
                  <ObjToggle label="Herald" value={herald} onChange={setHerald} color="red" />
                </div>
              </div>

            </div>
          )}
        </div>

        {/* ADVISE ME */}
        <button
          onClick={getAdvice}
          disabled={!canAdvise}
          className={cn(
            "w-full h-16 rounded-xl font-display text-xl font-bold tracking-widest uppercase transition-all relative overflow-hidden",
            canAdvise
              ? "bg-primary text-primary-foreground shadow-[0_0_30px_rgba(0,160,210,0.35)] hover:shadow-[0_0_45px_rgba(0,160,210,0.5)] active:scale-[0.98]"
              : "bg-muted text-muted-foreground cursor-not-allowed"
          )}
        >
          {isAdvising ? (
            <span className="flex items-center justify-center gap-3">
              <Loader2 className="w-5 h-5 animate-spin" /> Analyzing...
            </span>
          ) : (
            <span className="flex items-center justify-center gap-3">
              <Target className="w-5 h-5" /> Advise Me
            </span>
          )}
          {canAdvise && !isAdvising && (
            <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full animate-[shimmer_2.5s_infinite]" />
          )}
        </button>

        {/* Advice output */}
        {(advice || isAdvising) && (
          <div className="bg-card/60 border border-primary/30 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 bg-primary/5 border-b border-primary/20 flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              <span className="font-display text-xs tracking-widest uppercase text-primary">Tactical Read</span>
            </div>
            <div className="p-4">
              {advice ? (
                <div className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">{advice}</div>
              ) : (
                <div className="space-y-3">
                  <Skeleton className="h-4 w-3/4 bg-primary/10" />
                  <Skeleton className="h-4 w-full bg-primary/10" />
                  <Skeleton className="h-4 w-5/6 bg-primary/10" />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Chat */}
        <div className="bg-card/40 border border-border/40 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border/30 flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-primary" />
            <span className="font-display text-xs tracking-widest uppercase text-muted-foreground">Ask Follow-up</span>
          </div>

          {/* Past sessions */}
          {conversations && conversations.length > 0 && (
            <div className="flex gap-2 px-3 py-2 overflow-x-auto border-b border-border/20">
              {conversations.map(c => (
                <button
                  key={c.id}
                  onClick={() => {
                    setActiveConversationId(c.id);
                    setChatMessages([]);
                  }}
                  className={cn(
                    "shrink-0 text-xs px-3 py-1.5 rounded-full border transition-all",
                    activeConversationId === c.id
                      ? "bg-primary/20 border-primary text-primary"
                      : "bg-black/30 border-border/40 text-muted-foreground"
                  )}
                >
                  {c.title}
                </button>
              ))}
            </div>
          )}

          {/* Messages */}
          {(chatMessages.length > 0 || (conversationData?.messages?.length ?? 0) > 0) && (
            <div className="max-h-80 overflow-y-auto p-3 space-y-3">
              {(conversationData?.messages ?? [])
                .filter(m => !chatMessages.some(cm => cm.content === m.content && cm.role === m.role))
                .map(m => (
                  <div key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                    <div className={cn(
                      "max-w-[85%] px-3 py-2 rounded-lg text-sm",
                      m.role === "user"
                        ? "bg-primary text-primary-foreground rounded-tr-none"
                        : "bg-muted text-foreground border border-border rounded-tl-none"
                    )}>
                      {m.content}
                    </div>
                  </div>
                ))}
              {chatMessages.map((m, i) => (
                <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                  <div className={cn(
                    "max-w-[85%] px-3 py-2 rounded-lg text-sm whitespace-pre-wrap",
                    m.role === "user"
                      ? "bg-primary text-primary-foreground rounded-tr-none"
                      : "bg-muted text-foreground border border-border rounded-tl-none"
                  )}>
                    {m.content}
                    {m.streaming && m.content === "" && (
                      <span className="inline-flex gap-1 ml-1">
                        <span className="w-1.5 h-1.5 bg-current rounded-full animate-bounce [animation-delay:0ms]" />
                        <span className="w-1.5 h-1.5 bg-current rounded-full animate-bounce [animation-delay:150ms]" />
                        <span className="w-1.5 h-1.5 bg-current rounded-full animate-bounce [animation-delay:300ms]" />
                      </span>
                    )}
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
          )}

          <div className="p-3 border-t border-border/20">
            <form onSubmit={sendChat} className="flex gap-2">
              <Input
                placeholder="Ask anything about the situation..."
                className="bg-black/40 border-border/50 text-sm h-10"
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                disabled={isChatting}
              />
              <Button type="submit" size="icon" className="h-10 w-10 shrink-0" disabled={!chatInput.trim() || isChatting || !model}>
                {isChatting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </Button>
            </form>
          </div>
        </div>

        {/* Spacer for mobile bottom */}
        <div className="h-4" />
      </main>

      {/* Champion pickers */}
      <ChampionPicker
        open={picker === "myChamp"}
        title="Your Champion"
        selected={myChamp ? [myChamp] : []}
        max={1}
        onClose={() => setPicker(null)}
        onSelect={s => { setMyChamp(s[0] ?? null); if (s.length === 1) setPicker(null); }}
      />
      <ChampionPicker
        open={picker === "allies"}
        title="Ally Champions"
        selected={allies}
        max={4}
        onClose={() => setPicker(null)}
        onSelect={setAllies}
      />
      <ChampionPicker
        open={picker === "enemies"}
        title="Enemy Champions"
        selected={enemies}
        max={5}
        onClose={() => setPicker(null)}
        onSelect={setEnemies}
      />
    </div>
  );
}
