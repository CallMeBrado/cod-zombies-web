import {BlackOps2Engine} from './bo2-engine.js';
export class MobEngine extends BlackOps2Engine {
  constructor(...args){super(...args);this.engine='black-ops-t6-mob';}
  start(){const fresh=this.phase==='ready';super.start();if(fresh)this.mapRules.enterAfterlife(true);}
  startRound(){if(this.mapRules.afterlife){this.roundDue=this.time+.1;return;}super.startRound();}
  nearWindow(){return this.mapRules.afterlife?null:super.nearWindow();}
  fire(){
    if(!this.mapRules.afterlife)return super.fire();
    if(['ready','dead'].includes(this.phase)||this.gesture||this.switching||this.time<this.cooldown)return false;
    this.cooldown=this.time+this.weapon.definition.fireTime;this.sprinting=false;this.shots++;
    const origin=this.player.position.slice();origin[2]+=this.viewHeight;const dir=[Math.cos(this.pitch)*Math.cos(this.yaw),Math.cos(this.pitch)*Math.sin(this.yaw),Math.sin(this.pitch)];
    this.mapRules.afterlife.mana=Math.max(0,this.mapRules.afterlife.mana-1);this.emit('shot',{origin,dir,rays:[]});this.emit('sound',{alias:'wpn_lightninghand_loop_plr'});this.mapRules.shock();return true;
  }
  hitEnemy(e,damage,head=false,melee=false){
    if(this.firingNative&&this.mapRules.afterlife)return;
    if(e.kind==='brutus'&&head&&e.helmet>0&&!melee){e.helmet--;if(!e.helmet){this.changePoints(250);this.emit('sound',{alias:'zmb_ai_brutus_headpain'});}damage*=.1;}
    const alive=!e.dead;super.hitEnemy(e,damage,head,melee);
    if(alive&&e.dead&&e.kind==='brutus'){this.changePoints(750);this.addDrop('full_ammo',[e.position[0],e.position[1],e.position[2]+30]);}
  }
  melee(){if(this.mapRules.afterlife)return this.fire();return super.melee();}
  throwGrenade(...a){if(this.mapRules.afterlife)return false;return super.throwGrenade(...a);}
  switchWeapon(...a){if(this.mapRules.afterlife)return false;return super.switchWeapon(...a);}
  tickEnemy(e,dt){
    if(this.mapRules.afterlife&&!e.dead){e.age+=dt;return;}
    if(e.kind==='brutus'&&!e.dead){
      const r=this.mapRules,target=this.interactions.filter(x=>x.target&&!r.locked.has(x.target)&&['zombie_vending','treasure_chest_use','open_craftable_trigger'].includes(x.targetname)&&r.visible(x)).find(x=>Math.hypot(...x.position.map((v,k)=>v-e.position[k]))<90);
      if(target&&this.time>=(e.lockDue||0)){r.locked.add(target.target);e.lockDue=this.time+8;this.emit('sound',{alias:'zmb_ai_brutus_lock',position:e.position});}
    }super.tickEnemy(e,dt);
    // Dense prison props can strand a hull even when the graph has a route.
    // Retry a stalled arrival through an authored spawn, preserving its health
    // and round slot instead of moving it through the obstruction.
    if(!e.dead&&e.kind!=='brutus'&&e.stage==='hunt'){
      const progress=e.mobProgress,far=Math.hypot(...e.position.map((v,k)=>v-this.player.position[k]))>110;
      if(!far||!progress||Math.hypot(...e.position.map((v,k)=>v-progress.position[k]))>12)e.mobProgress={at:this.time,position:e.position.slice()};
      else if(this.time-progress.at>10){e.dead=true;e.deathTime=this.time;this.recycleHealth.push(e.health);this.remaining++;this.emit('removeEnemy',e);}
    }
  }
  meleeAnims(e){return e.kind==='brutus'?['ai_zombie_attack_v1','ai_zombie_attack_v2']:super.meleeAnims(e);}
  tick(dt,input={}){
    if(this.mapRules.afterlife&&input.jump&&this.player.grounded){this.player.velocityZ=420;this.player.grounded=false;}
    const wasReloading=this.reloadEnd;super.tick(dt,input);
    if(wasReloading&&!this.reloadEnd&&this.mapRules.perks.has('specialty_grenadepulldeath'))for(const e of this.enemies)if(!e.dead&&Math.hypot(...e.position.map((v,k)=>v-this.player.position[k]))<180)e.paralyzedUntil=this.time+2;
  }
}
