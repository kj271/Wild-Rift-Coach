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
  Target, Settings, AlertCircle, Loader2, Send, Upload, MessageSquare, X, Search, ChevronDown, ChevronUp, UserRound, Users, Swords,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Champion list ────────────────────────────────────────────────────────────
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
type ObjStatus = "up" | "down";

// ─── Map zones (Wild Rift schematic) ─────────────────────────────────────────
// Layout mirrors the WR minimap: top-left = top lane, bottom-right = bot lane
const MAP_ZONES = [
  { id: "base_blue",   label: "Blue Base",   col: 1, row: 1 },
  { id: "top_lane",    label: "Top Lane",    col: 2, row: 1 },
  { id: "baron_lane",  label: "Baron Lane",  col: 3, row: 1 },
  { id: "blue_jungle", label: "Blue Jungle", col: 1, row: 2 },
  { id: "mid_lane",    label: "Mid Lane",    col: 2, row: 2 },
  { id: "red_jungle",  label: "Red Jungle",  col: 3, row: 2 },
  { id: "dragon_lane", label: "Dragon Lane", col: 1, row: 3 },
  { id: "bot_lane",    label: "Bot Lane",    col: 2, row: 3 },
  { id: "base_red",    label: "Red Base",    col: 3, row: 3 },
  { id: "baron_pit",   label: "Baron Pit",   col: 2, row: 1, special: true },
  { id: "dragon_pit",  label: "Dragon Pit",  col: 2, row: 3, special: true },
] as const;
type ZoneId = typeof MAP_ZONES[number]["id"];

// Simplified 3×3 grid zones for the tap map
const GRID_ZONES: { id: ZoneId; label: string; col: number; row: number }[] = [
  { id: "base_blue",   label: "Blue\nBase",   col: 0, row: 0 },
  { id: "top_lane",    label: "Top\nLane",    col: 1, row: 0 },
  { id: "baron_pit",   label: "Baron\nPit",   col: 2, row: 0 },
  { id: "blue_jungle", label: "Blue\nJungle", col: 0, row: 1 },
  { id: "mid_lane",    label: "Mid\nLane",    col: 1, row: 1 },
  { id: "red_jungle",  label: "Red\nJungle",  col: 2, row: 1 },
  { id: "dragon_pit",  label: "Dragon\nPit",  col: 0, row: 2 },
  { id: "bot_lane",    label: "Bot\nLane",    col: 1, row: 2 },
  { id: "base_red",    label: "Red\nBase",    col: 2, row: 2 },
];

// ─── Types ────────────────────────────────────────────────────────────────────
interface PlayerMark {
  zone: ZoneId;
  champ: string | null; // optional
}

type PlacementMode = "me" | "ally" | "enemy" | null;

// ─── Champion picker ──────────────────────────────────────────────────────────
function ChampionPicker({
  open, title, selected, max, onClose, onSelect,
}: {
  open: boolean; title: string; selected: string[]; max: number;
  onClose: () => void; onSelect: (c: string[]) => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = CHAMPIONS.filter(c => c.toLowerCase().includes(search.toLowerCase()));
  const toggle = (c: string) => {
    if (selected.includes(c)) onSelect(selected.filter(s => s !== c));
    else if (selected.length < max) onSelect([...selected, c]);
  };
  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm w-full bg-[#0b1120] border-border p-0 gap-0 max-h-[80vh] flex flex-col">
        <DialogHeader className="p-4 border-b border-border/50 shrink-0">
          <DialogTitle className="text-sm font-display tracking-wider text-primary uppercase">
            {title} {max > 1 && <span className="text-muted-foreground font-normal">({selected.length}/{max})</span>}
          </DialogTitle>
        </DialogHeader>
        <div className="p-3 border-b border-border/30 shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input autoFocus placeholder="Search champion..." className="pl-9 h-9 bg-black/40 text-sm" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        {selected.length > 0 && (
          <div className="px-3 pt-2 pb-1 flex flex-wrap gap-1.5 shrink-0">
            {selected.map(c => (
              <button key={c} onClick={() => toggle(c)} className="text-xs px-2.5 py-1 rounded-full bg-primary/20 text-primary border border-primary/40 flex items-center gap-1.5">
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
                <button key={c} onClick={() => toggle(c)} disabled={full}
                  className={cn("rounded-md px-2 py-2.5 text-xs font-medium text-center transition-all active:scale-95",
                    sel ? "bg-primary/25 text-primary border border-primary/50"
                        : full ? "opacity-30 bg-black/20 border border-border/20 cursor-not-allowed"
                               : "bg-black/30 text-slate-300 border border-border/30 hover:border-primary/30 hover:text-primary hover:bg-primary/10"
                  )}>
                  {c}
                </button>
              );
            })}
          </div>
        </div>
        <div className="p-3 border-t border-border/30 shrink-0">
          <Button className="w-full h-10 font-display tracking-wider" onClick={onClose}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Minimap tap grid ─────────────────────────────────────────────────────────
function MinimapGrid({
  mode,
  myZone,
  allies,
  enemies,
  onTap,
}: {
  mode: PlacementMode;
  myZone: ZoneId | null;
  allies: PlayerMark[];
  enemies: PlayerMark[];
  onTap: (zone: ZoneId) => void;
}) {
  return (
    <div className="grid gap-1" style={{ gridTemplateColumns: "repeat(3, 1fr)", gridTemplateRows: "repeat(3, 1fr)", aspectRatio: "1" }}>
      {GRID_ZONES.map(z => {
        const isMe = myZone === z.id;
        const allyCount = allies.filter(a => a.zone === z.id).length;
        const enemyCount = enemies.filter(e => e.zone === z.id).length;
        const isMid = z.id === "mid_lane";

        return (
          <button
            key={z.id}
            onClick={() => onTap(z.id)}
            className={cn(
              "relative flex flex-col items-center justify-center rounded-md border text-[10px] transition-all active:scale-95 font-display tracking-wide leading-tight",
              isMid ? "bg-slate-800/60" : "bg-slate-900/60",
              mode && "hover:border-primary/60 hover:bg-primary/5",
              isMe ? "border-accent ring-1 ring-accent/40" : "border-border/30",
            )}
            style={{ gridColumn: z.col + 1, gridRow: z.row + 1 }}
          >
            <span className={cn("text-center whitespace-pre-line", isMe ? "text-accent font-bold" : "text-muted-foreground/70")}>
              {z.label}
            </span>
            {/* Markers */}
            <div className="flex gap-0.5 mt-1 flex-wrap justify-center">
              {isMe && <span className="w-3 h-3 rounded-full bg-accent border border-accent/60 text-[8px] flex items-center justify-center text-black font-bold">ME</span>}
              {Array.from({ length: allyCount }).map((_, i) => (
                <span key={`a${i}`} className="w-2.5 h-2.5 rounded-full bg-primary/80 border border-primary/40" />
              ))}
              {Array.from({ length: enemyCount }).map((_, i) => (
                <span key={`e${i}`} className="w-2.5 h-2.5 rounded-full bg-red-500/80 border border-red-400/40" />
              ))}
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ─── Objective toggle ─────────────────────────────────────────────────────────
function ObjToggle({ label, value, onChange }: { label: string; value: ObjStatus | null; onChange: (v: ObjStatus | null) => void }) {
  const tap = (v: ObjStatus) => onChange(value === v ? null : v);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-display uppercase tracking-wider text-muted-foreground/70 text-center">{label}</span>
      <div className="flex gap-1">
        <button onClick={() => tap("up")} className={cn("flex-1 text-xs font-bold py-2 rounded border transition-all active:scale-95",
          value === "up" ? "bg-primary/20 border-primary text-primary" : "bg-black/30 border-border/40 text-muted-foreground hover:border-primary/30")}>
          UP
        </button>
        <button onClick={() => tap("down")} className={cn("flex-1 text-xs font-bold py-2 rounded border transition-all active:scale-95",
          value === "down" ? "bg-red-500/20 border-red-500 text-red-400" : "bg-black/30 border-border/40 text-muted-foreground hover:border-red-400/30")}>
          DOWN
        </button>
      </div>
    </div>
  );
}

// ─── Streaming chat message type ──────────────────────────────────────────────
interface StreamingMsg { role: "user" | "assistant"; content: string; streaming?: boolean }

// ═════════════════════════════════════════════════════════════════════════════
export default function CoachPage() {
  const queryClient = useQueryClient();
  const [model] = useModelStorage();

  // Screenshot
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Context
  const [gameTimeSecs, setGameTimeSecs] = useState(0);
  const [myRole, setMyRole] = useState<Role | null>(null);
  const [myZone, setMyZone] = useState<ZoneId | null>(null);
  const [myChamp, setMyChamp] = useState<string | null>(null);
  const [allies, setAllies] = useState<PlayerMark[]>([]);
  const [enemies, setEnemies] = useState<PlayerMark[]>([]);
  const [dragon, setDragon] = useState<ObjStatus | null>(null);
  const [baron, setBaron] = useState<ObjStatus | null>(null);
  const [herald, setHerald] = useState<ObjStatus | null>(null);

  // Placement mode on map
  const [placementMode, setPlacementMode] = useState<PlacementMode>(null);

  // Champion picker
  const [champPickTarget, setChampPickTarget] = useState<"myChamp" | number | null>(null); // number = ally index

  // Section visibility
  const [contextOpen, setContextOpen] = useState(true);

  // Advice
  const [advice, setAdvice] = useState("");
  const [isAdvising, setIsAdvising] = useState(false);

  // Chat
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

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  // Handle map tap
  const handleMapTap = (zone: ZoneId) => {
    if (!placementMode) return;
    if (placementMode === "me") {
      setMyZone(prev => prev === zone ? null : zone);
    } else if (placementMode === "ally") {
      const existing = allies.findIndex(a => a.zone === zone);
      if (existing >= 0) {
        setAllies(p => p.filter((_, i) => i !== existing));
      } else if (allies.length < 4) {
        setAllies(p => [...p, { zone, champ: null }]);
      }
    } else if (placementMode === "enemy") {
      const existing = enemies.findIndex(e => e.zone === zone);
      if (existing >= 0) {
        setEnemies(p => p.filter((_, i) => i !== existing));
      } else if (enemies.length < 5) {
        setEnemies(p => [...p, { zone, champ: null }]);
      }
    }
  };

  // Build context
  const buildContext = useCallback((): GameContext => {
    const allyZoneNames = allies.map(a => {
      const zone = GRID_ZONES.find(z => z.id === a.zone);
      const name = zone?.label.replace("\n", " ") ?? a.zone;
      return a.champ ? `${a.champ} (${name})` : name;
    });
    const enemyZoneNames = enemies.map(e => {
      const zone = GRID_ZONES.find(z => z.id === e.zone);
      const name = zone?.label.replace("\n", " ") ?? e.zone;
      return e.champ ? `${e.champ} (${name})` : name;
    });
    const myZoneName = myZone ? (GRID_ZONES.find(z => z.id === myZone)?.label.replace("\n", " ") ?? myZone) : null;

    return {
      gameTime: gameTimeSecs > 0 ? formatTime(gameTimeSecs) : null,
      myRole: myRole ?? null,
      myLocation: myZoneName,
      allyChampions: allyZoneNames.length ? allyZoneNames.join(", ") : null,
      enemyChampions: enemyZoneNames.length ? enemyZoneNames.join(", ") : null,
      dragonStatus: dragon ?? null,
      baronStatus: baron ?? null,
      riftHeraldStatus: herald ?? null,
      goldDiff: null,
      score: null,
      additionalNotes: myChamp ? `I am playing ${myChamp}` : null,
    };
  }, [gameTimeSecs, myRole, myZone, myChamp, allies, enemies, dragon, baron, herald]);

  // File upload
  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = e => { const r = e.target?.result as string; if (r) setImageBase64(r); };
    reader.readAsDataURL(file);
  };

  // Advise
  const getAdvice = async () => {
    if (!model) return;
    setIsAdvising(true);
    setAdvice("");
    try {
      const BASE = import.meta.env.BASE_URL;
      const res = await fetch(`${BASE}api/coach/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, imageBase64: imageBase64?.split(",")[1] ?? null, context: buildContext() }),
      });
      if (!res.ok) throw new Error();
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
      setAdvice("Error — check your model in Settings and try again.");
    } finally {
      setIsAdvising(false);
    }
  };

  // Chat
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
      if (!res.ok) throw new Error();
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
              setChatMessages(p => { const n = [...p]; const l = n[n.length - 1]; if (l?.streaming) l.content += d.content; return n; });
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

  const hasContext = !!myChamp || !!myZone || allies.length > 0 || enemies.length > 0 || !!myRole || !!dragon || !!baron || !!herald || gameTimeSecs > 0;
  const canAdvise = !!model && !isAdvising && (!!imageBase64 || hasContext);

  const modeLabel = {
    me: { label: "Tap map → set YOUR position", color: "text-accent border-accent/40 bg-accent/10" },
    ally: { label: `Tap map → place ally (${allies.length}/4)`, color: "text-primary border-primary/40 bg-primary/10" },
    enemy: { label: `Tap map → place enemy (${enemies.length}/5)`, color: "text-red-400 border-red-400/40 bg-red-500/10" },
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-background/90 backdrop-blur border-b border-border/40">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
          <h1 className="font-display text-lg font-bold tracking-tight">MACRO<span className="text-primary">COACH</span></h1>
          <Link href="/settings">
            <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-white">
              <Settings className="w-5 h-5" />
            </Button>
          </Link>
        </div>
      </header>

      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-4 space-y-4 pb-8">

        {/* No model warning */}
        {!model && (
          <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3 flex items-start gap-3">
            <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            <div className="text-sm">
              <span className="font-semibold text-destructive">No AI model selected. </span>
              <Link href="/settings"><span className="underline text-destructive/80 cursor-pointer">Go to Settings</span></Link>
            </div>
          </div>
        )}

        {/* ── Screenshot — full size ─────────────────────────────────────────── */}
        {imageBase64 ? (
          <div className="relative w-full rounded-xl overflow-hidden border border-border/40">
            <img
              src={imageBase64}
              alt="Game screenshot"
              className="w-full h-auto block"
              style={{ maxHeight: "70vh", objectFit: "contain", background: "#000" }}
            />
            <div className="absolute top-2 right-2 flex gap-2">
              <button
                className="bg-black/70 border border-white/20 text-white text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 active:scale-95"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="w-3 h-3" /> Replace
              </button>
              <button
                className="w-8 h-8 rounded-full bg-black/70 border border-white/20 flex items-center justify-center text-white active:scale-95"
                onClick={() => setImageBase64(null)}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ) : (
          <div
            className="w-full h-24 rounded-xl border-2 border-dashed border-border/40 hover:border-primary/30 transition-colors cursor-pointer flex items-center justify-center gap-3 text-muted-foreground"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
          >
            <Upload className="w-4 h-4" />
            <span className="text-sm">Tap to upload screenshot (optional)</span>
          </div>
        )}
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />

        {/* ── Context ───────────────────────────────────────────────────────── */}
        <div className="bg-card/40 border border-border/40 rounded-xl overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-4 py-3 text-xs font-display tracking-widest uppercase text-muted-foreground"
            onClick={() => setContextOpen(o => !o)}
          >
            <span className="flex items-center gap-2">
              Game Context
              {hasContext && <span className="w-2 h-2 rounded-full bg-primary" />}
            </span>
            {contextOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          {contextOpen && (
            <div className="border-t border-border/30 px-4 pb-5 space-y-5">

              {/* Game time */}
              <div className="pt-4">
                <div className="flex justify-between mb-2">
                  <span className="text-[10px] uppercase tracking-widest font-display text-muted-foreground">Game Time</span>
                  <span className="font-display text-primary font-bold text-base">{formatTime(gameTimeSecs)}</span>
                </div>
                <input type="range" min={0} max={1800} step={30} value={gameTimeSecs}
                  onChange={e => setGameTimeSecs(Number(e.target.value))}
                  className="w-full accent-primary h-2 rounded-full cursor-pointer" />
                <div className="flex justify-between text-[10px] text-muted-foreground/40 mt-1">
                  <span>0:00</span><span>10:00</span><span>20:00</span><span>30:00</span>
                </div>
              </div>

              {/* Role */}
              <div>
                <span className="text-[10px] uppercase tracking-widest font-display text-muted-foreground">My Role</span>
                <div className="flex gap-2 mt-2">
                  {ROLES.map(r => (
                    <button key={r} onClick={() => setMyRole(myRole === r ? null : r)}
                      className={cn("flex-1 py-2 rounded-lg text-[11px] font-bold border transition-all active:scale-95 font-display tracking-wide",
                        myRole === r ? "bg-primary/20 border-primary text-primary shadow-[0_0_10px_rgba(0,160,210,0.2)]"
                                     : "bg-black/30 border-border/40 text-muted-foreground hover:border-primary/30")}>
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              {/* My champion */}
              <div>
                <span className="text-[10px] uppercase tracking-widest font-display text-muted-foreground">My Champion <span className="text-muted-foreground/40">(optional)</span></span>
                <button onClick={() => setChampPickTarget("myChamp")}
                  className={cn("w-full mt-2 py-2.5 rounded-lg border text-sm font-medium transition-all active:scale-[0.98]",
                    myChamp ? "bg-accent/15 border-accent/50 text-accent"
                            : "bg-black/30 border-border/40 text-muted-foreground hover:border-accent/40")}>
                  {myChamp ?? "+ Select your champion (optional)"}
                  {myChamp && <span className="ml-2 text-xs opacity-60">(tap to change)</span>}
                </button>
              </div>

              {/* ── Map tap section ─────────────────────────────────────────── */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] uppercase tracking-widest font-display text-muted-foreground">Positions on Map</span>
                  {placementMode && (
                    <button onClick={() => setPlacementMode(null)} className="text-[10px] text-muted-foreground hover:text-white border border-border/30 px-2 py-1 rounded">
                      Done
                    </button>
                  )}
                </div>

                {/* Mode buttons */}
                <div className="flex gap-2 mb-3">
                  <button
                    onClick={() => setPlacementMode(p => p === "me" ? null : "me")}
                    className={cn("flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border text-xs font-bold transition-all active:scale-95",
                      placementMode === "me" ? "bg-accent/20 border-accent text-accent" : "bg-black/30 border-border/40 text-muted-foreground hover:border-accent/40")}>
                    <UserRound className="w-3.5 h-3.5" /> Me {myZone && "✓"}
                  </button>
                  <button
                    onClick={() => setPlacementMode(p => p === "ally" ? null : "ally")}
                    className={cn("flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border text-xs font-bold transition-all active:scale-95",
                      placementMode === "ally" ? "bg-primary/20 border-primary text-primary" : "bg-black/30 border-border/40 text-muted-foreground hover:border-primary/30")}>
                    <Users className="w-3.5 h-3.5" /> Allies {allies.length > 0 && `(${allies.length})`}
                  </button>
                  <button
                    onClick={() => setPlacementMode(p => p === "enemy" ? null : "enemy")}
                    className={cn("flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border text-xs font-bold transition-all active:scale-95",
                      placementMode === "enemy" ? "bg-red-500/20 border-red-500 text-red-400" : "bg-black/30 border-border/40 text-muted-foreground hover:border-red-400/30")}>
                    <Swords className="w-3.5 h-3.5" /> Enemies {enemies.length > 0 && `(${enemies.length})`}
                  </button>
                </div>

                {/* Instruction banner */}
                {placementMode && (
                  <div className={cn("text-xs px-3 py-2 rounded-lg border mb-3 font-display tracking-wide", modeLabel[placementMode].color)}>
                    {modeLabel[placementMode].label}
                  </div>
                )}

                {/* Mini-map grid */}
                <MinimapGrid
                  mode={placementMode}
                  myZone={myZone}
                  allies={allies}
                  enemies={enemies}
                  onTap={handleMapTap}
                />

                {/* Clear buttons */}
                {(myZone || allies.length > 0 || enemies.length > 0) && (
                  <div className="flex gap-2 mt-2 flex-wrap">
                    {myZone && (
                      <button onClick={() => setMyZone(null)} className="text-[10px] text-muted-foreground hover:text-white border border-border/30 px-2 py-1 rounded-full">
                        Clear my pos
                      </button>
                    )}
                    {allies.length > 0 && (
                      <button onClick={() => setAllies([])} className="text-[10px] text-muted-foreground hover:text-white border border-border/30 px-2 py-1 rounded-full">
                        Clear allies
                      </button>
                    )}
                    {enemies.length > 0 && (
                      <button onClick={() => setEnemies([])} className="text-[10px] text-muted-foreground hover:text-white border border-border/30 px-2 py-1 rounded-full">
                        Clear enemies
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Objectives */}
              <div>
                <span className="text-[10px] uppercase tracking-widest font-display text-muted-foreground">Objectives</span>
                <div className="grid grid-cols-3 gap-3 mt-2">
                  <ObjToggle label="Dragon" value={dragon} onChange={setDragon} />
                  <ObjToggle label="Baron" value={baron} onChange={setBaron} />
                  <ObjToggle label="Herald" value={herald} onChange={setHerald} />
                </div>
              </div>

            </div>
          )}
        </div>

        {/* ── ADVISE ME ─────────────────────────────────────────────────────── */}
        <button
          onClick={getAdvice}
          disabled={!canAdvise}
          className={cn(
            "w-full h-16 rounded-xl font-display text-xl font-bold tracking-widest uppercase transition-all relative overflow-hidden",
            canAdvise
              ? "bg-primary text-primary-foreground shadow-[0_0_30px_rgba(0,160,210,0.35)] hover:shadow-[0_0_45px_rgba(0,160,210,0.5)] active:scale-[0.98]"
              : "bg-muted text-muted-foreground cursor-not-allowed opacity-60"
          )}
        >
          {isAdvising ? (
            <span className="flex items-center justify-center gap-3"><Loader2 className="w-5 h-5 animate-spin" /> Analyzing...</span>
          ) : (
            <span className="flex items-center justify-center gap-3"><Target className="w-5 h-5" /> Advise Me</span>
          )}
          {canAdvise && !isAdvising && (
            <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full animate-[shimmer_2.5s_infinite]" />
          )}
        </button>

        {/* ── Advice output ─────────────────────────────────────────────────── */}
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

        {/* ── Chat ──────────────────────────────────────────────────────────── */}
        <div className="bg-card/40 border border-border/40 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border/30 flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-primary" />
            <span className="font-display text-xs tracking-widest uppercase text-muted-foreground">Ask Follow-up</span>
          </div>

          {conversations && conversations.length > 0 && (
            <div className="flex gap-2 px-3 py-2 overflow-x-auto border-b border-border/20">
              {conversations.map(c => (
                <button key={c.id}
                  onClick={() => { setActiveConversationId(c.id); setChatMessages([]); }}
                  className={cn("shrink-0 text-xs px-3 py-1.5 rounded-full border transition-all",
                    activeConversationId === c.id ? "bg-primary/20 border-primary text-primary" : "bg-black/30 border-border/40 text-muted-foreground")}>
                  {c.title}
                </button>
              ))}
            </div>
          )}

          {(chatMessages.length > 0 || (conversationData?.messages?.length ?? 0) > 0) && (
            <div className="max-h-80 overflow-y-auto p-3 space-y-3">
              {(conversationData?.messages ?? []).filter(m => !chatMessages.some(cm => cm.content === m.content && cm.role === m.role)).map(m => (
                <div key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                  <div className={cn("max-w-[85%] px-3 py-2 rounded-lg text-sm",
                    m.role === "user" ? "bg-primary text-primary-foreground rounded-tr-none" : "bg-muted border border-border rounded-tl-none")}>
                    {m.content}
                  </div>
                </div>
              ))}
              {chatMessages.map((m, i) => (
                <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                  <div className={cn("max-w-[85%] px-3 py-2 rounded-lg text-sm whitespace-pre-wrap",
                    m.role === "user" ? "bg-primary text-primary-foreground rounded-tr-none" : "bg-muted border border-border rounded-tl-none")}>
                    {m.content || (m.streaming && (
                      <span className="inline-flex gap-1">
                        <span className="w-1.5 h-1.5 bg-current rounded-full animate-bounce [animation-delay:0ms]" />
                        <span className="w-1.5 h-1.5 bg-current rounded-full animate-bounce [animation-delay:150ms]" />
                        <span className="w-1.5 h-1.5 bg-current rounded-full animate-bounce [animation-delay:300ms]" />
                      </span>
                    ))}
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
          )}

          <div className="p-3 border-t border-border/20">
            <form onSubmit={sendChat} className="flex gap-2">
              <Input placeholder="Ask anything about the situation..." className="bg-black/40 border-border/50 text-sm h-10"
                value={chatInput} onChange={e => setChatInput(e.target.value)} disabled={isChatting} />
              <Button type="submit" size="icon" className="h-10 w-10 shrink-0" disabled={!chatInput.trim() || isChatting || !model}>
                {isChatting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </Button>
            </form>
          </div>
        </div>

      </main>

      {/* Champion picker */}
      <ChampionPicker
        open={champPickTarget !== null}
        title={champPickTarget === "myChamp" ? "Your Champion" : "Champion Name"}
        selected={champPickTarget === "myChamp" ? (myChamp ? [myChamp] : []) : []}
        max={1}
        onClose={() => setChampPickTarget(null)}
        onSelect={s => {
          if (champPickTarget === "myChamp") {
            setMyChamp(s[0] ?? null);
            if (s.length === 1) setChampPickTarget(null);
          }
        }}
      />
    </div>
  );
}
