// Co-op HUD, drawn by either game's HUD with its own text style: teammates'
// scores stacked above this player's, names over teammates, a revive marker
// over downed ones, this player's bleed-out count and the revive progress.
export function drawCoop(hud,ctx,info,W,scale){
  let row=0;
  for(const p of info.rows){if(p.local)continue;row++;
    const y=390-row*20;hud.text(p.points,W-27,y,17,'right',p.color);hud.text(p.down?'DOWN':p.dead?'DEAD':p.name,W-110,y,11,'right',p.down||p.dead?'#ff5040':p.color);}
  for(const m of info.markers){
    const x=m.x/scale,y=m.y/scale;if(m.distance>2500&&!m.down)continue;
    if(m.down){hud.text('REVIVE '+m.name,x,y-12,13,'center','#ff3a2a');hud.text(m.bleed+'s',x,y+2,11,'center','#ff8a7a');}
    else hud.text(m.name,x,y,11,'center',m.color);
  }
  const cx=W/2;
  if(info.down!==null){hud.text('YOU ARE DOWN',cx,170,20,'center','#ff3a2a');hud.text('Bleeding out in '+info.down+'s · a teammate must revive you',cx,190,12,'center','#ffb0a0');}
  if(info.dead){hud.text('YOU BLED OUT',cx,170,20,'center','#ff3a2a');hud.text('You will respawn at the start of the next round',cx,190,12,'center','#ffb0a0');}
  if(info.revive){
    hud.text('Hold '+info.revive.key+' to revive '+info.revive.name,cx,318,14,'center','#ffffff');
    if(info.revive.progress>0){ctx.fillStyle='#0008';ctx.fillRect(cx-60,326,120,6);ctx.fillStyle='#f4f4ed';ctx.fillRect(cx-60,326,120*Math.min(1,info.revive.progress),6);}
  }
}
