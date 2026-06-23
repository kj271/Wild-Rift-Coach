import { useState, useRef, useCallback, useEffect } from "react";
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
  Target, Settings, AlertCircle, Loader2, Send, Upload,
  MessageSquare, X, Search, UserRound, Users, Swords,
  ChevronDown, ChevronUp, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Constants ────────────────────────────────────────────────────────────────
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
type ObjStatus = "up" | "soon" | "down" | null;
type PinType = "me" | "ally" | "enemy";
type PlaceMode = PinType | null;

// ─── Wild Rift minimap zones ──────────────────────────────────────────────────
// Coordinate system: (cx, cy) = center % of the minimap image
// Blue base = lower-left, Red base = upper-right
interface MapZone {
  id: string;
  label: string;
  cx: number; // center x % on minimap
  cy: number; // center y % on minimap
  short: string; // short label for AI context
}

const MAP_ZONES: MapZone[] = [
  // Bases
  { id: "blue_base",      label: "Blue Base",             cx: 7,  cy: 90, short: "Blue Base" },
  { id: "red_base",       label: "Red Base",              cx: 93, cy: 10, short: "Red Base" },
  // Baron Lane (top lane in WR)
  { id: "baron_blue",     label: "Baron Lane\n(our side)",cx: 8,  cy: 60, short: "Baron Lane (Blue side)" },
  { id: "baron_center",   label: "Baron Lane\n(center)",  cx: 27, cy: 30, short: "Baron Lane center" },
  { id: "baron_red",      label: "Baron Lane\n(their side)", cx: 52, cy: 8, short: "Baron Lane (Red side)" },
  // Mid Lane
  { id: "mid_blue",       label: "Mid Lane\n(our side)",  cx: 32, cy: 72, short: "Mid Lane (Blue side)" },
  { id: "mid_center",     label: "Mid Lane\n(center)",    cx: 50, cy: 50, short: "Mid Lane center" },
  { id: "mid_red",        label: "Mid Lane\n(their side)",cx: 68, cy: 28, short: "Mid Lane (Red side)" },
  // Dragon Lane (bot lane in WR)
  { id: "dragon_blue",    label: "Dragon Lane\n(our side)", cx: 28, cy: 88, short: "Dragon Lane (Blue side)" },
  { id: "dragon_center",  label: "Dragon Lane\n(center)", cx: 53, cy: 80, short: "Dragon Lane center" },
  { id: "dragon_red",     label: "Dragon Lane\n(their side)", cx: 77, cy: 68, short: "Dragon Lane (Red side)" },
  // Jungle
  { id: "jungle_blue",    label: "Blue Jungle",           cx: 18, cy: 52, short: "Blue Jungle" },
  { id: "jungle_red",     label: "Red Jungle",            cx: 82, cy: 48, short: "Red Jungle" },
  // Objectives
  { id: "baron_pit",      label: "Baron Pit",             cx: 40, cy: 20, short: "Baron Pit area" },
  { id: "dragon_pit",     label: "Dragon Pit",            cx: 60, cy: 80, short: "Dragon Pit area" },
];

interface PlayerMark { zone: string; champ: string | null }

// ─── Canvas crop helper ───────────────────────────────────────────────────────
function cropImageRegion(
  img: HTMLImageElement,
  xPct: number, yPct: number, wPct: number, hPct: number,
  quality = 0.92
): Promise<string> {
  return new Promise(resolve => {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const sx = Math.round(w * xPct / 100);
    const sy = Math.round(h * yPct / 100);
    const sw = Math.round(w * wPct / 100);
    const sh = Math.round(h * hPct / 100);
    const canvas = document.createElement("canvas");
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    resolve(canvas.toDataURL("image/jpeg", quality));
  });
}

function timeToSeconds(t: string): number {
  const [m, s] = t.split(":").map(Number);
  return (m ?? 0) * 60 + (s ?? 0);
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
    else if (selected.length < max) { onSelect([...selected, c]); if (max === 1) onClose(); }
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
            <Input autoFocus placeholder="Search..." className="pl-9 h-9 bg-black/40 text-sm"
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
        {max > 1 && (
          <div className="p-3 border-t border-border/30 shrink-0">
            <Button className="w-full h-10 font-display tracking-wider" onClick={onClose}>Done</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Minimap zone button ──────────────────────────────────────────────────────
function ZoneButton({
  zone, mode, myMark, allyMarks, enemyMarks, onTap,
}: {
  zone: MapZone; mode: PlaceMode;
  myMark: PlayerMark | null; allyMarks: PlayerMark[]; enemyMarks: PlayerMark[];
  onTap: (zoneId: string) => void;
}) {
  const isMe = myMark?.zone === zone.id;
  const allyCount = allyMarks.filter(m => m.zone === zone.id).length;
  const enemyCount = enemyMarks.filter(m => m.zone === zone.id).length;
  const hasAny = isMe || allyCount > 0 || enemyCount > 0;

  return (
    <button
      onClick={() => onTap(zone.id)}
      className={cn(
        "absolute -translate-x-1/2 -translate-y-1/2 transition-all active:scale-90",
        "rounded-lg border text-[9px] leading-tight text-center font-display tracking-wide px-1 py-1",
        "min-w-[48px]",
        mode ? "cursor-crosshair" : "cursor-default",
        hasAny
          ? "bg-black/80 border-white/30 text-white"
          : mode
            ? "bg-black/60 border-white/15 text-white/50 hover:border-white/40 hover:text-white/80 hover:bg-black/75"
            : "bg-black/40 border-white/10 text-white/30"
      )}
      style={{ left: `${zone.cx}%`, top: `${zone.cy}%` }}
    >
      <div className="whitespace-pre-line">{zone.label}</div>
      {hasAny && (
        <div className="flex gap-0.5 justify-center mt-0.5 flex-wrap">
          {isMe && <span className="w-3 h-3 rounded-full bg-amber-400 text-black text-[7px] flex items-center justify-center font-bold">M</span>}
          {Array.from({ length: allyCount }).map((_, i) => <span key={i} className="w-2.5 h-2.5 rounded-full bg-sky-400" />)}
          {Array.from({ length: enemyCount }).map((_, i) => <span key={i} className="w-2.5 h-2.5 rounded-full bg-red-500" />)}
        </div>
      )}
    </button>
  );
}

// ─── 3-state objective control ────────────────────────────────────────────────
function ObjControl({ label, value, onChange }: {
  label: string; value: ObjStatus; onChange: (v: ObjStatus) => void;
}) {
  const states: { v: NonNullable<ObjStatus>; label: string; active: string; idle: string }[] = [
    { v: "up",   label: "UP",   active: "bg-emerald-500/25 text-emerald-400 border-emerald-500",   idle: "text-muted-foreground border-border/30 hover:border-emerald-500/40" },
    { v: "soon", label: "SOON", active: "bg-amber-500/25  text-amber-400  border-amber-500",       idle: "text-muted-foreground border-border/30 hover:border-amber-500/40"   },
    { v: "down", label: "DOWN", active: "bg-red-500/25    text-red-400    border-red-500",         idle: "text-muted-foreground border-border/30 hover:border-red-400/40"     },
  ];
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] font-display uppercase tracking-widest text-muted-foreground/70 text-center">{label}</span>
      <div className="flex rounded-lg overflow-hidden border border-border/30 divide-x divide-border/30">
        {states.map(s => (
          <button key={s.v}
            onClick={() => onChange(value === s.v ? null : s.v)}
            className={cn("flex-1 text-[11px] font-bold py-2.5 transition-all active:scale-95 border-0",
              value === s.v ? s.active : `bg-black/40 ${s.idle}`)}>
            {s.label}
          </button>
        ))}
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

  // Screenshot state
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [minimapBase64, setMinimapBase64] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hiddenImgRef = useRef<HTMLImageElement>(null);

  // Position pins on minimap
  const [myMark, setMyMark] = useState<PlayerMark | null>(null);
  const [allyMarks, setAllyMarks] = useState<PlayerMark[]>([]);
  const [enemyMarks, setEnemyMarks] = useState<PlayerMark[]>([]);
  const [placeMode, setPlaceMode] = useState<PlaceMode>(null);

  // Context
  const [gameTimeSecs, setGameTimeSecs] = useState(0);
  const [myRole, setMyRole] = useState<Role | null>(null);
  const [myChamp, setMyChamp] = useState<string | null>(null);
  const [dragon, setDragon] = useState<ObjStatus>(null);
  const [baron, setBaron] = useState<ObjStatus>(null);
  const [herald, setHerald] = useState<ObjStatus>(null);
  const [contextOpen, setContextOpen] = useState(true);
  const [champPickOpen, setChampPickOpen] = useState(false);

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

  // ── Auto-crop minimap + extract time ────────────────────────────────────────
  const processUploadedImage = useCallback(async (dataUrl: string) => {
    setImageBase64(dataUrl);
    setMinimapBase64(null);
    setMyMark(null); setAllyMarks([]); setEnemyMarks([]);

    const img = new Image();
    img.onload = async () => {
      // Crop minimap: top-left ~20% width, ~28% height
      const minimap = await cropImageRegion(img, 0, 0, 20, 28, 0.95);
      setMinimapBase64(minimap);

      // Extract game time using AI
      setExtracting(true);
      try {
        // Send a top strip of the image (top 15%) to save tokens
        const strip = await cropImageRegion(img, 25, 0, 50, 14, 0.9);
        const BASE = import.meta.env.BASE_URL;
        const res = await fetch(`${BASE}api/coach/extract-metadata`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageBase64: strip.split(",")[1] }),
        });
        if (res.ok) {
          const data = await res.json() as { gameTime?: string | null };
          if (data.gameTime) {
            const secs = timeToSeconds(data.gameTime);
            if (secs > 0 && secs <= 1800) setGameTimeSecs(secs);
          }
        }
      } catch { /* silent — user can set time manually */ }
      finally { setExtracting(false); }
    };
    img.src = dataUrl;
  }, []);

  // Hidden img element for triggering the load
  useEffect(() => {
    if (hiddenImgRef.current && imageBase64) {
      hiddenImgRef.current.src = imageBase64;
    }
  }, [imageBase64]);

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = e => { const r = e.target?.result as string; if (r) processUploadedImage(r); };
    reader.readAsDataURL(file);
  };

  // ── Minimap zone tap ─────────────────────────────────────────────────────────
  const handleZoneTap = (zoneId: string) => {
    if (!placeMode) return;
    if (placeMode === "me") {
      setMyMark(p => p?.zone === zoneId ? null : { zone: zoneId, champ: myChamp });
    } else if (placeMode === "ally") {
      const existing = allyMarks.findIndex(m => m.zone === zoneId);
      if (existing >= 0) setAllyMarks(p => p.filter((_, i) => i !== existing));
      else if (allyMarks.length < 4) setAllyMarks(p => [...p, { zone: zoneId, champ: null }]);
    } else {
      const existing = enemyMarks.findIndex(m => m.zone === zoneId);
      if (existing >= 0) setEnemyMarks(p => p.filter((_, i) => i !== existing));
      else if (enemyMarks.length < 5) setEnemyMarks(p => [...p, { zone: zoneId, champ: null }]);
    }
  };

  // ── Build AI context ─────────────────────────────────────────────────────────
  const buildContext = useCallback((): GameContext => {
    const zoneShort = (id: string) => MAP_ZONES.find(z => z.id === id)?.short ?? id;
    const myLoc = myMark ? zoneShort(myMark.zone) : null;
    const allyText = allyMarks.length
      ? allyMarks.map(m => { const z = zoneShort(m.zone); return m.champ ? `${m.champ} (${z})` : z; }).join(", ")
      : null;
    const enemyText = enemyMarks.length
      ? enemyMarks.map(m => { const z = zoneShort(m.zone); return m.champ ? `${m.champ} (${z})` : z; }).join(", ")
      : null;
    return {
      gameTime: gameTimeSecs > 0 ? formatTime(gameTimeSecs) : null,
      myRole: myRole ?? null,
      myLocation: myLoc,
      allyChampions: allyText,
      enemyChampions: enemyText,
      dragonStatus: dragon ?? null,
      baronStatus: baron ?? null,
      riftHeraldStatus: herald ?? null,
      goldDiff: null, score: null,
      additionalNotes: myChamp ? `I am playing ${myChamp}` : null,
    };
  }, [myMark, allyMarks, enemyMarks, gameTimeSecs, myRole, myChamp, dragon, baron, herald]);

  // ── Advise ───────────────────────────────────────────────────────────────────
  const getAdvice = async () => {
    if (!model) return;
    setIsAdvising(true); setAdvice("");
    try {
      const BASE = import.meta.env.BASE_URL;
      const res = await fetch(`${BASE}api/coach/analyze`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, imageBase64: imageBase64?.split(",")[1] ?? null, context: buildContext() }),
      });
      if (!res.ok) throw new Error();
      const reader = res.body!.getReader(); const dec = new TextDecoder(); let buf = "";
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop() || "";
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
    } catch { setAdvice("Error — check model in Settings and try again."); }
    finally { setIsAdvising(false); }
  };

  // ── Chat ─────────────────────────────────────────────────────────────────────
  const sendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !model) return;
    let convId = activeConversationId;
    if (!convId) {
      const conv = await createConversation.mutateAsync({ data: { title: `Game ${formatTime(gameTimeSecs)}`, model } });
      convId = conv.id; setActiveConversationId(conv.id);
      queryClient.invalidateQueries({ queryKey: getListOpenrouterConversationsQueryKey() });
    }
    const msg = chatInput.trim(); setChatInput(""); setIsChatting(true);
    setChatMessages(p => [...p, { role: "user", content: msg }, { role: "assistant", content: "", streaming: true }]);
    try {
      const BASE = import.meta.env.BASE_URL;
      const res = await fetch(`${BASE}api/openrouter/conversations/${convId}/messages`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: msg, model, context: buildContext() }),
      });
      if (!res.ok) throw new Error();
      const reader = res.body!.getReader(); const dec = new TextDecoder(); let buf = "";
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const d = JSON.parse(line.slice(6));
            if (d.content) {
              setChatMessages(p => { const n=[...p]; const l=n[n.length-1]; if(l?.streaming) l.content+=d.content; return n; });
              chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
            }
            if (d.done) {
              setChatMessages(p => p.map((m,i) => i===p.length-1 ? {...m,streaming:false} : m));
              queryClient.invalidateQueries({ queryKey: getGetOpenrouterConversationQueryKey(convId!) });
            }
          } catch {}
        }
      }
    } catch {
      setChatMessages(p => p.map((m,i) => i===p.length-1 ? {...m,content:"Error — try again.",streaming:false} : m));
    } finally { setIsChatting(false); }
  };

  const hasContext = !!myMark || allyMarks.length>0 || enemyMarks.length>0 || !!myChamp || !!myRole || !!dragon || !!baron || !!herald || gameTimeSecs>0;
  const canAdvise = !!model && !isAdvising && (!!imageBase64 || hasContext);

  const PIN_COLOR: Record<PinType, string> = { me: "amber", ally: "sky", enemy: "red" };
  const PLACE_BTN = {
    me:    { active: "bg-amber-400/20 border-amber-400 text-amber-400", idle: "border-border/40 text-muted-foreground hover:border-amber-400/40", dot: "bg-amber-400" },
    ally:  { active: "bg-sky-400/20   border-sky-400   text-sky-400",   idle: "border-border/40 text-muted-foreground hover:border-sky-400/40",   dot: "bg-sky-400"   },
    enemy: { active: "bg-red-500/20   border-red-500   text-red-400",   idle: "border-border/40 text-muted-foreground hover:border-red-400/40",   dot: "bg-red-500"   },
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Hidden img for canvas crop */}
      <img ref={hiddenImgRef} className="hidden" alt="" />

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
              <span className="font-semibold text-destructive">No AI model. </span>
              <Link href="/settings"><span className="underline text-destructive/80 cursor-pointer">Go to Settings</span></Link>
            </div>
          </div>
        )}

        {/* ── SCREENSHOT ───────────────────────────────────────────────────── */}
        {imageBase64 ? (
          <div className="relative w-full rounded-xl overflow-hidden border border-border/40">
            <img src={imageBase64} alt="Game screenshot" className="w-full h-auto block" draggable={false} />
            <div className="absolute top-2 right-2 flex gap-2">
              <button className="bg-black/70 border border-white/20 text-white text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 active:scale-95"
                onClick={() => fileInputRef.current?.click()}>
                <Upload className="w-3 h-3" /> Replace
              </button>
              <button className="w-8 h-8 rounded-full bg-black/70 border border-white/20 flex items-center justify-center text-white active:scale-95"
                onClick={() => { setImageBase64(null); setMinimapBase64(null); setMyMark(null); setAllyMarks([]); setEnemyMarks([]); }}>
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ) : (
          <div
            className="w-full h-28 rounded-xl border-2 border-dashed border-border/40 hover:border-primary/30 transition-colors cursor-pointer flex flex-col items-center justify-center gap-2 text-muted-foreground"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); const f=e.dataTransfer.files[0]; if(f) handleFile(f); }}
          >
            <Upload className="w-5 h-5" />
            <span className="text-sm">Upload screenshot</span>
            <span className="text-xs text-muted-foreground/50">Minimap auto-crops · timer auto-reads</span>
          </div>
        )}
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
          onChange={e => { const f=e.target.files?.[0]; if(f) handleFile(f); }} />

        {/* ── MINIMAP PANEL ────────────────────────────────────────────────── */}
        {imageBase64 && (
          <div className="bg-card/40 border border-border/40 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border/30 flex items-center justify-between">
              <span className="font-display text-xs tracking-widest uppercase text-muted-foreground">
                Minimap — tap zones
                {extracting && <span className="ml-2 inline-flex items-center gap-1 text-primary/70"><Sparkles className="w-3 h-3 animate-pulse" /> reading time…</span>}
              </span>
              {(myMark || allyMarks.length > 0 || enemyMarks.length > 0) && (
                <button onClick={() => { setMyMark(null); setAllyMarks([]); setEnemyMarks([]); }}
                  className="text-[10px] text-muted-foreground hover:text-white border border-border/30 px-2 py-1 rounded-full">
                  Clear
                </button>
              )}
            </div>

            <div className="p-3 space-y-3">
              {/* Mode selector */}
              <div className="flex gap-2">
                {(["me","ally","enemy"] as PinType[]).map(type => {
                  const b = PLACE_BTN[type];
                  const active = placeMode === type;
                  const count = type === "me" ? (myMark ? 1 : 0) : type === "ally" ? allyMarks.length : enemyMarks.length;
                  return (
                    <button key={type}
                      onClick={() => setPlaceMode(p => p === type ? null : type)}
                      className={cn("flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg border text-xs font-bold transition-all active:scale-95 font-display bg-black/30",
                        active ? b.active : `bg-black/30 ${b.idle}`)}>
                      {type === "me" && <UserRound className="w-3.5 h-3.5" />}
                      {type === "ally" && <Users className="w-3.5 h-3.5" />}
                      {type === "enemy" && <Swords className="w-3.5 h-3.5" />}
                      {type === "me" ? "Me" : type === "ally" ? "Ally" : "Enemy"}
                      {count > 0 && <span className={cn("w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center text-black", b.dot)}>{count}</span>}
                    </button>
                  );
                })}
              </div>

              {/* Instruction */}
              {placeMode && (
                <div className={cn("text-xs px-3 py-2 rounded-lg border text-center font-display tracking-wide",
                  placeMode === "me"    ? "bg-amber-400/10 border-amber-400/40 text-amber-400" :
                  placeMode === "ally"  ? "bg-sky-400/10   border-sky-400/40   text-sky-400" :
                                          "bg-red-500/10   border-red-500/40   text-red-400")}>
                  {placeMode === "me"    ? "Tap your location on the minimap" :
                   placeMode === "ally"  ? `Tap where allies are (${allyMarks.length}/4) — tap again to remove` :
                                          `Tap where enemies are (${enemyMarks.length}/5) — tap again to remove`}
                </div>
              )}

              {/* Minimap image + zone overlay */}
              <div className="relative w-full rounded-lg overflow-hidden border border-border/30" style={{ aspectRatio: "1" }}>
                {minimapBase64 ? (
                  <img src={minimapBase64} alt="Minimap" className="w-full h-full object-cover pointer-events-none" />
                ) : (
                  <div className="w-full h-full bg-slate-900/80 flex items-center justify-center">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground/40" />
                  </div>
                )}

                {/* Dark overlay when no mode active */}
                {!placeMode && (
                  <div className="absolute inset-0 bg-black/30 pointer-events-none" />
                )}

                {/* Zone buttons */}
                {MAP_ZONES.map(zone => (
                  <ZoneButton
                    key={zone.id}
                    zone={zone}
                    mode={placeMode}
                    myMark={myMark}
                    allyMarks={allyMarks}
                    enemyMarks={enemyMarks}
                    onTap={handleZoneTap}
                  />
                ))}
              </div>

              {/* Summary */}
              {(myMark || allyMarks.length > 0 || enemyMarks.length > 0) && (
                <div className="flex gap-2 flex-wrap">
                  {myMark && (
                    <span className="flex items-center gap-1.5 text-[10px] text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-full px-2.5 py-1">
                      <span className="w-2 h-2 rounded-full bg-amber-400" />
                      You: {MAP_ZONES.find(z=>z.id===myMark.zone)?.short}
                    </span>
                  )}
                  {allyMarks.map((m,i) => (
                    <span key={m.zone+i} className="flex items-center gap-1.5 text-[10px] text-sky-400 bg-sky-400/10 border border-sky-400/20 rounded-full px-2.5 py-1">
                      <span className="w-2 h-2 rounded-full bg-sky-400" />
                      A{i+1}: {MAP_ZONES.find(z=>z.id===m.zone)?.short}
                    </span>
                  ))}
                  {enemyMarks.map((m,i) => (
                    <span key={m.zone+i} className="flex items-center gap-1.5 text-[10px] text-red-400 bg-red-500/10 border border-red-400/20 rounded-full px-2.5 py-1">
                      <span className="w-2 h-2 rounded-full bg-red-500" />
                      E{i+1}: {MAP_ZONES.find(z=>z.id===m.zone)?.short}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── CONTEXT PANEL ────────────────────────────────────────────────── */}
        <div className="bg-card/40 border border-border/40 rounded-xl overflow-hidden">
          <button className="w-full flex items-center justify-between px-4 py-3 text-xs font-display tracking-widest uppercase text-muted-foreground"
            onClick={() => setContextOpen(o => !o)}>
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
                <div className="flex justify-between mb-2 items-center">
                  <span className="text-[10px] uppercase tracking-widest font-display text-muted-foreground">
                    Game Time
                    {extracting && <span className="ml-2 text-primary/70 inline-flex items-center gap-1"><Sparkles className="w-3 h-3 animate-pulse" /> auto-reading…</span>}
                  </span>
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
                        myRole === r ? "bg-primary/20 border-primary text-primary" : "bg-black/30 border-border/40 text-muted-foreground hover:border-primary/30")}>
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              {/* My champion */}
              <div>
                <span className="text-[10px] uppercase tracking-widest font-display text-muted-foreground">My Champion <span className="text-muted-foreground/40">(optional)</span></span>
                <button onClick={() => setChampPickOpen(true)}
                  className={cn("w-full mt-2 py-2.5 rounded-lg border text-sm font-medium transition-all active:scale-[0.98]",
                    myChamp ? "bg-amber-400/15 border-amber-400/50 text-amber-400" : "bg-black/30 border-border/40 text-muted-foreground hover:border-amber-400/40")}>
                  {myChamp ?? "+ Select champion (optional)"}
                </button>
              </div>

              {/* Objectives — 3-state */}
              <div>
                <span className="text-[10px] uppercase tracking-widest font-display text-muted-foreground">Objectives</span>
                <div className="space-y-2.5 mt-2">
                  <ObjControl label="Dragon" value={dragon} onChange={setDragon} />
                  <ObjControl label="Baron" value={baron} onChange={setBaron} />
                  <ObjControl label="Herald" value={herald} onChange={setHerald} />
                </div>
              </div>

            </div>
          )}
        </div>

        {/* ── ADVISE ME ────────────────────────────────────────────────────── */}
        <button onClick={getAdvice} disabled={!canAdvise}
          className={cn("w-full h-16 rounded-xl font-display text-xl font-bold tracking-widest uppercase transition-all relative overflow-hidden",
            canAdvise ? "bg-primary text-primary-foreground shadow-[0_0_30px_rgba(0,160,210,0.35)] hover:shadow-[0_0_45px_rgba(0,160,210,0.5)] active:scale-[0.98]"
                      : "bg-muted text-muted-foreground cursor-not-allowed opacity-60")}>
          {isAdvising
            ? <span className="flex items-center justify-center gap-3"><Loader2 className="w-5 h-5 animate-spin" /> Analyzing…</span>
            : <span className="flex items-center justify-center gap-3"><Target className="w-5 h-5" /> Advise Me</span>}
          {canAdvise && !isAdvising && <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full animate-[shimmer_2.5s_infinite]" />}
        </button>

        {/* ── ADVICE OUTPUT ────────────────────────────────────────────────── */}
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

        {/* ── CHAT ─────────────────────────────────────────────────────────── */}
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
              <Input placeholder="Ask anything…" className="bg-black/40 border-border/50 text-sm h-10"
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
        open={champPickOpen}
        title="Your Champion"
        selected={myChamp ? [myChamp] : []}
        max={1}
        onClose={() => setChampPickOpen(false)}
        onSelect={s => setMyChamp(s[0] ?? null)}
      />
    </div>
  );
}
