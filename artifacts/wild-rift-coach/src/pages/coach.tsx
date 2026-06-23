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

// ─── Types ────────────────────────────────────────────────────────────────────
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

type LanePos = { kind: "lane"; lane: string; progress: number; category: string };
type ZonePos = { kind: "zone"; zone: string };
type PosInfo = LanePos | ZonePos;

interface MapPin { id: string; type: PinType; x: number; y: number; pos: PosInfo; champ: string | null }

// ─── Wild Rift minimap geometry ───────────────────────────────────────────────
// Coordinate system: % of cropped minimap image
// Blue base = bottom-left, Red base = top-right

const BARON_PATH  = [{x:7,y:72},{x:7,y:48},{x:22,y:26},{x:44,y:8},{x:62,y:7}];
const MID_PATH    = [{x:20,y:80},{x:35,y:65},{x:50,y:50},{x:65,y:35},{x:80,y:20}];
const DRAGON_PATH = [{x:22,y:92},{x:40,y:83},{x:56,y:78},{x:73,y:70},{x:86,y:60}];

const LANES = [
  { name: "Baron Lane",  path: BARON_PATH  },
  { name: "Mid Lane",    path: MID_PATH    },
  { name: "Dragon Lane", path: DRAGON_PATH },
];

const SIMPLE_ZONES = [
  { id: "blue_base",   label: "Blue Base",    cx: 6,  cy: 90 },
  { id: "red_base",    label: "Red Base",     cx: 93, cy: 8  },
  { id: "baron_pit",   label: "Baron Pit",    cx: 36, cy: 21 },
  { id: "dragon_pit",  label: "Dragon Pit",   cx: 60, cy: 80 },
  { id: "jungle_blue", label: "Blue Jungle",  cx: 14, cy: 52 },
  { id: "jungle_red",  label: "Red Jungle",   cx: 84, cy: 48 },
];

function segmentProject(px:number,py:number,ax:number,ay:number,bx:number,by:number){
  const dx=bx-ax,dy=by-ay,lenSq=dx*dx+dy*dy;
  if(lenSq===0)return{dist:Math.hypot(px-ax,py-ay),t:0};
  const t=Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/lenSq));
  return{dist:Math.hypot(px-(ax+t*dx),py-(ay+t*dy)),t};
}

function polylineProject(px:number,py:number,path:{x:number;y:number}[]):{dist:number;progress:number}{
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

function classifyPos(x:number,y:number):PosInfo{
  // Check each lane
  let bestLane:{name:string;dist:number;progress:number}|null=null;
  for(const l of LANES){
    const{dist,progress}=polylineProject(x,y,l.path);
    if(!bestLane||dist<bestLane.dist)bestLane={name:l.name,dist,progress};
  }
  // Check simple zones
  let bestZone:{label:string;dist:number}|null=null;
  for(const z of SIMPLE_ZONES){
    const dist=Math.hypot(x-z.cx,y-z.cy);
    if(!bestZone||dist<bestZone.dist)bestZone={label:z.label,dist};
  }
  // Lane wins if it's close enough AND closer than the zone
  const LANE_THRESH=14;
  if(bestLane&&bestLane.dist<LANE_THRESH&&(!bestZone||bestLane.dist<bestZone.dist)){
    return{kind:"lane",lane:bestLane.name,progress:Math.round(bestLane.progress),category:laneCategory(bestLane.progress)};
  }
  return{kind:"zone",zone:bestZone?.label??"Jungle"};
}

function posLabel(pos:PosInfo):string{
  if(pos.kind==="lane")return`${pos.lane} ${pos.progress}% (${pos.category})`;
  return pos.zone;
}

// ─── Render annotated minimap onto canvas → base64 ───────────────────────────
async function renderAnnotatedMinimap(
  minimapDataUrl:string,
  pins:MapPin[]
):Promise<string>{
  return new Promise(resolve=>{
    const img=new Image();
    img.onload=()=>{
      const canvas=document.createElement("canvas");
      canvas.width=img.naturalWidth*2;
      canvas.height=img.naturalHeight*2;
      const ctx=canvas.getContext("2d")!;
      ctx.drawImage(img,0,0,canvas.width,canvas.height);

      const W=canvas.width,H=canvas.height;
      const r=Math.round(W*0.05); // pin radius = 5% of width

      const allyIdx:{[id:string]:number}={};
      const enemyIdx:{[id:string]:number}={};
      let ai=1,ei=1;
      for(const p of pins){
        if(p.type==="ally"){allyIdx[p.id]=ai++;} 
        if(p.type==="enemy"){enemyIdx[p.id]=ei++;}
      }

      for(const pin of pins){
        const px=pin.x/100*W;
        const py=pin.y/100*H;
        const color=pin.type==="me"?"#FBBF24":pin.type==="ally"?"#38BDF8":"#EF4444";
        const outline=pin.type==="me"?"#92400E":pin.type==="ally"?"#0C4A6E":"#7F1D1D";
        const label=pin.type==="me"?"ME":pin.type==="ally"?`A${allyIdx[pin.id]}`:`E${enemyIdx[pin.id]}`;

        // Drop shadow
        ctx.shadowColor="rgba(0,0,0,0.8)";ctx.shadowBlur=8;
        // Fill
        ctx.beginPath();ctx.arc(px,py,r,0,Math.PI*2);
        ctx.fillStyle=color+"DD";ctx.fill();
        ctx.shadowBlur=0;
        // Border
        ctx.strokeStyle=outline;ctx.lineWidth=Math.max(2,r*0.18);ctx.stroke();

        // Label
        ctx.fillStyle="#000";
        ctx.font=`bold ${Math.round(r*1.1)}px sans-serif`;
        ctx.textAlign="center";ctx.textBaseline="middle";
        ctx.fillText(label,px,py);

        // Champion name tag
        if(pin.champ){
          const tagW=ctx.measureText(pin.champ).width+8;
          ctx.fillStyle="rgba(0,0,0,0.75)";
          ctx.beginPath();
          ctx.roundRect(px-tagW/2,py+r+2,tagW,Math.round(r*0.85),3);
          ctx.fill();
          ctx.fillStyle="#fff";
          ctx.font=`${Math.round(r*0.72)}px sans-serif`;
          ctx.fillText(pin.champ,px,py+r+2+Math.round(r*0.42));
        }
      }

      resolve(canvas.toDataURL("image/jpeg",0.92));
    };
    img.src=minimapDataUrl;
  });
}

// ─── Canvas helpers ───────────────────────────────────────────────────────────
async function cropDataUrl(dataUrl:string,xPct:number,yPct:number,wPct:number,hPct:number):Promise<string>{
  return new Promise(resolve=>{
    const img=new Image();
    img.onload=()=>{
      const W=img.naturalWidth,H=img.naturalHeight;
      const canvas=document.createElement("canvas");
      canvas.width=Math.round(W*wPct/100);
      canvas.height=Math.round(H*hPct/100);
      canvas.getContext("2d")!.drawImage(img,
        Math.round(W*xPct/100),Math.round(H*yPct/100),canvas.width,canvas.height,
        0,0,canvas.width,canvas.height);
      resolve(canvas.toDataURL("image/jpeg",0.93));
    };
    img.src=dataUrl;
  });
}

function timeToSecs(t:string):number{
  const[m,s]=t.split(":").map(Number);return(m??0)*60+(s??0);
}

// ─── ChampionPicker ───────────────────────────────────────────────────────────
function ChampionPicker({open,title,selected,max,onClose,onSelect}:{
  open:boolean;title:string;selected:string[];max:number;
  onClose:()=>void;onSelect:(c:string[])=>void;
}){
  const[search,setSearch]=useState("");
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
            <Input autoFocus placeholder="Search..." className="pl-9 h-9 bg-black/40 text-sm"
              value={search} onChange={e=>setSearch(e.target.value)}/>
          </div>
        </div>
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
              return(
                <button key={c} onClick={()=>toggle(c)} disabled={full}
                  className={cn("rounded-md px-2 py-2.5 text-xs font-medium text-center transition-all active:scale-95",
                    sel?"bg-primary/25 text-primary border border-primary/50"
                    :full?"opacity-30 cursor-not-allowed bg-black/20 border border-border/20"
                    :"bg-black/30 text-slate-300 border border-border/30 hover:border-primary/30 hover:text-primary")}>
                  {c}
                </button>
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

// ─── 3-state objective control ────────────────────────────────────────────────
function ObjControl({label,value,onChange}:{label:string;value:ObjStatus;onChange:(v:ObjStatus)=>void}){
  const states=[
    {v:"up"  as const,label:"UP",  a:"bg-emerald-500/25 text-emerald-400 border-emerald-500", i:"text-muted-foreground hover:border-emerald-500/40"},
    {v:"soon"as const,label:"SOON",a:"bg-amber-500/25  text-amber-400  border-amber-500",     i:"text-muted-foreground hover:border-amber-500/40"},
    {v:"down"as const,label:"DOWN",a:"bg-red-500/25    text-red-400    border-red-500",        i:"text-muted-foreground hover:border-red-400/40"},
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

// ─── Chat message type ────────────────────────────────────────────────────────
interface StreamingMsg{role:"user"|"assistant";content:string;streaming?:boolean}

// ═════════════════════════════════════════════════════════════════════════════
export default function CoachPage(){
  const queryClient=useQueryClient();
  const[model]=useModelStorage();

  // Screenshot
  const[imageBase64,setImageBase64]=useState<string|null>(null);
  const[minimapBase64,setMinimapBase64]=useState<string|null>(null);
  const[extracting,setExtracting]=useState(false);
  const fileInputRef=useRef<HTMLInputElement>(null);

  // Pins
  const[pins,setPins]=useState<MapPin[]>([]);
  const[placeMode,setPlaceMode]=useState<PlaceMode>(null);
  const minimapDivRef=useRef<HTMLDivElement>(null);

  // Context
  const[gameTimeSecs,setGameTimeSecs]=useState(0);
  const[myRole,setMyRole]=useState<Role|null>(null);
  const[myChamp,setMyChamp]=useState<string|null>(null);
  const[dragon,setDragon]=useState<ObjStatus>(null);
  const[baron,setBaron]=useState<ObjStatus>(null);
  const[herald,setHerald]=useState<ObjStatus>(null);
  const[contextOpen,setContextOpen]=useState(true);
  const[champPickOpen,setChampPickOpen]=useState(false);

  // Advice
  const[advice,setAdvice]=useState("");
  const[isAdvising,setIsAdvising]=useState(false);

  // Chat
  const[activeConversationId,setActiveConversationId]=useState<number|null>(null);
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
  const fmt=(s:number)=>`${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;

  // ── Process uploaded image ──────────────────────────────────────────────────
  const processImage=useCallback(async(dataUrl:string)=>{
    setImageBase64(dataUrl);setMinimapBase64(null);setPins([]);setPlaceMode(null);

    // Crop minimap: top-left 22% width × 36% height (extra margin so nothing cuts off)
    const minimap=await cropDataUrl(dataUrl,0,0,22,36);
    setMinimapBase64(minimap);

    // Extract game time from top-center strip
    setExtracting(true);
    try{
      const strip=await cropDataUrl(dataUrl,28,0,44,13);
      const BASE=import.meta.env.BASE_URL;
      const res=await fetch(`${BASE}api/coach/extract-metadata`,{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({imageBase64:strip.split(",")[1]}),
      });
      if(res.ok){
        const d=await res.json() as{gameTime?:string|null};
        if(d.gameTime){const s=timeToSecs(d.gameTime);if(s>0&&s<=1800)setGameTimeSecs(s);}
      }
    }catch{}finally{setExtracting(false);}
  },[]);

  const handleFile=(file:File)=>{
    const reader=new FileReader();
    reader.onload=e=>{const r=e.target?.result as string;if(r)processImage(r);};
    reader.readAsDataURL(file);
  };

  // ── Tap on minimap ──────────────────────────────────────────────────────────
  const handleMinimapTap=useCallback((e:React.MouseEvent|React.TouchEvent)=>{
    if(!placeMode||!minimapDivRef.current)return;
    const target=e.target as HTMLElement;
    if(target.closest("[data-pin]"))return; // tapping an existing pin removes it

    const rect=minimapDivRef.current.getBoundingClientRect();
    let cx:number,cy:number;
    if("touches" in e){cx=e.touches[0]!.clientX;cy=e.touches[0]!.clientY;}
    else{cx=(e as React.MouseEvent).clientX;cy=(e as React.MouseEvent).clientY;}

    const x=Math.max(0,Math.min(100,(cx-rect.left)/rect.width*100));
    const y=Math.max(0,Math.min(100,(cy-rect.top)/rect.height*100));
    const pos=classifyPos(x,y);

    if(placeMode==="me"){
      setPins(p=>[...p.filter(pp=>pp.type!=="me"),{id:`me-${Date.now()}`,type:"me",x,y,pos,champ:myChamp}]);
    }else if(placeMode==="ally"){
      if(pins.filter(p=>p.type==="ally").length>=4)return;
      setPins(p=>[...p,{id:`ally-${Date.now()}`,type:"ally",x,y,pos,champ:null}]);
    }else{
      if(pins.filter(p=>p.type==="enemy").length>=5)return;
      setPins(p=>[...p,{id:`enemy-${Date.now()}`,type:"enemy",x,y,pos,champ:null}]);
    }
  },[placeMode,myChamp,pins]);

  const removePin=(id:string)=>setPins(p=>p.filter(pp=>pp.id!==id));

  // ── Build context for AI ────────────────────────────────────────────────────
  const buildContext=useCallback(():GameContext=>{
    const myPin=pins.find(p=>p.type==="me");
    const allyPins=pins.filter(p=>p.type==="ally");
    const enemyPins=pins.filter(p=>p.type==="enemy");
    return{
      gameTime:gameTimeSecs>0?fmt(gameTimeSecs):null,
      myRole:myRole??null,
      myLocation:myPin?posLabel(myPin.pos):null,
      allyChampions:allyPins.length?allyPins.map(p=>{const l=posLabel(p.pos);return p.champ?`${p.champ} at ${l}`:l;}).join(", "):null,
      enemyChampions:enemyPins.length?enemyPins.map(p=>{const l=posLabel(p.pos);return p.champ?`${p.champ} at ${l}`:l;}).join(", "):null,
      dragonStatus:dragon??null,baronStatus:baron??null,riftHeraldStatus:herald??null,
      goldDiff:null,score:null,
      additionalNotes:myChamp?`I am playing ${myChamp}`:null,
    };
  },[pins,gameTimeSecs,myRole,myChamp,dragon,baron,herald]);

  // ── Get annotated minimap for AI ────────────────────────────────────────────
  const getAnnotatedMinimap=useCallback(async():Promise<string|null>=>{
    if(!minimapBase64||pins.length===0)return null;
    return renderAnnotatedMinimap(minimapBase64,pins);
  },[minimapBase64,pins]);

  // ── Advise ──────────────────────────────────────────────────────────────────
  const getAdvice=async()=>{
    if(!model)return;
    setIsAdvising(true);setAdvice("");
    try{
      const annotated=await getAnnotatedMinimap();
      const BASE=import.meta.env.BASE_URL;
      const res=await fetch(`${BASE}api/coach/analyze`,{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          model,
          imageBase64:imageBase64?.split(",")[1]??null,
          minimapBase64:annotated?.split(",")[1]??null,
          context:buildContext(),
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
            if(d.done&&!activeConversationId){
              const conv=await createConversation.mutateAsync({data:{title:`Game ${fmt(gameTimeSecs)}`,model}});
              setActiveConversationId(conv.id);
              queryClient.invalidateQueries({queryKey:getListOpenrouterConversationsQueryKey()});
            }
          }catch{}
        }
      }
    }catch{setAdvice("Error — check model in Settings and try again.");}
    finally{setIsAdvising(false);}
  };

  // ── Chat ────────────────────────────────────────────────────────────────────
  const sendChat=async(e:React.FormEvent)=>{
    e.preventDefault();
    if(!chatInput.trim()||!model)return;
    let convId=activeConversationId;
    if(!convId){
      const conv=await createConversation.mutateAsync({data:{title:`Game ${fmt(gameTimeSecs)}`,model}});
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
  const hasContext=pins.length>0||!!myChamp||!!myRole||!!dragon||!!baron||!!herald||gameTimeSecs>0;
  const canAdvise=!!model&&!isAdvising&&(!!imageBase64||hasContext);

  const PLACE_CFG={
    me:   {active:"bg-amber-400/20 border-amber-400 text-amber-400",idle:"border-border/40 text-muted-foreground hover:border-amber-400/40",dot:"bg-amber-400",hint:"Tap anywhere on the minimap to drop YOUR pin — tap pin to remove"},
    ally: {active:"bg-sky-400/20   border-sky-400   text-sky-400",  idle:"border-border/40 text-muted-foreground hover:border-sky-400/40",  dot:"bg-sky-400",  hint:`Tap to place ally pins (${allyPins.length}/4) — tap existing to remove`},
    enemy:{active:"bg-red-500/20   border-red-500   text-red-400",  idle:"border-border/40 text-muted-foreground hover:border-red-400/40",  dot:"bg-red-500",  hint:`Tap to place enemy pins (${enemyPins.length}/5) — tap existing to remove`},
  };

  const PIN_COLOR={me:"#FBBF24",ally:"#38BDF8",enemy:"#EF4444"};
  const PIN_BORDER={me:"border-amber-400",ally:"border-sky-400",enemy:"border-red-500"};
  const PIN_BG={me:"bg-amber-400",ally:"bg-sky-400",enemy:"bg-red-500"};
  const PIN_TEXT={me:"text-black",ally:"text-black",enemy:"text-white"};

  let ai=1,ei=1;
  const pinLabel=(pin:MapPin)=>pin.type==="me"?"ME":pin.type==="ally"?`A${allyPins.indexOf(pin)+1}`:`E${enemyPins.indexOf(pin)+1}`;

  return(
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="sticky top-0 z-20 bg-background/90 backdrop-blur border-b border-border/40">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
          <h1 className="font-display text-lg font-bold tracking-tight">MACRO<span className="text-primary">COACH</span></h1>
          <Link href="/settings">
            <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-white">
              <Settings className="w-5 h-5"/>
            </Button>
          </Link>
        </div>
      </header>

      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-4 space-y-4 pb-8">

        {!model&&(
          <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3 flex gap-3 items-start">
            <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5"/>
            <div className="text-sm">
              <span className="font-semibold text-destructive">No AI model. </span>
              <Link href="/settings"><span className="underline text-destructive/80 cursor-pointer">Go to Settings</span></Link>
            </div>
          </div>
        )}

        {/* ── SCREENSHOT ─────────────────────────────────────────────────── */}
        {imageBase64?(
          <div className="relative w-full rounded-xl overflow-hidden border border-border/40">
            <img src={imageBase64} alt="Game screenshot" className="w-full h-auto block" draggable={false}/>
            <div className="absolute top-2 right-2 flex gap-2">
              <button className="bg-black/70 border border-white/20 text-white text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 active:scale-95"
                onClick={()=>fileInputRef.current?.click()}>
                <Upload className="w-3 h-3"/> Replace
              </button>
              <button className="w-8 h-8 rounded-full bg-black/70 border border-white/20 flex items-center justify-center text-white active:scale-95"
                onClick={()=>{setImageBase64(null);setMinimapBase64(null);setPins([]);}}>
                <X className="w-3.5 h-3.5"/>
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

        {/* ── MINIMAP TAP PANEL ──────────────────────────────────────────── */}
        {imageBase64&&(
          <div className="bg-card/40 border border-border/40 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border/30 flex items-center justify-between">
              <span className="font-display text-xs tracking-widest uppercase text-muted-foreground flex items-center gap-2">
                Minimap — tap to mark positions
                {extracting&&<span className="text-primary/70 flex items-center gap-1"><Sparkles className="w-3 h-3 animate-pulse"/>reading time…</span>}
              </span>
              {pins.length>0&&(
                <button onClick={()=>setPins([])}
                  className="text-[10px] text-muted-foreground hover:text-white border border-border/30 px-2 py-1 rounded-full">
                  Clear all
                </button>
              )}
            </div>

            <div className="p-3 space-y-3">
              {/* Mode buttons */}
              <div className="flex gap-2">
                {(["me","ally","enemy"] as PinType[]).map(type=>{
                  const cfg=PLACE_CFG[type];
                  const active=placeMode===type;
                  const count=type==="me"?(myPin?1:0):type==="ally"?allyPins.length:enemyPins.length;
                  return(
                    <button key={type}
                      onClick={()=>setPlaceMode(p=>p===type?null:type)}
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

              {/* ── The minimap with free-tap ──────────────────────────── */}
              <div
                ref={minimapDivRef}
                className={cn("relative w-full rounded-lg overflow-hidden border border-border/30",
                  placeMode?"cursor-crosshair":"cursor-default")}
                onClick={handleMinimapTap}
                onTouchStart={handleMinimapTap}
              >
                {minimapBase64?(
                  <img src={minimapBase64} alt="Minimap" className="w-full h-auto block pointer-events-none select-none" draggable={false}/>
                ):(
                  <div className="w-full aspect-square bg-slate-900/80 flex items-center justify-center">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground/40"/>
                  </div>
                )}

                {/* Pins rendered as positioned divs */}
                {pins.map(pin=>{
                  const label=pinLabel(pin);
                  return(
                    <div key={pin.id} data-pin="true"
                      className="absolute -translate-x-1/2 -translate-y-1/2 z-10"
                      style={{left:`${pin.x}%`,top:`${pin.y}%`}}
                      onClick={e=>{e.stopPropagation();removePin(pin.id);}}>
                      <div className={cn(
                        "w-8 h-8 rounded-full border-2 flex items-center justify-center",
                        "font-display font-bold text-[11px] cursor-pointer",
                        "shadow-lg active:scale-90 transition-transform",
                        PIN_BG[pin.type],PIN_BORDER[pin.type],PIN_TEXT[pin.type]
                      )}>
                        {label}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Position summary tags */}
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

        {/* ── CONTEXT PANEL ──────────────────────────────────────────────── */}
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
                    {extracting&&<span className="text-primary/70 flex items-center gap-1 text-[9px]"><Sparkles className="w-3 h-3 animate-pulse"/>auto…</span>}
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

              {/* My champion */}
              <div>
                <span className="text-[10px] uppercase tracking-widest font-display text-muted-foreground">My Champion <span className="text-muted-foreground/40">(optional)</span></span>
                <button onClick={()=>setChampPickOpen(true)}
                  className={cn("w-full mt-2 py-2.5 rounded-lg border text-sm font-medium transition-all active:scale-[0.98]",
                    myChamp?"bg-amber-400/15 border-amber-400/50 text-amber-400":"bg-black/30 border-border/40 text-muted-foreground hover:border-amber-400/40")}>
                  {myChamp??"+ Select champion (optional)"}
                </button>
              </div>

              {/* Objectives */}
              <div>
                <span className="text-[10px] uppercase tracking-widest font-display text-muted-foreground">Objectives</span>
                <div className="space-y-2.5 mt-2">
                  <ObjControl label="Dragon" value={dragon} onChange={setDragon}/>
                  <ObjControl label="Baron" value={baron} onChange={setBaron}/>
                  <ObjControl label="Herald" value={herald} onChange={setHerald}/>
                </div>
              </div>

            </div>
          )}
        </div>

        {/* ── ADVISE ME ──────────────────────────────────────────────────── */}
        <button onClick={getAdvice} disabled={!canAdvise}
          className={cn("w-full h-16 rounded-xl font-display text-xl font-bold tracking-widest uppercase transition-all relative overflow-hidden",
            canAdvise?"bg-primary text-primary-foreground shadow-[0_0_30px_rgba(0,160,210,0.35)] hover:shadow-[0_0_45px_rgba(0,160,210,0.5)] active:scale-[0.98]"
            :"bg-muted text-muted-foreground cursor-not-allowed opacity-60")}>
          {isAdvising
            ?<span className="flex items-center justify-center gap-3"><Loader2 className="w-5 h-5 animate-spin"/>Analyzing…</span>
            :<span className="flex items-center justify-center gap-3"><Target className="w-5 h-5"/>Advise Me</span>}
          {canAdvise&&!isAdvising&&<span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full animate-[shimmer_2.5s_infinite]"/>}
        </button>

        {/* ── ADVICE OUTPUT ──────────────────────────────────────────────── */}
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

        {/* ── CHAT ───────────────────────────────────────────────────────── */}
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

      <ChampionPicker
        open={champPickOpen} title="Your Champion"
        selected={myChamp?[myChamp]:[]} max={1}
        onClose={()=>setChampPickOpen(false)}
        onSelect={s=>setMyChamp(s[0]??null)}
      />
    </div>
  );
}
