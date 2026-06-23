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
  Target, Settings, AlertCircle, Loader2, Send, Upload, MessageSquare, X, Search, UserRound, Users, Swords, ChevronDown, ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Champions ────────────────────────────────────────────────────────────────
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
type PinType = "me" | "ally" | "enemy";
type PlaceMode = PinType | null;

interface Pin {
  id: string;
  type: PinType;
  x: number; // % from left
  y: number; // % from top
  champ: string | null;
}

// ─── Convert % position → rough zone name ────────────────────────────────────
function posToZone(x: number, y: number): string {
  // Wild Rift map: top-left = Baron side top lane, bottom-right = Dragon side bot lane
  const col = x < 33 ? "left" : x < 67 ? "center" : "right";
  const row = y < 33 ? "top" : y < 67 ? "mid" : "bot";
  const table: Record<string, string> = {
    "top-left":    "Top Lane / Baron side",
    "top-center":  "Top River / Upper Jungle",
    "top-right":   "Baron Lane / Top-right",
    "mid-left":    "Blue Jungle / Dragon side",
    "mid-center":  "Mid Lane",
    "mid-right":   "Red Jungle / Baron side",
    "bot-left":    "Dragon Lane / Bot-left",
    "bot-center":  "Bot River / Lower Jungle",
    "bot-right":   "Bot Lane / Dragon side",
  };
  return table[`${row}-${col}`] ?? "Mid Lane";
}

// ─── Champion picker ──────────────────────────────────────────────────────────
function ChampionPicker({ open, title, selected, max, onClose, onSelect }: {
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
            <Input autoFocus placeholder="Search champion..." className="pl-9 h-9 bg-black/40 text-sm"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        {selected.length > 0 && (
          <div className="px-3 pt-2 pb-1 flex flex-wrap gap-1.5 shrink-0">
            {selected.map(c => (
              <button key={c} onClick={() => toggle(c)}
                className="text-xs px-2.5 py-1 rounded-full bg-primary/20 text-primary border border-primary/40 flex items-center gap-1.5">
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
                        : full ? "opacity-30 cursor-not-allowed bg-black/20 border border-border/20"
                               : "bg-black/30 text-slate-300 border border-border/30 hover:border-primary/30 hover:text-primary")}>
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

// ─── Chat message type ────────────────────────────────────────────────────────
interface StreamingMsg { role: "user" | "assistant"; content: string; streaming?: boolean }

// ═════════════════════════════════════════════════════════════════════════════
export default function CoachPage() {
  const queryClient = useQueryClient();
  const [model] = useModelStorage();

  // Screenshot
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLDivElement>(null);

  // Pins on the image
  const [pins, setPins] = useState<Pin[]>([]);
  const [placeMode, setPlaceMode] = useState<PlaceMode>(null);
  const [champPickPin, setChampPickPin] = useState<string | null>(null); // pin id

  // Context
  const [gameTimeSecs, setGameTimeSecs] = useState(0);
  const [myRole, setMyRole] = useState<Role | null>(null);
  const [myChamp, setMyChamp] = useState<string | null>(null);
  const [dragon, setDragon] = useState<ObjStatus | null>(null);
  const [baron, setBaron] = useState<ObjStatus | null>(null);
  const [herald, setHerald] = useState<ObjStatus | null>(null);
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

  // ── Handle tap on image ────────────────────────────────────────────────────
  const handleImageTap = (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    if (!placeMode || !imgRef.current) return;

    // Don't place if clicking an existing pin
    const target = e.target as HTMLElement;
    if (target.closest("[data-pin]")) return;

    const rect = imgRef.current.getBoundingClientRect();
    let clientX: number, clientY: number;
    if ("touches" in e) {
      clientX = e.touches[0]!.clientX;
      clientY = e.touches[0]!.clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    const x = ((clientX - rect.left) / rect.width) * 100;
    const y = ((clientY - rect.top) / rect.height) * 100;

    if (placeMode === "me") {
      // Only one "me" pin — replace existing
      setPins(p => [...p.filter(pin => pin.type !== "me"), { id: `me-${Date.now()}`, type: "me", x, y, champ: myChamp }]);
    } else if (placeMode === "ally") {
      const allies = pins.filter(p => p.type === "ally");
      if (allies.length >= 4) return;
      setPins(p => [...p, { id: `ally-${Date.now()}`, type: "ally", x, y, champ: null }]);
    } else if (placeMode === "enemy") {
      const enemies = pins.filter(p => p.type === "enemy");
      if (enemies.length >= 5) return;
      setPins(p => [...p, { id: `enemy-${Date.now()}`, type: "enemy", x, y, champ: null }]);
    }
  };

  const removePin = (id: string) => setPins(p => p.filter(pin => pin.id !== id));

  // ── Build context ──────────────────────────────────────────────────────────
  const buildContext = useCallback((): GameContext => {
    const myPin = pins.find(p => p.type === "me");
    const allyPins = pins.filter(p => p.type === "ally");
    const enemyPins = pins.filter(p => p.type === "enemy");

    const myLocationText = myPin ? posToZone(myPin.x, myPin.y) : null;
    const allyText = allyPins.length
      ? allyPins.map(p => {
          const zone = posToZone(p.x, p.y);
          return p.champ ? `${p.champ} at ${zone}` : zone;
        }).join(", ")
      : null;
    const enemyText = enemyPins.length
      ? enemyPins.map(p => {
          const zone = posToZone(p.x, p.y);
          return p.champ ? `${p.champ} at ${zone}` : zone;
        }).join(", ")
      : null;

    const notes: string[] = [];
    if (myChamp) notes.push(`I am playing ${myChamp}`);
    if (myPin) notes.push(`I am pinned at (${Math.round(myPin.x)}%, ${Math.round(myPin.y)}%) on the screenshot`);

    return {
      gameTime: gameTimeSecs > 0 ? formatTime(gameTimeSecs) : null,
      myRole: myRole ?? null,
      myLocation: myLocationText,
      allyChampions: allyText,
      enemyChampions: enemyText,
      dragonStatus: dragon ?? null,
      baronStatus: baron ?? null,
      riftHeraldStatus: herald ?? null,
      goldDiff: null,
      score: null,
      additionalNotes: notes.length ? notes.join(". ") : null,
    };
  }, [pins, gameTimeSecs, myRole, myChamp, dragon, baron, herald]);

  // ── File upload ────────────────────────────────────────────────────────────
  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = e => { const r = e.target?.result as string; if (r) { setImageBase64(r); setPins([]); } };
    reader.readAsDataURL(file);
  };

  // ── Advise ─────────────────────────────────────────────────────────────────
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
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
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

  // ── Chat ───────────────────────────────────────────────────────────────────
  const sendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !model) return;
    let convId = activeConversationId;
    if (!convId) {
      const conv = await createConversation.mutateAsync({ data: { title: `Game ${formatTime(gameTimeSecs)}`, model } });
      convId = conv.id; setActiveConversationId(conv.id);
      queryClient.invalidateQueries({ queryKey: getListOpenrouterConversationsQueryKey() });
    }
    const msg = chatInput.trim();
    setChatInput(""); setIsChatting(true);
    setChatMessages(p => [...p, { role: "user", content: msg }, { role: "assistant", content: "", streaming: true }]);
    try {
      const BASE = import.meta.env.BASE_URL;
      const res = await fetch(`${BASE}api/openrouter/conversations/${convId}/messages`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: msg, model, context: buildContext() }),
      });
      if (!res.ok) throw new Error();
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop() || "";
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
    } finally { setIsChatting(false); }
  };

  const myPin = pins.find(p => p.type === "me");
  const allyPins = pins.filter(p => p.type === "ally");
  const enemyPins = pins.filter(p => p.type === "enemy");
  const hasContext = pins.length > 0 || !!myChamp || !!myRole || !!dragon || !!baron || !!herald || gameTimeSecs > 0;
  const canAdvise = !!model && !isAdvising && (!!imageBase64 || hasContext);

  const PIN_STYLES: Record<PinType, { ring: string; bg: string; text: string; label: string }> = {
    me:    { ring: "ring-amber-400",   bg: "bg-amber-400",   text: "text-black",   label: "ME" },
    ally:  { ring: "ring-sky-400",     bg: "bg-sky-400",     text: "text-black",   label: "A" },
    enemy: { ring: "ring-red-500",     bg: "bg-red-500",     text: "text-white",   label: "E" },
  };

  const MODE_BTN: Record<PinType, { active: string; idle: string; icon: React.ReactNode; label: string }> = {
    me:    { active: "bg-amber-400/20 border-amber-400 text-amber-400",    idle: "bg-black/30 border-border/40 text-muted-foreground hover:border-amber-400/40",    icon: <UserRound className="w-3.5 h-3.5" />, label: "Me" },
    ally:  { active: "bg-sky-400/20   border-sky-400   text-sky-400",      idle: "bg-black/30 border-border/40 text-muted-foreground hover:border-sky-400/40",      icon: <Users     className="w-3.5 h-3.5" />, label: `Allies ${allyPins.length > 0 ? `(${allyPins.length}/4)` : ""}` },
    enemy: { active: "bg-red-500/20   border-red-500   text-red-400",      idle: "bg-black/30 border-border/40 text-muted-foreground hover:border-red-400/40",      icon: <Swords    className="w-3.5 h-3.5" />, label: `Enemies ${enemyPins.length > 0 ? `(${enemyPins.length}/5)` : ""}` },
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

        {!model && (
          <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3 flex gap-3 items-start">
            <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            <div className="text-sm">
              <span className="font-semibold text-destructive">No AI model selected. </span>
              <Link href="/settings"><span className="underline text-destructive/80 cursor-pointer">Go to Settings</span></Link>
            </div>
          </div>
        )}

        {/* ══ SCREENSHOT + PIN OVERLAY ══════════════════════════════════════ */}
        {imageBase64 ? (
          <div className="space-y-2">
            {/* Mode selector bar */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-widest font-display text-muted-foreground shrink-0">Tap on pic:</span>
              {(["me","ally","enemy"] as PinType[]).map(type => {
                const s = MODE_BTN[type];
                const active = placeMode === type;
                return (
                  <button key={type}
                    onClick={() => setPlaceMode(p => p === type ? null : type)}
                    className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold transition-all active:scale-95 font-display",
                      active ? s.active : s.idle)}>
                    {s.icon} {s.label}
                  </button>
                );
              })}
              {pins.length > 0 && (
                <button onClick={() => setPins([])} className="ml-auto text-[10px] text-muted-foreground hover:text-white border border-border/30 px-2 py-1 rounded-full shrink-0">
                  Clear all
                </button>
              )}
            </div>

            {/* Instruction hint */}
            {placeMode && (
              <div className={cn("text-xs px-3 py-2 rounded-lg border font-display tracking-wide text-center",
                placeMode === "me"    ? "bg-amber-400/10 border-amber-400/40 text-amber-400" :
                placeMode === "ally"  ? "bg-sky-400/10   border-sky-400/40   text-sky-400" :
                                        "bg-red-500/10   border-red-500/40   text-red-400"
              )}>
                {placeMode === "me" && "Tap your position on the screenshot"}
                {placeMode === "ally" && `Tap where your allies are (${allyPins.length}/4)`}
                {placeMode === "enemy" && `Tap where enemies are (${enemyPins.length}/5)`}
              </div>
            )}

            {/* Image with tap overlay + pins */}
            <div
              ref={imgRef}
              className={cn("relative w-full rounded-xl overflow-hidden border border-border/40 select-none",
                placeMode ? "cursor-crosshair" : "cursor-default")}
              onClick={handleImageTap}
              onTouchStart={handleImageTap}
            >
              <img
                src={imageBase64}
                alt="Game screenshot"
                className="w-full h-auto block pointer-events-none"
                draggable={false}
              />

              {/* Pins */}
              {pins.map(pin => {
                const s = PIN_STYLES[pin.type];
                return (
                  <div
                    key={pin.id}
                    data-pin="true"
                    className="absolute -translate-x-1/2 -translate-y-full"
                    style={{ left: `${pin.x}%`, top: `${pin.y}%` }}
                    onClick={e => { e.stopPropagation(); removePin(pin.id); }}
                  >
                    {/* Stem */}
                    <div className="flex flex-col items-center">
                      <div className={cn("w-8 h-8 rounded-full ring-2 flex items-center justify-center font-display font-bold text-xs shadow-lg cursor-pointer active:scale-90 transition-transform", s.bg, s.text, s.ring)}>
                        {pin.champ ? pin.champ.slice(0, 2) : s.label}
                      </div>
                      <div className={cn("w-0.5 h-3", s.bg)} />
                      <div className={cn("w-1.5 h-1.5 rounded-full", s.bg)} />
                    </div>
                  </div>
                );
              })}

              {/* Replace button */}
              <button
                className="absolute top-2 right-2 bg-black/70 border border-white/20 text-white text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 active:scale-95"
                onClick={e => { e.stopPropagation(); fileInputRef.current?.click(); }}
              >
                <Upload className="w-3 h-3" /> Replace
              </button>
            </div>

            {/* Pin legend */}
            {pins.length > 0 && (
              <div className="flex gap-2 flex-wrap text-[10px]">
                {myPin && <span className="flex items-center gap-1 text-amber-400"><span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" /> You: {posToZone(myPin.x, myPin.y)}</span>}
                {allyPins.map((p, i) => <span key={p.id} className="flex items-center gap-1 text-sky-400"><span className="w-2.5 h-2.5 rounded-full bg-sky-400 inline-block" /> Ally {i+1}: {posToZone(p.x, p.y)}</span>)}
                {enemyPins.map((p, i) => <span key={p.id} className="flex items-center gap-1 text-red-400"><span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" /> Enemy {i+1}: {posToZone(p.x, p.y)}</span>)}
              </div>
            )}
          </div>
        ) : (
          <div
            className="w-full h-28 rounded-xl border-2 border-dashed border-border/40 hover:border-primary/30 transition-colors cursor-pointer flex flex-col items-center justify-center gap-2 text-muted-foreground"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
          >
            <Upload className="w-5 h-5" />
            <span className="text-sm">Upload screenshot — then tap it to mark positions</span>
          </div>
        )}
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />

        {/* ══ CONTEXT PANEL ════════════════════════════════════════════════ */}
        <div className="bg-card/40 border border-border/40 rounded-xl overflow-hidden">
          <button className="w-full flex items-center justify-between px-4 py-3 text-xs font-display tracking-widest uppercase text-muted-foreground"
            onClick={() => setContextOpen(o => !o)}>
            <span className="flex items-center gap-2">
              More Context
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
                      className={cn("flex-1 py-2 rounded-lg text-[11px] font-bold border transition-all active:scale-95 font-display",
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
                <button onClick={() => setChampPickPin("myChamp")}
                  className={cn("w-full mt-2 py-2.5 rounded-lg border text-sm font-medium transition-all active:scale-[0.98]",
                    myChamp ? "bg-amber-400/15 border-amber-400/50 text-amber-400" : "bg-black/30 border-border/40 text-muted-foreground hover:border-amber-400/40")}>
                  {myChamp ?? "+ Select your champion (optional)"}
                </button>
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

        {/* ══ ADVISE ME ════════════════════════════════════════════════════ */}
        <button onClick={getAdvice} disabled={!canAdvise}
          className={cn("w-full h-16 rounded-xl font-display text-xl font-bold tracking-widest uppercase transition-all relative overflow-hidden",
            canAdvise ? "bg-primary text-primary-foreground shadow-[0_0_30px_rgba(0,160,210,0.35)] hover:shadow-[0_0_45px_rgba(0,160,210,0.5)] active:scale-[0.98]"
                      : "bg-muted text-muted-foreground cursor-not-allowed opacity-60")}>
          {isAdvising
            ? <span className="flex items-center justify-center gap-3"><Loader2 className="w-5 h-5 animate-spin" /> Analyzing...</span>
            : <span className="flex items-center justify-center gap-3"><Target className="w-5 h-5" /> Advise Me</span>}
          {canAdvise && !isAdvising && <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full animate-[shimmer_2.5s_infinite]" />}
        </button>

        {/* ══ ADVICE OUTPUT ════════════════════════════════════════════════ */}
        {(advice || isAdvising) && (
          <div className="bg-card/60 border border-primary/30 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 bg-primary/5 border-b border-primary/20 flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              <span className="font-display text-xs tracking-widest uppercase text-primary">Tactical Read</span>
            </div>
            <div className="p-4">
              {advice
                ? <div className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">{advice}</div>
                : <div className="space-y-3"><Skeleton className="h-4 w-3/4 bg-primary/10" /><Skeleton className="h-4 w-full bg-primary/10" /><Skeleton className="h-4 w-5/6 bg-primary/10" /></div>}
            </div>
          </div>
        )}

        {/* ══ CHAT ═════════════════════════════════════════════════════════ */}
        <div className="bg-card/40 border border-border/40 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border/30 flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-primary" />
            <span className="font-display text-xs tracking-widest uppercase text-muted-foreground">Ask Follow-up</span>
          </div>
          {conversations && conversations.length > 0 && (
            <div className="flex gap-2 px-3 py-2 overflow-x-auto border-b border-border/20">
              {conversations.map(c => (
                <button key={c.id} onClick={() => { setActiveConversationId(c.id); setChatMessages([]); }}
                  className={cn("shrink-0 text-xs px-3 py-1.5 rounded-full border transition-all",
                    activeConversationId === c.id ? "bg-primary/20 border-primary text-primary" : "bg-black/30 border-border/40 text-muted-foreground")}>
                  {c.title}
                </button>
              ))}
            </div>
          )}
          {(chatMessages.length > 0 || (conversationData?.messages?.length ?? 0) > 0) && (
            <div className="max-h-80 overflow-y-auto p-3 space-y-3">
              {(conversationData?.messages ?? [])
                .filter(m => !chatMessages.some(cm => cm.content === m.content && cm.role === m.role))
                .map(m => (
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
        open={champPickPin === "myChamp"}
        title="Your Champion"
        selected={myChamp ? [myChamp] : []}
        max={1}
        onClose={() => setChampPickPin(null)}
        onSelect={s => { setMyChamp(s[0] ?? null); if (s.length === 1) setChampPickPin(null); }}
      />
    </div>
  );
}
