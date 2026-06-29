// This shows the key section from coach.tsx (lines 2142-2410) with the fix applied
// The minimap + buttons layout needs to be restructured from:
// 
// <div className="grid grid-cols-[1fr_auto] gap-1 items-stretch min-w-0">
//   <div>MINIMAP</div>
//   <div>BENCH ZONE</div>
//   <div>BUTTONS</div>
// </div>
//
// TO:

<div className="flex gap-3 items-stretch min-w-0">
  {/* Main minimap container - flex grow */}
  <div className="flex-1 flex flex-col gap-1 min-w-0">
    {/* Minimap image wrapper */}
    <div ref={minimapDivRef}
      className={cn("relative min-w-0 select-none",
        placeMode?"cursor-crosshair":"cursor-default")}
      style={{WebkitTouchCallout:"none"} as React.CSSProperties}
      onClick={handleMinimapTap}
      onContextMenu={e=>e.preventDefault()}
      onTouchStart={handleMinimapTouchStart}
      onTouchMove={handleMinimapTouchMove}
      onTouchEnd={handleMinimapTouchEnd}>
      {/* X button - top-right corner */}
      {minimapBase64&&(
        <button
          className="absolute top-1 right-1 z-20 w-11 h-11 rounded-full bg-black/75 border border-white/30 flex items-center justify-center text-white hover:bg-black/95 active:scale-95"
          title="Clear image & upload new screenshot"
          onClick={e=>{e.stopPropagation();setImageBase64(null);setMinimapBase64(null);setGameTimeCrop(null);setPortraitStripCrop(null);setAlliesDown([]);setEnemiesDown([]);setTimeout(()=>fileInputRef.current?.click(),100);}}
          >
          <X className="w-5 h-5"/>
        </button>
      )}
      {/* Minimap image */}
      <div className="rounded-lg overflow-hidden border border-border/30">
        {minimapBase64?(
          <img src={minimapBase64} alt="Minimap" className="w-full h-auto block pointer-events-none select-none" draggable={false}/>
        ):(
          <div className="w-full aspect-square bg-slate-900/80 flex items-center justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground/40"/>
          </div>
        )}
      </div>
      {/* Pins and overlays rendered on minimap */}
      {pins.map(pin => (/* ... pin rendering code ... */))}
      {objPins.map(pin => (/* ... obj pin rendering code ... */))}
      {/* Towers */}
      {(["ally","enemy"] as const).map(team => /* ... tower rendering ... */)}
    </div>

    {/* Bench zone - below minimap on desktop, but in a sidebar on larger screens */}
    <div ref={benchRef}
      className="relative w-full h-16 shrink-0 rounded-lg border-2 border-dashed border-border/30 bg-black/20">
      {/* Bench zone content */}
    </div>
  </div>

  {/* RIGHT SIDEBAR: Buttons positioned to the right of minimap + bench */}
  <div className="flex flex-col gap-1 justify-end shrink-0 self-stretch">
    {(["me","ally","enemy","obj","ally_wave","enemy_wave"] as const).map(type=>{
      const cfg=PLACE_CFG[type];
      const active=placeMode===type;
      const count=type==="me"?(myPin?1:0):type==="ally"?allyPins.length:type==="enemy"?enemyPins.length:type==="obj"?objPins.length:type==="ally_wave"?allyWavePins.length:enemyWavePins.length;
      const label=type==="me"?"Me":type==="ally"?"Ally":type==="enemy"?"Enemy":type==="obj"?"Obj":type==="ally_wave"?"A≋":"E≋";
      return(
        <button key={type}
          onClick={()=>setPlaceMode(p=>p===type?null:type)}
          className={cn("relative flex items-center gap-1 px-2 py-1.5 rounded-lg border text-[9px] font-bold transition-all active:scale-95 font-display w-14",
            active?cfg.active:`bg-black/30 ${cfg.idle}`)}>
          {type==="me"&&<UserRound className="w-2.5 h-2.5 shrink-0"/>}
          {type==="ally"&&<Users className="w-2.5 h-2.5 shrink-0"/>}
          {type==="enemy"&&<Swords className="w-2.5 h-2.5 shrink-0"/>}
          {type==="obj"&&<Target className="w-2.5 h-2.5 shrink-0"/>}
          {(type==="ally_wave"||type==="enemy_wave")&&<span className="text-[10px] leading-none shrink-0">≋</span>}
          <span className="leading-none truncate">{label}</span>
          {count>0&&<span className={cn("absolute -top-1 -right-1 min-w-[13px] h-3.5 rounded-full px-0.5 text-[8px] font-bold flex items-center justify-center text-black",cfg.dot)}>{count}</span>}
        </button>
      );
    })}
  </div>
</div>

// KEY CHANGES:
// 1. Changed outer wrapper from "grid grid-cols-[1fr_auto]" to "flex gap-3"
// 2. Moved buttons to a RIGHT SIDEBAR after the minimap/bench
// 3. Added "flex-1 flex flex-col" to minimap container so it grows to fill available space
// 4. Bench zone now sits below minimap in a column
// 5. Buttons are in a separate "flex flex-col gap-1 justify-end shrink-0" container on the RIGHT
// 6. Added "self-stretch" so the button column stretches to match minimap height
// 7. Added "justify-end" so buttons align to the bottom of the minimap area
