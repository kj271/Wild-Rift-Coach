import { useState, useRef, useCallback, useEffect } from "react";
import { Link } from "wouter";
import { useModelStorage } from "@/hooks/use-model-storage";
import { useCropConfig, useTimerCropConfig, usePortraitConfig, usePortraitStripConfig, DEFAULT_PORTRAIT_CONFIG, useLanePaths, useZones, useFavoriteChamps, useTowerConfig, TOWER_LABELS, LanePaths, ZoneData, Point } from "@/hooks/use-map-config";
import { CropCalibrator } from "@/components/crop-calibrator";
import { PortraitPlacer } from "@/components/portrait-placer";
import { ZoneEditor } from "@/components/zone-editor";
import { TowerCalibrator } from "@/components/tower-calibrator";
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
  ChevronDown, ChevronUp, Crop, Map, Star, RotateCcw, Bug, Timer, Clock, Building2,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Champions ────────────────────────────────────────────────────────────────
const CHAMPIONS = [
  "Aatrox","Ahri","Akali","Akshan","Alistar","Amumu","Annie","Ashe","Aurelion Sol",
  "Bard","Blitzcrank","Brand","Braum",
  "Caitlyn","Camille","Cho'Gath","Corki",
  "Darius","Diana","Dr. Mundo","Draven",
  "Ekko","Elise","Evelynn","Ezreal",
  "Fiddlesticks","Fiora","Fizz",
  "Galio","Gangplank","Garen","Gnar","Gragas","Graves","Gwen",
  "Hecarim","Heimerdinger",
  "Irelia",
  "Janna","Jarvan IV","Jax","Jayce","Jhin","Jinx",
  "Kai'Sa","Karma","Kassadin","Katarina","Kayle","Kayn","Kennen","Kha'Zix","Kog'Maw",
  "LeBlanc","Lee Sin","Leona","Lissandra","Lucian","Lulu","Lux",
  "Malphite","Malzahar","Master Yi","Mel","Miss Fortune","Morgana",
  "Nami","Nasus","Nautilus","Nilah","Norra","Nunu",
  "Olaf","Orianna",
  "Pantheon",
  "Quinn",
  "Rakan","Rammus","Renekton","Rengar","Riven","Ryze",
  "Seraphine","Senna","Sett","Singed","Skarner","Smolder","Sona","Soraka","Swain",
  "Taliyah","Teemo","Thresh","Tristana","Tryndamere","Twisted Fate","Twitch",
  "Varus","Vayne","Veigar","Vi","Viego","Viktor","Vladimir","Volibear",
  "Warwick","Wukong",
  "Xayah","Xin Zhao",
  "Yasuo","Yone","Yuumi",
  "Zac","Zed","Ziggs","Zilean","Zoe","Zyra",
].sort();
const ROLES = ["Top","Jungle","Mid","ADC","Support"] as const;
type Role = typeof ROLES[number];
type ObjType = "baron" | "dragon" | "rift_herald" | "elder_dragon";
type ObjStatus = "up" | "soon" | null; // null = down
type BuffHolder = "us" | "them" | null;
type PinType = "me" | "ally" | "enemy";
type PlaceMode = PinType | "obj" | null;
interface ObjPin { id:string; x:number; y:number; pos:PosInfo; objType:ObjType|null; status:ObjStatus }

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
    {name:"Top Lane", path:lanePaths.baron},
    {name:"Mid Lane",   path:lanePaths.mid},
    {name:"Bottom Lane",path:lanePaths.dragon},
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

// Returns the slot number for the i-th pin of a given type, skipping slots already
// reserved by dead portrait markers. e.g. if slot 1 is dead, first placed pin = slot 2.
function pinSlot(index:number,occupied:number[]):number{
  let count=0;
  for(let candidate=1;candidate<=20;candidate++){
    if(!occupied.includes(candidate)){
      if(count===index)return candidate;
      count++;
    }
  }
  return index+1;
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
  alliesDown?:number[],
  enemiesDown?:number[],
  objPins?:ObjPin[],
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
  const aDown=alliesDown??[];const eDown=enemiesDown??[];
  for(const pin of pins){
    const px=pin.x/100*W,py=pin.y/100*H;
    const color=pin.type==="me"?"#FBBF24":pin.type==="ally"?"#38BDF8":"#EF4444";
    const outline=pin.type==="me"?"#92400E":pin.type==="ally"?"#0C4A6E":"#7F1D1D";
    const label=pin.type==="me"?"ME":pin.type==="ally"?`A${pinSlot(allyPins.indexOf(pin),aDown)}`:`E${pinSlot(enemyPins.indexOf(pin),eDown)}`;
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

  // Draw objective pins
  if(objPins?.length){
    const objColors:Record<string,string>={baron:"#a855f7",dragon:"#f97316",rift_herald:"#ef4444",elder_dragon:"#10b981"};
    const objShorts:Record<string,string>={baron:"B",dragon:"D",rift_herald:"RH",elder_dragon:"ED"};
    const or=Math.round(W*0.045);
    for(const op of objPins){
      const px=op.x/100*W,py=op.y/100*H;
      const col=op.objType?objColors[op.objType]:"#888888";
      const short=op.objType?objShorts[op.objType]:"?";
      const fs=Math.round(or*0.9);
      const tw=ctx.measureText(short).width+or*1.2;
      const bh=or*1.6;
      const bx=px-tw/2,by=py-bh/2;
      // Background rect
      ctx.shadowColor="rgba(0,0,0,0.9)";ctx.shadowBlur=8;
      ctx.fillStyle="rgba(5,12,28,0.9)";
      ctx.beginPath();ctx.roundRect(bx,by,tw,bh,4);ctx.fill();
      ctx.shadowBlur=0;
      ctx.strokeStyle=col;ctx.lineWidth=Math.max(2,or*0.15);
      ctx.beginPath();ctx.roundRect(bx,by,tw,bh,4);ctx.stroke();
      // Label
      ctx.fillStyle=col;ctx.font=`bold ${fs}px sans-serif`;
      ctx.textAlign="center";ctx.textBaseline="middle";
      ctx.fillText(short,px,py);
      // Status dot
      if(op.status){
        const sc=op.status==="up"?"#22c55e":"#f59e0b";
        ctx.fillStyle=sc;
        ctx.beginPath();ctx.arc(bx+tw-or*0.3,by+or*0.3,or*0.22,0,Math.PI*2);ctx.fill();
      }
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

interface StreamingMsg{role:"user"|"assistant";content:string;streaming?:boolean}

// ─── Objective pin config ──────────────────────────────────────────────────────
const OBJ_CFG:Record<ObjType,{label:string;short:string;color:string;bg:string;border:string}>={
  baron:       {label:"Baron",       short:"B",  color:"#a855f7",bg:"rgba(168,85,247,0.18)",border:"rgba(168,85,247,0.6)"},
  dragon:      {label:"Dragon",      short:"D",  color:"#f97316",bg:"rgba(249,115,22,0.18)", border:"rgba(249,115,22,0.6)"},
  rift_herald: {label:"Rift Herald", short:"RH", color:"#ef4444",bg:"rgba(239,68,68,0.18)",  border:"rgba(239,68,68,0.6)"},
  elder_dragon:{label:"Elder Dragon",short:"ED", color:"#10b981",bg:"rgba(16,185,129,0.18)", border:"rgba(16,185,129,0.6)"},
};

// ─── QuickObjPicker — floating popup for objective pins ───────────────────────
function QuickObjPicker({pin,pos,onUpdate,onRemove,onClose}:{
  pin:ObjPin;pos:{x:number;y:number};
  onUpdate:(p:Partial<ObjPin>)=>void;onRemove:()=>void;onClose:()=>void;
}){
  const PW=220,PH=210;
  const left=Math.max(6,Math.min(pos.x-PW/2,window.innerWidth-PW-6));
  const rawTop=pos.y+20+PH>window.innerHeight?pos.y-PH-20:pos.y+20;
  const top=Math.max(6,Math.min(rawTop,window.innerHeight-PH-6));
  return(
    <>
      <div className="fixed inset-0 z-40" onClick={onClose}/>
      <div className="fixed z-50 flex flex-col bg-[#0d1526] border border-border/60 rounded-xl shadow-2xl overflow-hidden"
        style={{left,top,width:PW}}>
        <div className="flex items-center justify-between px-3 pt-2.5 pb-2 border-b border-border/30 shrink-0">
          <span className="text-[11px] font-display font-bold uppercase tracking-wider text-muted-foreground">Objective</span>
          <button onClick={onRemove} className="text-sm font-bold text-red-400 border border-red-500/50 px-3 py-1.5 rounded-lg active:scale-95 min-w-[44px] min-h-[36px]">Del</button>
        </div>
        <div className="px-2.5 pt-2 pb-1">
          <span className="text-[9px] uppercase tracking-widest text-muted-foreground/60">Type</span>
          <div className="grid grid-cols-2 gap-1.5 mt-1.5">
            {(Object.entries(OBJ_CFG) as [ObjType,typeof OBJ_CFG[ObjType]][]).map(([k,cfg])=>(
              <button key={k} onClick={()=>onUpdate({objType:pin.objType===k?null:k})}
                className="py-1.5 rounded-lg border text-[10px] font-bold transition-all active:scale-95"
                style={pin.objType===k?{background:cfg.bg,borderColor:cfg.color,color:cfg.color}:{background:"rgba(0,0,0,0.4)",borderColor:"rgba(255,255,255,0.1)",color:"rgba(255,255,255,0.45)"}}>
                {cfg.label}
              </button>
            ))}
          </div>
        </div>
        <div className="px-2.5 pb-2.5 pt-2">
          <span className="text-[9px] uppercase tracking-widest text-muted-foreground/60">Status</span>
          <div className="flex gap-1.5 mt-1.5">
            {([["up","UP","#22c55e"],["soon","SOON","#f59e0b"]] as const).map(([v,l,c])=>(
              <button key={v} onClick={()=>onUpdate({status:pin.status===v?null:v as ObjStatus})}
                className="flex-1 py-1.5 rounded-lg border text-[10px] font-bold transition-all active:scale-95"
                style={pin.status===v?{background:`${c}22`,borderColor:c,color:c}:{background:"rgba(0,0,0,0.4)",borderColor:"rgba(255,255,255,0.1)",color:"rgba(255,255,255,0.45)"}}>
                {l}
              </button>
            ))}
          </div>
          <p className="text-[8px] text-muted-foreground/40 mt-1.5 text-center">No status = down / dead</p>
        </div>
      </div>
    </>
  );
}

// ─── QuickChampPicker — small floating popup anchored near the pin ─────────────
function QuickChampPicker({pin,label,pos,onAssign,onRemove,onClose,favorites,onToggleFav}:{
  pin:MapPin;label:string;pos:{x:number;y:number};
  onAssign:(c:string|null)=>void;onRemove:()=>void;onClose:()=>void;
  favorites:string[];onToggleFav:(c:string)=>void;
}){
  const[search,setSearch]=useState("");
  const inputRef=useRef<HTMLInputElement>(null);
  const popupRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{setTimeout(()=>inputRef.current?.focus(),60);},[]);

  // Clamp popup so it stays on screen (popup is ~300×420)
  const PW=300,PH=420;
  const left=Math.max(6,Math.min(pos.x-PW/2,window.innerWidth-PW-6));
  const rawTop=pos.y+20+PH>window.innerHeight?pos.y-PH-20:pos.y+20;
  const top=Math.max(6,Math.min(rawTop,window.innerHeight-PH-6));

  const words=search.toLowerCase().split(/\s+/).filter(Boolean);
  const filtered=words.length===0?CHAMPIONS:CHAMPIONS.filter(c=>{const t=c.toLowerCase();return words.every(w=>t.includes(w));});
  const isAlly=pin.type==="ally";
  const accent=isAlly?"#38BDF8":"#EF4444";
  return(
    <>
      {/* Backdrop — tap to close */}
      <div className="fixed inset-0 z-40" onClick={onClose}/>
      {/* Popup card */}
      <div ref={popupRef}
        className="fixed z-50 flex flex-col bg-[#0d1526] border border-border/60 rounded-xl shadow-2xl overflow-hidden"
        style={{left,top,width:PW,maxHeight:PH}}>
        {/* Header */}
        <div className="flex items-center gap-2 px-3 pt-3 pb-2 border-b border-border/30 shrink-0">
          <span className="text-sm font-display font-bold uppercase tracking-wider" style={{color:accent}}>{label}</span>
          {pin.champ&&<span className="text-xs text-muted-foreground flex-1 truncate">{pin.champ}</span>}
          {!pin.champ&&<span className="flex-1"/>}
          {pin.champ&&<button onClick={()=>onAssign(null)} className="text-xs text-muted-foreground border border-border/30 px-2 py-1 rounded active:scale-95 shrink-0">✕</button>}
          <button onClick={onRemove} className="text-sm font-bold text-red-400 border border-red-500/50 px-3 py-1.5 rounded-lg active:scale-95 shrink-0 min-w-[44px] min-h-[36px]">Del</button>
        </div>
        {/* Search */}
        <div className="px-3 py-2 shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none"/>
            <input ref={inputRef} placeholder="Search champion…" value={search} onChange={e=>setSearch(e.target.value)}
              className="w-full pl-9 pr-3 h-10 rounded-lg bg-black/60 border border-border/30 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50"/>
          </div>
        </div>
        {/* Favorites strip */}
        {favorites.length>0&&!search&&(
          <div className="px-3 pb-1.5 flex gap-1.5 overflow-x-auto shrink-0">
            {favorites.map(c=>(
              <button key={c} onClick={()=>onAssign(c)}
                className={cn("shrink-0 text-xs px-2.5 py-1 rounded-full border active:scale-95",
                  pin.champ===c?"bg-amber-400/25 border-amber-400 text-amber-300":"border-amber-400/30 text-amber-300/70")}>
                ★ {c}
              </button>
            ))}
          </div>
        )}
        {/* List */}
        <div className="overflow-y-auto flex-1 px-2 pb-2">
          {filtered.map(c=>{
            const sel=pin.champ===c;
            const isFav=favorites.includes(c);
            return(
              <div key={c} className="flex items-center gap-1 group">
                <button onClick={()=>onAssign(c)}
                  className={cn("flex-1 text-left px-3 py-2.5 text-sm rounded-lg transition-all active:scale-[.97]",
                    sel?"bg-primary/20 text-primary":"text-slate-300 hover:bg-white/5 hover:text-white")}>
                  {c}
                </button>
                <button onClick={ev=>{ev.stopPropagation();onToggleFav(c);}} className="opacity-0 group-hover:opacity-100 px-2 py-2">
                  <Star className={cn("w-3.5 h-3.5",isFav?"fill-amber-400 text-amber-400":"text-muted-foreground/40")}/>
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

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
  const{config:towerConfig,save:saveTowerConfig}=useTowerConfig();

  // Load persisted session once on mount
  const[_sess]=useState(()=>loadSession());

  // Screenshot
  const[imageBase64,setImageBase64]=useState<string|null>((_sess.imageBase64 as string|null)??null);
  const[minimapBase64,setMinimapBase64]=useState<string|null>((_sess.minimapBase64 as string|null)??null);
  const[imageQueue,setImageQueue]=useState<string[]>([]);
  const[activeQueueIdx,setActiveQueueIdx]=useState(0);
  const fileInputRef=useRef<HTMLInputElement>(null);

  // Calibration modals
  const[showCropEditor,setShowCropEditor]=useState(false);
  const[showTimerCropEditor,setShowTimerCropEditor]=useState(false);
  const[showPortraitBarEditor,setShowPortraitBarEditor]=useState(false);
  const[showPortraitStripEditor,setShowPortraitStripEditor]=useState(false);
  const[showTowerCalibrator,setShowTowerCalibrator]=useState(false);
  const[screenshotCollapsed,setScreenshotCollapsed]=useState(()=>localStorage.getItem("wildrift_screenshot_collapsed")==="true");
  const toggleScreenshotCollapsed=()=>{const n=!screenshotCollapsed;setScreenshotCollapsed(n);localStorage.setItem("wildrift_screenshot_collapsed",String(n));};
  const[showZoneEditor,setShowZoneEditor]=useState(false);

  // Crop images (stored in state only — too large for localStorage)
  const[gameTimeCrop,setGameTimeCrop]=useState<string|null>(null);
  const[portraitStripCrop,setPortraitStripCrop]=useState<string|null>(null);

  // Pins
  const[pins,setPins]=useState<MapPin[]>((_sess.pins as MapPin[])??[]);
  const[benchPins,setBenchPins]=useState<MapPin[]>([]);
  const[placeMode,setPlaceMode]=useState<PlaceMode>(null);
  const minimapDivRef=useRef<HTMLDivElement>(null);
  const benchRef=useRef<HTMLDivElement>(null);
  const pinDragActive=useRef<{id:string;kind:"champ"|"obj"}|null>(null);
  const pinDragMoved=useRef(false);
  const handlePinPointerMove=useCallback((e:React.PointerEvent,id:string,kind:"champ"|"obj")=>{
    if(!pinDragActive.current||pinDragActive.current.id!==id)return;
    e.stopPropagation();
    const rect=minimapDivRef.current?.getBoundingClientRect();
    if(!rect)return;
    pinDragMoved.current=true;
    const x=Math.max(1,Math.min(130,(e.clientX-rect.left)/rect.width*100));
    const y=Math.max(1,Math.min(99,(e.clientY-rect.top)/rect.height*100));
    if(kind==="champ")setPins(p=>p.map(pp=>pp.id===id?{...pp,x,y,pos:classifyPos(x,y,lanePaths,zones)}:pp));
    else setObjPins(p=>p.map(pp=>pp.id===id?{...pp,x,y,pos:classifyPos(x,y,lanePaths,zones)}:pp));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[lanePaths,zones]);

  // Context
  const[gameTimeSecs,setGameTimeSecs]=useState((_sess.gameTimeSecs as number)??0);
  const gameTimeSecsRef=useRef((_sess.gameTimeSecs as number)??0);
  const[myRole,setMyRole]=useState<Role|null>((_sess.myRole as Role|null)??null);
  const[myChamp,setMyChamp]=useState<string|null>((_sess.myChamp as string|null)??null);
  const[objPins,setObjPins]=useState<ObjPin[]>((_sess.objPins as ObjPin[])??[]);
  const[quickObjPickId,setQuickObjPickId]=useState<string|null>(null);
  const[quickObjPickPos,setQuickObjPickPos]=useState<{x:number;y:number}>({x:0,y:0});
  const[baronBuff,setBaronBuff]=useState<BuffHolder>((_sess.baronBuff as BuffHolder)??null);
  const[elderBuff,setElderBuff]=useState<BuffHolder>((_sess.elderBuff as BuffHolder)??null);
  const[alliesDown,setAlliesDown]=useState<number[]>((_sess.alliesDown as number[])??[]);
  const[enemiesDown,setEnemiesDown]=useState<number[]>((_sess.enemiesDown as number[])??[]);
  const[towersDown,setTowersDown]=useState<{ally:number[];enemy:number[]}>(
    (_sess.towersDown as {ally:number[];enemy:number[]})??{ally:[],enemy:[]}
  );
  const[towerIconSizePct,setTowerIconSizePct]=useState<number>(()=>{
    try{const v=localStorage.getItem("wildrift_tower_icon_size");return v?parseInt(v,10):6;}catch{return 6;}
  });
  const saveTowerIconSize=(v:number)=>{
    const clamped=Math.max(4,Math.min(14,v));
    setTowerIconSizePct(clamped);
    try{localStorage.setItem("wildrift_tower_icon_size",String(clamped));}catch{}
  };
  const[quickPickPinId,setQuickPickPinId]=useState<string|null>(null);
  const[quickPickPos,setQuickPickPos]=useState<{x:number;y:number}>({x:0,y:0});
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
    saveSession({imageBase64,minimapBase64,pins,objPins,myRole,myChamp,baronBuff,elderBuff,alliesDown,enemiesDown,towersDown,gameTimeSecs,advice,userNotes});
  },[imageBase64,minimapBase64,pins,objPins,myRole,myChamp,baronBuff,elderBuff,alliesDown,enemiesDown,gameTimeSecs,advice,userNotes]);

  const handleClearSession=useCallback(()=>{
    clearSessionStorage();
    setImageBase64(null);setMinimapBase64(null);setGameTimeCrop(null);setPins([]);setPlaceMode(null);
    setMyRole(null);setMyChamp(null);setObjPins([]);
    setBaronBuff(null);setElderBuff(null);setAlliesDown([]);setEnemiesDown([]);setTowersDown({ally:[],enemy:[]});
    setUserNotes('');setGameTimeSecs(0);setActiveConversationId(null);setAdvice("");setChatMessages([]);
    setDebugInfo(null);setDebugMinimapUrl(null);setPortraitStripCrop(null);
    setImageQueue([]);setActiveQueueIdx(0);setBenchPins([]);
  },[]);

  // ── Re-crop minimap with current config ──────────────────────────────────────
  const recropMinimap=useCallback(async(dataUrl:string,cfg=cropConfig)=>{
    const m=await cropDataUrl(dataUrl,cfg.x,cfg.y,cfg.w,cfg.h);
    setMinimapBase64(m);
    return m;
  },[cropConfig]);

  // ── Process uploaded image ──────────────────────────────────────────────────
  const processImage=useCallback(async(dataUrl:string)=>{
    setImageBase64(dataUrl);setMinimapBase64(null);setPlaceMode(null);
    setGameTimeCrop(null);setPortraitStripCrop(null);
    setAlliesDown([]);setEnemiesDown([]);
    setAdvice("");setChatMessages([]);setActiveConversationId(null);
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

  const handleFiles=(files:FileList|File[])=>{
    const arr=Array.from(files);
    if(!arr.length)return;
    const readers=arr.map(f=>new Promise<string>(res=>{const r=new FileReader();r.onload=e=>res(e.target?.result as string);r.readAsDataURL(f);}));
    Promise.all(readers).then(dataUrls=>{
      const valid=dataUrls.filter(Boolean);
      if(!valid.length)return;
      setImageQueue(valid);
      setActiveQueueIdx(0);
      processImage(valid[0]!);
    });
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
    }else if(placeMode==="obj"){
      const id=`obj-${Date.now()}`;
      setObjPins(p=>[...p,{id,x,y,pos:classifyPos(x,y,lanePaths,zones),objType:null,status:null}]);
      // Get screen coords for popup
      const rect=minimapDivRef.current!.getBoundingClientRect();
      setQuickObjPickPos({x:rect.left+x/100*rect.width,y:rect.top+y/100*rect.height});
      setQuickObjPickId(id);
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
    if(ctx.dragonStatus)parts.push(ctx.dragonStatus);
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
      allyChampions:allyPins.length?allyPins.map((p,i)=>{const s=pinSlot(i,alliesDown);const l=posLabel(p.pos);return p.champ?`${p.champ}(A${s}) at ${l}`:`A${s} at ${l}`;}).join(", "):null,
      enemyChampions:enemyPins.length?enemyPins.map((p,i)=>{const s=pinSlot(i,enemiesDown);const l=posLabel(p.pos);return p.champ?`${p.champ}(E${s}) at ${l}`:`E${s} at ${l}`;}).join(", "):null,
      dragonStatus:objPins.length?(()=>{const lines=objPins.map(p=>{const cfg=p.objType?OBJ_CFG[p.objType]:null;const t=cfg?cfg.label:"Unknown objective";const s=p.status==="up"?"Up":p.status==="soon"?"Spawning Soon":"Down";const loc=posLabel(p.pos);return`${t}: ${s} (at ${loc})`;});return`Objectives pinned on map:\n${lines.map(l=>`  - ${l}`).join("\n")}`;})():null,
      elderDragonStatus:null,baronStatus:null,riftHeraldStatus:null,
      goldDiff:null,score:null,
      additionalNotes:(()=>{
        const parts:string[]=[];
        if(myChamp)parts.push(`I am playing ${myChamp}`);
        if(baronBuff==="us")parts.push("We have Baron Buff");
        else if(baronBuff==="them")parts.push("Enemy has Baron Buff");
        if(elderBuff==="us")parts.push("We have Elder Dragon Buff");
        else if(elderBuff==="them")parts.push("Enemy has Elder Dragon Buff");
        if(alliesDown.length>0)parts.push(`Dead allies: ${alliesDown.sort((a,b)=>a-b).map(n=>`A${n}`).join(", ")}`);
        if(enemiesDown.length>0)parts.push(`Dead enemies: ${enemiesDown.sort((a,b)=>a-b).map(n=>`E${n}`).join(", ")}`);
        const allyTowersDown=towersDown.ally.map(i=>TOWER_LABELS[i]).filter(Boolean);
        const enemyTowersDown=towersDown.enemy.map(i=>TOWER_LABELS[i]).filter(Boolean);
        if(allyTowersDown.length>0)parts.push(`Our destroyed towers: ${allyTowersDown.join(", ")}`);
        if(enemyTowersDown.length>0)parts.push(`Enemy destroyed towers: ${enemyTowersDown.join(", ")}`);
        if(benchPins.length>0){const names=benchPins.map(p=>p.champ||(p.type==="ally"?"an ally":"an enemy")).join(", ");parts.push(`Not visible on map: ${names}`);}
        if(userNotes.trim())parts.push(userNotes.trim());
        return parts.length?parts.join(". "):null;
      })(),
    };
  },[pins,objPins,gameTimeSecs,myRole,myChamp,baronBuff,elderBuff,alliesDown,enemiesDown,towersDown,userNotes]);

  // Always return annotated minimap when available (with pins + game-time crop if present)
  const getAnnotatedMinimap=useCallback(async():Promise<string|null>=>{
    if(!minimapBase64)return null;
    return renderAnnotatedMinimap(minimapBase64,pins,gameTimeCrop,portraitStripCrop,alliesDown,enemiesDown,objPins);
  },[minimapBase64,pins,objPins,gameTimeCrop,portraitStripCrop,alliesDown,enemiesDown]);

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
  const hasContext=pins.length>0||objPins.length>0||!!myChamp||!!myRole||!!baronBuff||!!elderBuff||gameTimeSecs>0;
  const canAdvise=!!model&&!isAdvising&&(!!imageBase64||hasContext);
  const hasBuffs=baronBuff!==null||elderBuff!==null;

  const PLACE_CFG={
    me:   {active:"bg-amber-400/20  border-amber-400  text-amber-400",idle:"border-border/40 text-muted-foreground hover:border-amber-400/40",dot:"bg-amber-400", hint:"Tap anywhere on the minimap to drop YOUR pin — tap pin to remove"},
    ally: {active:"bg-sky-400/20    border-sky-400    text-sky-400",  idle:"border-border/40 text-muted-foreground hover:border-sky-400/40",  dot:"bg-sky-400",  hint:`Tap map to place ally pin (${allyPins.length}/4) — tap pin to assign champ`},
    enemy:{active:"bg-red-500/20    border-red-500    text-red-400",  idle:"border-border/40 text-muted-foreground hover:border-red-400/40",  dot:"bg-red-500",  hint:`Tap map to place enemy pin (${enemyPins.length}/5) — tap pin to assign champ`},
    obj:  {active:"bg-purple-500/20 border-purple-500 text-purple-400",idle:"border-border/40 text-muted-foreground hover:border-purple-500/40",dot:"bg-purple-400",hint:"Tap map to mark an objective location — then pick type & status"},
  };

  const PIN_BG={me:"bg-amber-400",ally:"bg-sky-400",enemy:"bg-red-500"};
  const PIN_BORDER={me:"border-amber-400",ally:"border-sky-400",enemy:"border-red-500"};
  const PIN_TEXT={me:"text-black",ally:"text-black",enemy:"text-white"};
  const pinLabel=(pin:MapPin)=>pin.type==="me"?"ME":pin.type==="ally"?`A${pinSlot(allyPins.indexOf(pin),alliesDown)}`:`E${pinSlot(enemyPins.indexOf(pin),enemiesDown)}`;

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

        {/* ── UPLOAD DROP ZONE (only shown when no screenshot yet) ─── */}
        {!imageBase64&&(
          <div className="w-full h-28 rounded-xl border-2 border-dashed border-border/40 hover:border-primary/30 transition-colors cursor-pointer flex flex-col items-center justify-center gap-2 text-muted-foreground"
            onClick={()=>fileInputRef.current?.click()}
            onDragOver={e=>e.preventDefault()}
            onDrop={e=>{e.preventDefault();if(e.dataTransfer.files.length)handleFiles(e.dataTransfer.files);}}>
            <Upload className="w-5 h-5"/>
            <span className="text-sm">Upload screenshot(s)</span>
            <span className="text-xs text-muted-foreground/50">Tap or drop — select multiple for same match</span>
          </div>
        )}
        <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden"
          onChange={e=>{if(e.target.files?.length)handleFiles(e.target.files);e.target.value="";}}/>


        {/* ── MINIMAP TAP PANEL + DEAD TRACKER ──────────────────────── */}
        {imageBase64&&(<>
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
                {(towersDown.ally.length>0||towersDown.enemy.length>0)&&(
                  <button onClick={()=>setTowersDown({ally:[],enemy:[]})}
                    className="text-[10px] text-amber-400/80 hover:text-amber-300 border border-amber-400/30 hover:border-amber-400/60 px-2 py-1 rounded-full transition-colors">
                    Reset towers
                  </button>
                )}
                {(pins.length>0||objPins.length>0)&&(
                  <button onClick={()=>{setPins([]);setObjPins([]);setTowersDown({ally:[],enemy:[]});}}
                    className="text-[10px] text-muted-foreground hover:text-white border border-border/30 px-2 py-1 rounded-full">
                    Clear all
                  </button>
                )}
              </div>
            </div>

            {/* Batch thumbnail strip */}
            {imageQueue.length>1&&(
              <div className="flex gap-2 px-3 py-2 border-b border-border/30 overflow-x-auto">
                {imageQueue.map((img,i)=>(
                  <div key={i} className="relative shrink-0">
                    <button onClick={()=>{setActiveQueueIdx(i);processImage(img);}}
                      className={cn("w-14 h-14 rounded-lg overflow-hidden border-2 active:scale-95 transition-all block",
                        i===activeQueueIdx?"border-primary":"border-border/30 opacity-50")}>
                      <img src={img} alt={`Screenshot ${i+1}`} className="w-full h-full object-cover"/>
                    </button>
                    <button
                      onClick={()=>{
                        const next=imageQueue.filter((_,j)=>j!==i);
                        if(next.length===0){setImageQueue([]);setActiveQueueIdx(0);setImageBase64(null);setMinimapBase64(null);setGameTimeCrop(null);setPortraitStripCrop(null);}
                        else{const newIdx=i>=next.length?next.length-1:i===activeQueueIdx?Math.min(i,next.length-1):activeQueueIdx>i?activeQueueIdx-1:activeQueueIdx;setImageQueue(next);setActiveQueueIdx(newIdx);if(i===activeQueueIdx)processImage(next[newIdx]!);}
                      }}
                      className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-black/90 border border-border/60 flex items-center justify-center text-xs font-bold text-white hover:bg-red-600 active:scale-90 transition-all touch-manipulation">
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="p-3 space-y-3">
              {/* Mode buttons */}
              <div className="grid grid-cols-4 gap-1.5">
                {(["me","ally","enemy","obj"] as const).map(type=>{
                  const cfg=PLACE_CFG[type];
                  const active=placeMode===type;
                  const count=type==="me"?(myPin?1:0):type==="ally"?allyPins.length:type==="enemy"?enemyPins.length:objPins.length;
                  return(
                    <button key={type} onClick={()=>setPlaceMode(p=>p===type?null:type)}
                      className={cn("flex flex-col items-center justify-center gap-0.5 py-2 rounded-lg border text-[10px] font-bold transition-all active:scale-95 font-display bg-black/30",
                        active?cfg.active:`bg-black/30 ${cfg.idle}`)}>
                      {type==="me"&&<UserRound className="w-3.5 h-3.5"/>}
                      {type==="ally"&&<Users className="w-3.5 h-3.5"/>}
                      {type==="enemy"&&<Swords className="w-3.5 h-3.5"/>}
                      {type==="obj"&&<Target className="w-3.5 h-3.5"/>}
                      <span>{type==="me"?"Me":type==="ally"?"Ally":type==="enemy"?"Enemy":"Obj"}</span>
                      {count>0&&<span className={cn("w-3.5 h-3.5 rounded-full text-[8px] font-bold flex items-center justify-center text-black",cfg.dot)}>{count}</span>}
                    </button>
                  );
                })}
              </div>

              {/* Hint */}
              {placeMode&&(
                <p className={cn("text-[11px] px-3 py-2 rounded-lg border text-center font-display tracking-wide",
                  placeMode==="me"?"bg-amber-400/10 border-amber-400/40 text-amber-400":
                  placeMode==="ally"?"bg-sky-400/10 border-sky-400/40 text-sky-400":
                  placeMode==="obj"?"bg-purple-500/10 border-purple-500/40 text-purple-400":
                  "bg-red-500/10 border-red-500/40 text-red-400")}>
                  {PLACE_CFG[placeMode].hint}
                </p>
              )}

              {/* Minimap + bench zone flex row */}
              <div className="flex items-stretch gap-1">
              <div ref={minimapDivRef}
                className={cn("relative flex-1",
                  placeMode?"cursor-crosshair":"cursor-default")}
                onClick={handleMinimapTap}
                onTouchStart={handleMinimapTap}>
                {/* X button — top-right corner — clears image and triggers new upload */}
                {minimapBase64&&(
                  <button
                    className="absolute top-1 right-1 z-20 w-11 h-11 rounded-full bg-black/75 border border-white/30 flex items-center justify-center text-white hover:bg-black/95 active:scale-95"
                    title="Clear image & upload new screenshot"
                    onClick={e=>{e.stopPropagation();setImageBase64(null);setMinimapBase64(null);setGameTimeCrop(null);setPortraitStripCrop(null);setAlliesDown([]);setEnemiesDown([]);setTimeout(()=>fileInputRef.current?.click(),50);}}>
                    <X className="w-5 h-5"/>
                  </button>
                )}
                {/* Image in its own clipping wrapper so pins can render past the edge */}
                <div className="rounded-lg overflow-hidden border border-border/30">
                  {minimapBase64?(
                    <img src={minimapBase64} alt="Minimap" className="w-full h-auto block pointer-events-none select-none" draggable={false}/>
                  ):(
                    <div className="w-full aspect-square bg-slate-900/80 flex items-center justify-center">
                      <Loader2 className="w-5 h-5 animate-spin text-muted-foreground/40"/>
                    </div>
                  )}
                </div>
                {pins.map(pin=>(
                  <div key={pin.id} data-pin="true"
                    className="absolute -translate-x-1/2 -translate-y-1/2 z-10 flex flex-col items-center touch-none"
                    style={{left:`${pin.x}%`,top:`${pin.y}%`,cursor:pinDragActive.current?.id===pin.id?"grabbing":"grab"}}
                    onPointerDown={e=>{
                      e.stopPropagation();
                      pinDragActive.current={id:pin.id,kind:"champ"};
                      pinDragMoved.current=false;
                      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                    }}
                    onPointerMove={e=>handlePinPointerMove(e,pin.id,"champ")}
                    onPointerUp={e=>{
                      e.stopPropagation();
                      if(pinDragMoved.current&&benchRef.current){
                        const r=benchRef.current.getBoundingClientRect();
                        if(e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom){
                          const bx=Math.min(90,Math.max(10,((e.clientX-r.left)/r.width)*100));
                          const by=Math.min(95,Math.max(5,((e.clientY-r.top)/r.height)*100));
                          setBenchPins(b=>[...b.filter(p=>p.id!==pin.id),{...pin,x:bx,y:by}]);
                          setPins(p=>p.filter(pp=>pp.id!==pin.id));
                          pinDragMoved.current=false;
                          pinDragActive.current=null;
                          return;
                        }
                      }
                      // Clamp x back to map range in case it drifted past 100% during drag
                      setPins(p=>p.map(pp=>pp.id===pin.id?{...pp,x:Math.min(99,Math.max(1,pp.x))}:pp));
                      pinDragActive.current=null;
                    }}
                    onClick={e=>{
                      e.stopPropagation();
                      if(pinDragMoved.current){pinDragMoved.current=false;return;}
                      if(pin.type!=="me"){
                        const rect=(e.currentTarget as HTMLElement).getBoundingClientRect();
                        setQuickPickPos({x:rect.left+rect.width/2,y:rect.top+rect.height/2});
                        setQuickPickPinId(pin.id);
                      }else{
                        removePin(pin.id);
                      }
                    }}>
                    <div className={cn(
                      "w-8 h-8 rounded-full border-2 flex items-center justify-center",
                      "font-display font-bold text-[11px] shadow-lg transition-transform",
                      PIN_BG[pin.type],PIN_BORDER[pin.type],PIN_TEXT[pin.type])}>
                      {pinLabel(pin)}
                    </div>
                    {pin.champ&&(
                      <span className="text-[8px] font-medium text-white bg-black/70 px-1 rounded mt-0.5 whitespace-nowrap leading-tight max-w-[60px] text-center truncate">{pin.champ}</span>
                    )}
                  </div>
                ))}
                {/* Objective pins */}
                {objPins.map(pin=>{
                  const cfg=pin.objType?OBJ_CFG[pin.objType]:null;
                  const short=cfg?cfg.short:"?";
                  const color=cfg?.color??"#888888";
                  return(
                    <div key={pin.id} data-pin="true"
                      className="absolute -translate-x-1/2 -translate-y-1/2 z-10 flex flex-col items-center touch-none"
                      style={{left:`${pin.x}%`,top:`${pin.y}%`,cursor:"grab"}}
                      onPointerDown={e=>{
                        e.stopPropagation();
                        pinDragActive.current={id:pin.id,kind:"obj"};
                        pinDragMoved.current=false;
                        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                      }}
                      onPointerMove={e=>handlePinPointerMove(e,pin.id,"obj")}
                      onPointerUp={e=>{e.stopPropagation();pinDragActive.current=null;}}
                      onClick={e=>{
                        e.stopPropagation();
                        if(pinDragMoved.current){pinDragMoved.current=false;return;}
                        const rect=(e.currentTarget as HTMLElement).getBoundingClientRect();
                        setQuickObjPickPos({x:rect.left+rect.width/2,y:rect.top+rect.height/2});
                        setQuickObjPickId(pin.id);
                      }}>
                      <div className="rounded-md border-2 flex flex-col items-center justify-center shadow-lg active:scale-90 transition-transform px-1.5 py-1"
                        style={{background:"rgba(5,12,28,0.88)",borderColor:color,minWidth:"2.4rem"}}>
                        <span style={{fontSize:"12px",fontWeight:"bold",color,lineHeight:1.1}}>{short}</span>
                        {pin.status&&<span style={{fontSize:"9px",color:pin.status==="up"?"#22c55e":"#f59e0b",lineHeight:1.1}}>{pin.status==="up"?"UP":"~"}</span>}
                      </div>
                    </div>
                  );
                })}
                {/* Tower overlays — tappable on minimap */}
                {(["ally","enemy"] as const).map(team=>
                  towerConfig[team].map((pos,idx)=>{
                    if(!pos)return null;
                    const down=towersDown[team].includes(idx);
                    const color=team==="ally"?"#38BDF8":"#EF4444";
                    const lane=["B","M","D"][Math.floor(idx/3)]!;
                    const tier=(idx%3)+1;
                    return(
                      <button key={`tw-${team}-${idx}`}
                        data-pin="true"
                        className="absolute -translate-x-1/2 -translate-y-1/2 z-10 rounded-sm border flex items-center justify-center font-bold leading-none active:scale-90 transition-transform"
                        style={{
                          left:`${pos.x}%`,top:`${pos.y}%`,
                          width:`${towerIconSizePct}%`,aspectRatio:"1",
                          fontSize:`${towerIconSizePct*0.35}vw`,
                          background:down?"rgba(5,12,28,0.92)":"rgba(5,12,28,0.72)",
                          borderColor:down?"rgba(100,100,100,0.5)":color,
                          color:down?"rgba(100,100,100,0.6)":color,
                          opacity:down?0.55:1,
                          textDecoration:down?"line-through":"none",
                        }}
                        title={`${team==="ally"?"Allied":"Enemy"} ${TOWER_LABELS[idx]}${down?" (destroyed)":""}`}
                        onClick={e=>{
                          e.stopPropagation();
                          setTowersDown(prev=>({
                            ...prev,
                            [team]:down?prev[team].filter(i=>i!==idx):[...prev[team],idx],
                          }));
                        }}>
                        {`${lane}${tier}`}
                      </button>
                    );
                  })
                )}
              </div>
              {/* Bench zone — separate column to the right of minimap */}
              <div ref={benchRef}
                className="relative w-16 shrink-0 rounded-lg border-2 border-dashed border-border/30 bg-black/20">
                  {benchPins.length===0&&(
                    <span className="absolute inset-0 flex items-center justify-center text-[8px] uppercase tracking-widest text-muted-foreground/30 font-display text-center leading-tight pointer-events-none">Off<br/>map</span>
                  )}
                  {benchPins.map(p=>{
                    const allyIdx=benchPins.filter(b=>b.type==="ally").indexOf(p);
                    const enemyIdx=benchPins.filter(b=>b.type==="enemy").indexOf(p);
                    const benchLabel=p.type==="me"?"ME":p.type==="ally"?`A${allyIdx+1}`:`E${enemyIdx+1}`;
                    return(
                      <div key={p.id}
                        className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-0.5 touch-none z-30"
                        style={{left:`${p.x}%`,top:`${p.y}%`,cursor:"grab"}}
                        onPointerDown={e=>{
                          e.stopPropagation();
                          pinDragActive.current={id:p.id,kind:"champ"};
                          pinDragMoved.current=false;
                          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                        }}
                        onPointerMove={e=>{
                          e.stopPropagation();
                          if(!pinDragActive.current||pinDragActive.current.id!==p.id)return;
                          pinDragMoved.current=true;
                          const br=benchRef.current!.getBoundingClientRect();
                          // Track freely — allow negative x so pin visually travels into minimap
                          const bx=((e.clientX-br.left)/br.width)*100;
                          const by=Math.min(95,Math.max(5,((e.clientY-br.top)/br.height)*100));
                          setBenchPins(b=>b.map(bp=>bp.id===p.id?{...bp,x:bx,y:by}:bp));
                        }}
                        onPointerUp={e=>{
                          e.stopPropagation();
                          if(pinDragMoved.current&&benchRef.current&&minimapDivRef.current){
                            const br=benchRef.current.getBoundingClientRect();
                            if(e.clientX<br.left){
                              // Released in minimap — convert to map pin
                              const mr=minimapDivRef.current.getBoundingClientRect();
                              const mx=Math.min(99,Math.max(1,((e.clientX-mr.left)/mr.width)*100));
                              const my=Math.min(99,Math.max(1,((e.clientY-mr.top)/mr.height)*100));
                              setBenchPins(b=>b.filter(bp=>bp.id!==p.id));
                              setPins(prev=>[...prev,{...p,x:mx,y:my,pos:classifyPos(mx,my,lanePaths,zones)}]);
                              pinDragMoved.current=false;
                              pinDragActive.current=null;
                              return;
                            }
                            // Clamp back into bench zone
                            const bx=Math.min(90,Math.max(10,((e.clientX-br.left)/br.width)*100));
                            const by=Math.min(95,Math.max(5,((e.clientY-br.top)/br.height)*100));
                            setBenchPins(b=>b.map(bp=>bp.id===p.id?{...bp,x:bx,y:by}:bp));
                          }
                          pinDragMoved.current=false;
                          pinDragActive.current=null;
                        }}
                        onClick={e=>{
                          e.stopPropagation();
                          if(pinDragMoved.current){pinDragMoved.current=false;return;}
                          setPins(prev=>[...prev,{...p,x:50,y:50}]);
                          setBenchPins(b=>b.filter(bp=>bp.id!==p.id));
                        }}>
                        <div className={cn(
                          "w-8 h-8 rounded-full border-2 flex items-center justify-center",
                          "font-display font-bold text-[11px] shadow-lg",
                          PIN_BG[p.type],PIN_BORDER[p.type],PIN_TEXT[p.type])}>
                          {benchLabel}
                        </div>
                        {p.champ&&(
                          <span className="text-[7px] font-medium text-white/70 whitespace-nowrap max-w-[56px] truncate text-center leading-tight">{p.champ.split(" ")[0]}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
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
                      A{pinSlot(i,alliesDown)}: {posLabel(p.pos)}
                    </span>
                  ))}
                  {enemyPins.map((p,i)=>(
                    <span key={p.id} className="flex items-center gap-1.5 text-[10px] text-red-400 bg-red-500/10 border border-red-400/20 rounded-full px-2.5 py-1">
                      <span className="w-2 h-2 rounded-full bg-red-500"/>
                      E{pinSlot(i,enemiesDown)}: {posLabel(p.pos)}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── SCORE BAR + PORTRAIT STRIP WITH TAP ZONES ─────────── */}
          {(gameTimeCrop||portraitStripCrop)&&(
            <div className="space-y-2">
              {gameTimeCrop&&(
                <div className="relative rounded-xl overflow-hidden border border-border/30">
                  <img src={gameTimeCrop} alt="Score bar" className="w-full h-auto block pointer-events-none select-none"/>
                  {/* Baron buff — left half */}
                  <button
                    onClick={()=>setBaronBuff(p=>p===null?"us":p==="us"?"them":null)}
                    className="absolute inset-y-0 left-0 w-1/2 flex items-center justify-start pl-2 transition-all active:scale-[0.98]"
                    style={{background:baronBuff?"rgba(168,85,247,0.18)":"transparent"}}>
                    {baronBuff&&(
                      <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold"
                        style={{background:"rgba(168,85,247,0.7)",color:"#fff"}}>
                        Baron · {baronBuff==="us"?"US":"THEM"}
                      </span>
                    )}
                  </button>
                  {/* Elder buff — right half */}
                  <button
                    onClick={()=>setElderBuff(p=>p===null?"us":p==="us"?"them":null)}
                    className="absolute inset-y-0 right-0 w-1/2 flex items-center justify-end pr-2 transition-all active:scale-[0.98]"
                    style={{background:elderBuff?"rgba(16,185,129,0.18)":"transparent"}}>
                    {elderBuff&&(
                      <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold"
                        style={{background:"rgba(16,185,129,0.7)",color:"#fff"}}>
                        Elder · {elderBuff==="us"?"US":"THEM"}
                      </span>
                    )}
                  </button>
                  {/* Hint when no buff active */}
                  {!baronBuff&&!elderBuff&&(
                    <div className="absolute inset-0 flex items-center justify-between px-2 pointer-events-none">
                      <span className="text-[8px] text-white/20 font-display">tap for Baron buff</span>
                      <span className="text-[8px] text-white/20 font-display">tap for Elder buff</span>
                    </div>
                  )}
                </div>
              )}
              {/* Portrait strip with calibrated tap zones overlaid */}
              {portraitStripCrop&&(
                <div className="relative rounded-xl overflow-hidden border border-border/30">
                  <img src={portraitStripCrop} alt="Portrait strip" className="w-full h-auto block pointer-events-none select-none"/>
                  {/* Ally tap zones — translate full-image % coords to strip-relative % */}
                  {portraitConfig.allies.map((pos,i)=>{
                    const n=i+1,dead=alliesDown.includes(n);
                    const sx=((pos.x-portraitStripConfig.x)/portraitStripConfig.w)*100;
                    const sy=((pos.y-portraitStripConfig.y)/portraitStripConfig.h)*100;
                    const sz=portraitConfig.sizePct??5.5;
                    if(sx<-5||sx>105||sy<-5||sy>105)return null;
                    return(
                      <button key={`ps-a${n}`}
                        onClick={()=>setAlliesDown(p=>dead?p.filter(x=>x!==n):[...p,n])}
                        className="absolute rounded-full flex items-center justify-center font-bold leading-none select-none"
                        style={{left:`${sx}%`,top:`${sy}%`,transform:"translate(-50%,-50%)",width:`${sz}%`,aspectRatio:"1",
                          background:dead?"rgba(2,6,23,0.85)":"transparent",
                          border:dead?"2px solid rgba(56,189,248,0.7)":"2px solid transparent",
                          color:dead?"#7dd3fc":"transparent",
                          fontSize:`${sz*0.13}vw`}}>
                        {dead?`A${n}`:""}
                      </button>
                    );
                  })}
                  {/* Enemy tap zones */}
                  {portraitConfig.enemies.map((pos,i)=>{
                    const n=i+1,dead=enemiesDown.includes(n);
                    const sx=((pos.x-portraitStripConfig.x)/portraitStripConfig.w)*100;
                    const sy=((pos.y-portraitStripConfig.y)/portraitStripConfig.h)*100;
                    const sz=portraitConfig.sizePct??5.5;
                    if(sx<-5||sx>105||sy<-5||sy>105)return null;
                    return(
                      <button key={`ps-e${n}`}
                        onClick={()=>setEnemiesDown(p=>dead?p.filter(x=>x!==n):[...p,n])}
                        className="absolute rounded-full flex items-center justify-center font-bold leading-none select-none"
                        style={{left:`${sx}%`,top:`${sy}%`,transform:"translate(-50%,-50%)",width:`${sz}%`,aspectRatio:"1",
                          background:dead?"rgba(2,6,23,0.85)":"transparent",
                          border:dead?"2px solid rgba(239,68,68,0.7)":"2px solid transparent",
                          color:dead?"#fca5a5":"transparent",
                          fontSize:`${sz*0.13}vw`}}>
                        {dead?`E${n}`:""}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── FULL SCREENSHOT (collapsible, below minimap) ───────── */}
          <div className="flex flex-col gap-1.5">
            <button onClick={toggleScreenshotCollapsed}
              className="flex items-center justify-between w-full px-3 py-2 rounded-xl border border-border/40 bg-card/30 text-xs font-display tracking-widest uppercase text-muted-foreground active:scale-[0.99]">
              <span>{screenshotCollapsed?"Show full screenshot":"Hide full screenshot"}</span>
              {screenshotCollapsed?<ChevronDown className="w-4 h-4"/>:<ChevronUp className="w-4 h-4"/>}
            </button>
            {!screenshotCollapsed&&(<>
              <div className="relative w-full rounded-xl overflow-hidden border border-border/40">
                <img src={imageBase64!} alt="Game screenshot" className="w-full h-auto block" draggable={false}/>
                {/* Portrait tap zones on full screenshot — size is strip-relative, convert to full-image % */}
                {portraitConfig.allies.map((pos,i)=>{
                  const n=i+1,dead=alliesDown.includes(n);
                  const sz=`${((portraitConfig.sizePct??5.5)*portraitStripConfig.w)/100}%`;
                  return(
                    <button key={`fa${n}`}
                      onClick={()=>setAlliesDown(p=>dead?p.filter(x=>x!==n):[...p,n])}
                      className="absolute rounded-full flex items-center justify-center font-bold leading-none select-none"
                      style={{left:`${pos.x}%`,top:`${pos.y}%`,transform:"translate(-50%,-50%)",width:sz,aspectRatio:"1",
                        background:dead?"rgba(2,6,23,0.85)":"transparent",
                        border:dead?"2px solid rgba(56,189,248,0.6)":"none",
                        color:dead?"#7dd3fc":"transparent",fontSize:"9px"}}>
                      {dead?`A${n}`:""}
                    </button>
                  );
                })}
                {portraitConfig.enemies.map((pos,i)=>{
                  const n=i+1,dead=enemiesDown.includes(n);
                  const sz=`${((portraitConfig.sizePct??5.5)*portraitStripConfig.w)/100}%`;
                  return(
                    <button key={`fe${n}`}
                      onClick={()=>setEnemiesDown(p=>dead?p.filter(x=>x!==n):[...p,n])}
                      className="absolute rounded-full flex items-center justify-center font-bold leading-none select-none"
                      style={{left:`${pos.x}%`,top:`${pos.y}%`,transform:"translate(-50%,-50%)",width:sz,aspectRatio:"1",
                        background:dead?"rgba(2,6,23,0.85)":"transparent",
                        border:dead?"2px solid rgba(239,68,68,0.7)":"none",
                        color:dead?"#fca5a5":"transparent",fontSize:"9px"}}>
                      {dead?`E${n}`:""}
                    </button>
                  );
                })}
              </div>
              {/* Toolbar */}
              <div className="flex flex-wrap gap-1.5 items-center">
                <button className="border border-white/20 text-white text-xs px-2 py-1 rounded-lg flex items-center gap-1 active:scale-95 hover:bg-white/10"
                  onClick={()=>fileInputRef.current?.click()}>
                  <Upload className="w-3 h-3"/> Replace
                </button>
                <button className="border border-amber-400/40 text-amber-400 text-xs px-2 py-1 rounded-lg flex items-center gap-1 active:scale-95 hover:bg-amber-400/10"
                  onClick={()=>setShowCropEditor(true)}>
                  <Crop className="w-3 h-3"/> Map
                </button>
                <button className={cn("text-xs px-2 py-1 rounded-lg flex items-center gap-1 active:scale-95 border hover:bg-white/5",
                  gameTimeCrop?"border-border/60 text-foreground/70":"border-border/30 text-muted-foreground/60")}
                  onClick={()=>setShowTimerCropEditor(true)}>
                  <Clock className="w-3 h-3"/> Score bar
                </button>
                <button className={cn("text-xs px-2 py-1 rounded-lg flex items-center gap-1 active:scale-95 border hover:bg-white/5",
                  portraitStripCrop?"border-emerald-400/60 text-emerald-400":"border-emerald-400/30 text-emerald-400/60")}
                  onClick={()=>setShowPortraitStripEditor(true)}>
                  <Timer className="w-3 h-3"/> Respawn
                </button>
                <button className="border border-sky-400/40 text-sky-400 text-xs px-2 py-1 rounded-lg flex items-center gap-1 active:scale-95 hover:bg-sky-400/10"
                  onClick={()=>setShowPortraitBarEditor(true)}>
                  <Users className="w-3 h-3"/> Portraits
                </button>
                <button className={cn("text-xs px-2 py-1 rounded-lg flex items-center gap-1 active:scale-95 border hover:bg-white/5",
                  (towersDown.ally.length>0||towersDown.enemy.length>0)?"border-amber-400/60 text-amber-400":"border-border/30 text-muted-foreground/60")}
                  onClick={()=>setShowTowerCalibrator(true)}>
                  <Building2 className="w-3 h-3"/> Towers
                </button>
                {/* Main map tower icon size */}
                <div className="flex items-center gap-0.5 border border-border/30 rounded-lg overflow-hidden">
                  <button className="px-1.5 py-1 text-sm text-muted-foreground hover:text-white hover:bg-white/10 active:scale-95 leading-none"
                    onClick={()=>saveTowerIconSize(towerIconSizePct-1)}>−</button>
                  <span className="text-[9px] text-muted-foreground/50 w-5 text-center select-none">{towerIconSizePct}</span>
                  <button className="px-1.5 py-1 text-sm text-muted-foreground hover:text-white hover:bg-white/10 active:scale-95 leading-none"
                    onClick={()=>saveTowerIconSize(towerIconSizePct+1)}>+</button>
                </div>
              </div>
            </>)}
          </div>
        </>)}

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
      {showPortraitBarEditor&&(portraitStripCrop||imageBase64)&&(
        <PortraitPlacer
          screenshot={portraitStripCrop??imageBase64!}
          current={portraitConfig}
          onSave={cfg=>{savePortraitConfig(cfg);}}
          onClose={()=>setShowPortraitBarEditor(false)}
          toDisplay={portraitStripCrop ? (p=>({
            x: ((p.x-portraitStripConfig.x)/portraitStripConfig.w)*100,
            y: ((p.y-portraitStripConfig.y)/portraitStripConfig.h)*100,
          })) : undefined}
          toStored={portraitStripCrop ? (p=>({
            x: p.x*portraitStripConfig.w/100+portraitStripConfig.x,
            y: p.y*portraitStripConfig.h/100+portraitStripConfig.y,
          })) : undefined}
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
      {showTowerCalibrator&&minimapBase64&&(
        <TowerCalibrator
          imageDataUrl={minimapBase64}
          config={towerConfig}
          onSave={saveTowerConfig}
          onClose={()=>setShowTowerCalibrator(false)}
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

      {/* Quick obj picker — appears when obj pin placed or tapped */}
      {quickObjPickId&&(()=>{
        const pin=objPins.find(p=>p.id===quickObjPickId);
        if(!pin)return null;
        return(
          <QuickObjPicker
            pin={pin}
            pos={quickObjPickPos}
            onUpdate={partial=>{setObjPins(prev=>prev.map(p=>p.id===quickObjPickId?{...p,...partial}:p));}}
            onRemove={()=>{setObjPins(prev=>prev.filter(p=>p.id!==quickObjPickId));setQuickObjPickId(null);}}
            onClose={()=>setQuickObjPickId(null)}
          />
        );
      })()}

      {/* Quick champ picker — appears after placing ally/enemy pin, or on pin tap */}
      {quickPickPinId&&(()=>{
        const pin=pins.find(p=>p.id===quickPickPinId);
        if(!pin||pin.type==="me")return null;
        const ap=pins.filter(p=>p.type==="ally");
        const ep=pins.filter(p=>p.type==="enemy");
        const lbl=pin.type==="ally"
          ?`A${pinSlot(ap.indexOf(pin),alliesDown)}`
          :`E${pinSlot(ep.indexOf(pin),enemiesDown)}`;
        return(
          <QuickChampPicker
            pin={pin}
            label={lbl}
            pos={quickPickPos}
            onAssign={champ=>{
              setPins(prev=>prev.map(p=>p.id===quickPickPinId?{...p,champ}:p));
              setQuickPickPinId(null);
            }}
            onRemove={()=>{removePin(quickPickPinId);setQuickPickPinId(null);}}
            onClose={()=>setQuickPickPinId(null)}
            favorites={favorites}
            onToggleFav={toggleFav}
          />
        );
      })()}
    </div>
  );
}
