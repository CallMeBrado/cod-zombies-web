import {get} from './assets.js';
import {assetResponse} from './preload.js';
import {roundIndicatorState} from './round-hud.js';
import {scorePopupState} from './score-hud.js';
import {CrosshairHud} from './crosshair-hud.js';
import {drawCoop} from './coop-hud.js';
const perkIcons={specialty_armorvest:'specialty_juggernaut_zombies',specialty_fastreload:'specialty_fastreload_zombies',specialty_rof:'specialty_doubletap_zombies'};
const loadImage=async src=>{
  const response=await assetResponse(src);if(!response.ok)throw new Error(`Missing HUD image: ${src}`);
  const url=URL.createObjectURL(await response.blob());
  try{return await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=reject;image.src=url;});}
  finally{URL.revokeObjectURL(url);}
};
export class OriginalHud {
  constructor(canvas){this.canvas=canvas;this.ctx=canvas.getContext('2d');this.ready=false;this.images=new Map();this.crosshair=new CrosshairHud();
    this.roundLayer=document.createElement('canvas');this.roundLayer.width=128;this.roundLayer.height=64;this.roundCtx=this.roundLayer.getContext('2d');}
  async loadFont() {
    if(this.fontReady)return;
    this.font=await get('/data/ui/fonts/normalFont.json',true);this.glyphs=new Map(this.font.glyphs.map(g=>[g.letter,g]));
    this.atlas=await loadImage('/data/gameplay/hud/gamefonts_pc.png');
    this.tintedAtlases=new Map(['#e6e600','#6c0100'].map(color=>{
      const tint=document.createElement('canvas');tint.width=this.atlas.width;tint.height=this.atlas.height;
      const ctx=tint.getContext('2d');ctx.drawImage(this.atlas,0,0);ctx.globalCompositeOperation='source-in';ctx.fillStyle=color;ctx.fillRect(0,0,tint.width,tint.height);
      return [color,tint];
    }));
    this.fontReady=true;
  }
  async load() {
    await this.loadFont();
    await Promise.all(['ammocounterback','scorebar_zom_1','hud_us_grenade',...Object.values(perkIcons),...[1,2,3,4,5].map(i=>'chalkmarks_'+i)].map(async name=>{
      const image=await loadImage('/data/gameplay/hud/'+name+'.png');
      if(name.startsWith('chalk')||name.startsWith('scorebar')){
        const tint=document.createElement('canvas');tint.width=image.width;tint.height=image.height;const ctx=tint.getContext('2d');ctx.drawImage(image,0,0);ctx.globalCompositeOperation='source-in';ctx.fillStyle=name.startsWith('chalk')?'#ffffff':'#6c0100';ctx.fillRect(0,0,tint.width,tint.height);this.images.set(name,tint);
      }else this.images.set(name,image);
    }));
    // _zombiemode_timer.gsc stopwatch art is Der Riese's; Nacht never shows it.
    await Promise.all(['zombie_stopwatch','zombie_stopwatchneedle','zombie_stopwatch_glass'].map(name=>loadImage('/data/gameplay/hud/'+name+'.png').then(image=>this.images.set(name,image),()=>{})));
    this.ready=true;
  }
  // start_timer(): a 96x96 stopwatch at (10,20) whose needle shows the seconds
  // remaining on a 60-second dial, under its glass.
  stopwatch(ctx,remaining){
    const x=10,y=20,size=96,face=this.images.get('zombie_stopwatch'),needle=this.images.get('zombie_stopwatchneedle'),glass=this.images.get('zombie_stopwatch_glass');if(!face||!needle)return;
    ctx.drawImage(face,x,y,size,size);ctx.save();ctx.translate(x+size/2,y+size/2);ctx.rotate(remaining/60*Math.PI*2);ctx.drawImage(needle,-size/2,-size/2,size,size);ctx.restore();if(glass)ctx.drawImage(glass,x,y,size,size);
  }
  tint(color){
    if(!color)return this.atlas;let atlas=this.tintedAtlases.get(color);if(atlas)return atlas;
    atlas=document.createElement('canvas');atlas.width=this.atlas.width;atlas.height=this.atlas.height;const ctx=atlas.getContext('2d');ctx.drawImage(this.atlas,0,0);ctx.globalCompositeOperation='source-in';ctx.fillStyle=color;ctx.fillRect(0,0,atlas.width,atlas.height);this.tintedAtlases.set(color,atlas);return atlas;
  }
  text(value,x,y,size=20,align='left',color=null,ctx=this.ctx) {
    const atlas=this.tint(color);
    const s=size/this.font.pixelHeight,letters=[...String(value)].map(c=>this.glyphs.get(c)||this.glyphs.get(' '));
    const width=letters.reduce((sum,g)=>sum+g.dx*s,0);if(align==='right')x-=width;if(align==='center')x-=width/2;
    for(const g of letters){if(g.pixelWidth)ctx.drawImage(atlas,g.s0*atlas.width,g.t0*atlas.height,(g.s1-g.s0)*atlas.width,(g.t1-g.t0)*atlas.height,x+g.x0*s,y+g.y0*s,g.pixelWidth*s,g.pixelHeight*s);x+=g.dx*s;}
  }
  draw(game,ads,hit,verticalFov=65) {
    if(!this.ready)return;const c=this.canvas,w=innerWidth,h=innerHeight,dpr=Math.min(devicePixelRatio,1.5);
    if(c.width!==Math.round(w*dpr)||c.height!==Math.round(h*dpr)){c.width=Math.round(w*dpr);c.height=Math.round(h*dpr);}
    const ctx=this.ctx,s=h/480,W=w/s;ctx.setTransform(dpr*s,0,0,dpr*s,0,0);ctx.clearRect(0,0,W,480);
    const indicator=roundIndicatorState(game),round=indicator.round;const image=(name,x,y,width,height)=>ctx.drawImage(this.images.get(name),x,y,width,height);
    const chalk=this.roundCtx;chalk.clearRect(0,0,128,64);
    if(round<=10){chalk.drawImage(this.images.get('chalkmarks_'+Math.min(5,round)),0,0,64,64);if(round>5)chalk.drawImage(this.images.get('chalkmarks_'+(round-5)),58,0,64,64);}else this.text(round,6,58,36,'left',null,chalk);
    chalk.globalCompositeOperation='source-in';chalk.fillStyle=indicator.color;chalk.fillRect(0,0,128,64);chalk.globalCompositeOperation='source-over';
    ctx.globalAlpha=indicator.alpha;ctx.drawImage(this.roundLayer,10,406);
    ctx.globalAlpha=1;
    if(game.mapRules){let slot=0;for(const perk of game.mapRules.perks)if(perkIcons[perk])image(perkIcons[perk],10+slot++*30,382,24,24);
      // teleport_pad_countdown runs the timer for time+1 (31 s) for VO sync.
      if(game.mapRules.linkPending)this.stopwatch(ctx,Math.max(0,game.mapRules.linkPending.started+31-game.time));}
    image('ammocounterback',W-145,429,128,32);image('scorebar_zom_1',W-105,378,94,16);
    this.text(game.player.points,W-96,390,21);
    if(game.coopHud)drawCoop(this,ctx,game.coopHud,W,s);
    for(const popup of game.scorePopups){const state=scorePopupState(popup,game.time);if(!state)continue;
      ctx.globalAlpha=state.alpha;this.text(state.text,W-103+state.x,390+state.y,21,'right',state.color);
    }ctx.globalAlpha=1;
    this.text(game.weapon.clip+' / '+game.weapon.reserve,W-130,459,20);
    image('hud_us_grenade',W-45,452,15,15);this.text(game.player.grenades,W-23,464,13);
    const cx=W/2,cy=240;
    const crosshair=this.crosshair.state(game,ads,verticalFov);
    if((ads<.8||crosshair.cooking)&&!game.reloadEnd){const {gap,alpha}=crosshair;ctx.globalAlpha=alpha;ctx.strokeStyle='#f4f4ed';ctx.lineWidth=.7;ctx.beginPath();ctx.moveTo(cx-gap-4,cy);ctx.lineTo(cx-gap,cy);ctx.moveTo(cx+gap,cy);ctx.lineTo(cx+gap+4,cy);ctx.moveTo(cx,cy-gap-4);ctx.lineTo(cx,cy-gap);ctx.moveTo(cx,cy+gap);ctx.lineTo(cx,cy+gap+4);ctx.stroke();ctx.globalAlpha=1;}
    if(hit){ctx.strokeStyle='#ddd';ctx.lineWidth=1;ctx.beginPath();for(const x of [-1,1])for(const y of [-1,1]){ctx.moveTo(cx+x*3,cy+y*3);ctx.lineTo(cx+x*6,cy+y*6);}ctx.stroke();}
    const prompt=game.prompt();if(prompt&&!game.events.controllerPrompts?.())this.text(prompt,cx,294,16,'center');
    if(game.weapon.clip===0&&!game.reloadEnd&&!game.events.controllerPrompts?.())this.text((game.events.bindingName?.('reload')||'R')+' · Reload',cx,275,16,'center');
    const active=Object.entries(game.powerup).map(([name,due])=>name.replaceAll('_',' ')+' '+Math.ceil(due-game.time));
    if(active.length)this.text(active.join('  '),cx,457,14,'center');
  }
}
