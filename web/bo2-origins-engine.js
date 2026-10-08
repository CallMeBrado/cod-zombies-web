import {BlackOps2Engine} from './bo2-engine.js';
const LABELS={c96_zm:'Mauser C96',c96_upgraded_zm:'Boomhilda',staff_air_zm:'Staff of Wind',staff_fire_zm:'Staff of Fire',staff_lightning_zm:'Staff of Lightning',staff_water_zm:'Staff of Ice',staff_air_upgraded_zm:'Boreas’ Fury',staff_fire_upgraded_zm:'Kagutsuchi’s Blood',staff_lightning_upgraded_zm:'Kimat’s Bite',staff_water_upgraded_zm:'Ull’s Arrow'};
export class OriginsEngine extends BlackOps2Engine {
  constructor(...args){super(...args);this.engine='black-ops-t6-origins';}
  weaponName(name){return LABELS[name]||super.weaponName(name);}
  tick(dt,input={}){super.tick(dt,{...input,movementScale:(input.movementScale??1)*(this.mapRules.mudScale||1)});}
  hitEnemy(e,damage,head=false,melee=false){
    if(this.firingNative&&this.weapon.definition.originsElement&&!melee)return;
    if(e.kind==='panzer'&&!head)damage*=.5;
    const alive=!e.dead;super.hitEnemy(e,damage,head,melee);
    if(alive&&e.dead&&e.kind==='panzer'){
      this.mapRules.collected.add('elemental_staff_fire_lower_staff');this.message('Fire Staff part recovered from the Panzer');
      this.addDrop('full_ammo',[e.position[0],e.position[1],e.position[2]+30]);
    }
  }
  fire(){
    const d=this.weapon.definition,element=d.originsElement,up=this.weapon.name.includes('upgraded');
    const fired=super.fire();if(!fired||!element)return fired;
    const range=element==='air'?400:1800,ray=this.rayHit(range),origin=[...this.player.position];origin[2]+=this.viewHeight;
    const dir=[Math.cos(this.pitch)*Math.cos(this.yaw),Math.cos(this.pitch)*Math.sin(this.yaw),Math.sin(this.pitch)];
    const end=ray.end||origin.map((v,k)=>v+dir[k]*range),radius=element==='air'?130:element==='lightning'?160:130;
    const damage=element==='air'?(up?3300:2050):(element==='fire'?1500:element==='water'?10000:2050)*(up?2:1);
    let hits=0;
    for(const e of this.enemies.filter(e=>!e.dead).sort((a,b)=>Math.hypot(...a.position.map((v,k)=>v-origin[k]))-Math.hypot(...b.position.map((v,k)=>v-origin[k])))){
      if(element==='air'&&hits>=12)break;
      const center=[e.position[0],e.position[1],e.position[2]+35],delta=center.map((v,k)=>v-origin[k]),along=delta.reduce((s,v,k)=>s+v*dir[k],0),distance=Math.hypot(...delta);
      const inside=element==='air'?distance<range&&along/distance>Math.cos((up?60:45)*Math.PI/180):Math.hypot(...center.map((v,k)=>v-end[k]))<radius;
      if(!inside||this.collision.trace(origin,center,[0,0,0],1).fraction<.98)continue;
      if(element==='water')e.paralyzedUntil=this.time+(up?5:3);
      this.hitEnemy(e,damage,false,false);hits++;
    }
    if(hits)this.emit('hit',false);
    const fx=this.data.map.staffEffects?.[element];if(fx)this.emit('effect',{name:fx,position:end,duration:1.3});
    return fired;
  }
}
