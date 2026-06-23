import { useState, useRef, useCallback, useEffect } from "react";
import { Link } from "wouter";
import { useModelStorage } from "@/hooks/use-model-storage";
import { useCropConfig, useTimerCropConfig, usePortraitConfig, usePortraitStripConfig, DEFAULT_PORTRAIT_CONFIG, useLanePaths, useZones, useFavoriteChamps, LanePaths, ZoneData, Point } from "@/hooks/use-map-config";
import { CropCalibrator } from "@/components/crop-calibrator";
import { PortraitPlacer } from "@/components/portrait-placer";
import { ZoneEditor } from "@/components/zone-editor";
import { PROMPT_KEY, DEFAULT_SYSTEM_PROMPT } from "@/hooks/use-system-prompt";
import {
  GameContext,
  useCreateOpenrouterConversation,
  usePatchOpenrouterConversation,
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
  ChevronDown, ChevronUp, Crop, Map, Star, RotateCcw, Bug, Timer, Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Champions ────────────────────────────────────────────────────────────────
const CHAMPIONS = [
  "Ahri","Akali","Akshan","Alistar","Amumu","Annie","Ashe","Aurelion Sol",
  "Blitzcrank","Brand","Braum",
  "Caitlyn","Camille","Cho'Gath","Corki",
  "Darius","Diana","Dr. Mundo","Draven",
  "Ekko","Elise","Evelynn","Ezreal",
  "Fiora","Fizz",
  "Galio","Garen","Gragas","Graves",
  "Heimerdinger",
  "Irelia",
  "Janna","Jarvan IV","Jax","Jayce","Jhin","Jinx",
  "Kai'Sa","Karma","Kassadin","Katarina","Kayle","Kennen","Kha'Zix","Kog'Maw",
  "LeBlanc","Lee Sin","Leona","Lucian","Lulu","Lux",
  "Malphite","Malzahar","Master Yi","Miss Fortune","Morgana",
  "Nami","Nasus","Nunu",
  "Olaf","Orianna",
  "Pantheon",
  "Rammus","Renekton","Rengar","Riven",
  "Seraphine","Senna","Sett","Singed","Sona","Soraka",
  "Teemo","Thresh","Tristana","Tryndamere","Twisted Fate","Twitch",
  "Varus","Vayne","Veigar","Vi","Viego","Vladimir",
  "Wukong",
  "Xayah","Xin Zhao",
  "Yasuo","Yone","Yuumi",
  "Zed","Ziggs","Zilean","Zoe","Zyra",
];
const ROLES = ["Top","Jungle","Mid","ADC","Support"] as const;
type Role = typeof ROLES[number];
type ObjStatus = "up" | "soon" | "down" | null;
type BuffHolder = "us" | "them" | null;
type PinType = "me" | "ally" | "enemy";
type PlaceMode = PinType | null;

// ─── Position types ────────────────────────────────────────────────────────────
type LanePos = { kind: "lane"; lane: string; progress: number; category: string };
type ZonePos = { kind: "zone"; zone: string };
type PosInfo = LanePos | ZonePos;

interface MapPin { id: string; type: PinType; x: number; y: number; pos: PosInfo; champ: string | null }

// ─── Session persistence ───────────────────────────────────────────────────────
const SESSION_KEY = "wildrift_session";
const SESSION_IMG_KEY = "wildrift_session_img";

let _cachedSession: Record<string, unknown> | null = null;
function loadSession(): Record<string, unknown> {
  if (_cachedSession !== null) return _cachedSession;
  try {
    const ctx = localStorage.getItem(SESSION_KEY);
    const img = localStorage.getItem(SESSION_IMG_KEY);
    const ctxData = ctx ? JSON.parse(ctx) as Record<string, unknown> : {};
    const imgData = img ? JSON.parse(img) as Record<string, unknown> : {};
    _cachedSession = { ...ctxData, ...imgData };
  } catch { _cachedSession = {}; }
  return _cachedSession!;
}
function saveSession(data: Record<string, unknown>) {
  // Keep module-level cache current so component remounts read latest state (not original mount state)
  _cachedSession = { ...data };
  // Split images (large) from context (small) so context always saves even if images exceed quota
  const { imageBase64, minimapBase64, ...ctx } = data;
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(ctx)); } catch {}
  try { localStorage.setItem(SESSION_IMG_KEY, JSON.stringify({ imageBase64, minimapBase64 })); } catch {}
}
function clearSessionStorage() {
  _cachedSession = null;
  try { localStorage.removeItem(SESSION_KEY); } catch {}
  try { localStorage.removeItem(SESSION_IMG_KEY); } catch {}
}

// ─── Geometry helpers ─────────────────────────────────────────────────────────
function segmentProject(px:number,py:number,ax:number,ay:number,bx:number,by:number){
  const dx=bx-ax,dy=by-ay,lenSq=dx*dx+dy*dy;
  if(lenSq===0)return{dist:Math.hypot(px-ax,py-ay),t:0};
  const t=Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/lenSq));
  return{dist:Math.hypot(px-(ax+t*dx),py-(ay+t*dy)),t};
}

function polylineProject(px:number,py:number,path:Point[]):{dist:number;progress:number}{
  const segs:number[]=[];let totalLen=0;
  for(let i=0;i<path.length-1;i++){
    const l=Math.hypot(path[i+1].x-path[i].x,path[i+1].y-path[i].y);
    segs.push(l);totalLen+=l;
  }
  let minDist=Infinity,bestProg=0,cumLen=0;
  for(let i=0;i<path.length-1;i++){
    const{dist,t}=segmentProject(px,py,path[i].x,path[i].y,path[i+1].x,path[i+1].y);
    if(dist<minDist){minDist=dist;bestProg=(cumLen+t*segs[i])/totalLen*100;}
    cumLen+=segs[i];
  }
  return{dist:minDist,progress:bestProg};
}

function laneCategory(p:number):string{
  if(p<20)return"Near Our Tower";
  if(p<40)return"Safe Side";
  if(p<60)return"River Area";
  if(p<80)return"Enemy Side";
  return"Deep Push";
}

function pointInPolygon(px:number,py:number,poly:Point[]):boolean{
  let inside=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const xi=poly[i]!.x,yi=poly[i]!.y,xj=poly[j]!.x,yj=poly[j]!.y;
    const hit=((yi>py)!==(yj>py))&&(px<(xj-xi)*(py-yi)/(yj-yi)+xi);
    if(hit)inside=!inside;
  }
  return inside;
}

function classifyPos(x:number,y:number,lanePaths:LanePaths,zones:ZoneData[]):PosInfo{
  // 1. Polygon zones have priority
  for(const z of zones){
    if(z.points.length>=3&&pointInPolygon(x,y,z.points))return{kind:"zone",zone:z.label};
  }
  // 2. Lanes
  const lanes=[
    {name:"Baron Lane", path:lanePaths.baron},
    {name:"Mid Lane",   path:lanePaths.mid},
    {name:"Dragon Lane",path:lanePaths.dragon},
  ];
  let bestLane:{name:string;dist:number;progress:number}|null=null;
  for(const l of lanes){
    const{dist,progress}=polylineProject(x,y,l.path);
    if(!bestLane||dist<bestLane.dist)bestLane={name:l.name,dist,progress};
  }
  const LANE_THRESH=14;
  if(bestLane&&bestLane.dist<LANE_THRESH){
    return{kind:"lane",lane:bestLane.name,progress:Math.round(bestLane.progress),category:laneCategory(bestLane.progress)};
  }
  // 3. Nearest zone centroid fallback
  let bestZone:{label:string;dist:number}|null=null;
  for(const z of zones){
    const cx=z.points.reduce((s,p)=>s+p.x,0)/z.points.length;
    const cy=z.points.reduce((s,p)=>s+p.y,0)/z.points.length;
    const dist=Math.hypot(x-cx,y-cy);
    if(!bestZone||dist<bestZone.dist)bestZone={label:z.label,dist};
  }
  return{kind:"zone",zone:bestZone?.label??"Unknown"};
}

function posLabel(pos:PosInfo):string{
  if(pos.kind==="lane")return`${pos.lane} ${pos.progress}% (${pos.category})`;
  return pos.zone;
}

// ─── Render annotated minimap onto canvas → base64 ───────────────────────────
function loadImg(src:string):Promise<HTMLImageElement>{
  return new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=src;});
}
async function renderAnnotatedMinimap(
  minimapDataUrl:string,
  pins:MapPin[],
  scoreboardCropDataUrl?:string|null,
  portraitStripDataUrl?:string|null,
):Promise<string>{
  const img=await loadImg(minimapDataUrl);
  const W=img.naturalWidth*2,H=img.naturalHeight*2;
  const pad=10,labelFs=Math.round(W*0.042);
  const cropW=Math.round(W*0.96);

  // Pre-load scoreboard image
  let scoreImg:HTMLImageElement|null=null;
  if(scoreboardCropDataUrl){try{scoreImg=await loadImg(scoreboardCropDataUrl);}catch{}}
  const scoreImgH=scoreImg?Math.round(cropW*(scoreImg.naturalHeight/scoreImg.naturalWidth)):0;
  const scoreStripH=scoreImg?labelFs+pad*3+scoreImgH:0;

  // Pre-load portrait strip image
  let portraitImg:HTMLImageElement|null=null;
  if(portraitStripDataUrl){try{portraitImg=await loadImg(portraitStripDataUrl);}catch{}}
  const portraitImgH=portraitImg?Math.round(cropW*(portraitImg.naturalHeight/portraitImg.naturalWidth)):0;
  const portraitStripH=portraitImg?labelFs+pad*3+portraitImgH:0;

  const canvas=document.createElement("canvas");
  canvas.width=W;canvas.height=H+scoreStripH+portraitStripH;
  const ctx=canvas.getContext("2d")!;
  ctx.drawImage(img,0,0,W,H);

  // Draw pins
  const r=Math.round(W*0.05);
  const allyPins=pins.filter(p=>p.type==="ally");
  const enemyPins=pins.filter(p=>p.type==="enemy");
  for(const pin of pins){
    const px=pin.x/100*W,py=pin.y/100*H;
    const color=pin.type==="me"?"#FBBF24":pin.type==="ally"?"#38BDF8":"#EF4444";
    const outline=pin.type==="me"?"#92400E":pin.type==="ally"?"#0C4A6E":"#7F1D1D";
    const label=pin.type==="me"?"ME":pin.type==="ally"?`A${allyPins.indexOf(pin)+1}`:`E${enemyPins.indexOf(pin)+1}`;
    ctx.shadowColor="rgba(0,0,0,0.8)";ctx.shadowBlur=8;
    ctx.beginPath();ctx.arc(px,py,r,0,Math.PI*2);
    ctx.fillStyle=color+"DD";ctx.fill();ctx.shadowBlur=0;
    ctx.strokeStyle=outline;ctx.lineWidth=Math.max(2,r*0.18);ctx.stroke();
    ctx.fillStyle="#000";
    ctx.font=`bold ${Math.round(r*1.1)}px sans-serif`;
    ctx.textAlign="center";ctx.textBaseline="middle";
    ctx.fillText(label,px,py);
    if(pin.champ){
      const tagW=ctx.measureText(pin.champ).width+8;
      ctx.fillStyle="rgba(0,0,0,0.75)";
      ctx.beginPath();ctx.roundRect(px-tagW/2,py+r+2,tagW,Math.round(r*0.85),3);ctx.fill();
      ctx.fillStyle="#fff";ctx.font=`${Math.round(r*0.72)}px sans-serif`;
      ctx.fillText(pin.champ,px,py+r+2+Math.round(r*0.42));
    }
  }

  // Draw scoreboard strip BELOW minimap
  let nextY=H;
  if(scoreImg){
    ctx.fillStyle="#0a111e";ctx.fillRect(0,nextY,W,scoreStripH);
    ctx.strokeStyle="#1e3a5f";ctx.lineWidth=2;
    ctx.beginPath();ctx.moveTo(0,nextY+1);ctx.lineTo(W,nextY+1);ctx.stroke();
    ctx.fillStyle="#93c5fd";ctx.font=`bold ${labelFs}px sans-serif`;
    ctx.textAlign="left";ctx.textBaseline="top";
    ctx.fillText("SCOREBOARD:",pad,nextY+pad);
    ctx.drawImage(scoreImg,pad,nextY+pad+labelFs+pad,cropW,scoreImgH);
    nextY+=scoreStripH;
  }

  // Draw portrait strip BELOW scoreboard
  if(portraitImg){
    ctx.fillStyle="#0a1020";ctx.fillRect(0,nextY,W,portraitStripH);
    ctx.strokeStyle="#1e3a5f";ctx.lineWidth=2;
    ctx.beginPath();ctx.moveTo(0,nextY+1);ctx.lineTo(W,nextY+1);ctx.stroke();
    ctx.fillStyle="#86efac";ctx.font=`bold ${labelFs}px sans-serif`;
    ctx.textAlign="left";ctx.textBaseline="top";
    ctx.fillText("PORTRAITS (respawn timers):",pad,nextY+pad);
    ctx.drawImage(portraitImg,pad,nextY+pad+labelFs+pad,cropW,portraitImgH);
  }

  return canvas.toDataURL("image/jpeg",0.92);
}

// ─── Crop helper ──────────────────────────────────────────────────────────────
async function cropDataUrl(dataUrl:string,xPct:number,yPct:number,wPct:number,hPct:number):Promise<string>{
  return new Promise(resolve=>{
    const img=new Image();
    img.onload=()=>{
      const W=img.naturalWidth,H=img.naturalHeight;
      const canvas=document.createElement("canvas");
      canvas.width=Math.round(W*wPct/100);canvas.height=Math.round(H*hPct/100);
      canvas.getContext("2d")!.drawImage(img,
        Math.round(W*xPct/100),Math.round(H*yPct/100),canvas.width,canvas.height,
        0,0,canvas.width,canvas.height);
      resolve(canvas.toDataURL("image/jpeg",0.93));
    };
    img.src=dataUrl;
  });
}

function fmt(s:number){return`${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;}
function timeToSecs(t:string){const[m,s]=t.split(":").map(Number);return(m??0)*60+(s??0);}

// ─── ChampionPicker ───────────────────────────────────────────────────────────
function ChampionPicker({open,title,selected,max,onClose,onSelect,favorites,onToggleFav}:{
  open:boolean;title:string;selected:string[];max:number;
  onClose:()=>void;onSelect:(c:string[])=>void;
  favorites?:string[];onToggleFav?:(c:string)=>void;
}){
  const[search,setSearch]=useState("");
  const favs=favorites??[];
  const filtered=CHAMPIONS.filter(c=>c.toLowerCase().includes(search.toLowerCase()));
  const toggle=(c:string)=>{
    if(selected.includes(c))onSelect(selected.filter(s=>s!==c));
    else if(selected.length<max){onSelect([...selected,c]);if(max===1)onClose();}
  };
  return(
    <Dialog open={open} onOpenChange={o=>{if(!o)onClose();}}>
      <DialogContent className="max-w-sm w-full bg-[#0b1120] border-border p-0 gap-0 max-h-[80vh] flex flex-col">
        <DialogHeader className="p-4 border-b border-border/50 shrink-0">
          <DialogTitle className="text-sm font-display tracking-wider text-primary uppercase">
            {title}{max>1&&<span className="text-muted-foreground font-normal ml-1">({selected.length}/{max})</span>}
          </DialogTitle>
        </DialogHeader>
        <div className="p-3 border-b border-border/30 shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"/>
            <Input autoFocus placeholder="Search…" className="pl-9 h-9 bg-black/40 text-sm"
              value={search} onChange={e=>setSearch(e.target.value)}/>
          </div>
        </div>
        {/* Favorites quick row */}
        {favs.length>0&&!search&&(
          <div className="px-3 pt-2.5 pb-2 border-b border-border/20 shrink-0">
            <p className="text-[9px] uppercase tracking-widest text-amber-400/70 mb-2 font-display">⭐ Favorites</p>
            <div className="flex flex-wrap gap-1.5">
              {favs.map(c=>(
                <button key={c} onClick={()=>toggle(c)}
                  className={cn("text-xs px-2.5 py-1 rounded-full border transition-all active:scale-95",
                    selected.includes(c)?"bg-amber-400/25 border-amber-400 text-amber-300":"bg-black/40 border-amber-400/30 text-amber-300/80 hover:border-amber-400/60")}>
                  {c}
                </button>
              ))}
            </div>
          </div>
        )}
        {selected.length>0&&(
          <div className="px-3 pt-2 pb-1 flex flex-wrap gap-1.5 shrink-0">
            {selected.map(c=>(
              <button key={c} onClick={()=>toggle(c)}
                className="text-xs px-2.5 py-1 rounded-full bg-primary/20 text-primary border border-primary/40 flex items-center gap-1.5">
                {c}<X className="w-3 h-3"/>
              </button>
            ))}
          </div>
        )}
        <div className="overflow-y-auto flex-1 p-2">
          <div className="grid grid-cols-3 gap-1.5">
            {filtered.map(c=>{
              const sel=selected.includes(c);
              const full=!sel&&selected.length>=max;
              const isFav=favs.includes(c);
              return(
                <div key={c} className="relative">
                  <button onClick={()=>toggle(c)} disabled={full}
                    className={cn("w-full rounded-md px-2 py-2.5 text-xs font-medium text-center transition-all active:scale-95",
                      sel?"bg-primary/25 text-primary border border-primary/50"
                      :full?"opacity-30 cursor-not-allowed bg-black/20 border border-border/20"
                      :"bg-black/30 text-slate-300 border border-border/30 hover:border-primary/30 hover:text-primary")}>
                    {c}
                  </button>
                  {onToggleFav&&(
                    <button onClick={e=>{e.stopPropagation();onToggleFav(c);}}
                      className="absolute top-0.5 right-0.5 p-0.5 leading-none text-[10px]"
                      title={isFav?"Remove from favorites":"Add to favorites"}>
                      <Star className={cn("w-2.5 h-2.5",isFav?"fill-amber-400 text-amber-400":"text-muted-foreground/40 hover:text-amber-400")}/>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        {max>1&&(
          <div className="p-3 border-t border-border/30 shrink-0">
            <Button className="w-full h-10 font-display tracking-wider" onClick={onClose}>Done</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── ObjControl ───────────────────────────────────────────────────────────────
function ObjControl({label,value,onChange}:{label:string;value:ObjStatus;onChange:(v:ObjStatus)=>void}){
  const states=[
    {v:"up"  as const,label:"UP",  a:"bg-emerald-500/25 text-emerald-400 border-emerald-500",i:"text-muted-foreground hover:border-emerald-500/40"},
    {v:"soon"as const,label:"SOON",a:"bg-amber-500/25  text-amber-400  border-amber-500",    i:"text-muted-foreground hover:border-amber-500/40"},
    {v:"down"as const,label:"DOWN",a:"bg-red-500/25    text-red-400    border-red-500",       i:"text-muted-foreground hover:border-red-400/40"},
  ];
  return(
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] font-display uppercase tracking-widest text-muted-foreground/70 text-center">{label}</span>
      <div className="flex rounded-lg overflow-hidden border border-border/30 divide-x divide-border/30">
        {states.map(s=>(
          <button key={s.v} onClick={()=>onChange(value===s.v?null:s.v)}
            className={cn("flex-1 text-[11px] font-bold py-2.5 transition-all active:scale-95",
              value===s.v?s.a:`bg-black/40 border-0 ${s.i}`)}>
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

interface StreamingMsg{role:"user"|"assistant";content:string;streaming?:boolean}

function BuffControl({label,value,onChange}:{label:string;value:BuffHolder;onChange:(v:BuffHolder)=>void}){
  const opts=[
    {v:"us"as const,label:"US",a:"bg-emerald-500/25 text-emerald-400 border-emerald-500/60",i:"text-muted-foreground hover:text-emerald-400"},
    {v:"them"as const,label:"THEM",a:"bg-red-500/25 text-red-400 border-red-500/60",i:"text-muted-foreground hover:text-red-400"},
  ] as const;
  return(
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] font-display uppercase tracking-widest text-muted-foreground/70 text-center">{label}</span>
      <div className="flex rounded-lg overflow-hidden border border-border/30 divide-x divide-border/30">
        {opts.map(s=>(
          <button key={s.v} onClick={()=>onChange(value===s.v?null:s.v)}
            className={cn("flex-1 text-[11px] font-bold py-2.5 transition-all active:scale-95",
              value===s.v?s.a:`bg-black/40 ${s.i}`)}>
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
export default function CoachPage(){
  const queryClient=useQueryClient();
  const[model]=useModelStorage();
  const{config:cropConfig,save:saveCrop}=useCropConfig();
  const{config:timerCropConfig,save:saveTimerCrop}=useTimerCropConfig();
  const{config:portraitStripConfig,save:savePortraitStrip}=usePortraitStripConfig();
  const{config:portraitConfig,save:savePortraitConfig}=usePortraitConfig();
  const{paths:lanePaths,save:saveLanes}=useLanePaths();
  const{zones,save:saveZones}=useZones();
  const{favorites,toggle:toggleFav}=useFavoriteChamps();

  // Load persisted session once on mount
  const[_sess]=useState(()=>loadSession());

  // Screenshot
  const[imageBase64,setImageBase64]=useState<string|null>((_sess.imageBase64 as string|null)??null);
  const[minimapBase64,setMinimapBase64]=useState<string|null>((_sess.minimapBase64 as string|null)??null);
  const fileInputRef=useRef<HTMLInputElement>(null);

  // Calibration modals
  const[showCropEditor,setShowCropEditor]=useState(false);
  const[showTimerCropEditor,setShowTimerCropEditor]=useState(false);
  const[showPortraitBarEditor,setShowPortraitBarEditor]=useState(false);
  const[showPortraitStripEditor,setShowPortraitStripEditor]=useState(false);
  const[showZoneEditor,setShowZoneEditor]=useState(false);

  // Crop images (stored in state only — too large for localStorage)
  const[gameTimeCrop,setGameTimeCrop]=useState<string|null>(null);
  const[portraitStripCrop,setPortraitStripCrop]=useState<string|null>(null);

  // Pins
  const[pins,setPins]=useState<MapPin[]>((_sess.pins as MapPin[])??[]);
  const[placeMode,setPlaceMode]=useState<PlaceMode>(null);
  const minimapDivRef=useRef<HTMLDivElement>(null);

  // Context
  const[gameTimeSecs,setGameTimeSecs]=useState((_sess.gameTimeSecs as number)??0);
  const gameTimeSecsRef=useRef((_sess.gameTimeSecs as number)??0);
  const[myRole,setMyRole]=useState<Role|null>((_sess.myRole as Role|null)??null);
  const[myChamp,setMyChamp]=useState<string|null>((_sess.myChamp as string|null)??null);
  const[dragon,setDragon]=useState<ObjStatus>((_sess.dragon as ObjStatus)??null);
  const[elderDragon,setElderDragon]=useState<ObjStatus>((_sess.elderDragon as ObjStatus)??null);
  const[baron,setBaron]=useState<ObjStatus>((_sess.baron as ObjStatus)??null);
  const[herald,setHerald]=useState<ObjStatus>((_sess.herald as ObjStatus)??null);
  const[baronBuff,setBaronBuff]=useState<BuffHolder>((_sess.baronBuff as BuffHolder)??null);
  const[elderBuff,setElderBuff]=useState<BuffHolder>((_sess.elderBuff as BuffHolder)??null);
  const[alliesDown,setAlliesDown]=useState<number[]>((_sess.alliesDown as number[])??[]);
  const[enemiesDown,setEnemiesDown]=useState<number[]>((_sess.enemiesDown as number[])??[]);
  const[contextOpen,setContextOpen]=useState(true);
  const[champPickOpen,setChampPickOpen]=useState(false);

  // Advice
  const[advice,setAdvice]=useState((_sess.advice as string)??'');
  const[isAdvising,setIsAdvising]=useState(false);
  const[debugInfo,setDebugInfo]=useState<{systemPrompt:string;userText:string}|null>(()=>{
    try{const s=sessionStorage.getItem("wr_debug_info");return s?JSON.parse(s):null;}catch{return null;}
  });
  const[debugMinimapUrl,setDebugMinimapUrl]=useState<string|null>(()=>{
    try{return sessionStorage.getItem("wr_debug_minimap");}catch{return null;}
  });
  const[showDebug,setShowDebug]=useState(false);

  // Chat
  const[userNotes,setUserNotes]=useState<string>((_sess.userNotes as string)??'');
  const[activeConversationId,setActiveConversationId]=useState<number|null>((_sess.activeConversationId as number|null)??null);
  const[chatMessages,setChatMessages]=useState<StreamingMsg[]>([]);
  const[chatInput,setChatInput]=useState("");
  const[isChatting,setIsChatting]=useState(false);
  const chatEndRef=useRef<HTMLDivElement>(null);

  const{data:conversations}=useListOpenrouterConversations();
  const{data:conversationData}=useGetOpenrouterConversation(
    activeConversationId as number,
    {query:{enabled:!!activeConversationId,queryKey:getGetOpenrouterConversationQueryKey(activeConversationId as number)}}
  );
  const createConversation=useCreateOpenrouterConversation();
  const patchConversation=usePatchOpenrouterConversation();

  // ── Persist session to localStorage on every change ───────────────────────────
  useEffect(()=>{
    saveSession({imageBase64,minimapBase64,pins,myRole,myChamp,dragon,elderDragon,baron,herald,baronBuff,elderBuff,alliesDown,enemiesDown,gameTimeSecs,activeConversationId,advice,userNotes});
  },[imageBase64,minimapBase64,pins,myRole,myChamp,dragon,baron,herald,baronBuff,elderBuff,alliesDown,enemiesDown,gameTimeSecs,activeConversationId,advice,userNotes]);

  const handleClearSession=useCallback(()=>{
    clearSessionStorage();
    setImageBase64(null);setMinimapBase64(null);setGameTimeCrop(null);setPins([]);setPlaceMode(null);
    setMyRole(null);setMyChamp(null);setDragon(null);setElderDragon(null);setBaron(null);setHerald(null);
    setBaronBuff(null);setElderBuff(null);setAlliesDown([]);setEnemiesDown([]);
    setUserNotes('');setGameTimeSecs(0);setActiveConversationId(null);setAdvice("");setChatMessages([]);
    setDebugInfo(null);setDebugMinimapUrl(null);setPortraitStripCrop(null);
  },[]);

  // ── Re-crop minimap with current config ──────────────────────────────────────
  const recropMinimap=useCallback(async(dataUrl:string,cfg=cropConfig)=>{
    const m=await cropDataUrl(dataUrl,cfg.x,cfg.y,cfg.w,cfg.h);
    setMinimapBase64(m);
    return m;
  },[cropConfig]);

  // ── Process uploaded image ──────────────────────────────────────────────────
  const processImage=useCallback(async(dataUrl:string)=>{
    setImageBase64(dataUrl);setMinimapBase64(null);setPins([]);setPlaceMode(null);
    setAlliesDown([]);setEnemiesDown([]);setGameTimeCrop(null);setPortraitStripCrop(null);
    await recropMinimap(dataUrl);
    try{
      const strip=await cropDataUrl(dataUrl,timerCropConfig.x,timerCropConfig.y,timerCropConfig.w,timerCropConfig.h);
      setGameTimeCrop(strip);
    }catch{}
    try{
      const ps=await cropDataUrl(dataUrl,portraitStripConfig.x,portraitStripConfig.y,portraitStripConfig.w,portraitStripConfig.h);
      setPortraitStripCrop(ps);
    }catch{}
  },[recropMinimap,timerCropConfig,portraitStripConfig]);

  const handleFile=(file:File)=>{
    const reader=new FileReader();
    reader.onload=e=>{const r=e.target?.result as string;if(r)processImage(r);};
    reader.readAsDataURL(file);
  };

  // ── Save crop config and immediately re-crop if we have a screenshot ────────
  const handleSaveCrop=useCallback(async(cfg:typeof cropConfig)=>{
    saveCrop(cfg);
    if(imageBase64)await recropMinimap(imageBase64,cfg);
  },[saveCrop,imageBase64,recropMinimap]);

  // ── Save timer-crop config and immediately re-crop ───────────────────────
  const handleSaveTimerCrop=useCallback(async(cfg:typeof timerCropConfig)=>{
    saveTimerCrop(cfg);
    if(!imageBase64)return;
    try{
      const strip=await cropDataUrl(imageBase64,cfg.x,cfg.y,cfg.w,cfg.h);
      setGameTimeCrop(strip);
    }catch{}
  },[saveTimerCrop,imageBase64]);

  // ── Save portrait-strip config and immediately re-crop ───────────────────
  const handleSavePortraitStrip=useCallback(async(cfg:typeof portraitStripConfig)=>{
    savePortraitStrip(cfg);
    if(!imageBase64)return;
    try{
      const ps=await cropDataUrl(imageBase64,cfg.x,cfg.y,cfg.w,cfg.h);
      setPortraitStripCrop(ps);
    }catch{}
  },[savePortraitStrip,imageBase64]);

  // ── Tap on minimap ──────────────────────────────────────────────────────────
  const handleMinimapTap=useCallback((e:React.MouseEvent|React.TouchEvent)=>{
    if(!placeMode||!minimapDivRef.current)return;
    const target=e.target as HTMLElement;
    if(target.closest("[data-pin]"))return;
    const rect=minimapDivRef.current.getBoundingClientRect();
    let cx:number,cy:number;
    if("touches" in e){cx=e.touches[0]!.clientX;cy=e.touches[0]!.clientY;}
    else{cx=(e as React.MouseEvent).clientX;cy=(e as React.MouseEvent).clientY;}
    const x=Math.max(0,Math.min(100,(cx-rect.left)/rect.width*100));
    const y=Math.max(0,Math.min(100,(cy-rect.top)/rect.height*100));
    const pos=classifyPos(x,y,lanePaths,zones);
    if(placeMode==="me"){
      setPins(p=>[...p.filter(pp=>pp.type!=="me"),{id:`me-${Date.now()}`,type:"me",x,y,pos,champ:myChamp}]);
    }else if(placeMode==="ally"){
      if(pins.filter(p=>p.type==="ally").length>=4)return;
      setPins(p=>[...p,{id:`ally-${Date.now()}`,type:"ally",x,y,pos,champ:null}]);
    }else{
      if(pins.filter(p=>p.type==="enemy").length>=5)return;
      setPins(p=>[...p,{id:`enemy-${Date.now()}`,type:"enemy",x,y,pos,champ:null}]);
    }
  },[placeMode,myChamp,pins,lanePaths,zones]);

  const removePin=(id:string)=>setPins(p=>p.filter(pp=>pp.id!==id));

  // ── Mirror of server buildUserMessage — shows the exact text the AI receives ─
  const buildUserMessageText=useCallback((ctx:ReturnType<typeof buildContext>,hasImage:boolean):string=>{
    const parts:string[]=[];
    parts.push("**Current Game State:**");
    if(ctx.gameTime)parts.push(`- Game time: ${ctx.gameTime}`);
    if(ctx.myRole)parts.push(`- My role: ${ctx.myRole}`);
    if(ctx.myLocation)parts.push(`- My location: ${ctx.myLocation}`);
    if(ctx.allyChampions)parts.push(`- Ally champions: ${ctx.allyChampions}`);
    if(ctx.enemyChampions)parts.push(`- Enemy champions: ${ctx.enemyChampions}`);
    if(ctx.dragonStatus)parts.push(`- Dragon: ${ctx.dragonStatus}`);
    if(ctx.elderDragonStatus)parts.push(`- Elder Dragon: ${ctx.elderDragonStatus}`);
    if(ctx.baronStatus)parts.push(`- Baron: ${ctx.baronStatus}`);
    if(ctx.riftHeraldStatus)parts.push(`- Rift Herald: ${ctx.riftHeraldStatus}`);
    if(ctx.additionalNotes)parts.push(`- Additional notes: ${ctx.additionalNotes}`);
    parts.push("\n⚠️ IMPORTANT: Do NOT name or guess any champion from the minimap image. Only use champion names I have explicitly provided above. Refer to unknown pins only as A1/A2/E1/E2 etc.");
    if(hasImage)parts.push("\nAnalyze the attached minimap and provide macro advice based on the game state above.");
    else if(parts.length>1)parts.push("\nBased on the game state above, what should I do right now?");
    else parts.push("What should I focus on macro-wise right now?");
    return parts.join("\n");
  },[]);

  // ── Build context ────────────────────────────────────────────────────────────
  const buildContext=useCallback(():GameContext=>{
    const myPin=pins.find(p=>p.type==="me");
    const allyPins=pins.filter(p=>p.type==="ally");
    const enemyPins=pins.filter(p=>p.type==="enemy");
    return{
      gameTime:gameTimeSecs>0?fmt(gameTimeSecs):null,
      myRole:myRole??null,
      myLocation:myPin?posLabel(myPin.pos):null,
      allyChampions:allyPins.length?allyPins.map((p,i)=>{const l=posLabel(p.pos);return p.champ?`${p.champ}(A${i+1}) at ${l}`:`Ally ${i+1} at ${l}`;}).join(", "):null,
      enemyChampions:enemyPins.length?enemyPins.map((p,i)=>{const l=posLabel(p.pos);return p.champ?`${p.champ}(E${i+1}) at ${l}`:`Enemy ${i+1} at ${l}`;}).join(", "):null,
      dragonStatus:dragon??null,elderDragonStatus:elderDragon??null,baronStatus:baron??null,riftHeraldStatus:herald??null,
      goldDiff:null,score:null,
      additionalNotes:(()=>{
        const parts:string[]=[];
        if(myChamp)parts.push(`I am playing ${myChamp}`);
        if(baronBuff==="us")parts.push("We have Baron Buff");
        else if(baronBuff==="them")parts.push("Enemy has Baron Buff");
        if(elderBuff==="us")parts.push("We have Elder Dragon Buff");
        else if(elderBuff==="them")parts.push("Enemy has Elder Dragon Buff");
        if(alliesDown.length>0)parts.push(`Dead allies: ${alliesDown.sort().map(n=>`A${n}`).join(", ")}`);
        if(enemiesDown.length>0)parts.push(`Dead enemies: ${enemiesDown.sort().map(n=>`E${n}`).join(", ")}`);
        if(userNotes.trim())parts.push(userNotes.trim());
        return parts.length?parts.join(". "):null;
      })(),
    };
  },[pins,gameTimeSecs,myRole,myChamp,dragon,elderDragon,baron,herald,baronBuff,elderBuff,alliesDown,enemiesDown,userNotes]);

  // Always return annotated minimap when available (with pins + game-time crop if present)
  const getAnnotatedMinimap=useCallback(async():Promise<string|null>=>{
    if(!minimapBase64)return null;
    return renderAnnotatedMinimap(minimapBase64,pins,gameTimeCrop,portraitStripCrop);
  },[minimapBase64,pins,gameTimeCrop,portraitStripCrop]);

  // Persist debug info to sessionStorage so it survives refresh / tab switch
  useEffect(()=>{
    try{
      if(debugInfo)sessionStorage.setItem("wr_debug_info",JSON.stringify(debugInfo));
      else sessionStorage.removeItem("wr_debug_info");
    }catch{}
  },[debugInfo]);
  useEffect(()=>{
    try{
      if(debugMinimapUrl)sessionStorage.setItem("wr_debug_minimap",debugMinimapUrl);
      else sessionStorage.removeItem("wr_debug_minimap");
    }catch{}
  },[debugMinimapUrl]);

  // Keep ref in sync so async callbacks always read the latest game time
  useEffect(() => { gameTimeSecsRef.current = gameTimeSecs; }, [gameTimeSecs]);

  // ── Advise ────────────────────────────────────────────────────────────────────
  const getAdvice=async()=>{
    if(!model)return;
    setIsAdvising(true);setAdvice("");
    try{
      const annotated=await getAnnotatedMinimap();
      const ctx=buildContext();
      const customPrompt=localStorage.getItem(PROMPT_KEY);
      const sysPrompt=customPrompt??DEFAULT_SYSTEM_PROMPT;
      const userText=buildUserMessageText(ctx,!!annotated);
      setDebugInfo({systemPrompt:sysPrompt,userText});
      setDebugMinimapUrl(annotated);
      const BASE=import.meta.env.BASE_URL;
      const res=await fetch(`${BASE}api/coach/analyze`,{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          model,
          imageBase64:null,
          minimapBase64:annotated?.split(",")[1]??null,
          context:ctx,
          systemPrompt:localStorage.getItem("wildrift_system_prompt")||undefined,
        }),
      });
      if(!res.ok)throw new Error();
      const reader=res.body!.getReader();const dec=new TextDecoder();let buf="";
      while(true){
        const{done,value}=await reader.read();if(done)break;
        buf+=dec.decode(value,{stream:true});
        const lines=buf.split("\n");buf=lines.pop()||"";
        for(const line of lines){
          if(!line.startsWith("data: "))continue;
          try{
            const d=JSON.parse(line.slice(6));
            if(d.content)setAdvice(p=>p+d.content);
            if(d.done){
              const gts=gameTimeSecsRef.current;
              const newTitle=gts>0?`@ ${fmt(gts)}`:`Game ${new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}`;
              if(!activeConversationId){
                const conv=await createConversation.mutateAsync({data:{title:newTitle,model}});
                setActiveConversationId(conv.id);
              } else {
                await patchConversation.mutateAsync({id:activeConversationId,data:{title:newTitle}});
              }
              queryClient.invalidateQueries({queryKey:getListOpenrouterConversationsQueryKey()});
            }
          }catch{}
        }
      }
    }catch{setAdvice("Error — check model in Settings and try again.");}
    finally{setIsAdvising(false);}
  };

  // ── Chat ──────────────────────────────────────────────────────────────────────
  const sendChat=async(e:React.FormEvent)=>{
    e.preventDefault();
    if(!chatInput.trim()||!model)return;
    let convId=activeConversationId;
    if(!convId){
      const gts=gameTimeSecsRef.current;
      const conv=await createConversation.mutateAsync({data:{title:gts>0?`@ ${fmt(gts)}`:`Game ${new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}`,model}});
      convId=conv.id;setActiveConversationId(conv.id);
      queryClient.invalidateQueries({queryKey:getListOpenrouterConversationsQueryKey()});
    }
    const msg=chatInput.trim();setChatInput("");setIsChatting(true);
    setChatMessages(p=>[...p,{role:"user",content:msg},{role:"assistant",content:"",streaming:true}]);
    try{
      const BASE=import.meta.env.BASE_URL;
      const res=await fetch(`${BASE}api/openrouter/conversations/${convId}/messages`,{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({content:msg,model,context:buildContext()}),
      });
      if(!res.ok)throw new Error();
      const reader=res.body!.getReader();const dec=new TextDecoder();let buf="";
      while(true){
        const{done,value}=await reader.read();if(done)break;
        buf+=dec.decode(value,{stream:true});
        const lines=buf.split("\n");buf=lines.pop()||"";
        for(const line of lines){
          if(!line.startsWith("data: "))continue;
          try{
            const d=JSON.parse(line.slice(6));
            if(d.content){
              setChatMessages(p=>{const n=[...p];const l=n[n.length-1];if(l?.streaming)l.content+=d.content;return n;});
              chatEndRef.current?.scrollIntoView({behavior:"smooth"});
            }
            if(d.done){
              setChatMessages(p=>p.map((m,i)=>i===p.length-1?{...m,streaming:false}:m));
              queryClient.invalidateQueries({queryKey:getGetOpenrouterConversationQueryKey(convId!)});
            }
          }catch{}
        }
      }
    }catch{
      setChatMessages(p=>p.map((m,i)=>i===p.length-1?{...m,content:"Error — try again.",streaming:false}:m));
    }finally{setIsChatting(false);}
  };

  const myPin=pins.find(p=>p.type==="me");
  const allyPins=pins.filter(p=>p.type==="ally");
  const enemyPins=pins.filter(p=>p.type==="enemy");
  const hasContext=pins.length>0||!!myChamp||!!myRole||!!dragon||!!elderDragon||!!baron||!!herald||!!baronBuff||!!elderBuff||gameTimeSecs>0;
  const canAdvise=!!model&&!isAdvising&&(!!imageBase64||hasContext);
  const hasBuffs=baronBuff!==null||elderBuff!==null;

  const PLACE_CFG={
    me:   {active:"bg-amber-400/20 border-amber-400 text-amber-400",idle:"border-border/40 text-muted-foreground hover:border-amber-400/40",dot:"bg-amber-400",hint:"Tap anywhere on the minimap to drop YOUR pin — tap pin to remove"},
    ally: {active:"bg-sky-400/20   border-sky-400   text-sky-400",  idle:"border-border/40 text-muted-foreground hover:border-sky-400/40",  dot:"bg-sky-400",  hint:`Tap to place ally pins (${allyPins.length}/4) — tap pin to remove`},
    enemy:{active:"bg-red-500/20   border-red-500   text-red-400",  idle:"border-border/40 text-muted-foreground hover:border-red-400/40",  dot:"bg-red-500",  hint:`Tap to place enemy pins (${enemyPins.length}/5) — tap pin to remove`},
  };

  const PIN_BG={me:"bg-amber-400",ally:"bg-sky-400",enemy:"bg-red-500"};
  const PIN_BORDER={me:"border-amber-400",ally:"border-sky-400",enemy:"border-red-500"};
  const PIN_TEXT={me:"text-black",ally:"text-black",enemy:"text-white"};
  const pinLabel=(pin:MapPin)=>pin.type==="me"?"ME":pin.type==="ally"?`A${allyPins.indexOf(pin)+1}`:`E${enemyPins.indexOf(pin)+1}`;

  return(
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="sticky top-0 z-20 bg-background/90 backdrop-blur border-b border-border/40">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
          <h1 className="font-display text-lg font-bold tracking-tight">MACRO<span className="text-primary">COACH</span></h1>
          <div className="flex items-center gap-1">
            <button onClick={handleClearSession}
              title="Clear session (start fresh)"
              className="h-9 w-9 flex items-center justify-center rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-400/10 transition-colors">
              <RotateCcw className="w-4 h-4"/>
            </button>
            <Link href="/settings">
              <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-white">
                <Settings className="w-5 h-5"/>
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-4 space-y-4 pb-8">

        {!model&&(
          <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-3 flex gap-3 items-start">
            <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5"/>
            <div className="text-sm">
              <span className="font-semibold text-destructive">No AI model. </span>
              <Link href="/settings"><span className="underline text-destructive/80 cursor-pointer">Go to Settings</span></Link>
            </div>
          </div>
        )}

        {/* ── SCREENSHOT ──────────────────────────────────────────────── */}
        {imageBase64?(
          <div className="flex flex-col gap-1.5">
            {/* Image with X in top-right corner */}
            <div className="relative w-full rounded-xl overflow-hidden border border-border/40">
              <img src={imageBase64} alt="Game screenshot" className="w-full h-auto block" draggable={false}/>
              <button
                className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/70 border border-white/30 flex items-center justify-center text-white/80 hover:text-white hover:bg-black/90 active:scale-95"
                title="Remove screenshot"
                onClick={()=>{setImageBase64(null);setMinimapBase64(null);setGameTimeCrop(null);setPortraitStripCrop(null);setAlliesDown([]);setEnemiesDown([]);setPins([]);}}>
                <X className="w-3.5 h-3.5"/>
              </button>

              {/* ── Individual portrait tap targets (who's dead) ── */}
              {portraitConfig.allies.map((pos,i)=>{
                const n=i+1,dead=alliesDown.includes(n);
                const sz=`${portraitConfig.sizePct??5.5}%`;
                return(
                  <button key={`a${n}`}
                    onClick={()=>setAlliesDown(p=>dead?p.filter(x=>x!==n):[...p,n])}
                    title={dead?`A${n} dead — tap to revive`:`A${n} alive — tap to mark dead`}
                    className="absolute rounded-full flex items-center justify-center font-bold leading-none select-none"
                    style={{
                      left:`${pos.x}%`,top:`${pos.y}%`,transform:"translate(-50%,-50%)",
                      width:sz,aspectRatio:"1",
                      background: dead ? "rgba(2,6,23,0.85)" : "transparent",
                      border: dead ? "2px solid rgba(56,189,248,0.6)" : "none",
                      color: dead ? "#7dd3fc" : "transparent",
                      fontSize:"9px",
                    }}>
                    {dead?`A${n}`:""}
                  </button>
                );
              })}
              {portraitConfig.enemies.map((pos,i)=>{
                const n=i+1,dead=enemiesDown.includes(n);
                const sz=`${portraitConfig.sizePct??5.5}%`;
                return(
                  <button key={`e${n}`}
                    onClick={()=>setEnemiesDown(p=>dead?p.filter(x=>x!==n):[...p,n])}
                    title={dead?`E${n} dead — tap to revive`:`E${n} alive — tap to mark dead`}
                    className="absolute rounded-full flex items-center justify-center font-bold leading-none select-none"
                    style={{
                      left:`${pos.x}%`,top:`${pos.y}%`,transform:"translate(-50%,-50%)",
                      width:sz,aspectRatio:"1",
                      background: dead ? "rgba(2,6,23,0.85)" : "transparent",
                      border: dead ? "2px solid rgba(239,68,68,0.7)" : "none",
                      color: dead ? "#fca5a5" : "transparent",
                      fontSize:"9px",
                    }}>
                    {dead?`E${n}`:""}
                  </button>
                );
              })}
            </div>

            {/* Toolbar row — below the image, never blocks it */}
            <div className="flex flex-wrap gap-1.5 items-center">
              <button className="border border-white/20 text-white text-xs px-2 py-1 rounded-lg flex items-center gap-1 active:scale-95 hover:bg-white/10"
                onClick={()=>fileInputRef.current?.click()}>
                <Upload className="w-3 h-3"/> Replace
              </button>
              <button
                className="border border-amber-400/40 text-amber-400 text-xs px-2 py-1 rounded-lg flex items-center gap-1 active:scale-95 hover:bg-amber-400/10"
                onClick={()=>setShowCropEditor(true)} title="Set minimap crop area">
                <Crop className="w-3 h-3"/> Map
              </button>
              <button
                className={cn("text-xs px-2 py-1 rounded-lg flex items-center gap-1 active:scale-95 border hover:bg-white/5",
                  gameTimeCrop?"border-primary/50 text-primary":"border-primary/30 text-primary/60")}
                onClick={()=>setShowTimerCropEditor(true)} title="Crop scoreboard (KDA + score + timer) area">
                <Clock className="w-3 h-3"/> Score bar
              </button>
              <button
                className={cn("text-xs px-2 py-1 rounded-lg flex items-center gap-1 active:scale-95 border hover:bg-white/5",
                  portraitStripCrop?"border-emerald-400/60 text-emerald-400":"border-emerald-400/30 text-emerald-400/60")}
                onClick={()=>setShowPortraitStripEditor(true)} title="Crop portrait area (respawn timers) for AI">
                <Timer className="w-3 h-3"/> Respawn
              </button>
              <button
                className="border border-sky-400/40 text-sky-400 text-xs px-2 py-1 rounded-lg flex items-center gap-1 active:scale-95 hover:bg-sky-400/10"
                onClick={()=>setShowPortraitBarEditor(true)} title="Place individual portrait click zones">
                <Users className="w-3 h-3"/> Zones
              </button>
            </div>
          </div>
        ):(
          <div className="w-full h-28 rounded-xl border-2 border-dashed border-border/40 hover:border-primary/30 transition-colors cursor-pointer flex flex-col items-center justify-center gap-2 text-muted-foreground"
            onClick={()=>fileInputRef.current?.click()}
            onDragOver={e=>e.preventDefault()}
            onDrop={e=>{e.preventDefault();const f=e.dataTransfer.files[0];if(f)handleFile(f);}}>
            <Upload className="w-5 h-5"/>
            <span className="text-sm">Upload screenshot</span>
            <span className="text-xs text-muted-foreground/50">Minimap auto-crops · timer auto-reads</span>
          </div>
        )}
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
          onChange={e=>{const f=e.target.files?.[0];if(f)handleFile(f);}}/>

        {/* ── MINIMAP TAP PANEL ──────────────────────────────────────── */}
        {imageBase64&&(
          <div className="bg-card/40 border border-border/40 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border/30 flex items-center justify-between">
              <span className="font-display text-xs tracking-widest uppercase text-muted-foreground flex items-center gap-2">
                Minimap
              </span>
              <div className="flex items-center gap-2">
                {minimapBase64&&(
                  <button onClick={()=>setShowZoneEditor(true)}
                    className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-amber-400 border border-border/30 hover:border-amber-400/40 px-2.5 py-1 rounded-full transition-colors">
                    <Map className="w-3 h-3"/> Edit zones
                  </button>
                )}
                {pins.length>0&&(
                  <button onClick={()=>setPins([])}
                    className="text-[10px] text-muted-foreground hover:text-white border border-border/30 px-2 py-1 rounded-full">
                    Clear all
                  </button>
                )}
              </div>
            </div>

            <div className="p-3 space-y-3">
              {/* Mode buttons */}
              <div className="flex gap-2">
                {(["me","ally","enemy"] as PinType[]).map(type=>{
                  const cfg=PLACE_CFG[type];
                  const active=placeMode===type;
                  const count=type==="me"?(myPin?1:0):type==="ally"?allyPins.length:enemyPins.length;
                  return(
                    <button key={type} onClick={()=>setPlaceMode(p=>p===type?null:type)}
                      className={cn("flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg border text-xs font-bold transition-all active:scale-95 font-display bg-black/30",
                        active?cfg.active:`bg-black/30 ${cfg.idle}`)}>
                      {type==="me"&&<UserRound className="w-3.5 h-3.5"/>}
                      {type==="ally"&&<Users className="w-3.5 h-3.5"/>}
                      {type==="enemy"&&<Swords className="w-3.5 h-3.5"/>}
                      {type==="me"?"Me":type==="ally"?"Ally":"Enemy"}
                      {count>0&&<span className={cn("w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center text-black",cfg.dot)}>{count}</span>}
                    </button>
                  );
                })}
              </div>

              {/* Hint */}
              {placeMode&&(
                <p className={cn("text-[11px] px-3 py-2 rounded-lg border text-center font-display tracking-wide",
                  placeMode==="me"?"bg-amber-400/10 border-amber-400/40 text-amber-400":
                  placeMode==="ally"?"bg-sky-400/10 border-sky-400/40 text-sky-400":
                  "bg-red-500/10 border-red-500/40 text-red-400")}>
                  {PLACE_CFG[placeMode].hint}
                </p>
              )}

              {/* Minimap with free-tap */}
              <div ref={minimapDivRef}
                className={cn("relative w-full rounded-lg overflow-hidden border border-border/30",
                  placeMode?"cursor-crosshair":"cursor-default")}
                onClick={handleMinimapTap}
                onTouchStart={handleMinimapTap}>
                {minimapBase64?(
                  <img src={minimapBase64} alt="Minimap" className="w-full h-auto block pointer-events-none select-none" draggable={false}/>
                ):(
                  <div className="w-full aspect-square bg-slate-900/80 flex items-center justify-center">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground/40"/>
                  </div>
                )}
                {pins.map(pin=>(
                  <div key={pin.id} data-pin="true"
                    className="absolute -translate-x-1/2 -translate-y-1/2 z-10"
                    style={{left:`${pin.x}%`,top:`${pin.y}%`}}
                    onClick={e=>{e.stopPropagation();removePin(pin.id);}}>
                    <div className={cn(
                      "w-8 h-8 rounded-full border-2 flex items-center justify-center",
                      "font-display font-bold text-[11px] cursor-pointer shadow-lg active:scale-90 transition-transform",
                      PIN_BG[pin.type],PIN_BORDER[pin.type],PIN_TEXT[pin.type])}>
                      {pinLabel(pin)}
                    </div>
                  </div>
                ))}
              </div>

              {/* Position tags */}
              {pins.length>0&&(
                <div className="flex gap-1.5 flex-wrap">
                  {myPin&&(
                    <span className="flex items-center gap-1.5 text-[10px] text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-full px-2.5 py-1">
                      <span className="w-2 h-2 rounded-full bg-amber-400"/>
                      Me: {posLabel(myPin.pos)}
                    </span>
                  )}
                  {allyPins.map((p,i)=>(
                    <span key={p.id} className="flex items-center gap-1.5 text-[10px] text-sky-400 bg-sky-400/10 border border-sky-400/20 rounded-full px-2.5 py-1">
                      <span className="w-2 h-2 rounded-full bg-sky-400"/>
                      A{i+1}: {posLabel(p.pos)}
                    </span>
                  ))}
                  {enemyPins.map((p,i)=>(
                    <span key={p.id} className="flex items-center gap-1.5 text-[10px] text-red-400 bg-red-500/10 border border-red-400/20 rounded-full px-2.5 py-1">
                      <span className="w-2 h-2 rounded-full bg-red-500"/>
                      E{i+1}: {posLabel(p.pos)}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── CONTEXT PANEL ──────────────────────────────────────────── */}
        <div className="bg-card/40 border border-border/40 rounded-xl overflow-hidden">
          <button className="w-full flex items-center justify-between px-4 py-3 text-xs font-display tracking-widest uppercase text-muted-foreground"
            onClick={()=>setContextOpen(o=>!o)}>
            <span className="flex items-center gap-2">
              Game Context
              {hasContext&&<span className="w-2 h-2 rounded-full bg-primary"/>}
            </span>
            {contextOpen?<ChevronUp className="w-4 h-4"/>:<ChevronDown className="w-4 h-4"/>}
          </button>
          {contextOpen&&(
            <div className="border-t border-border/30 px-4 pb-5 space-y-5">
              {/* Game time */}
              <div className="pt-4">
                <div className="flex justify-between mb-2 items-center">
                  <span className="text-[10px] uppercase tracking-widest font-display text-muted-foreground flex items-center gap-2">
                    Game Time
                  </span>
                  <span className="font-display text-primary font-bold text-base">{fmt(gameTimeSecs)}</span>
                </div>
                <input type="range" min={0} max={1800} step={30} value={gameTimeSecs}
                  onChange={e=>setGameTimeSecs(Number(e.target.value))}
                  className="w-full accent-primary h-2 rounded-full cursor-pointer"/>
                <div className="flex justify-between text-[10px] text-muted-foreground/40 mt-1">
                  <span>0:00</span><span>10:00</span><span>20:00</span><span>30:00</span>
                </div>
              </div>
              {/* Role */}
              <div>
                <span className="text-[10px] uppercase tracking-widest font-display text-muted-foreground">My Role</span>
                <div className="flex gap-2 mt-2">
                  {ROLES.map(r=>(
                    <button key={r} onClick={()=>setMyRole(myRole===r?null:r)}
                      className={cn("flex-1 py-2 rounded-lg text-[11px] font-bold border transition-all active:scale-95 font-display",
                        myRole===r?"bg-primary/20 border-primary text-primary":"bg-black/30 border-border/40 text-muted-foreground hover:border-primary/30")}>
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              {/* Champion */}
              <div>
                <span className="text-[10px] uppercase tracking-widest font-display text-muted-foreground">My Champion <span className="text-muted-foreground/40">(optional)</span></span>
                {favorites.length>0&&(
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {favorites.map(c=>(
                      <button key={c} onClick={()=>setMyChamp(myChamp===c?null:c)}
                        className={cn("text-sm font-semibold px-4 py-2.5 rounded-xl border transition-all active:scale-95 font-display",
                          myChamp===c?"bg-primary/25 border-primary text-primary":"bg-black/30 border-border/50 text-foreground/80 hover:border-primary/50 hover:text-primary")}>
                        ★ {c}
                      </button>
                    ))}
                  </div>
                )}
                <button onClick={()=>setChampPickOpen(true)}
                  className={cn("w-full mt-2 py-2.5 rounded-lg border text-sm font-medium transition-all active:scale-[0.98]",
                    myChamp?"bg-primary/15 border-primary/50 text-primary":"bg-black/30 border-border/40 text-muted-foreground hover:border-primary/40")}>
                  {myChamp??`${favorites.length>0?"Other champion…":"+ Select champion (optional)"}`}
                </button>
              </div>
              {/* Objectives */}
              <div>
                <span className="text-[10px] uppercase tracking-widest font-display text-muted-foreground">Objectives</span>
                <div className="space-y-2.5 mt-2">
                  <ObjControl label="Dragon" value={dragon} onChange={setDragon}/>
                  <ObjControl label="Elder Dragon" value={elderDragon} onChange={setElderDragon}/>
                  <ObjControl label="Baron" value={baron} onChange={setBaron}/>
                  <ObjControl label="Herald" value={herald} onChange={setHerald}/>
                </div>
              </div>
              {/* Buffs */}
              <div>
                <button className="w-full flex items-center justify-between text-[10px] uppercase tracking-widest font-display text-muted-foreground mb-2"
                  onClick={()=>setContextOpen(o=>o)}>
                  <span className="flex items-center gap-2">
                    Active Buffs <span className="text-muted-foreground/50 normal-case tracking-normal font-normal">(who has it?)</span>
                    {hasBuffs&&<span className="w-2 h-2 rounded-full bg-emerald-400"/>}
                  </span>
                </button>
                <div className="grid grid-cols-2 gap-2">
                  <BuffControl label="Baron Buff" value={baronBuff} onChange={setBaronBuff}/>
                  <BuffControl label="Elder Buff" value={elderBuff} onChange={setElderBuff}/>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── NOTES ──────────────────────────────────────────────────── */}
        <textarea
          value={userNotes}
          onChange={e=>setUserNotes(e.target.value)}
          placeholder="Notes (optional) — anything extra for the AI e.g. 'enemy mid is roaming, we need dragon'"
          rows={2}
          className="w-full rounded-xl border border-border/40 bg-card/40 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 resize-none focus:outline-none focus:border-primary/50"
        />

        {/* ── ADVISE ME ──────────────────────────────────────────────── */}
        <button onClick={getAdvice} disabled={!canAdvise}
          className={cn("w-full h-16 rounded-xl font-display text-xl font-bold tracking-widest uppercase transition-all relative overflow-hidden",
            canAdvise?"bg-primary text-primary-foreground shadow-[0_0_30px_rgba(0,160,210,0.35)] hover:shadow-[0_0_45px_rgba(0,160,210,0.5)] active:scale-[0.98]"
            :"bg-muted text-muted-foreground cursor-not-allowed opacity-60")}>
          {isAdvising
            ?<span className="flex items-center justify-center gap-3"><Loader2 className="w-5 h-5 animate-spin"/>Analyzing…</span>
            :<span className="flex items-center justify-center gap-3"><Target className="w-5 h-5"/>Advise Me</span>}
        </button>

        {/* ── ADVICE OUTPUT ──────────────────────────────────────────── */}
        {(advice||isAdvising)&&(
          <div className="bg-card/60 border border-primary/30 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 bg-primary/5 border-b border-primary/20 flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-primary animate-pulse"/>
              <span className="font-display text-xs tracking-widest uppercase text-primary">Tactical Read</span>
            </div>
            <div className="p-4">
              {advice
                ?<div className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">{advice}</div>
                :<div className="space-y-3"><Skeleton className="h-4 w-3/4 bg-primary/10"/><Skeleton className="h-4 w-full bg-primary/10"/><Skeleton className="h-4 w-5/6 bg-primary/10"/></div>}
            </div>
          </div>
        )}

        {/* ── DEBUG PANEL ────────────────────────────────────────────── */}
        {debugInfo&&(
          <div className="bg-card/40 border border-border/40 rounded-xl overflow-hidden">
            <button className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-display tracking-widest uppercase text-muted-foreground hover:text-slate-300 transition-colors"
              onClick={()=>setShowDebug(d=>!d)}>
              <span className="flex items-center gap-2"><Bug className="w-3 h-3"/> What the AI received</span>
              {showDebug?<ChevronUp className="w-3 h-3"/>:<ChevronDown className="w-3 h-3"/>}
            </button>
            {showDebug&&(
              <div className="border-t border-border/30 p-3 space-y-4">

                {/* 1 — System instructions */}
                <div>
                  <p className="text-[10px] font-bold text-primary/70 uppercase tracking-wider mb-1">① Instructions given to the AI (system prompt)</p>
                  <p className="text-[10px] text-muted-foreground/50 mb-1.5">This tells the AI what role to play and how to respond.</p>
                  <pre className="text-[10px] text-slate-300 whitespace-pre-wrap overflow-auto max-h-40 bg-black/40 rounded-lg p-3 leading-relaxed">
                    {debugInfo.systemPrompt}
                  </pre>
                </div>

                {/* 2 — User message text */}
                <div>
                  <p className="text-[10px] font-bold text-primary/70 uppercase tracking-wider mb-1">② Your game state (text sent to AI)</p>
                  <p className="text-[10px] text-muted-foreground/50 mb-1.5">This is the actual text message the AI reads — your game context formatted as plain English.</p>
                  <pre className="text-[10px] text-slate-300 whitespace-pre-wrap bg-black/40 rounded-lg p-3 leading-relaxed">
                    {debugInfo.userText}
                  </pre>
                </div>

                {/* 3 — Minimap image */}
                <div>
                  <p className="text-[10px] font-bold text-primary/70 uppercase tracking-wider mb-1">③ Minimap image (sent to AI)</p>
                  {debugMinimapUrl?(
                    <>
                      <p className="text-[10px] text-muted-foreground/50 mb-1.5">This is the actual image the AI sees — annotated minimap with your pins and game time below it.</p>
                      <img src={debugMinimapUrl} alt="Minimap sent to AI" className="w-full rounded-lg border border-border/30"/>
                    </>
                  ):(
                    <p className="text-[10px] text-amber-400/70">No minimap sent — upload a screenshot and calibrate the Map crop area.</p>
                  )}
                </div>

              </div>
            )}
          </div>
        )}

        {/* ── CHAT ───────────────────────────────────────────────────── */}
        <div className="bg-card/40 border border-border/40 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border/30 flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-primary"/>
            <span className="font-display text-xs tracking-widest uppercase text-muted-foreground">Ask Follow-up</span>
          </div>
          {conversations&&conversations.length>0&&(
            <div className="flex gap-2 px-3 py-2 overflow-x-auto border-b border-border/20">
              {conversations.map(c=>(
                <button key={c.id} onClick={()=>{setActiveConversationId(c.id);setChatMessages([]);}}
                  className={cn("shrink-0 text-xs px-3 py-1.5 rounded-full border transition-all",
                    activeConversationId===c.id?"bg-primary/20 border-primary text-primary":"bg-black/30 border-border/40 text-muted-foreground")}>
                  {c.title}
                </button>
              ))}
            </div>
          )}
          {(chatMessages.length>0||(conversationData?.messages?.length??0)>0)&&(
            <div className="max-h-80 overflow-y-auto p-3 space-y-3">
              {(conversationData?.messages??[])
                .filter(m=>!chatMessages.some(cm=>cm.content===m.content&&cm.role===m.role))
                .map(m=>(
                  <div key={m.id} className={cn("flex",m.role==="user"?"justify-end":"justify-start")}>
                    <div className={cn("max-w-[85%] px-3 py-2 rounded-lg text-sm",
                      m.role==="user"?"bg-primary text-primary-foreground rounded-tr-none":"bg-muted border border-border rounded-tl-none")}>
                      {m.content}
                    </div>
                  </div>
                ))}
              {chatMessages.map((m,i)=>(
                <div key={i} className={cn("flex",m.role==="user"?"justify-end":"justify-start")}>
                  <div className={cn("max-w-[85%] px-3 py-2 rounded-lg text-sm whitespace-pre-wrap",
                    m.role==="user"?"bg-primary text-primary-foreground rounded-tr-none":"bg-muted border border-border rounded-tl-none")}>
                    {m.content||(m.streaming&&(
                      <span className="inline-flex gap-1">
                        <span className="w-1.5 h-1.5 bg-current rounded-full animate-bounce [animation-delay:0ms]"/>
                        <span className="w-1.5 h-1.5 bg-current rounded-full animate-bounce [animation-delay:150ms]"/>
                        <span className="w-1.5 h-1.5 bg-current rounded-full animate-bounce [animation-delay:300ms]"/>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
              <div ref={chatEndRef}/>
            </div>
          )}
          <div className="p-3 border-t border-border/20">
            <form onSubmit={sendChat} className="flex gap-2">
              <Input placeholder="Ask anything…" className="bg-black/40 border-border/50 text-sm h-10"
                value={chatInput} onChange={e=>setChatInput(e.target.value)} disabled={isChatting}/>
              <Button type="submit" size="icon" className="h-10 w-10 shrink-0" disabled={!chatInput.trim()||isChatting||!model}>
                {isChatting?<Loader2 className="w-4 h-4 animate-spin"/>:<Send className="w-4 h-4"/>}
              </Button>
            </form>
          </div>
        </div>

      </main>

      {/* ── Calibration modals ─────────────────────────────────────────── */}
      {showCropEditor&&imageBase64&&(
        <CropCalibrator
          screenshot={imageBase64}
          current={cropConfig}
          onSave={handleSaveCrop}
          onClose={()=>setShowCropEditor(false)}
        />
      )}
      {showTimerCropEditor&&imageBase64&&(
        <CropCalibrator
          screenshot={imageBase64}
          current={timerCropConfig}
          title="Score bar — select KDA + score + timer area"
          onSave={handleSaveTimerCrop}
          onClose={()=>setShowTimerCropEditor(false)}
        />
      )}
      {showPortraitStripEditor&&imageBase64&&(
        <CropCalibrator
          screenshot={imageBase64}
          current={portraitStripConfig}
          title="Portrait strip — select the ally/enemy portrait area"
          onSave={handleSavePortraitStrip}
          onClose={()=>setShowPortraitStripEditor(false)}
        />
      )}
      {showPortraitBarEditor&&imageBase64&&(
        <PortraitPlacer
          screenshot={imageBase64}
          current={portraitConfig}
          onSave={cfg=>{savePortraitConfig(cfg);}}
          onClose={()=>setShowPortraitBarEditor(false)}
        />
      )}
      {showZoneEditor&&minimapBase64&&(
        <ZoneEditor
          minimap={minimapBase64}
          lanes={lanePaths}
          zones={zones}
          onSave={(l,z)=>{saveLanes(l);saveZones(z);}}
          onClose={()=>setShowZoneEditor(false)}
        />
      )}

      <ChampionPicker
        open={champPickOpen} title="Your Champion"
        selected={myChamp?[myChamp]:[]} max={1}
        onClose={()=>setChampPickOpen(false)}
        onSelect={s=>setMyChamp(s[0]??null)}
        favorites={favorites}
        onToggleFav={toggleFav}
      />
    </div>
  );
}
