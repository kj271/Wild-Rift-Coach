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
  ChevronDown, ChevronUp, Crop, Map as MapIcon, Star, RotateCcw, Bug, Timer, Clock, Building2, Plus,
  Database, Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { detectMapCircles, loadDetectConfig, matchPersonalDb, saveChampPortrait, getAllPortraitEntries, deletePortraitEntry, prewarmChampSigs, detectTowerStatus, detectMinionWavesInLanes, detectDeadBySlotBoxes, SlotBox, PortraitDbEntry, DetectedCircle } from "@/lib/champion-detection";

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
  "K'Sante","Kai'Sa","Kalista","Karma","Kassadin","Katarina","Kayle","Kayn","Kennen","Kha'Zix","Kog'Maw",
  "LeBlanc","Lee Sin","Leona","Lillia","Lissandra","Lucian","Lulu","Lux",
  "Malphite","Malzahar","Master Yi","Mel","Miss Fortune","Morgana",
  "Nami","Nasus","Nautilus","Nilah","Norra","Nunu",
  "Olaf","Orianna",
  "Pantheon",
  "Quinn",
  "Rakan","Rammus","Renekton","Rengar","Riven","Ryze",
  "Seraphine","Senna","Sett","Shen","Shyvana","Singed","Skarner","Smolder","Sona","Soraka","Swain",
  "Taliyah","Teemo","Thresh","Tristana","Tryndamere","Twisted Fate","Twitch",
  "Varus","Vayne","Veigar","Vel'Koz","Vi","Viego","Viktor","Vladimir","Volibear",
  "Warwick","Wukong",
  "Xayah","Xin Zhao",
  "Yasuo","Yone","Yuumi",
  "Zac","Zed","Ziggs","Zilean","Zoe","Zyra",
].sort();

// ─── Recently used champions ──────────────────────────────────────────────────
const RECENT_CHAMPS_KEY = "wr_recent_champs";
const MAX_RECENT_CHAMPS = 10;
function _loadRecentChamps(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_CHAMPS_KEY) ?? "[]"); } catch { return []; }
}
function _addRecentChamp(name: string): string[] {
  const prev = _loadRecentChamps();
  const next = [name, ...prev.filter(c => c !== name)].slice(0, MAX_RECENT_CHAMPS);
  localStorage.setItem(RECENT_CHAMPS_KEY, JSON.stringify(next));
  return next;
}

const ROLES = ["Top","Jungle","Mid","ADC","Support"] as const;
type Role = typeof ROLES[number];
type ObjType = "baron" | "infernal" | "mountain" | "ocean" | "ice" | "elder_dragon" | "rift_herald";
type ObjStatus = "up" | "soon" | null; // null = down
type BuffHolder = "us" | "them" | null;
type PinType = "me" | "ally" | "enemy" | "ally_wave" | "enemy_wave";
type PlaceMode = PinType | "obj" | null;
interface ObjPin { id:string; x:number; y:number; pos:PosInfo; objType:ObjType|null; status:ObjStatus }

// ─── Position types ────────────────────────────────────────────────────────────
type LanePos = { kind: "lane"; lane: string; progress: number; category: string };
type ZonePos = { kind: "zone"; zone: string };
type PosInfo = LanePos | ZonePos;

interface MapPin { id: string; type: PinType; x: number; y: number; pos: PosInfo; champ: string | null; auto?: boolean }
interface ImageSlotState {
  pins:MapPin[]; benchPins:MapPin[]; objPins:ObjPin[];
  alliesDown:number[]; enemiesDown:number[]; towersDown:{ally:number[];enemy:number[]};
  advice?:string; chatMessages?:StreamingMsg[]; conversationId?:number|null;
  detectedStripAllies?:(string|null)[]; detectedStripEnemies?:(string|null)[];
}

// ─── Session persistence ───────────────────────────────────────────────────────
const SESSION_KEY = "wildrift_session";
const SESSION_IMG_KEY = "wildrift_session_img";
const IDB_KEY_QUEUE = "queue";
const IDB_KEY_IMGS  = "imgs";
const IDB_KEY_CROPS = "crops";

// ─── IndexedDB helpers — no quota limit, safe for large base64 images ─────────
function _openIdb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open("wildrift_coach_v1", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onsuccess = () => res(r.result);
    r.onerror   = () => rej(r.error);
  });
}
async function idbSet(key: string, val: unknown): Promise<void> {
  try {
    const db = await _openIdb();
    await new Promise<void>((res, rej) => {
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").put(val, key);
      tx.oncomplete = () => res();
      tx.onerror    = () => rej(tx.error);
    });
  } catch {}
}
async function idbGet<T>(key: string): Promise<T | undefined> {
  try {
    const db = await _openIdb();
    return new Promise<T | undefined>((res, rej) => {
      const tx = db.transaction("kv", "readonly");
      const r2 = tx.objectStore("kv").get(key);
      r2.onsuccess = () => res(r2.result as T | undefined);
      r2.onerror   = () => rej(r2.error);
    });
  } catch { return undefined; }
}
async function idbDel(key: string): Promise<void> {
  try {
    const db = await _openIdb();
    await new Promise<void>((res, rej) => {
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").delete(key);
      tx.oncomplete = () => res();
      tx.onerror    = () => rej(tx.error);
    });
  } catch {}
}

let _cachedSession: Record<string, unknown> | null = null;
function loadSession(): Record<string, unknown> {
  if (_cachedSession !== null) return _cachedSession;
  try {
    const ctx = localStorage.getItem(SESSION_KEY);
    _cachedSession = ctx ? JSON.parse(ctx) as Record<string, unknown> : {};
  } catch { _cachedSession = {}; }
  return _cachedSession!;
}
function saveSession(data: Record<string, unknown>) {
  _cachedSession = { ...data };
  // Only small text fields go to localStorage — images go to IndexedDB via separate useEffects
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { imageBase64: _ib, minimapBase64: _mb, ...ctx } = data;
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(ctx)); } catch {}
}
function clearSessionStorage() {
  _cachedSession = null;
  try { localStorage.removeItem(SESSION_KEY); } catch {}
  try { localStorage.removeItem(SESSION_IMG_KEY); } catch {}
  idbDel(IDB_KEY_QUEUE);
  idbDel(IDB_KEY_IMGS);
  idbDel(IDB_KEY_CROPS);
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

// ── Lane midpoint helper ──────────────────────────────────────────────────────
// Returns a point at fraction t (0=ally base, 1=enemy base) along a polyline.
function lanePoint(path:Point[],t:number):{x:number;y:number}{
  if(!path.length)return{x:50,y:50};
  if(path.length===1)return{x:path[0].x,y:path[0].y};
  const lens:number[]=[];
  for(let i=0;i<path.length-1;i++){const dx=path[i+1].x-path[i].x,dy=path[i+1].y-path[i].y;lens.push(Math.sqrt(dx*dx+dy*dy));}
  const total=lens.reduce((s,l)=>s+l,0);
  let walked=0,target=t*total;
  for(let i=0;i<lens.length;i++){
    if(walked+lens[i]>=target){const f=lens[i]>0?(target-walked)/lens[i]:0;return{x:path[i].x+f*(path[i+1].x-path[i].x),y:path[i].y+f*(path[i+1].y-path[i].y)};}
    walked+=lens[i];
  }
  return{x:path[path.length-1].x,y:path[path.length-1].y};
}

// ── Per-slot dead calibration box types ──────────────────────────────────────
type DeadSlotBoxes={ally:SlotBox[];enemy:SlotBox[]};
const DEFAULT_DEAD_SLOT_BOXES:DeadSlotBoxes={
  ally: Array.from({length:4},(_,i)=>({x:i*25,y:0,w:25,h:50})),
  enemy:Array.from({length:5},(_,i)=>({x:i*20,y:50,w:20,h:50})),
};
function loadDeadBoxes():DeadSlotBoxes{
  try{const s=localStorage.getItem("wr_dead_slot_boxes");return s?JSON.parse(s):DEFAULT_DEAD_SLOT_BOXES;}
  catch{return DEFAULT_DEAD_SLOT_BOXES;}
}

// ── Objective pit detection ───────────────────────────────────────────────────
interface ObjPitConfig{zones:[SlotBox,SlotBox];colors:Record<string,string>}
const OBJ_DETECT_TYPES=[
  {id:"baron",       label:"Baron Nashor",    def:"#5B2C6F"},
  {id:"infernal",    label:"Infernal Dragon", def:"#E74C3C"},
  {id:"mountain",    label:"Mountain Dragon", def:"#7D6608"},
  {id:"ocean",       label:"Ocean Dragon",    def:"#1ABC9C"},
  {id:"ice",         label:"Ice Dragon",      def:"#7dd3fc"},
  {id:"elder_dragon",label:"Elder Dragon",    def:"#C39BD3"},
  {id:"rift_herald", label:"Rift Herald",     def:"#E8DAEF"},
] as const;
type ObjDetectId=typeof OBJ_DETECT_TYPES[number]["id"];
const DEFAULT_OBJ_PIT_CONFIG:ObjPitConfig={
  zones:[{x:20,y:2,w:40,h:44},{x:40,y:54,w:40,h:44}],
  colors:Object.fromEntries(OBJ_DETECT_TYPES.map(t=>[t.id,t.def])),
};
function loadObjPitConfig():ObjPitConfig{
  try{const s=localStorage.getItem("wr_obj_pit_config");return s?JSON.parse(s):DEFAULT_OBJ_PIT_CONFIG;}
  catch{return DEFAULT_OBJ_PIT_CONFIG;}
}
function hexToRgb(hex:string):{r:number;g:number;b:number}|null{
  const m=hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  return m?{r:parseInt(m[1],16),g:parseInt(m[2],16),b:parseInt(m[3],16)}:null;
}
function detectObjColors(
  imgUrl:string,
  zones:[SlotBox,SlotBox],
  colors:Record<string,string>,
):Promise<{zoneA:string[];zoneB:string[]}>{
  return new Promise(resolve=>{
    const img=new Image();
    img.onload=()=>{
      const W=img.width,H=img.height;
      const c=document.createElement("canvas");c.width=W;c.height=H;
      c.getContext("2d")!.drawImage(img,0,0);
      const data=c.getContext("2d")!.getImageData(0,0,W,H).data;
      // Pixel RGB saturation (0–1): S = (max-min)/max
      const saturation=(r:number,g:number,b:number):number=>{
        const mx=Math.max(r,g,b);return mx===0?0:(mx-Math.min(r,g,b))/mx;
      };
      const scanZone=(zone:SlotBox,rgb:{r:number;g:number;b:number}):number=>{
        const x0=Math.round(Math.max(0,zone.x*W/100)),x1=Math.round(Math.min(W,(zone.x+zone.w)*W/100));
        const y0=Math.round(Math.max(0,zone.y*H/100)),y1=Math.round(Math.min(H,(zone.y+zone.h)*H/100));
        let count=0;
        for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
          const i=(y*W+x)*4;
          const r=data[i],g=data[i+1],b=data[i+2];
          // Skip grey/desaturated pixels — grey icon = objective is DOWN
          if(saturation(r,g,b)<0.25)continue;
          const dr=r-rgb.r,dg=g-rgb.g,db=b-rgb.b;
          if(Math.sqrt(dr*dr+dg*dg+db*db)<38)count++;
        }
        return count;
      };
      const THRESHOLD=8;
      // Return only the single best-matching objective (most pixels) to avoid false ties
      const checkZone=(zone:SlotBox)=>{
        let bestId="",bestCount=THRESHOLD-1;
        for(const[id,hex]of Object.entries(colors)){
          const rgb=hexToRgb(hex);if(!rgb)continue;
          const count=scanZone(zone,rgb);
          if(count>bestCount){bestCount=count;bestId=id;}
        }
        return bestId?[bestId]:[];
      };
      resolve({zoneA:checkZone(zones[0]),zoneB:checkZone(zones[1])});
    };
    img.onerror=()=>resolve({zoneA:[],zoneB:[]});
    img.src=imgUrl;
  });
}

// ── Per-slot portrait strip detect calibration ───────────────────────────────
interface StripDetectBox{x:number;y:number;sz:number} // strip-relative % — center + half-size
interface StripDetectConfig{ally:StripDetectBox[];enemy:StripDetectBox[]}
function loadStripDetectConfig():StripDetectConfig|null{
  try{const s=localStorage.getItem("wr_strip_detect_config");return s?JSON.parse(s):null;}
  catch{return null;}
}
// ── Portrait strip per-slot champion detection ────────────────────────────────
async function detectStripSlotChamps(
  stripCrop:string,
  slots:Array<{x:number;y:number}>,
  stripConfig:{x:number;y:number;w:number;h:number},
  sizePct:number,
  overrides?:(StripDetectBox|null)[],
):Promise<(string|null)[]>{
  return Promise.all(slots.map(async(pos,i)=>{
    const ov=overrides?.[i];
    const sx=ov?.x??((pos.x-stripConfig.x)/stripConfig.w)*100;
    const sy=ov?.y??((pos.y-stripConfig.y)/stripConfig.h)*100;
    const sz=ov?.sz??sizePct;
    const half=sz/2;
    if(sx<-5||sx>105||sy<-5||sy>105)return null;
    try{
      const slotCrop=await cropDataUrl(stripCrop,Math.max(0,sx-half),Math.max(0,sy-half),sz,sz);
      const match=await matchPersonalDb(slotCrop);
      return match?.name??null;
    }catch{return null;}
  }));
}

// ── Distance from a point to a polyline path (lane zones) ────────────────────
function distToSegment(p:{x:number;y:number},a:{x:number;y:number},b:{x:number;y:number}):number{
  const dx=b.x-a.x,dy=b.y-a.y;
  if(dx===0&&dy===0){const ex=p.x-a.x,ey=p.y-a.y;return Math.sqrt(ex*ex+ey*ey);}
  const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy)));
  const cx=a.x+t*dx,cy=a.y+t*dy;
  const ex=p.x-cx,ey=p.y-cy;return Math.sqrt(ex*ex+ey*ey);
}
function distToPath(p:{x:number;y:number},path:{x:number;y:number}[]):number{
  if(!path.length)return Infinity;
  let min=Infinity;
  for(let i=0;i<path.length-1;i++)min=Math.min(min,distToSegment(p,path[i],path[i+1]));
  return min;
}
// Assign a position to the nearest calibrated lane path
function nearestLane(p:{x:number;y:number},baron:{x:number;y:number}[],mid:{x:number;y:number}[],dragon:{x:number;y:number}[]):"Top"|"Mid"|"Bot"{
  const dT=distToPath(p,baron),dM=distToPath(p,mid),dB=distToPath(p,dragon);
  if(dT<=dM&&dT<=dB)return"Top";
  if(dM<=dT&&dM<=dB)return"Mid";
  return"Bot";
}

// ── Tower cascade: if T2/T3 is down, all preceding towers in that lane are also down ──
function applyTowerCascade(down:number[]):number[]{
  const s=new Set(down);
  [[0,1,2],[3,4,5],[6,7,8]].forEach(([t1,t2,t3])=>{
    if(s.has(t3)){s.add(t1);s.add(t2);}
    else if(s.has(t2)){s.add(t1);}
  });
  return Array.from(s).sort((a,b)=>a-b);
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

  // Draw champion/me pins (skip wave pins — drawn separately below)
  const r=Math.round(W*0.05);
  const allyPins=pins.filter(p=>p.type==="ally");
  const enemyPins=pins.filter(p=>p.type==="enemy");
  const aDown=alliesDown??[];const eDown=enemiesDown??[];
  for(const pin of pins){
    if(pin.type==="ally_wave"||pin.type==="enemy_wave")continue;
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

  // Draw wave pins (diamond shape, labelled AW1/EW1 etc.)
  const wr=Math.round(W*0.038);
  const allyWavePins=pins.filter(p=>p.type==="ally_wave");
  const enemyWavePins=pins.filter(p=>p.type==="enemy_wave");
  for(const pin of [...allyWavePins,...enemyWavePins]){
    const isAlly=pin.type==="ally_wave";
    const wavePinsOfType=isAlly?allyWavePins:enemyWavePins;
    const idx=wavePinsOfType.indexOf(pin)+1;
    const wLabel=isAlly?`AW${idx}`:`EW${idx}`;
    const wColor=isAlly?"#4ade80":"#fb923c";
    const wOutline=isAlly?"#14532d":"#7c2d12";
    const px=pin.x/100*W,py=pin.y/100*H;
    // Diamond shape
    ctx.shadowColor="rgba(0,0,0,0.8)";ctx.shadowBlur=6;
    ctx.beginPath();ctx.moveTo(px,py-wr);ctx.lineTo(px+wr,py);ctx.lineTo(px,py+wr);ctx.lineTo(px-wr,py);ctx.closePath();
    ctx.fillStyle=wColor+"CC";ctx.fill();ctx.shadowBlur=0;
    ctx.strokeStyle=wOutline;ctx.lineWidth=Math.max(1.5,wr*0.18);ctx.stroke();
    ctx.fillStyle="#000";
    ctx.font=`bold ${Math.round(wr*0.9)}px sans-serif`;
    ctx.textAlign="center";ctx.textBaseline="middle";
    ctx.fillText(wLabel,px,py);
  }

  // Draw objective pins
  if(objPins?.length){
    const objColors:Record<string,string>={baron:"#a855f7",infernal:"#ef4444",mountain:"#a16207",ocean:"#0ea5e9",ice:"#7dd3fc",elder_dragon:"#10b981",rift_herald:"#ef4444"};
    const objShorts:Record<string,string>={baron:"B",infernal:"ID",mountain:"MD",ocean:"OD",ice:"IC",elder_dragon:"ED",rift_herald:"RH"};
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
  baron:       {label:"Baron Nashor",    short:"B",  color:"#a855f7",bg:"rgba(168,85,247,0.18)",border:"rgba(168,85,247,0.6)"},
  infernal:    {label:"Infernal Dragon", short:"ID", color:"#ef4444",bg:"rgba(239,68,68,0.18)", border:"rgba(239,68,68,0.6)"},
  mountain:    {label:"Mountain Dragon", short:"MD", color:"#a16207",bg:"rgba(161,98,7,0.18)",  border:"rgba(161,98,7,0.6)"},
  ocean:       {label:"Ocean Dragon",    short:"OD", color:"#0ea5e9",bg:"rgba(14,165,233,0.18)",border:"rgba(14,165,233,0.6)"},
  ice:         {label:"Ice Dragon",      short:"IC", color:"#7dd3fc",bg:"rgba(125,211,252,0.18)",border:"rgba(125,211,252,0.6)"},
  elder_dragon:{label:"Elder Dragon",    short:"ED", color:"#10b981",bg:"rgba(16,185,129,0.18)", border:"rgba(16,185,129,0.6)"},
  rift_herald: {label:"Rift Herald",     short:"RH", color:"#f59e0b",bg:"rgba(245,158,11,0.18)", border:"rgba(245,158,11,0.6)"},
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
function QuickChampPicker({pin,label,pos,onAssign,onRemove,onClose,recent}:{
  pin:MapPin;label:string;pos:{x:number;y:number};
  onAssign:(c:string|null,save:boolean)=>void;onRemove:()=>void;onClose:()=>void;
  recent?:string[];
}){
  const[search,setSearch]=useState("");
  const[saveToDb,setSaveToDb]=useState(true);
  const inputRef=useRef<HTMLInputElement>(null);
  const popupRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{setTimeout(()=>inputRef.current?.focus(),60);},[]);

  // Clamp popup so it stays on screen (popup is ~300×440)
  const PW=300,PH=440;
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
          {/* Save to DB toggle */}
          <button onClick={()=>setSaveToDb(v=>!v)}
            title={saveToDb?"Assigned champion will be saved to portrait database — tap to disable":"Portrait will NOT be saved — tap to enable"}
            className={cn("flex items-center gap-1 text-[10px] px-2 py-1 rounded border shrink-0 active:scale-95",
              saveToDb?"border-emerald-500/60 text-emerald-400 bg-emerald-500/10":"border-border/30 text-muted-foreground/40")}>
            <Database className="w-3 h-3"/>{saveToDb?"DB":"No DB"}
          </button>
          {pin.champ&&<button onClick={()=>onAssign(null,false)} className="text-xs text-muted-foreground border border-border/30 px-2 py-1 rounded active:scale-95 shrink-0">✕</button>}
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
        {/* Recent champs strip */}
        {(recent??[]).length>0&&!search&&(
          <div className="px-3 pb-1 shrink-0">
            <p className="text-[9px] uppercase tracking-widest text-sky-400/60 mb-1.5 font-display">Recent</p>
            <div className="flex gap-1.5 overflow-x-auto">
              {(recent??[]).map(c=>(
                <button key={c} onClick={()=>onAssign(c,saveToDb)}
                  className={cn("shrink-0 text-xs px-2.5 py-1 rounded-full border active:scale-95",
                    pin.champ===c?"bg-sky-400/25 border-sky-400 text-sky-300":"border-sky-400/20 text-sky-300/60 hover:border-sky-400/50")}>
                  {c}
                </button>
              ))}
            </div>
          </div>
        )}
        {/* List */}
        <div className="overflow-y-auto flex-1 px-2 pb-2">
          {filtered.map(c=>{
            const sel=pin.champ===c;
            return(
              <button key={c} onClick={()=>onAssign(c,saveToDb)}
                className={cn("w-full text-left px-3 py-2.5 text-sm rounded-lg transition-all active:scale-[.97]",
                  sel?"bg-primary/20 text-primary":"text-slate-300 hover:bg-white/5 hover:text-white")}>
                {c}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

// ─── CropAdjuster — full-screen modal to precisely crop a portrait before saving ─
//
// Design:
//  • cx/cy/r are stored in BASE (zoom=1) display pixels.
//  • The image is scaled with CSS transform so the crop circle is ALWAYS
//    visible at the centre of the container — the map pans under it.
//  • SVG overlay lives in CONTAINER space: circle is always at (disp/2, disp/2).
//  • Pinch two fingers to zoom (non-passive listeners via useEffect).
//  • Move mode: single-finger drag pans the circle; resize mode: drag near edge.
//  • Resize is delta-based — lifting and re-touching does not jump.
//
function CropAdjuster({champ,minimapSrc,pinX,pinY,initialCropPct,onConfirm,onCancel}:{
  champ:string; minimapSrc:string;
  pinX:number; pinY:number; initialCropPct:number;
  onConfirm:(cxPct:number,cyPct:number,diamPct:number)=>void;
  onCancel:()=>void;
}){
  const containerRef = useRef<HTMLDivElement>(null);
  const [disp,setDisp]   = useState(320);
  const [cx,setCx]       = useState(160);
  const [cy,setCy]       = useState(160);
  const [r,setR]         = useState(24);
  const [zoom,setZoom]   = useState(1);

  useEffect(()=>{
    const s = Math.min(window.innerWidth-32, window.innerHeight-140, 480);
    setDisp(s);
    setCx(pinX/100*s);
    setCy(pinY/100*s);
    setR(Math.max(12,(initialCropPct/100)*s/2));
  },[pinX,pinY,initialCropPct]);

  // Current state is stored in a ref so native (non-React) event handlers
  // can read it without stale-closure issues.
  const S = useRef({cx:160,cy:160,r:24,zoom:1,disp:320});
  S.current = {cx,cy,r,zoom,disp};

  // Single-finger drag state
  const dragRef = useRef<{
    mode:"move"|"resize";
    startSx:number; startSy:number;          // screen coords at drag start
    startCx:number; startCy:number; startR:number;
    startDr:number; zoom:number; disp:number; // snapshot at drag start
  }|null>(null);

  // Pinch state
  const pinchRef = useRef<{startDist:number; startZoom:number}|null>(null);

  // ── Geometry helpers ────────────────────────────────────────────────────────
  //
  // Image transform: scale(zoom) translate(tx, ty) with transform-origin: 0 0
  //   tx = disp/2/zoom − cx   →  circle centre maps to screen (disp/2, disp/2)
  //   ty = disp/2/zoom − cy
  //
  // Touch coords (screen) vs base coords:
  //   Move:   base_delta = screen_delta / zoom
  //   Resize: base_dist_from_centre = screenDist(touch, (disp/2,disp/2)) / zoom
  //
  const imgTX = (d:number,c:number,z:number) => d/2/z - c;
  const imgTY = (d:number,c:number,z:number) => d/2/z - c;

  // Native pointer helpers — read rect fresh each time
  const getRect = () => containerRef.current?.getBoundingClientRect();

  // ── Drag logic (runs in native listeners) ──────────────────────────────────
  const startDrag = (sx:number,sy:number)=>{
    const {cx:ccx,cy:ccy,r:cr,zoom:vz,disp:vd} = S.current;
    const screenDist = Math.hypot(sx-vd/2, sy-vd/2);
    const baseDist   = screenDist/vz;
    const mode:("move"|"resize") = baseDist < cr*0.75 ? "move" : "resize";
    dragRef.current = {mode,startSx:sx,startSy:sy,startCx:ccx,startCy:ccy,startR:cr,startDr:baseDist,zoom:vz,disp:vd};
  };

  const moveDrag = (sx:number,sy:number)=>{
    const d = dragRef.current;
    if(!d) return;
    if(d.mode==="move"){
      const dx=(sx-d.startSx)/d.zoom, dy=(sy-d.startSy)/d.zoom;
      setCx(Math.max(d.startR,Math.min(d.disp-d.startR, d.startCx+dx)));
      setCy(Math.max(d.startR,Math.min(d.disp-d.startR, d.startCy+dy)));
    } else {
      const screenDist = Math.hypot(sx-d.disp/2, sy-d.disp/2);
      const curDr = screenDist/d.zoom;
      setR(Math.max(8,Math.min(d.disp/2-4, d.startR+(curDr-d.startDr))));
    }
  };

  // ── Native (non-passive) touch listeners ───────────────────────────────────
  useEffect(()=>{
    const el = containerRef.current;
    if(!el) return;

    const onTS = (e:TouchEvent)=>{
      e.preventDefault();
      if(e.touches.length===2){
        dragRef.current = null;
        const d = Math.hypot(
          e.touches[1].clientX-e.touches[0].clientX,
          e.touches[1].clientY-e.touches[0].clientY,
        );
        pinchRef.current = {startDist:d, startZoom:S.current.zoom};
      } else if(e.touches.length===1){
        pinchRef.current = null;
        const rect = getRect(); if(!rect) return;
        const t=e.touches[0];
        startDrag(t.clientX-rect.left, t.clientY-rect.top);
      }
    };

    const onTM = (e:TouchEvent)=>{
      e.preventDefault();
      if(e.touches.length===2 && pinchRef.current){
        const d = Math.hypot(
          e.touches[1].clientX-e.touches[0].clientX,
          e.touches[1].clientY-e.touches[0].clientY,
        );
        setZoom(Math.max(1,Math.min(12, pinchRef.current.startZoom*d/pinchRef.current.startDist)));
      } else if(e.touches.length===1 && dragRef.current){
        const rect = getRect(); if(!rect) return;
        const t=e.touches[0];
        moveDrag(t.clientX-rect.left, t.clientY-rect.top);
      }
    };

    const onTE = (e:TouchEvent)=>{
      if(e.touches.length===0){ dragRef.current=null; pinchRef.current=null; }
      else if(e.touches.length===1){ pinchRef.current=null; }
    };

    el.addEventListener("touchstart",  onTS, {passive:false});
    el.addEventListener("touchmove",   onTM, {passive:false});
    el.addEventListener("touchend",    onTE, {passive:false});
    el.addEventListener("touchcancel", onTE, {passive:false});
    return ()=>{
      el.removeEventListener("touchstart",  onTS);
      el.removeEventListener("touchmove",   onTM);
      el.removeEventListener("touchend",    onTE);
      el.removeEventListener("touchcancel", onTE);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  // ── Mouse handlers (desktop) ───────────────────────────────────────────────
  const onMouseDown=(e:React.MouseEvent)=>{
    e.preventDefault();
    const rect=getRect(); if(!rect) return;
    startDrag(e.clientX-rect.left, e.clientY-rect.top);
  };
  const onMouseMove=(e:React.MouseEvent)=>{
    if(!dragRef.current) return;
    const rect=getRect(); if(!rect) return;
    moveDrag(e.clientX-rect.left, e.clientY-rect.top);
  };
  const onMouseUp=()=>{dragRef.current=null;};

  const confirm=()=>{ onConfirm(cx/disp*100, cy/disp*100, r*2/disp*100); };

  // Circle in container (screen) space: always at centre
  const scx=disp/2, scy=disp/2, sr=r*zoom;

  return(
    <div className="fixed inset-0 z-[200] bg-black/95 flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[#30363d] flex items-center justify-between shrink-0">
        <div>
          <h3 className="text-sm font-display font-bold text-white">
            Crop — <span className="text-sky-300">{champ}</span>
          </h3>
          <p className="text-[11px] text-[#8b949e] mt-0.5">
            Inside circle → pan map · near edge / ⇔ → resize · pinch to zoom
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={onCancel}
            className="px-3 py-1.5 text-xs rounded border border-[#30363d] text-[#8b949e] active:bg-white/5">
            Cancel
          </button>
          <button onClick={confirm}
            className="px-4 py-1.5 text-xs rounded bg-sky-600 text-white font-medium active:bg-sky-700">
            Save
          </button>
        </div>
      </div>
      {/* Zoom indicator */}
      <div className="flex items-center justify-center py-1.5 shrink-0">
        <span className="text-[11px] text-[#5a6472]">
          <span className="text-white/50 font-mono">{zoom.toFixed(1)}×</span>
          &nbsp;· pinch to zoom
        </span>
      </div>
      {/* Canvas */}
      <div className="flex-1 flex items-center justify-center">
        <div
          ref={containerRef}
          className="relative overflow-hidden"
          style={{width:disp,height:disp,cursor:"crosshair",touchAction:"none",userSelect:"none"}}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        >
          {/* Minimap image — CSS transform centres it on (cx,cy) */}
          <div style={{
            position:"absolute", width:disp, height:disp,
            transform:`scale(${zoom}) translate(${imgTX(disp,cx,zoom)}px,${imgTY(disp,cy,zoom)}px)`,
            transformOrigin:"0 0",
            willChange:"transform",
            pointerEvents:"none",
          }}>
            <img src={minimapSrc} style={{width:disp,height:disp,display:"block",userSelect:"none"}}/>
          </div>
          {/* SVG overlay — in container (screen) space; circle always at centre */}
          <svg className="absolute inset-0" width={disp} height={disp} style={{pointerEvents:"none",overflow:"visible"}}>
            <defs>
              <mask id="ca-hole">
                <rect width={disp} height={disp} fill="white"/>
                <circle cx={scx} cy={scy} r={sr} fill="black"/>
              </mask>
            </defs>
            <rect width={disp} height={disp} fill="rgba(0,0,0,0.55)" mask="url(#ca-hole)"/>
            <circle cx={scx} cy={scy} r={sr} fill="none" stroke="white" strokeWidth="2" strokeDasharray="6 3" opacity="0.9"/>
            <line x1={scx-7} y1={scy} x2={scx+7} y2={scy} stroke="white" strokeWidth="1.5" opacity="0.55"/>
            <line x1={scx} y1={scy-7} x2={scx} y2={scy+7} stroke="white" strokeWidth="1.5" opacity="0.55"/>
            {/* Resize badge — at right edge of circle */}
            <circle cx={scx+sr} cy={scy} r={14} fill="#0ea5e9" opacity="0.9"/>
            <text x={scx+sr} y={scy} textAnchor="middle" dominantBaseline="central" fontSize="13" fill="white">⇔</text>
          </svg>
        </div>
      </div>
      <p className="text-center text-[11px] text-[#8b949e] pb-3 shrink-0">
        Drag inside = pan · drag edge / ⇔ = resize · lift &amp; retap to continue
      </p>
    </div>
  );
}

// ─── LongPressMenu — appears after 500ms hold on minimap to pick pin type ───────
function LongPressMenu({pos,onClose,onPlace}:{
  pos:{x:number;y:number};
  onClose:()=>void;
  onPlace:(t:"ally"|"enemy"|"obj"|"ally_wave"|"enemy_wave")=>void;
}){
  const PW=190,PH=248;
  const left=Math.max(6,Math.min(pos.x-PW/2,window.innerWidth-PW-6));
  const rawTop=pos.y+12+PH>window.innerHeight?pos.y-PH-12:pos.y+12;
  const top=Math.max(6,rawTop);
  const opts=[
    {type:"ally"as const,label:"Ally Pin",cls:"text-sky-400 border-sky-400/40 hover:bg-sky-400/10"},
    {type:"enemy"as const,label:"Enemy Pin",cls:"text-red-400 border-red-500/40 hover:bg-red-500/10"},
    {type:"obj"as const,label:"Objective",cls:"text-purple-400 border-purple-500/40 hover:bg-purple-500/10"},
    {type:"ally_wave"as const,label:"Ally Wave",cls:"text-green-400 border-green-400/40 hover:bg-green-400/10"},
    {type:"enemy_wave"as const,label:"Enemy Wave",cls:"text-orange-400 border-orange-400/40 hover:bg-orange-400/10"},
  ];
  return(
    <>
      <div className="fixed inset-0 z-40" onClick={onClose}/>
      <div className="fixed z-50 bg-[#0d1526] border border-border/60 rounded-xl shadow-2xl overflow-hidden py-2"
        style={{left,top,width:PW}}>
        <p className="text-[9px] uppercase tracking-widest text-muted-foreground/50 px-3 pb-1.5 font-display">Place pin here</p>
        {opts.map(o=>(
          <button key={o.type} onClick={()=>onPlace(o.type)}
            className={cn("w-full text-left px-3 py-2.5 text-sm border-l-2 transition-colors active:scale-[.97]",o.cls)}>
            {o.label}
          </button>
        ))}
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

  // Screenshot — initialized null; images restored from IndexedDB async in mount effect below
  const[imageBase64,setImageBase64]=useState<string|null>(null);
  const[minimapBase64,setMinimapBase64]=useState<string|null>(null);
  const[imageQueue,setImageQueue]=useState<string[]>([]);
  const[activeQueueIdx,setActiveQueueIdx]=useState(0);
  const perImageState=useRef<Map<string,ImageSlotState>>(new Map());
  const fileInputRef=useRef<HTMLInputElement>(null);
  const appendFileInputRef=useRef<HTMLInputElement>(null);
  // Guards IDB save effects from firing before the mount-restore reads complete
  const idbReady=useRef(false);

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

  // Champion auto-detection from minimap rings
  const[detectedAllies,setDetectedAllies]=useState<(string|null)[]>([]);
  const[detectedEnemies,setDetectedEnemies]=useState<(string|null)[]>([]);
  // Per-slot champion detection from portrait strip (independent of minimap order)
  const[detectedStripAllies,setDetectedStripAllies]=useState<(string|null)[]>([]);
  const[detectedStripEnemies,setDetectedStripEnemies]=useState<(string|null)[]>([]);
  // Objective pit detection
  const[objPitConfig,setObjPitConfig]=useState<ObjPitConfig>(loadObjPitConfig);
  const[showObjPitCalib,setShowObjPitCalib]=useState(false);
  const[objPitResetConfirm,setObjPitResetConfirm]=useState(false);
  const objPitDragRef=useRef<{zoneIdx:0|1;type:"move"|"resize";sx:number;sy:number;bx:number;by:number;bw:number;bh:number}|null>(null);
  const objPitImgRef=useRef<HTMLDivElement>(null);
  const[objPickingColorFor,setObjPickingColorFor]=useState<string|null>(null);
  // Per-slot strip detect calibration
  const[stripDetectConfig,setStripDetectConfig]=useState<StripDetectConfig|null>(loadStripDetectConfig);
  const[showStripDetectCalib,setShowStripDetectCalib]=useState(false);
  const stripDetectDragRef=useRef<{team:'ally'|'enemy';idx:number;sx:number;sy:number;bx:number;by:number;bsz:number}|null>(null);
  const stripDetectImgRef=useRef<HTMLDivElement>(null);
  const[detectingChamps,setDetectingChamps]=useState(false);
  const[autoDetectStrip,setAutoDetectStrip]=useState(()=>localStorage.getItem("wr_auto_detect_strip")!=="false");
  const[recentChamps,setRecentChamps]=useState<string[]>(_loadRecentChamps);
  const trackRecentChamp=useCallback((name:string)=>{setRecentChamps(_addRecentChamp(name));},[]);

  // Portrait database viewer + crop-size calibration
  const[showPortraitDb,setShowPortraitDb]=useState(false);
  const[portraitDbEntries,setPortraitDbEntries]=useState<PortraitDbEntry[]>([]);
  const loadPortraitDb=useCallback(()=>{getAllPortraitEntries().then(setPortraitDbEntries).catch(()=>{});},[]);
  const[portraitCropPct,_setPortraitCropPct]=useState(()=>parseInt(localStorage.getItem("wr_portrait_crop_pct")??"12"));
  // Dead-timer detection calibration
  const[deadSlotBoxes,setDeadSlotBoxes]=useState<DeadSlotBoxes>(loadDeadBoxes);
  const[showDeadCalib,setShowDeadCalib]=useState(false);
  const[deadStripPick,setDeadStripPick]=useState<{team:"ally"|"enemy";slotN:number}|null>(null);
  const[deadStripSearch,setDeadStripSearch]=useState("");
  const deadDragRef=useRef<{team:'ally'|'enemy';idx:number;type:'move'|'resize';sx:number;sy:number;bx:number;by:number;bw:number;bh:number}|null>(null);
  const deadCalibImgRef=useRef<HTMLDivElement>(null);
  // ── Objective pit drag handlers ───────────────────────────────────────────
  const onObjPitPointerDown=useCallback((e:React.PointerEvent,zoneIdx:0|1,type:'move'|'resize')=>{
    e.stopPropagation();(e.target as HTMLElement).setPointerCapture(e.pointerId);
    const b=objPitConfig.zones[zoneIdx];
    objPitDragRef.current={zoneIdx,type,sx:e.clientX,sy:e.clientY,bx:b.x,by:b.y,bw:b.w,bh:b.h};
  },[objPitConfig]);
  const onObjPitPointerMove=useCallback((e:React.PointerEvent)=>{
    const drag=objPitDragRef.current;if(!drag||!objPitImgRef.current)return;
    const rect=objPitImgRef.current.getBoundingClientRect();
    const dx=(e.clientX-drag.sx)/rect.width*100,dy=(e.clientY-drag.sy)/rect.height*100;
    const cl=(v:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,v));
    setObjPitConfig(prev=>{
      const zones=[...prev.zones] as [SlotBox,SlotBox];
      const b=zones[drag.zoneIdx];
      if(drag.type==='move')zones[drag.zoneIdx]={...b,x:cl(drag.bx+dx,0,100-b.w),y:cl(drag.by+dy,0,100-b.h)};
      else zones[drag.zoneIdx]={...b,w:cl(drag.bw+dx,5,100-b.x),h:cl(drag.bh+dy,5,100-b.y)};
      return{...prev,zones};
    });
  },[]);
  const onObjPitPointerUp=useCallback(()=>{objPitDragRef.current=null;},[]);
  // Eyedropper: tap on minimap image to pick color for an objective
  const onObjPitEyedrop=useCallback((e:React.MouseEvent)=>{
    if(!objPickingColorFor||!objPitImgRef.current||!minimapBase64)return;
    const rect=objPitImgRef.current.getBoundingClientRect();
    const xPct=(e.clientX-rect.left)/rect.width,yPct=(e.clientY-rect.top)/rect.height;
    const img=new Image();
    img.onload=()=>{
      const c=document.createElement("canvas");c.width=img.width;c.height=img.height;
      c.getContext("2d")!.drawImage(img,0,0);
      const px=Math.round(xPct*img.width),py=Math.round(yPct*img.height);
      const d=c.getContext("2d")!.getImageData(px,py,1,1).data;
      const hex=`#${d[0].toString(16).padStart(2,"0")}${d[1].toString(16).padStart(2,"0")}${d[2].toString(16).padStart(2,"0")}`;
      setObjPitConfig(prev=>({...prev,colors:{...prev.colors,[objPickingColorFor]:hex}}));
      setObjPickingColorFor(null);
    };
    img.src=minimapBase64;
  },[objPickingColorFor,minimapBase64]);

  // ── Strip detect (per-slot champion crop) drag handlers ──────────────────
  const getStripDetectBoxes=useCallback(():StripDetectConfig=>{
    if(stripDetectConfig)return stripDetectConfig;
    const sz=portraitConfig.sizePct??5.5;
    const toBox=(pos:{x:number;y:number})=>({
      x:((pos.x-portraitStripConfig.x)/portraitStripConfig.w)*100,
      y:((pos.y-portraitStripConfig.y)/portraitStripConfig.h)*100,
      sz,
    });
    return{ally:portraitConfig.allies.map(toBox),enemy:portraitConfig.enemies.map(toBox)};
  },[stripDetectConfig,portraitConfig,portraitStripConfig]);
  const onStripDetectPointerDown=useCallback((e:React.PointerEvent,team:'ally'|'enemy',idx:number)=>{
    e.stopPropagation();(e.target as HTMLElement).setPointerCapture(e.pointerId);
    const boxes=getStripDetectBoxes();
    const b=(team==='ally'?boxes.ally:boxes.enemy)[idx];
    stripDetectDragRef.current={team,idx,sx:e.clientX,sy:e.clientY,bx:b.x,by:b.y,bsz:b.sz};
  },[getStripDetectBoxes]);
  const onStripDetectPointerMove=useCallback((e:React.PointerEvent)=>{
    const drag=stripDetectDragRef.current;if(!drag||!stripDetectImgRef.current)return;
    const rect=stripDetectImgRef.current.getBoundingClientRect();
    const dx=(e.clientX-drag.sx)/rect.width*100,dy=(e.clientY-drag.sy)/rect.height*100;
    const cl=(v:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,v));
    setStripDetectConfig(prev=>{
      const curr=prev??getStripDetectBoxes();
      const boxes=[...(drag.team==='ally'?curr.ally:curr.enemy)];
      const b=boxes[drag.idx];
      boxes[drag.idx]={...b,x:cl(drag.bx+dx,0,100),y:cl(drag.by+dy,0,100)};
      return drag.team==='ally'?{...curr,ally:boxes}:{...curr,enemy:boxes};
    });
  },[getStripDetectBoxes]);
  const onStripDetectPointerUp=useCallback(()=>{stripDetectDragRef.current=null;},[]);
  const onStripDetectResizeSz=useCallback((team:'ally'|'enemy',idx:number,delta:number)=>{
    setStripDetectConfig(prev=>{
      const curr=prev??getStripDetectBoxes();
      const boxes=[...(team==='ally'?curr.ally:curr.enemy)];
      const b=boxes[idx];
      boxes[idx]={...b,sz:Math.max(2,Math.min(30,b.sz+delta))};
      return team==='ally'?{...curr,ally:boxes}:{...curr,enemy:boxes};
    });
  },[getStripDetectBoxes]);

  const onDeadBoxPointerDown=useCallback((e:React.PointerEvent,team:'ally'|'enemy',idx:number,type:'move'|'resize')=>{
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const boxes=team==='ally'?deadSlotBoxes.ally:deadSlotBoxes.enemy;
    const b=boxes[idx];
    deadDragRef.current={team,idx,type,sx:e.clientX,sy:e.clientY,bx:b.x,by:b.y,bw:b.w,bh:b.h};
  },[deadSlotBoxes]);
  const onDeadCalibPointerMove=useCallback((e:React.PointerEvent)=>{
    const drag=deadDragRef.current;if(!drag||!deadCalibImgRef.current)return;
    const rect=deadCalibImgRef.current.getBoundingClientRect();
    const dx=(e.clientX-drag.sx)/rect.width*100;
    const dy=(e.clientY-drag.sy)/rect.height*100;
    const clamp=(v:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,v));
    setDeadSlotBoxes(prev=>{
      const boxes=[...prev[drag.team]];
      const b=boxes[drag.idx];
      if(drag.type==='move'){boxes[drag.idx]={...b,x:clamp(drag.bx+dx,0,100-b.w),y:clamp(drag.by+dy,0,100-b.h)};}
      else{boxes[drag.idx]={...b,w:clamp(drag.bw+dx,5,100-b.x),h:clamp(drag.bh+dy,5,100-b.y)};}
      return{...prev,[drag.team]:boxes};
    });
  },[]);
  const onDeadCalibPointerUp=useCallback(()=>{deadDragRef.current=null;},[]);
  const setPortraitCropPct=useCallback((v:number)=>{
    const clamped=Math.max(6,Math.min(25,v));
    _setPortraitCropPct(clamped);
    localStorage.setItem("wr_portrait_crop_pct",String(clamped));
  },[]);

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
  const[cropAdjust,setCropAdjust]=useState<{champ:string;pinX:number;pinY:number}|null>(null);
  const[longPressMenu,setLongPressMenu]=useState<{screenX:number;screenY:number;mapX:number;mapY:number}|null>(null);
  const longPressTimerRef=useRef<ReturnType<typeof setTimeout>|null>(null);
  const longPressTouchRef=useRef<{x:number;y:number}|null>(null);
  const[contextOpen,setContextOpen]=useState(true);
  const[champPickOpen,setChampPickOpen]=useState(false);

  // Advice
  const[advice,setAdvice]=useState((_sess.advice as string)??'');
  const[isAdvising,setIsAdvising]=useState(false);
  const[adviceElapsedMs,setAdviceElapsedMs]=useState<number|null>(null);
  const adviceStartRef=useRef<number>(0);
  const adviceTimerRef=useRef<ReturnType<typeof setInterval>|null>(null);
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

  // On mount — restore everything from IndexedDB FIRST, then unlock saves
  useEffect(()=>{
    Promise.all([
      idbGet<{imageBase64:string|null;minimapBase64:string|null}>(IDB_KEY_IMGS).then(d=>{
        if(d?.imageBase64)setImageBase64(d.imageBase64);
        if(d?.minimapBase64)setMinimapBase64(d.minimapBase64);
      }),
      idbGet<{imageQueue:string[];activeQueueIdx:number}>(IDB_KEY_QUEUE).then(d=>{
        if(d&&Array.isArray(d.imageQueue)&&d.imageQueue.length){setImageQueue(d.imageQueue);setActiveQueueIdx(d.activeQueueIdx??0);}
      }),
      idbGet<{gameTimeCrop:string|null;portraitStripCrop:string|null}>(IDB_KEY_CROPS).then(d=>{
        if(d?.gameTimeCrop)setGameTimeCrop(d.gameTimeCrop);
        if(d?.portraitStripCrop)setPortraitStripCrop(d.portraitStripCrop);
      }),
    ]).finally(()=>{ idbReady.current=true; });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  // Persist active image + minimap to IndexedDB — guarded so initial null state can't overwrite saved data
  useEffect(()=>{
    if(!idbReady.current)return;
    idbSet(IDB_KEY_IMGS,{imageBase64,minimapBase64});
  },[imageBase64,minimapBase64]);

  // Persist full image queue to IndexedDB
  useEffect(()=>{
    if(!idbReady.current)return;
    if(imageQueue.length>0)idbSet(IDB_KEY_QUEUE,{imageQueue,activeQueueIdx});
    else idbDel(IDB_KEY_QUEUE);
  },[imageQueue,activeQueueIdx]);

  // Persist crops to IndexedDB
  useEffect(()=>{
    if(!idbReady.current)return;
    idbSet(IDB_KEY_CROPS,{gameTimeCrop,portraitStripCrop});
  },[gameTimeCrop,portraitStripCrop]);

  const handleClearSession=useCallback(()=>{
    clearSessionStorage();
    setImageBase64(null);setMinimapBase64(null);setGameTimeCrop(null);setPins([]);setPlaceMode(null);
    setMyRole(null);setMyChamp(null);setObjPins([]);
    setBaronBuff(null);setElderBuff(null);setAlliesDown([]);setEnemiesDown([]);setTowersDown({ally:[],enemy:[]});
    setUserNotes('');setGameTimeSecs(0);setActiveConversationId(null);setAdvice("");setChatMessages([]);
    setDebugInfo(null);setDebugMinimapUrl(null);setPortraitStripCrop(null);
    setImageQueue([]);setActiveQueueIdx(0);setBenchPins([]);
  },[]);

  // Quick reset — clears screenshot + pins + advice but keeps role & champion
  const handleQuickReset=useCallback(()=>{
    idbDel(IDB_KEY_IMGS);idbDel(IDB_KEY_QUEUE);idbDel(IDB_KEY_CROPS);
    setImageBase64(null);setMinimapBase64(null);setGameTimeCrop(null);setPortraitStripCrop(null);
    setPins([]);setBenchPins([]);setObjPins([]);setPlaceMode(null);
    setBaronBuff(null);setElderBuff(null);setAlliesDown([]);setEnemiesDown([]);setTowersDown({ally:[],enemy:[]});
    setUserNotes('');setGameTimeSecs(0);setActiveConversationId(null);setAdvice("");setChatMessages([]);
    setDebugInfo(null);setDebugMinimapUrl(null);
    setImageQueue([]);setActiveQueueIdx(0);
    perImageState.current.clear();
    // myRole and myChamp intentionally kept
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
    setAdvice("");setChatMessages([]);setActiveConversationId(null);
    setDetectedAllies([]);
    setDetectedEnemies([]);

    const minimap=await recropMinimap(dataUrl);

    // ── Detect all minimap circles (me/allies/enemies) ──────────────────────
    if(minimap){
      detectMapCircles(minimap,portraitCropPct,loadDetectConfig()).then(({me,allies,enemies})=>{
        const ts=Date.now();
        // Remove previous auto champion pins; keep manual pins AND auto wave pins
        // (wave pins are placed by a parallel async call — don't wipe them here)
        setPins(prev=>{
          const manual=prev.filter(p=>!p.auto||(p.type==="ally_wave"||p.type==="enemy_wave"));
          const next=[...manual];
          if(me) next.push({id:`me-${ts}`,type:"me",x:me.x,y:me.y,pos:classifyPos(me.x,me.y,lanePaths,zones),champ:myChamp,auto:true});
          allies.forEach((a,i)=>next.push({id:`ally-auto-${ts}-${i}`,type:"ally",x:a.x,y:a.y,pos:classifyPos(a.x,a.y,lanePaths,zones),champ:null,auto:true}));
          enemies.forEach((e,i)=>next.push({id:`enemy-auto-${ts}-${i}`,type:"enemy",x:e.x,y:e.y,pos:classifyPos(e.x,e.y,lanePaths,zones),champ:null,auto:true}));
          return next;
        });

        // ── Match detected portrait crops against personal portrait database ──
        setDetectingChamps(true);
        const tryDb=async(detected:DetectedCircle[],type:"ally"|"enemy")=>{
          const updates:Array<{id:string;champ:string}>=[];
          for(let i=0;i<detected.length;i++){
            const d=detected[i];
            if(!d.portraitDataUrl)continue;
            const m=await matchPersonalDb(d.portraitDataUrl).catch(():null=>null);
            if(m)updates.push({id:`${type}-auto-${ts}-${i}`,champ:m.name});
          }
          return updates;
        };
        Promise.all([tryDb(allies,"ally"),tryDb(enemies,"enemy")]).then(([au,eu])=>{
          const all=[...au,...eu];
          if(all.length){
            setPins(prev=>prev.map(p=>{const u=all.find(u=>u.id===p.id);return u?{...p,champ:u.champ}:p;}));
          }
          setDetectedAllies(au.map(u=>u.champ));
          setDetectedEnemies(eu.map(u=>u.champ));
          setDetectingChamps(false);
        }).catch(()=>setDetectingChamps(false));
      }).catch(()=>{});

      // ── Auto-detect tower status — with cascade logic ──────────────────────
      detectTowerStatus(minimap,towerConfig.ally,towerConfig.enemy).then(({allyDown,enemyDown})=>{
        setTowersDown({ally:applyTowerCascade(allyDown),enemy:applyTowerCascade(enemyDown)});
      }).catch(()=>{});

      // ── Auto-detect objectives → place ObjPins at pit zone centres ───────
      detectObjColors(minimap,objPitConfig.zones,objPitConfig.colors)
        .then(({zoneA,zoneB})=>{
          const ts=Date.now();
          const newPins:ObjPin[]=[];
          ([zoneA,zoneB] as const).forEach((detected,zi)=>{
            if(!detected.length)return;
            const id=detected[0];
            // Skip stale localStorage keys (e.g. "cloud","chemtech") that are no longer valid ObjTypes
            if(!(id in OBJ_CFG))return;
            const zone=objPitConfig.zones[zi as 0|1];
            const cx=zone.x+zone.w/2,cy=zone.y+zone.h/2;
            newPins.push({id:`obj-auto-${ts}-${zi}`,x:cx,y:cy,
              pos:classifyPos(cx,cy,lanePaths,zones),objType:id as ObjType,status:"up"});
          });
          // Always replace old auto-pins (even if newPins is empty — clears stale pins on re-detect)
          setObjPins(prev=>[...prev.filter(p=>!p.id.startsWith("obj-auto-")),...newPins]);
        })
        .catch(()=>{});

      // ── Auto-detect minion waves (1 ally + 1 enemy per lane, ON the user's configured lane paths) ──
      // Default = calibrated lane midpoints. Detected position used only if it classifies as the correct lane.
      const waveDefaults={
        ally:  {Top:lanePoint(lanePaths.baron,0.35),Mid:lanePoint(lanePaths.mid,0.35),Bot:lanePoint(lanePaths.dragon,0.35)},
        enemy: {Top:lanePoint(lanePaths.baron,0.65),Mid:lanePoint(lanePaths.mid,0.65),Bot:lanePoint(lanePaths.dragon,0.65)},
      };
      const placeWavePins=(aw:{lane:string;x:number;y:number}[],ew:{lane:string;x:number;y:number}[])=>{
        const ts2=Date.now();
        setPins(prev=>{
          const noAutoWave=prev.filter(p=>!((p.type==="ally_wave"||p.type==="enemy_wave")&&p.auto));
          const next=[...noAutoWave];
          // Reclassify each detected wave by nearest calibrated lane path (ignores _minionLane labels)
          const aByLane:{Top?:{x:number;y:number};Mid?:{x:number;y:number};Bot?:{x:number;y:number}}={};
          const eByLane:{Top?:{x:number;y:number};Mid?:{x:number;y:number};Bot?:{x:number;y:number}}={};
          aw.forEach(w=>{const l=nearestLane(w,lanePaths.baron,lanePaths.mid,lanePaths.dragon);if(!aByLane[l])aByLane[l]=w;});
          ew.forEach(w=>{const l=nearestLane(w,lanePaths.baron,lanePaths.mid,lanePaths.dragon);if(!eByLane[l])eByLane[l]=w;});
          (["Top","Mid","Bot"] as const).forEach(lane=>{
            const ap=aByLane[lane]??waveDefaults.ally[lane];
            const ep=eByLane[lane]??waveDefaults.enemy[lane];
            next.push({id:`aw-auto-${ts2}-${lane}`,type:"ally_wave",x:ap.x,y:ap.y,pos:classifyPos(ap.x,ap.y,lanePaths,zones),champ:null,auto:true});
            next.push({id:`ew-auto-${ts2}-${lane}`,type:"enemy_wave",x:ep.x,y:ep.y,pos:classifyPos(ep.x,ep.y,lanePaths,zones),champ:null,auto:true});
          });
          return next;
        });
      };
      // Search ONLY within each calibrated lane corridor; pick most-advanced blob per team per lane
      detectMinionWavesInLanes(minimap,lanePaths).then(({ally:aw,enemy:ew})=>placeWavePins(aw,ew)).catch(()=>placeWavePins([],[]));
    }

    try{
      const strip=await cropDataUrl(dataUrl,timerCropConfig.x,timerCropConfig.y,timerCropConfig.w,timerCropConfig.h);
      setGameTimeCrop(strip);
    }catch{}
    try{
      const ps=await cropDataUrl(dataUrl,portraitStripConfig.x,portraitStripConfig.y,portraitStripConfig.w,portraitStripConfig.h);
      setPortraitStripCrop(ps);
      // Detect dead slots via slot boxes
      detectDeadBySlotBoxes(ps,deadSlotBoxes.ally,deadSlotBoxes.enemy).then(({allySlots,enemySlots})=>{
        if(allySlots.length>0)setAlliesDown(allySlots.map(i=>i+1));
        if(enemySlots.length>0)setEnemiesDown(enemySlots.map(i=>i+1));
      }).catch(()=>{});
      // Detect champion names per strip slot (uses per-slot calibrated positions when available)
      const sz=portraitConfig.sizePct??5.5;
      if(autoDetectStrip){
        detectStripSlotChamps(ps,portraitConfig.allies,portraitStripConfig,sz,stripDetectConfig?.ally)
          .then(setDetectedStripAllies).catch(()=>{});
        detectStripSlotChamps(ps,portraitConfig.enemies,portraitStripConfig,sz,stripDetectConfig?.enemy)
          .then(setDetectedStripEnemies).catch(()=>{});
      } else {
        setDetectedStripAllies([]);
        setDetectedStripEnemies([]);
      }
    }catch{}
    setDetectingChamps(true);
  },[recropMinimap,timerCropConfig,portraitStripConfig,portraitConfig,lanePaths,zones,myChamp,portraitCropPct,deadSlotBoxes,objPitConfig,stripDetectConfig,autoDetectStrip]);

  const clearPinState=()=>{setPins([]);setBenchPins([]);setObjPins([]);setAlliesDown([]);setEnemiesDown([]);setTowersDown({ally:[],enemy:[]});};
  const applySlotState=(s:ImageSlotState|undefined)=>{
    setPins(s?.pins??[]);setBenchPins(s?.benchPins??[]);setObjPins(s?.objPins??[]);
    setAlliesDown(s?.alliesDown??[]);setEnemiesDown(s?.enemiesDown??[]);setTowersDown(s?.towersDown??{ally:[],enemy:[]});
    if(s?.advice!==undefined)setAdvice(s.advice);
    if(s?.chatMessages!==undefined)setChatMessages(s.chatMessages);
    if(s?.conversationId!==undefined)setActiveConversationId(s.conversationId??null);
    if(s?.detectedStripAllies!==undefined)setDetectedStripAllies(s.detectedStripAllies);
    if(s?.detectedStripEnemies!==undefined)setDetectedStripEnemies(s.detectedStripEnemies);
  };
  const saveCurrentSlot=(url:string)=>{
    perImageState.current.set(url,{
      pins,benchPins,objPins,alliesDown,enemiesDown,towersDown,
      advice,chatMessages,conversationId:activeConversationId,
      detectedStripAllies,detectedStripEnemies,
    });
  };

  const handleAppendFiles=(files:FileList|File[])=>{
    const arr=Array.from(files);
    if(!arr.length)return;
    const readers=arr.map(f=>new Promise<string>(res=>{const r=new FileReader();r.onload=e=>res(e.target?.result as string);r.readAsDataURL(f);}));
    Promise.all(readers).then(dataUrls=>{
      const valid=dataUrls.filter(Boolean);
      if(!valid.length)return;
      setImageQueue(prev=>[...prev,...valid]);
      // Stay on current image, don't touch pins or advice
    });
  };

  const handleFiles=(files:FileList|File[])=>{
    const arr=Array.from(files);
    if(!arr.length)return;
    const readers=arr.map(f=>new Promise<string>(res=>{const r=new FileReader();r.onload=e=>res(e.target?.result as string);r.readAsDataURL(f);}));
    Promise.all(readers).then(dataUrls=>{
      const valid=dataUrls.filter(Boolean);
      if(!valid.length)return;
      perImageState.current.clear();
      setImageQueue(valid);
      setActiveQueueIdx(0);
      clearPinState();
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
    const totalOfType=(t:PinType)=>[...pins,...benchPins].filter(p=>p.type===t).length;
    if(placeMode==="me"){
      setPins(p=>[...p.filter(pp=>pp.type!=="me"),{id:`me-${Date.now()}`,type:"me",x,y,pos,champ:myChamp}]);
    }else if(placeMode==="ally"){
      if(totalOfType("ally")>=4)return;
      setPins(p=>[...p,{id:`ally-${Date.now()}`,type:"ally",x,y,pos,champ:null}]);
    }else if(placeMode==="obj"){
      const id=`obj-${Date.now()}`;
      setObjPins(p=>[...p,{id,x,y,pos:classifyPos(x,y,lanePaths,zones),objType:null,status:null}]);
      const rect=minimapDivRef.current!.getBoundingClientRect();
      setQuickObjPickPos({x:rect.left+x/100*rect.width,y:rect.top+y/100*rect.height});
      setQuickObjPickId(id);
    }else if(placeMode==="ally_wave"){
      if(totalOfType("ally_wave")>=5)return;
      setPins(p=>[...p,{id:`aw-${Date.now()}`,type:"ally_wave",x,y,pos,champ:null}]);
    }else if(placeMode==="enemy_wave"){
      if(totalOfType("enemy_wave")>=5)return;
      setPins(p=>[...p,{id:`ew-${Date.now()}`,type:"enemy_wave",x,y,pos,champ:null}]);
    }else{
      if(totalOfType("enemy")>=5)return;
      setPins(p=>[...p,{id:`enemy-${Date.now()}`,type:"enemy",x,y,pos,champ:null}]);
    }
  },[placeMode,myChamp,pins,benchPins,lanePaths,zones]);

  // ── Long-press on minimap to place a pin without entering a mode ─────────────
  const handleMinimapTouchStart=useCallback((e:React.TouchEvent)=>{
    // If already in place mode, delegate to existing tap handler
    if(placeMode){handleMinimapTap(e);return;}
    const t=e.touches[0]!;
    longPressTouchRef.current={x:t.clientX,y:t.clientY};
    longPressTimerRef.current=setTimeout(()=>{
      if(!minimapDivRef.current||!longPressTouchRef.current)return;
      const{x:cx,y:cy}=longPressTouchRef.current;
      const rect=minimapDivRef.current.getBoundingClientRect();
      const mapX=Math.max(0,Math.min(100,(cx-rect.left)/rect.width*100));
      const mapY=Math.max(0,Math.min(100,(cy-rect.top)/rect.height*100));
      setLongPressMenu({screenX:cx,screenY:cy,mapX,mapY});
      longPressTouchRef.current=null;
    },500);
  },[placeMode,handleMinimapTap]);

  const handleMinimapTouchMove=useCallback((e:React.TouchEvent)=>{
    if(!longPressTouchRef.current||!longPressTimerRef.current)return;
    const t=e.touches[0]!;
    const dx=t.clientX-longPressTouchRef.current.x;
    const dy=t.clientY-longPressTouchRef.current.y;
    if(Math.sqrt(dx*dx+dy*dy)>10){
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current=null;
      longPressTouchRef.current=null;
    }
  },[]);

  const handleMinimapTouchEnd=useCallback(()=>{
    if(longPressTimerRef.current){clearTimeout(longPressTimerRef.current);longPressTimerRef.current=null;}
    longPressTouchRef.current=null;
  },[]);

  const handleLongPressPlace=useCallback((type:"ally"|"enemy"|"obj"|"ally_wave"|"enemy_wave")=>{
    if(!longPressMenu)return;
    const{mapX:x,mapY:y}=longPressMenu;
    const pos=classifyPos(x,y,lanePaths,zones);
    const totalOfType=(t:PinType)=>[...pins,...benchPins].filter(p=>p.type===t).length;
    if(type==="ally"&&totalOfType("ally")<4){
      const id=`ally-${Date.now()}`;
      setPins(p=>[...p,{id,type:"ally",x,y,pos,champ:null}]);
      if(minimapDivRef.current){const r=minimapDivRef.current.getBoundingClientRect();setQuickPickPos({x:r.left+x/100*r.width,y:r.top+y/100*r.height});}
      setQuickPickPinId(id);
    }else if(type==="enemy"&&totalOfType("enemy")<5){
      const id=`enemy-${Date.now()}`;
      setPins(p=>[...p,{id,type:"enemy",x,y,pos,champ:null}]);
      if(minimapDivRef.current){const r=minimapDivRef.current.getBoundingClientRect();setQuickPickPos({x:r.left+x/100*r.width,y:r.top+y/100*r.height});}
      setQuickPickPinId(id);
    }else if(type==="obj"){
      const id=`obj-${Date.now()}`;
      setObjPins(p=>[...p,{id,x,y,pos,objType:null,status:null}]);
      if(minimapDivRef.current){const r=minimapDivRef.current.getBoundingClientRect();setQuickObjPickPos({x:r.left+x/100*r.width,y:r.top+y/100*r.height});}
      setQuickObjPickId(id);
    }else if(type==="ally_wave"&&totalOfType("ally_wave")<5){
      setPins(p=>[...p,{id:`aw-${Date.now()}`,type:"ally_wave",x,y,pos,champ:null}]);
    }else if(type==="enemy_wave"&&totalOfType("enemy_wave")<5){
      setPins(p=>[...p,{id:`ew-${Date.now()}`,type:"enemy_wave",x,y,pos,champ:null}]);
    }
    setLongPressMenu(null);
  },[longPressMenu,pins,benchPins,lanePaths,zones]);

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
        const awPins=pins.filter(p=>p.type==="ally_wave");
        const ewPins=pins.filter(p=>p.type==="enemy_wave");
        if(awPins.length)parts.push(`Allied minion waves at: ${awPins.map(p=>posLabel(p.pos)).join(", ")}`);
        if(ewPins.length)parts.push(`Enemy minion waves at: ${ewPins.map(p=>posLabel(p.pos)).join(", ")}`);
        if(myChamp)parts.push(`I am playing ${myChamp}`);
        if(baronBuff==="us")parts.push("We have Baron Buff");
        else if(baronBuff==="them")parts.push("Enemy has Baron Buff");
        if(elderBuff==="us")parts.push("We have Elder Dragon Buff");
        else if(elderBuff==="them")parts.push("Enemy has Elder Dragon Buff");
        if(alliesDown.length>0)parts.push(`Dead allies: ${alliesDown.sort((a,b)=>a-b).map(n=>{const c=detectedStripAllies[n-1];return c?`${c}(A${n})`:`A${n}`;}).join(", ")}`);
        if(enemiesDown.length>0)parts.push(`Dead enemies: ${enemiesDown.sort((a,b)=>a-b).map(n=>{const c=detectedStripEnemies[n-1];return c?`${c}(E${n})`:`E${n}`;}).join(", ")}`);
        const allyTowersDown=towersDown.ally.map(i=>TOWER_LABELS[i]).filter(Boolean);
        const enemyTowersDown=towersDown.enemy.map(i=>TOWER_LABELS[i]).filter(Boolean);
        if(allyTowersDown.length>0)parts.push(`Our destroyed towers: ${allyTowersDown.join(", ")}`);
        if(enemyTowersDown.length>0)parts.push(`Enemy destroyed towers: ${enemyTowersDown.join(", ")}`);
        if(userNotes.trim())parts.push(userNotes.trim());
        return parts.length?parts.join(". "):null;
      })(),
    };
  },[pins,objPins,gameTimeSecs,myRole,myChamp,baronBuff,elderBuff,alliesDown,enemiesDown,towersDown,userNotes,detectedStripAllies,detectedStripEnemies]);

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
    setIsAdvising(true);setAdvice("");setAdviceElapsedMs(null);
    adviceStartRef.current=Date.now();
    adviceTimerRef.current=setInterval(()=>setAdviceElapsedMs(Date.now()-adviceStartRef.current),100);
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
    finally{
      if(adviceTimerRef.current)clearInterval(adviceTimerRef.current);
      setAdviceElapsedMs(Date.now()-adviceStartRef.current);
      setIsAdvising(false);
    }
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
  const allyWavePins=pins.filter(p=>p.type==="ally_wave");
  const enemyWavePins=pins.filter(p=>p.type==="enemy_wave");
  const hasContext=pins.length>0||objPins.length>0||!!myChamp||!!myRole||!!baronBuff||!!elderBuff||gameTimeSecs>0;
  const canAdvise=!!model&&!isAdvising&&(!!imageBase64||hasContext);
  const hasBuffs=baronBuff!==null||elderBuff!==null;

  const PLACE_CFG={
    me:        {active:"bg-amber-400/20  border-amber-400  text-amber-400", idle:"border-border/40 text-muted-foreground hover:border-amber-400/40", dot:"bg-amber-400",  hint:"Tap anywhere on the minimap to drop YOUR pin — tap pin to remove"},
    ally:      {active:"bg-sky-400/20    border-sky-400    text-sky-400",   idle:"border-border/40 text-muted-foreground hover:border-sky-400/40",   dot:"bg-sky-400",   hint:`Tap map to place ally pin (${allyPins.length}/4) — tap pin to assign champ`},
    enemy:     {active:"bg-red-500/20    border-red-500    text-red-400",   idle:"border-border/40 text-muted-foreground hover:border-red-400/40",   dot:"bg-red-500",   hint:`Tap map to place enemy pin (${enemyPins.length}/5) — tap pin to assign champ`},
    obj:       {active:"bg-purple-500/20 border-purple-500 text-purple-400",idle:"border-border/40 text-muted-foreground hover:border-purple-500/40", dot:"bg-purple-400",hint:"Tap map to mark an objective location — then pick type & status"},
    ally_wave: {active:"bg-green-400/20  border-green-400  text-green-400", idle:"border-border/40 text-muted-foreground hover:border-green-400/40",  dot:"bg-green-400", hint:"Tap map to mark an allied minion wave position — tap pin to remove"},
    enemy_wave:{active:"bg-orange-400/20 border-orange-400 text-orange-400",idle:"border-border/40 text-muted-foreground hover:border-orange-400/40", dot:"bg-orange-400",hint:"Tap map to mark an enemy minion wave position — tap pin to remove"},
  };

  const PIN_BG:Record<PinType,string>={me:"bg-amber-400",ally:"bg-sky-400",enemy:"bg-red-500",ally_wave:"bg-green-400",enemy_wave:"bg-orange-400"};
  const PIN_BORDER:Record<PinType,string>={me:"border-amber-400",ally:"border-sky-400",enemy:"border-red-500",ally_wave:"border-green-400",enemy_wave:"border-orange-400"};
  const PIN_TEXT:Record<PinType,string>={me:"text-black",ally:"text-black",enemy:"text-white",ally_wave:"text-black",enemy_wave:"text-black"};
  const pinLabel=(pin:MapPin)=>
    pin.type==="me"?"ME":
    pin.type==="ally"?`A${pinSlot(allyPins.indexOf(pin),alliesDown)}`:
    pin.type==="enemy"?`E${pinSlot(enemyPins.indexOf(pin),enemiesDown)}`:
    pin.type==="ally_wave"?`W${allyWavePins.indexOf(pin)+1}`:`W${enemyWavePins.indexOf(pin)+1}`;

  return(
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="sticky top-0 z-20 bg-background/90 backdrop-blur border-b border-border/40">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
          <h1 className="font-display text-lg font-bold tracking-tight">MACRO<span className="text-primary">COACH</span></h1>
          <div className="flex items-center gap-1">
            <button onClick={handleQuickReset}
              title="Quick reset — clears pics & advice, keeps role & champion"
              className="h-9 px-2.5 flex items-center gap-1.5 rounded-lg text-xs font-display font-bold tracking-wide text-muted-foreground hover:text-amber-400 hover:bg-amber-400/10 transition-colors border border-transparent hover:border-amber-400/20">
              <RotateCcw className="w-3.5 h-3.5"/>
              NEW GAME
            </button>
            <button onClick={handleClearSession}
              title="Full reset — clears everything including role & champion"
              className="h-9 w-9 flex items-center justify-center rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-400/10 transition-colors">
              <RotateCcw className="w-4 h-4 opacity-40"/>
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
        <input ref={appendFileInputRef} type="file" accept="image/*" multiple className="hidden"
          onChange={e=>{if(e.target.files?.length)handleAppendFiles(e.target.files);e.target.value="";}}/>


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
                    <MapIcon className="w-3 h-3"/> Edit zones
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
            {imageQueue.length>0&&(
              <div className="flex gap-2 px-3 py-2 border-b border-border/30 overflow-x-auto items-center">
                {imageQueue.map((img,i)=>(
                  <div key={i} className="relative shrink-0">
                    <button onClick={()=>{
                        if(i===activeQueueIdx)return;
                        saveCurrentSlot(imageQueue[activeQueueIdx]!);
                        const saved=perImageState.current.get(img);
                        setActiveQueueIdx(i);
                        setPlaceMode(null);
                        if(saved){
                          // Return visit: restore full saved state (pins, advice, chat, strip) + reload crops
                          applySlotState(saved);
                          setImageBase64(img);
                          recropMinimap(img);
                          cropDataUrl(img,timerCropConfig.x,timerCropConfig.y,timerCropConfig.w,timerCropConfig.h).then(setGameTimeCrop).catch(()=>{});
                          cropDataUrl(img,portraitStripConfig.x,portraitStripConfig.y,portraitStripConfig.w,portraitStripConfig.h).then(setPortraitStripCrop).catch(()=>{});
                        }else{
                          // First visit: clear everything and run fresh auto-detection
                          clearPinState();
                          processImage(img);
                        }
                      }}
                      className={cn("w-14 h-14 rounded-lg overflow-hidden border-2 active:scale-95 transition-all block",
                        i===activeQueueIdx?"border-primary":"border-border/30 opacity-50")}>
                      <img src={img} alt={`Screenshot ${i+1}`} className="w-full h-full object-cover"/>
                    </button>
                    <button
                      onClick={()=>{
                        const next=imageQueue.filter((_,j)=>j!==i);
                        if(next.length===0){
                          perImageState.current.clear();
                          setImageQueue([]);setActiveQueueIdx(0);
                          setImageBase64(null);setMinimapBase64(null);setGameTimeCrop(null);setPortraitStripCrop(null);
                          clearPinState();
                        } else {
                          const newIdx=i>=next.length?next.length-1:i===activeQueueIdx?Math.min(i,next.length-1):activeQueueIdx>i?activeQueueIdx-1:activeQueueIdx;
                          if(i===activeQueueIdx){
                            const nextUrl=next[newIdx]!;
                            const savedNext=perImageState.current.get(nextUrl);
                            setImageQueue(next);setActiveQueueIdx(newIdx);setPlaceMode(null);
                            if(savedNext){
                              applySlotState(savedNext);
                              setImageBase64(nextUrl);
                              recropMinimap(nextUrl);
                              cropDataUrl(nextUrl,timerCropConfig.x,timerCropConfig.y,timerCropConfig.w,timerCropConfig.h).then(setGameTimeCrop).catch(()=>{});
                              cropDataUrl(nextUrl,portraitStripConfig.x,portraitStripConfig.y,portraitStripConfig.w,portraitStripConfig.h).then(setPortraitStripCrop).catch(()=>{});
                            }else{
                              clearPinState();
                              processImage(nextUrl);
                            }
                          } else {
                            // Deleting a non-active image — active image unchanged, just update queue
                            setImageQueue(next);setActiveQueueIdx(newIdx);
                          }
                        }
                      }}
                      className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-black/90 border border-border/60 flex items-center justify-center text-xs font-bold text-white hover:bg-red-600 active:scale-90 transition-all touch-manipulation">
                      ×
                    </button>
                  </div>
                ))}
                {/* Add more photos */}
                <button onClick={()=>appendFileInputRef.current?.click()}
                  className="shrink-0 w-14 h-14 rounded-lg border-2 border-dashed border-border/40 hover:border-primary/50 flex flex-col items-center justify-center gap-0.5 text-muted-foreground hover:text-primary transition-colors active:scale-95 touch-manipulation">
                  <Plus className="w-4 h-4"/>
                  <span className="text-[8px] font-display">Add</span>
                </button>
              </div>
            )}

            <div className="p-3 space-y-3">
              {/* Mode buttons */}
              <div className="grid grid-cols-3 gap-1.5">
                {(["me","ally","enemy","obj","ally_wave","enemy_wave"] as const).map(type=>{
                  const cfg=PLACE_CFG[type];
                  const active=placeMode===type;
                  const count=type==="me"?(myPin?1:0):type==="ally"?allyPins.length:type==="enemy"?enemyPins.length:type==="obj"?objPins.length:type==="ally_wave"?allyWavePins.length:enemyWavePins.length;
                  return(
                    <button key={type} onClick={()=>setPlaceMode(p=>p===type?null:type)}
                      className={cn("flex flex-col items-center justify-center gap-0.5 py-2 rounded-lg border text-[10px] font-bold transition-all active:scale-95 font-display bg-black/30",
                        active?cfg.active:`bg-black/30 ${cfg.idle}`)}>
                      {type==="me"&&<UserRound className="w-3.5 h-3.5"/>}
                      {type==="ally"&&<Users className="w-3.5 h-3.5"/>}
                      {type==="enemy"&&<Swords className="w-3.5 h-3.5"/>}
                      {type==="obj"&&<Target className="w-3.5 h-3.5"/>}
                      {type==="ally_wave"&&<span className="text-sm leading-none">≋</span>}
                      {type==="enemy_wave"&&<span className="text-sm leading-none">≋</span>}
                      <span>{type==="me"?"Me":type==="ally"?"Ally":type==="enemy"?"Enemy":type==="obj"?"Obj":type==="ally_wave"?"A.Wave":"E.Wave"}</span>
                      {count>0&&<span className={cn("w-3.5 h-3.5 rounded-full text-[8px] font-bold flex items-center justify-center text-black",cfg.dot)}>{count}</span>}
                    </button>
                  );
                })}
              </div>

              {/* Portrait database button */}
              <button
                onClick={()=>{setShowPortraitDb(true);loadPortraitDb();}}
                className="flex items-center gap-1.5 self-end text-[10px] font-semibold px-2.5 py-1.5 rounded-lg border border-[#30363d] bg-black/30 text-[#8b949e] hover:text-[#58a6ff] hover:border-[#58a6ff]/40 transition-colors"
                title="View saved champion portraits"
              >
                <Database size={11}/>DB
              </button>

              {/* Hint */}
              {placeMode&&(
                <p className={cn("text-[11px] px-3 py-2 rounded-lg border text-center font-display tracking-wide",
                  placeMode==="me"?"bg-amber-400/10 border-amber-400/40 text-amber-400":
                  placeMode==="ally"?"bg-sky-400/10 border-sky-400/40 text-sky-400":
                  placeMode==="obj"?"bg-purple-500/10 border-purple-500/40 text-purple-400":
                  placeMode==="ally_wave"?"bg-green-400/10 border-green-400/40 text-green-400":
                  placeMode==="enemy_wave"?"bg-orange-400/10 border-orange-400/40 text-orange-400":
                  "bg-red-500/10 border-red-500/40 text-red-400")}>
                  {PLACE_CFG[placeMode].hint}
                </p>
              )}

              {/* Minimap + bench zone flex row */}
              <div className="flex items-stretch gap-1">
              <div ref={minimapDivRef}
                className={cn("relative flex-1 select-none",
                  placeMode?"cursor-crosshair":"cursor-default")}
                style={{WebkitTouchCallout:"none"} as React.CSSProperties}
                onClick={handleMinimapTap}
                onContextMenu={e=>e.preventDefault()}
                onTouchStart={handleMinimapTouchStart}
                onTouchMove={handleMinimapTouchMove}
                onTouchEnd={handleMinimapTouchEnd}>
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
                          setTowersDown(prev=>{
                            const lane=Math.floor(idx/3);
                            const tier=idx%3;
                            const next=new Set(prev[team]);
                            if(down){
                              // Un-marking: also un-mark later towers that couldn't be up without this one
                              next.delete(idx);
                              if(tier===0){next.delete(lane*3+1);next.delete(lane*3+2);}
                              else if(tier===1){next.delete(lane*3+2);}
                            } else {
                              // Marking down: also mark earlier towers that must have fallen first
                              next.add(idx);
                              if(tier===2){next.add(lane*3);next.add(lane*3+1);}
                              else if(tier===1){next.add(lane*3);}
                            }
                            return {...prev,[team]:Array.from(next).sort((a,b)=>a-b)};
                          });
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
              {/* Portrait strip with calibrated tap zones */}
              {portraitStripCrop&&(
                <div className="space-y-1.5">
                <div className="relative rounded-xl overflow-hidden border border-border/30">
                  <img src={portraitStripCrop} alt="Portrait strip" className="w-full h-auto block pointer-events-none select-none"/>
                  {/* Ally tap zones — tap to toggle dead; shows champ name if known */}
                  {portraitConfig.allies.map((pos,i)=>{
                    const n=i+1,dead=alliesDown.includes(n);
                    const sx=((pos.x-portraitStripConfig.x)/portraitStripConfig.w)*100;
                    const sy=((pos.y-portraitStripConfig.y)/portraitStripConfig.h)*100;
                    const sz=portraitConfig.sizePct??5.5;
                    if(sx<-5||sx>105||sy<-5||sy>105)return null;
                    const champName=detectedStripAllies[i]||null;
                    return(
                      <button key={`ps-a${n}`}
                        onClick={()=>setAlliesDown(p=>dead?p.filter(x=>x!==n):[...p,n])}
                        className="absolute rounded-full flex flex-col items-center justify-center leading-none select-none"
                        style={{left:`${sx}%`,top:`${sy}%`,transform:"translate(-50%,-50%)",width:`${sz}%`,aspectRatio:"1",
                          background:dead?"rgba(2,6,23,0.92)":"transparent",
                          border:dead?"2px solid rgba(56,189,248,0.8)":"2px solid transparent",
                          color:dead?"#7dd3fc":"transparent",
                          fontSize:`${sz*0.12}vw`}}>
                        {dead&&<span className="font-bold leading-none">{champName??"A"+n}</span>}
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
                    const champName=detectedStripEnemies[i]||null;
                    return(
                      <button key={`ps-e${n}`}
                        onClick={()=>setEnemiesDown(p=>dead?p.filter(x=>x!==n):[...p,n])}
                        className="absolute rounded-full flex flex-col items-center justify-center leading-none select-none"
                        style={{left:`${sx}%`,top:`${sy}%`,transform:"translate(-50%,-50%)",width:`${sz}%`,aspectRatio:"1",
                          background:dead?"rgba(2,6,23,0.92)":"transparent",
                          border:dead?"2px solid rgba(239,68,68,0.8)":"2px solid transparent",
                          color:dead?"#fca5a5":"transparent",
                          fontSize:`${sz*0.12}vw`}}>
                        {dead&&<span className="font-bold leading-none">{champName??"E"+n}</span>}
                      </button>
                    );
                  })}
                </div>
                {/* Who's down + calibrate row */}
                <div className="flex items-center justify-between gap-2 px-0.5">
                  <div className="flex flex-wrap gap-1 flex-1 min-w-0">
                    {alliesDown.length===0&&enemiesDown.length===0&&(
                      <span className="text-[9px] text-white/25">Tap a portrait to mark dead · auto-detects on screenshot</span>
                    )}
                    {alliesDown.sort((a,b)=>a-b).map(n=>{
                      const champName=detectedStripAllies[n-1]||null;
                      return(
                        <button key={`ad${n}`}
                          onClick={()=>setDeadStripPick({team:"ally",slotN:n})}
                          className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full border border-sky-400/40 bg-sky-400/10 text-sky-300 text-[9px] font-bold">
                          {champName??`A${n}`} ▾
                        </button>
                      );
                    })}
                    {enemiesDown.sort((a,b)=>a-b).map(n=>{
                      const champName=detectedStripEnemies[n-1]||null;
                      return(
                        <button key={`ed${n}`}
                          onClick={()=>setDeadStripPick({team:"enemy",slotN:n})}
                          className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full border border-red-400/40 bg-red-400/10 text-red-300 text-[9px] font-bold">
                          {champName??`E${n}`} ▾
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={()=>{const n=!autoDetectStrip;setAutoDetectStrip(n);localStorage.setItem("wr_auto_detect_strip",String(n));}}
                      className={cn("text-[9px] px-2 py-1 rounded-lg border transition-colors",
                        autoDetectStrip
                          ?"border-sky-500/50 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20"
                          :"border-border/40 text-white/30 hover:text-white/60 hover:border-border/60")}
                      title={autoDetectStrip?"Auto-detect champ names from strip: ON (tap to disable)":"Auto-detect champ names from strip: OFF (tap to enable)"}>
                      {autoDetectStrip?"🔍 Champs ON":"🔍 Champs OFF"}
                    </button>
                    <button
                      onClick={()=>setShowDeadCalib(true)}
                      className="text-[9px] px-2 py-1 rounded-lg border border-border/40 text-white/40 hover:text-white/70 hover:border-border/60 transition-colors">
                      ⚙ Calibrate
                    </button>
                  </div>
                </div>
                </div>
              )}

              {/* Detected champions row */}
              {(portraitStripCrop||detectingChamps)&&(
                <div className="flex flex-col gap-1 px-0.5">
                  {detectingChamps&&(
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <Loader2 className="w-3 h-3 animate-spin"/>
                      <span>Detecting champions…</span>
                    </div>
                  )}
                  {!detectingChamps&&detectedStripAllies.some(Boolean)&&(
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="text-[9px] font-display uppercase tracking-widest text-sky-400/70 mr-0.5">Allies:</span>
                      {detectedStripAllies.map((c,i)=>c&&(
                        <span key={`da${i}`} className="text-[9px] px-1.5 py-0.5 rounded-md bg-sky-900/40 border border-sky-700/40 text-sky-300 font-medium">{c}</span>
                      ))}
                    </div>
                  )}
                  {!detectingChamps&&(
                    <button onClick={()=>setShowStripDetectCalib(true)} className="text-[9px] text-white/20 hover:text-white/50 self-start transition-colors" title="Calibrate portrait crop detection areas">⚙ Portrait detection</button>
                  )}
                  {!detectingChamps&&detectedStripEnemies.some(Boolean)&&(
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="text-[9px] font-display uppercase tracking-widest text-red-400/70 mr-0.5">Enemies:</span>
                      {detectedStripEnemies.map((c,i)=>c&&(
                        <span key={`de${i}`} className="text-[9px] px-1.5 py-0.5 rounded-md bg-red-900/40 border border-red-700/40 text-red-300 font-medium">{c}</span>
                      ))}
                    </div>
                  )}
                  <button onClick={()=>setShowObjPitCalib(true)} className="text-[9px] text-white/20 hover:text-white/50 self-start transition-colors" title="Configure objective pit detection">⚙ Obj detection</button>
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
            <div className="px-4 py-2.5 bg-primary/5 border-b border-primary/20 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-primary animate-pulse"/>
                <span className="font-display text-xs tracking-widest uppercase text-primary">Tactical Read</span>
              </div>
              {adviceElapsedMs!==null&&(
                <span className="font-mono text-[10px] text-muted-foreground">
                  {isAdvising?`⏱ ${(adviceElapsedMs/1000).toFixed(1)}s…`:`✓ ${(adviceElapsedMs/1000).toFixed(1)}s`}
                </span>
              )}
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

      {/* ── Portrait database viewer ─────────────────────────────────────── */}
      {showPortraitDb&&(()=>{
        const grouped:Record<string,PortraitDbEntry[]>={};
        for(const e of portraitDbEntries){
          if(!grouped[e.champName])grouped[e.champName]=[];
          grouped[e.champName].push(e);
        }
        const champs=Object.keys(grouped).sort();
        return(
          <div
            className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70"
            onClick={()=>setShowPortraitDb(false)}
          >
            <div
              className="bg-[#0d1117] border border-[#30363d] rounded-xl shadow-2xl w-[min(92vw,520px)] max-h-[80vh] flex flex-col"
              onClick={e=>e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-[#30363d]">
                <div className="flex items-center gap-2 text-[#c9d1d9] font-semibold text-sm">
                  <Database size={15} className="text-[#58a6ff]"/>
                  Portrait Database
                  <span className="text-xs text-[#8b949e] font-normal">({portraitDbEntries.length} saved)</span>
                </div>
                <button
                  className="text-[#8b949e] hover:text-[#c9d1d9] p-1 rounded"
                  onClick={()=>setShowPortraitDb(false)}
                ><X size={16}/></button>
              </div>
              <div className="overflow-y-auto p-4 flex-1">
                {champs.length===0?(
                  <div className="text-center text-[#8b949e] text-sm py-8">
                    <Database size={28} className="mx-auto mb-2 opacity-40"/>
                    No portraits saved yet.<br/>
                    <span className="text-xs">Assign champions to auto-placed pins to build your database.</span>
                  </div>
                ):(
                  <div className="space-y-4">
                    {champs.map(champ=>(
                      <div key={champ}>
                        <div className="text-xs font-semibold text-[#58a6ff] mb-1.5">{champ}</div>
                        <div className="flex flex-wrap gap-2">
                          {grouped[champ].map(e=>(
                            <div key={e.id} className="relative">
                              <img
                                src={e.cropDataUrl}
                                className="w-12 h-12 rounded-full border border-[#30363d] object-cover"
                                style={{clipPath:"circle(50%)"}}
                                title={new Date(e.ts).toLocaleDateString()}
                              />
                              {/* Always-visible X button — top-right corner — works on touch */}
                              <button
                                className="absolute top-0 right-0 w-5 h-5 flex items-center justify-center bg-black/80 rounded-bl rounded-tr border-b border-l border-red-800/60 active:bg-red-900/80"
                                onClick={()=>{
                                  if(!e.id)return;
                                  deletePortraitEntry(e.id).then(loadPortraitDb).catch(()=>{});
                                }}
                                title="Delete"
                              ><X size={10} className="text-red-400"/></button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="px-4 py-3 border-t border-[#30363d] flex items-center justify-between gap-3">
                {/* Crop-size calibration — adjust until portraits look centred in the DB thumbnail */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[#8b949e]">Crop:</span>
                  <button
                    className="w-6 h-6 flex items-center justify-center rounded bg-[#21262d] hover:bg-[#30363d] text-[#c9d1d9] text-sm leading-none transition-colors"
                    onClick={()=>setPortraitCropPct(portraitCropPct-1)}
                  >−</button>
                  <span className="text-xs text-[#c9d1d9] w-8 text-center tabular-nums">{portraitCropPct}%</span>
                  <button
                    className="w-6 h-6 flex items-center justify-center rounded bg-[#21262d] hover:bg-[#30363d] text-[#c9d1d9] text-sm leading-none transition-colors"
                    onClick={()=>setPortraitCropPct(portraitCropPct+1)}
                  >+</button>
                  {portraitDbEntries.length>0&&<span className="text-xs text-amber-400/80 ml-1">Clear DB to apply</span>}
                </div>
                <button
                  className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1 px-3 py-1.5 rounded border border-red-800/50 hover:border-red-600/50 transition-colors"
                  onClick={()=>{
                    if(!window.confirm("Delete ALL saved portraits?"))return;
                    Promise.all(portraitDbEntries.filter(e=>e.id!=null).map(e=>deletePortraitEntry(e.id!))).then(loadPortraitDb).catch(()=>{});
                  }}
                >
                  <Trash2 size={12}/>Clear all
                </button>
              </div>
            </div>
          </div>
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
            onAssign={(champ,save)=>{
              const pin=pins.find(p=>p.id===quickPickPinId);
              setPins(prev=>prev.map(p=>p.id===quickPickPinId?{...p,champ}:p));
              if(champ)trackRecentChamp(champ);
              if(pin&&minimapBase64&&champ&&save){
                // Open the crop adjuster so user can frame portrait precisely before saving
                setCropAdjust({champ,pinX:pin.x,pinY:pin.y});
              }
              setQuickPickPinId(null);
            }}
            onRemove={()=>{removePin(quickPickPinId);setQuickPickPinId(null);}}
            onClose={()=>setQuickPickPinId(null)}
            recent={recentChamps}
          />
        );
      })()}

      {/* ── Portrait Crop Adjuster ──────────────────────────────────────── */}
      {cropAdjust&&minimapBase64&&(
        <CropAdjuster
          champ={cropAdjust.champ}
          minimapSrc={minimapBase64}
          pinX={cropAdjust.pinX}
          pinY={cropAdjust.pinY}
          initialCropPct={portraitCropPct}
          onConfirm={(cxPct,cyPct,diamPct)=>{
            saveChampPortrait(cropAdjust.champ,minimapBase64,cxPct,cyPct,diamPct)
              .then(()=>loadPortraitDb())
              .catch(()=>{});
            setCropAdjust(null);
          }}
          onCancel={()=>setCropAdjust(null)}
        />
      )}

      {/* Long-press place-pin menu */}
      {longPressMenu&&(
        <LongPressMenu
          pos={{x:longPressMenu.screenX,y:longPressMenu.screenY}}
          onClose={()=>setLongPressMenu(null)}
          onPlace={handleLongPressPlace}
        />
      )}

      {/* ── Dead strip champion picker ────────────────────────────────────── */}
      {deadStripPick&&(
        <div className="fixed inset-0 z-50 flex items-end justify-center pb-4 px-4 bg-black/70"
          onClick={()=>setDeadStripPick(null)}>
          <div className="bg-[#0d1117] rounded-2xl border border-border/50 p-4 space-y-3 w-full max-w-sm"
            onClick={e=>e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-display font-bold"
                style={{color:deadStripPick.team==="ally"?"#7dd3fc":"#fca5a5"}}>
                {deadStripPick.team==="ally"?`Ally A${deadStripPick.slotN}`:`Enemy E${deadStripPick.slotN}`}
              </h3>
              <div className="flex gap-2">
                <button
                  onClick={()=>{
                    if(deadStripPick.team==="ally")setAlliesDown(p=>p.filter(x=>x!==deadStripPick.slotN));
                    else setEnemiesDown(p=>p.filter(x=>x!==deadStripPick.slotN));
                    setDeadStripPick(null);
                  }}
                  className="text-[10px] px-2 py-1 rounded-lg border border-border/40 text-white/50 hover:text-white/80">
                  Mark alive
                </button>
                <button onClick={()=>setDeadStripPick(null)} className="text-white/40 hover:text-white/70 px-1 text-lg leading-none">✕</button>
              </div>
            </div>
            <input
              autoFocus
              placeholder="Search champion…"
              value={deadStripSearch}
              onChange={e=>setDeadStripSearch(e.target.value)}
              className="w-full bg-white/5 border border-border/40 rounded-lg px-3 py-1.5 text-xs text-white placeholder-white/30 outline-none focus:border-sky-500/50"/>
            {/* Recent champs quick row */}
            {recentChamps.length>0&&!deadStripSearch&&(
              <div className="space-y-1">
                <p className="text-[9px] uppercase tracking-widest text-sky-400/60 font-display">Recent</p>
                <div className="flex flex-wrap gap-1">
                  {recentChamps.map(c=>(
                    <button key={c}
                      onClick={()=>{
                        trackRecentChamp(c);
                        if(deadStripPick.team==="ally"){
                          setDetectedStripAllies(prev=>{const n=[...prev];n[deadStripPick.slotN-1]=c;return n;});
                        }else{
                          setDetectedStripEnemies(prev=>{const n=[...prev];n[deadStripPick.slotN-1]=c;return n;});
                        }
                        setDeadStripPick(null);setDeadStripSearch("");
                      }}
                      className="text-[9px] px-2 py-1 rounded-full border border-sky-400/30 text-sky-300/70 hover:bg-sky-400/10 hover:text-sky-300">
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="max-h-40 overflow-y-auto grid grid-cols-3 gap-1">
              {CHAMPIONS.filter(c=>!deadStripSearch||c.toLowerCase().includes(deadStripSearch.toLowerCase())).map(c=>(
                <button key={c}
                  onClick={()=>{
                    trackRecentChamp(c);
                    if(deadStripPick.team==="ally"){
                      setDetectedStripAllies(prev=>{const n=[...prev];n[deadStripPick.slotN-1]=c;return n;});
                    }else{
                      setDetectedStripEnemies(prev=>{const n=[...prev];n[deadStripPick.slotN-1]=c;return n;});
                    }
                    setDeadStripPick(null);setDeadStripSearch("");
                  }}
                  className="text-[9px] px-1.5 py-1 rounded-lg border border-border/30 text-white/60 hover:bg-white/10 hover:text-white/90 truncate text-left">
                  {c}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Dead-timer calibration popup ──────────────────────────────────── */}
      {showDeadCalib&&(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85" onClick={()=>setShowDeadCalib(false)}>
          <div className="bg-[#0d1117] rounded-2xl border border-border/50 p-4 space-y-3 w-full max-w-md" onClick={e=>e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-display font-bold text-white/90">Dead Timer Calibration</h3>
                <p className="text-[9px] text-white/35 mt-0.5">Drag boxes onto where each champion's countdown number appears. Blue = allies, red = enemies.</p>
              </div>
              <button onClick={()=>setShowDeadCalib(false)} className="text-white/40 hover:text-white/70 text-lg leading-none px-1">✕</button>
            </div>

            {/* Portrait strip with drag boxes */}
            {portraitStripCrop?(
              <div
                ref={deadCalibImgRef}
                className="relative rounded-xl overflow-hidden select-none border border-border/30"
                style={{touchAction:"none"}}
                onPointerMove={onDeadCalibPointerMove}
                onPointerUp={onDeadCalibPointerUp}
                onPointerLeave={onDeadCalibPointerUp}
              >
                <img src={portraitStripCrop} alt="Portrait strip" className="w-full h-auto block pointer-events-none"/>
                {/* Ally boxes (blue) */}
                {deadSlotBoxes.ally.map((box,i)=>(
                  <div key={`dab${i}`}
                    className="absolute cursor-move"
                    style={{left:`${box.x}%`,top:`${box.y}%`,width:`${box.w}%`,height:`${box.h}%`,
                      border:"2px solid rgba(56,189,248,0.8)",background:"rgba(56,189,248,0.12)",boxSizing:"border-box"}}
                    onPointerDown={e=>onDeadBoxPointerDown(e,"ally",i,"move")}>
                    <span style={{position:"absolute",top:1,left:2,fontSize:"10px",color:"#38bdf8",fontWeight:"bold",lineHeight:1,pointerEvents:"none"}}>
                      {detectedStripAllies[i]??`A${i+1}`}
                    </span>
                    {/* Resize corner */}
                    <div style={{position:"absolute",bottom:0,right:0,width:12,height:12,background:"rgba(56,189,248,0.6)",cursor:"se-resize",touchAction:"none"}}
                      onPointerDown={e=>{e.stopPropagation();onDeadBoxPointerDown(e,"ally",i,"resize");}}/>
                  </div>
                ))}
                {/* Enemy boxes (red) */}
                {deadSlotBoxes.enemy.map((box,i)=>(
                  <div key={`deb${i}`}
                    className="absolute cursor-move"
                    style={{left:`${box.x}%`,top:`${box.y}%`,width:`${box.w}%`,height:`${box.h}%`,
                      border:"2px solid rgba(239,68,68,0.8)",background:"rgba(239,68,68,0.12)",boxSizing:"border-box"}}
                    onPointerDown={e=>onDeadBoxPointerDown(e,"enemy",i,"move")}>
                    <span style={{position:"absolute",top:1,left:2,fontSize:"10px",color:"#f87171",fontWeight:"bold",lineHeight:1,pointerEvents:"none"}}>
                      {detectedStripEnemies[i]??`E${i+1}`}
                    </span>
                    <div style={{position:"absolute",bottom:0,right:0,width:12,height:12,background:"rgba(239,68,68,0.6)",cursor:"se-resize",touchAction:"none"}}
                      onPointerDown={e=>{e.stopPropagation();onDeadBoxPointerDown(e,"enemy",i,"resize");}}/>
                  </div>
                ))}
              </div>
            ):(
              <p className="text-[10px] text-white/30 text-center py-4">Upload a screenshot first so the portrait strip appears here.</p>
            )}

            <div className="flex gap-2">
              <button
                onClick={()=>setDeadSlotBoxes(DEFAULT_DEAD_SLOT_BOXES)}
                className="flex-1 text-[11px] py-1.5 rounded-lg border border-border/40 text-white/50 hover:text-white/70 transition-colors">
                Reset to defaults
              </button>
              <button
                onClick={()=>{localStorage.setItem("wr_dead_slot_boxes",JSON.stringify(deadSlotBoxes));setShowDeadCalib(false);}}
                className="flex-1 text-[11px] py-1.5 rounded-lg bg-sky-500/20 border border-sky-500/40 text-sky-300 font-semibold hover:bg-sky-500/30 transition-colors">
                Save & Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Objective pit calibration popup ───────────────────────────────── */}
      {showObjPitCalib&&(
        <div className="fixed inset-0 z-50 flex items-end justify-center p-3 bg-black/85" onClick={()=>{setShowObjPitCalib(false);setObjPickingColorFor(null);}}>
          <div className="bg-[#0d1117] rounded-2xl border border-border/50 p-4 space-y-3 w-full max-w-sm max-h-[92dvh] overflow-y-auto" onClick={e=>e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-display font-bold text-white/90">Objective Pit Detection</h3>
                <p className="text-[9px] text-white/35 mt-0.5">Drag the two boxes over the baron and dragon pit areas. Assign a color per objective type — tap 💧 then tap the map.</p>
              </div>
              <button onClick={()=>{setShowObjPitCalib(false);setObjPickingColorFor(null);}} className="text-white/40 hover:text-white/70 text-lg leading-none px-1">✕</button>
            </div>
            {minimapBase64?(
              <div
                ref={objPitImgRef}
                className="relative rounded-xl overflow-hidden select-none border border-border/30"
                style={{touchAction:"none",cursor:objPickingColorFor?"crosshair":"default"}}
                onPointerMove={onObjPitPointerMove}
                onPointerUp={onObjPitPointerUp}
                onPointerLeave={onObjPitPointerUp}
                onClick={objPickingColorFor?onObjPitEyedrop:undefined}
              >
                <img src={minimapBase64} alt="Minimap" className="w-full h-auto block pointer-events-none"/>
                {objPickingColorFor&&(
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <span className="bg-black/75 text-yellow-300 text-[10px] px-2 py-1 rounded-lg font-bold">
                      Tap to pick color for {OBJ_DETECT_TYPES.find(t=>t.id===objPickingColorFor)?.label??objPickingColorFor}
                    </span>
                  </div>
                )}
                {([
                  {label:"Pit A",col:"rgba(139,92,246,0.9)"},
                  {label:"Pit B",col:"rgba(34,197,94,0.9)"},
                ] as const).map(({label,col},zi)=>{
                  const zone=objPitConfig.zones[zi as 0|1];
                  return(
                    <div key={zi}
                      className="absolute cursor-move"
                      style={{left:`${zone.x}%`,top:`${zone.y}%`,width:`${zone.w}%`,height:`${zone.h}%`,
                        border:`2px solid ${col}`,background:col.replace("0.9","0.1"),boxSizing:"border-box"}}
                      onPointerDown={e=>onObjPitPointerDown(e,zi as 0|1,"move")}>
                      <span style={{position:"absolute",top:2,left:3,fontSize:"9px",color:col,fontWeight:"bold",lineHeight:1,pointerEvents:"none"}}>{label}</span>
                      <div style={{position:"absolute",bottom:0,right:0,width:14,height:14,background:col,cursor:"se-resize",touchAction:"none"}}
                        onPointerDown={e=>{e.stopPropagation();onObjPitPointerDown(e,zi as 0|1,"resize");}}/>
                    </div>
                  );
                })}
              </div>
            ):(
              <p className="text-[10px] text-white/30 text-center py-3">Upload a screenshot first so the minimap appears here.</p>
            )}
            <div className="space-y-1.5">
              <p className="text-[10px] text-white/40 font-display uppercase tracking-widest">Objective Colors</p>
              <div className="grid grid-cols-2 gap-1.5">
                {OBJ_DETECT_TYPES.map(t=>(
                  <div key={t.id} className="flex items-center gap-1.5">
                    <input type="color"
                      value={objPitConfig.colors[t.id]??t.def}
                      onChange={e=>setObjPitConfig(prev=>({...prev,colors:{...prev.colors,[t.id]:e.target.value}}))}
                      className="w-7 h-7 rounded-md cursor-pointer border border-border/40 p-0.5 shrink-0 bg-transparent"/>
                    <span className="text-[10px] text-white/70 flex-1 truncate">{t.label}</span>
                    <button
                      onClick={()=>setObjPickingColorFor(prev=>prev===t.id?null:t.id)}
                      className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${objPickingColorFor===t.id?"border-yellow-400/70 bg-yellow-400/20 text-yellow-300":"border-border/30 text-white/30 hover:text-white/60"}`}>
                      💧
                    </button>
                  </div>
                ))}
              </div>
            </div>
            {objPitResetConfirm?(
              <div className="flex gap-2 items-center bg-red-950/40 border border-red-700/40 rounded-lg px-3 py-2">
                <span className="text-[10px] text-red-300 flex-1">Reset all to defaults?</span>
                <button onClick={()=>{setObjPitConfig(DEFAULT_OBJ_PIT_CONFIG);setObjPitResetConfirm(false);}}
                  className="text-[10px] px-2.5 py-1 rounded-md bg-red-600/70 border border-red-500/60 text-white font-bold active:scale-95">Yes</button>
                <button onClick={()=>setObjPitResetConfirm(false)}
                  className="text-[10px] px-2.5 py-1 rounded-md border border-border/40 text-white/50 active:scale-95">Cancel</button>
              </div>
            ):(
              <div className="flex gap-2">
                <button onClick={()=>setObjPitResetConfirm(true)}
                  className="flex-1 text-[11px] py-1.5 rounded-lg border border-border/40 text-white/50 hover:text-white/70 transition-colors">
                  Reset
                </button>
                <button
                  onClick={()=>{localStorage.setItem("wr_obj_pit_config",JSON.stringify(objPitConfig));setShowObjPitCalib(false);setObjPickingColorFor(null);setObjPitResetConfirm(false);}}
                  className="flex-1 text-[11px] py-1.5 rounded-lg bg-violet-500/20 border border-violet-500/40 text-violet-300 font-semibold hover:bg-violet-500/30 transition-colors">
                  Save & Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Strip detect calibration popup (per-slot portrait crop areas) ──── */}
      {showStripDetectCalib&&(
        <div className="fixed inset-0 z-50 flex items-end justify-center p-3 bg-black/85" onClick={()=>setShowStripDetectCalib(false)}>
          <div className="bg-[#0d1117] rounded-2xl border border-border/50 p-4 space-y-3 w-full max-w-sm" onClick={e=>e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-display font-bold text-white/90">Champion Detection Calibration</h3>
                <p className="text-[9px] text-white/35 mt-0.5">Drag circles to be centered over each portrait face. Use +/− to adjust crop size per slot.</p>
              </div>
              <button onClick={()=>setShowStripDetectCalib(false)} className="text-white/40 hover:text-white/70 text-lg leading-none px-1">✕</button>
            </div>
            {portraitStripCrop?(
              <div
                ref={stripDetectImgRef}
                className="relative rounded-xl overflow-hidden select-none border border-border/30"
                style={{touchAction:"none"}}
                onPointerMove={onStripDetectPointerMove}
                onPointerUp={onStripDetectPointerUp}
                onPointerLeave={onStripDetectPointerUp}
              >
                <img src={portraitStripCrop} alt="Portrait strip" className="w-full h-auto block pointer-events-none"/>
                {(["ally","enemy"] as const).map(team=>
                  getStripDetectBoxes()[team].map((box,i)=>{
                    const isAlly=team==="ally";
                    const col=isAlly?"rgba(56,189,248,0.9)":"rgba(239,68,68,0.9)";
                    const bg=isAlly?"rgba(56,189,248,0.1)":"rgba(239,68,68,0.1)";
                    const name=isAlly?detectedStripAllies[i]:detectedStripEnemies[i];
                    const label=isAlly?`A${i+1}`:`E${i+1}`;
                    return(
                      <div key={`sdc-${team}${i}`}
                        className="absolute cursor-move rounded-full flex items-center justify-center"
                        style={{left:`${box.x}%`,top:`${box.y}%`,width:`${box.sz}%`,aspectRatio:"1",
                          transform:"translate(-50%,-50%)",border:`2px solid ${col}`,background:bg,boxSizing:"border-box",touchAction:"none"}}
                        onPointerDown={e=>onStripDetectPointerDown(e,team,i)}>
                        <span style={{fontSize:"6px",color:col,fontWeight:"bold",lineHeight:1,pointerEvents:"none",textAlign:"center",maxWidth:"90%",overflow:"hidden"}}>
                          {name??label}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            ):(
              <p className="text-[10px] text-white/30 text-center py-3">Upload a screenshot first.</p>
            )}
            <div className="space-y-1">
              <p className="text-[10px] text-white/40 font-display uppercase tracking-widest">Crop size</p>
              {(["ally","enemy"] as const).map(team=>
                getStripDetectBoxes()[team].map((box,i)=>{
                  const isAlly=team==="ally";
                  const name=isAlly?detectedStripAllies[i]:detectedStripEnemies[i];
                  const label=isAlly?`A${i+1}`:`E${i+1}`;
                  return(
                    <div key={`szc-${team}${i}`} className="flex items-center gap-2">
                      <span className={`text-[9px] w-16 truncate ${isAlly?"text-sky-400":"text-red-400"}`}>{name??label}</span>
                      <button onClick={()=>onStripDetectResizeSz(team,i,-1)} className="text-white/50 hover:text-white/80 text-xs px-2 py-0.5 rounded border border-border/30">−</button>
                      <span className="text-[9px] text-white/40 w-8 text-center">{box.sz.toFixed(1)}%</span>
                      <button onClick={()=>onStripDetectResizeSz(team,i,+1)} className="text-white/50 hover:text-white/80 text-xs px-2 py-0.5 rounded border border-border/30">+</button>
                    </div>
                  );
                })
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={()=>{setStripDetectConfig(null);localStorage.removeItem("wr_strip_detect_config");}}
                className="flex-1 text-[11px] py-1.5 rounded-lg border border-border/40 text-white/50 hover:text-white/70 transition-colors">
                Reset to defaults
              </button>
              <button
                onClick={()=>{
                  const cfg=getStripDetectBoxes();
                  localStorage.setItem("wr_strip_detect_config",JSON.stringify(cfg));
                  setStripDetectConfig(cfg);
                  setShowStripDetectCalib(false);
                }}
                className="flex-1 text-[11px] py-1.5 rounded-lg bg-sky-500/20 border border-sky-500/40 text-sky-300 font-semibold hover:bg-sky-500/30 transition-colors">
                Save & Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
