import {assetResponse} from './preload.js';
import {roundIndicatorState} from './round-hud.js';
import {scorePopupState} from './score-hud.js';
import {CrosshairHud} from './crosshair-hud.js';
import {drawCoop} from './coop-hud.js';
const icons={specialty_additionalprimaryweapon:'specialty_additionalprimaryweapon_zombies',specialty_armorvest:'specialty_juggernaut_zombies',specialty_fastreload:'specialty_fastreload_zombies',specialty_rof:'specialty_doubletap_zombies',specialty_quickrevive:'specialty_quickrevive_zombies',specialty_flakjacket:'specialty_divetonuke_zombies',specialty_longersprint:'specialty_marathon_zombies',specialty_deadshot:'specialty_ads_zombies'};
export class BlackOpsHud {
  constructor(canvas,options={}){this.folder=options.folder||'gameplay/bo1-kino';this.icons=options.icons||icons;this.scorebar=options.scorebar||'scorebar_zom_1';this.canvas=canvas;this.ctx=canvas.getContext('2d');this.images=new Map();this.crosshair=new CrosshairHud();this.ready=false;this.roundLayer=document.createElement('canvas');this.roundLayer.width=128;this.roundLayer.height=64;}
  async load(){
    // Perk icons are per map (Kino has no Stamin-Up or PhD Flopper); the rest is required.
    const icons=new Set(Object.values(this.icons));
    await Promise.all([...icons,this.scorebar,'hud_us_grenade',...[1,2,3,4,5].map(i=>'chalkmarks_'+i)].map(async name=>{
      const response=await assetResponse('/data/'+this.folder+'/hud/'+name+'.png').catch(()=>null);
      if(!response?.ok){if(icons.has(name))return;throw new Error('Missing Zombies HUD: '+name);}
      const url=URL.createObjectURL(await response.blob());try{const image=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=reject;img.src=url;});this.images.set(name,image);}finally{URL.revokeObjectURL(url);}
    }));this.ready=true;
  }
  text(text,x,y,size=20,align='left',color='#eee',ctx=this.ctx){ctx.save();ctx.font=`600 ${size}px "Arial Narrow",Arial,sans-serif`;ctx.textAlign=align;ctx.fillStyle=color;ctx.shadowColor='#000';ctx.shadowBlur=2;ctx.shadowOffsetY=1;ctx.fillText(String(text),x,y);ctx.restore();}
  draw(game,ads,hit,fov=65){
    if(!this.ready)return;const c=this.canvas,dpr=Math.min(devicePixelRatio,1.5),s=innerHeight/480,W=innerWidth/s,ctx=this.ctx;
    if(c.width!==Math.round(innerWidth*dpr)||c.height!==Math.round(innerHeight*dpr)){c.width=Math.round(innerWidth*dpr);c.height=Math.round(innerHeight*dpr);}
    ctx.setTransform(dpr*s,0,0,dpr*s,0,0);ctx.clearRect(0,0,W,480);
    const round=roundIndicatorState(game),r=this.roundLayer.getContext('2d');r.clearRect(0,0,128,64);
    if(round.round<=10){r.drawImage(this.images.get('chalkmarks_'+Math.min(round.round,5)),0,0,64,64);if(round.round>5)r.drawImage(this.images.get('chalkmarks_'+(round.round-5)),58,0,64,64);}else this.text(round.round,5,55,38,'left','#fff',r);
    r.globalCompositeOperation='source-in';r.fillStyle=round.color;r.fillRect(0,0,128,64);r.globalCompositeOperation='source-over';ctx.globalAlpha=round.alpha;if(!game.mapRules.earth)ctx.drawImage(this.roundLayer,10,406);ctx.globalAlpha=1;
    let slot=0;for(const id of game.mapRules.perks){const image=this.images.get(this.icons[id]);if(image)ctx.drawImage(image,12+slot++*28,379,24,24);}
    ctx.drawImage(this.images.get(this.scorebar),W-125,383,110,18);this.text(game.player.points,W-27,398,21,'right');
    if(game.coopHud)drawCoop(this,ctx,game.coopHud,W,s);
    this.text(game.weapon.name.startsWith('slowgun')?Math.floor(game.paralyzerHeat):game.weapon.clip,W-88,456,32,'right');this.text(game.weapon.name.startsWith('slowgun')?' / 115':'/ '+game.weapon.reserve,W-81,456,19);this.text(game.weaponName(game.weapon.name),W-25,472,10,'right','#aaa');
    ctx.drawImage(this.images.get('hud_us_grenade'),W-38,418,13,15);this.text(game.player.grenades,W-43,430,13,'right');
    for(const p of game.scorePopups){const v=scorePopupState(p,game.time);if(v){ctx.globalAlpha=v.alpha;this.text(v.text,W-28+v.x,398+v.y,19,'right',v.color);}}ctx.globalAlpha=1;
    const cx=W/2,cy=240,v=this.crosshair.state(game,ads,fov);
    if((ads<.8||v.cooking)&&!game.reloadEnd){ctx.globalAlpha=v.alpha;ctx.strokeStyle='#eee';ctx.lineWidth=.7;ctx.beginPath();for(const sign of [-1,1]){ctx.moveTo(cx+sign*v.gap,cy);ctx.lineTo(cx+sign*(v.gap+5),cy);ctx.moveTo(cx,cy+sign*v.gap);ctx.lineTo(cx,cy+sign*(v.gap+5));}ctx.stroke();ctx.globalAlpha=1;}
    if(hit){ctx.strokeStyle='#ddd';ctx.beginPath();for(const x of [-1,1])for(const y of [-1,1]){ctx.moveTo(cx+x*3,cy+y*3);ctx.lineTo(cx+x*6,cy+y*6);}ctx.stroke();}
    if(!game.events.controllerPrompts?.())this.text(game.prompt(),cx,294,14,'center');if(!game.mapRules.afterlife&&!game.weapon.clip&&!game.reloadEnd&&!game.events.controllerPrompts?.())this.text((game.events.bindingName?.('reload')||'R')+' · Reload',cx,276,14,'center');
    if(game.data.map.id==='moon'){const r=game.mapRules;if(r.equipment)this.text((r.equipment==='pes'?(r.pes?'P.E.S. ACTIVE':'P.E.S. · '+(game.events.bindingName?.('equipment')||'5')):'HACKER'),12,360,12);if(r.oxygen>5)this.text('OXYGEN '+Math.max(0,Math.ceil((r.perks.has('specialty_armorvest')?17:15)-r.oxygen)),cx,75,20,'center','#f66');if(game.weapon.definition.alternate)this.text((game.events.bindingName?.('alternateWeapon')||'4')+' · '+(game.weapon.name.startsWith('microwavegundw')?'Combine Wave Gun':'Split Zap Guns'),cx,320,12);}
    const left=game.mapRules.projectionUntil-game.time;if(left>0)this.text('TELEPORTING IN '+Math.ceil(left),cx,50,17,'center');
    if(game.data.map.id==='five'){this.text('DEFCON '+game.mapRules.defcon,cx,35,16,'center');if(game.mapRules.thiefRound)this.text('PENTAGON THIEF',cx,55,13,'center','#e8b57b');if(game.mapRules.trapCarry!=null)this.text('TRAP PART',12,360,12);}
    const active=Object.entries(game.powerup).map(([k,t])=>k.replaceAll('_',' ')+' '+Math.ceil(t-game.time));if(game.mapRules.deathMachine)active.push('DEATH MACHINE '+Math.ceil(game.mapRules.deathMachineUntil-game.time));if(active.length)this.text(active.join('   '),cx,455,14,'center');
  }
}
