// Green Run Survival: zm_transit_standard_town.gsc and zm_transit_lava.gsc.
import {KinoRules} from './bo1-engine.js';
import {NuketownRules} from './bo2-nuketown.js';
const inside=(p,h)=>h.mins.every((v,k)=>p[k]>=v)&&h.maxs.every((v,k)=>p[k]<=v)&&h.planes.every(q=>q[0]*p[0]+q[1]*p[1]+q[2]*p[2]<=q[3]+1);
const distance=(a,b)=>Math.hypot(...a.map((v,k)=>v-b[k]));
export class TownRules extends KinoRules {
  get maxHealth(){return this.perks.has('specialty_armorvest')?250:100;}
  reset(){super.reset();this.power=true;this.flags.add('power_on');this.powerStartedAt=0;this.lavaDue=0;this.meleeUpgrade=null;this.salePlaying=false;this.burnDeaths=new Set();}
  negotiationLink(a,b,l){return NuketownRules.prototype.negotiationLink.call(this,a,b,l);}
  startTraversal(e){return NuketownRules.prototype.startTraversal.call(this,e);}
  advanceTraversal(e){return NuketownRules.prototype.advanceTraversal.call(this,e);}
  visible(e){if(e.targetname==='treasure_chest_use'&&this.game.powerup.fire_sale)return true;return super.visible(e);}
  prompt(e,key){
    const g=this.game;
    if(e.targetname==='treasure_chest_use'&&g.powerup.fire_sale&&g.boxes.get(e.target)?.phase==='closed')return key+' · Mystery box · 10 points';
    if(e.targetname==='zombie_vending_upgrade')return this.pap?(this.pap.phase==='ready'?key+' · Take '+g.weaponName(this.pap.upgraded):'Pack-a-Punch · upgrading…'):g.weapon.definition.upgrade?key+' · Pack-a-Punch · 5000 points':'No further upgrade available';
    if(e.targetname==='zombie_vending'&&e.script_noteworthy==='specialty_rof')return this.perks.has('specialty_rof')?'Double Tap II purchased':key+' · Buy Double Tap II · 2000 points';
    if(e.zombie_weapon_upgrade==='tazer_knuckles_zm')return this.meleeUpgrade==='tazer_knuckles_zm'?'Galvaknuckles purchased':key+' · Buy Galvaknuckles · 6000 points';
    if(e.zombie_weapon_upgrade==='sticky_grenade_zm')return 'Semtex is not available in this build yet';
    return super.prompt(e,key);
  }
  use(e){
    const g=this.game;
    if(e.zombie_weapon_upgrade==='tazer_knuckles_zm'){if(this.meleeUpgrade!=='tazer_knuckles_zm'&&g.spendPoints(6000)){this.meleeUpgrade='tazer_knuckles_zm';g.message('Galvaknuckles purchased');}return true;}
    if(e.zombie_weapon_upgrade==='sticky_grenade_zm')return true;
    if(e.targetname==='zombie_vending'&&this.perks.size>=4)return true;
    return super.use(e);
  }
  boxCost(e){return this.game.powerup.fire_sale?10:Number(e.zombie_cost)||950;}
  boxJoker(){return NuketownRules.prototype.boxJoker.call(this);}
  lavaAt(p){return this.data.hazards.find(v=>v.hulls.some(h=>inside([p[0],p[1],p[2]+3],h)));}
  tick(){
    super.tick();const g=this.game;if(g.mirror||g.phase==='ready'||g.phase==='dead')return;
    const sale=!!g.powerup.fire_sale;if(sale!==this.salePlaying){this.salePlaying=sale;g.emit(sale?'loop':'stopLoop',sale?{id:'town_sale',alias:'mus_fire_sale'}:{id:'town_sale'});}
    if(g.time>=this.lavaDue){
      this.lavaDue=g.time+.5;const lava=this.lavaAt(g.player.position);if(lava&&!this.reviveDue)g.damagePlayer(15*lava.multiplier);
      let burning=g.enemies.filter(e=>!e.dead&&e.townBurning).length;
      for(const e of g.enemies){
        if(e.dead)continue;const ground=this.lavaAt(e.position);
        if(ground&&!e.townBurning&&burning<6&&e.health>g.zombieHealth*.5){e.townBurning=true;burning++;g.emit('sound',{alias:'zmb_zombie_ignite',position:e.position});}
        if(e.townBurning&&e.health>g.zombieHealth*.5)e.health=Math.max(g.zombieHealth*.5,e.health-(ground?.multiplier||1));
        if(e.townBurning&&distance(e.position,g.player.position)<25)g.damagePlayer(2,{from:e.position});
      }
    }
    const retained=new Set(g.enemies.map(e=>e.id));for(const id of this.burnDeaths)if(!retained.has(id))this.burnDeaths.delete(id);
    for(const e of g.enemies)if(e.dead&&e.townBurning&&!this.burnDeaths.has(e.id)){
      this.burnDeaths.add(e.id);g.emit('explosion',{position:[e.position[0],e.position[1],e.position[2]+25],townLava:true});g.emit('sound',{alias:'zmb_zombie_explode',position:e.position});
      const d=distance(e.position,g.player.position);if(d<128&&g.collision.trace([e.position[0],e.position[1],e.position[2]+35],[g.player.position[0],g.player.position[1],g.player.position[2]+35],[0,0,0],1).fraction>.98)g.damagePlayer(30-15*d/128,{from:e.position});
    }
  }
  saveState(){return {...super.saveState(),lavaDue:this.lavaDue,meleeUpgrade:this.meleeUpgrade,burnDeaths:[...this.burnDeaths]};}
  loadState(s){super.loadState(s);this.power=true;this.flags.add('power_on');this.lavaDue=s.lavaDue??0;this.meleeUpgrade=s.meleeUpgrade??null;this.burnDeaths=new Set(s.burnDeaths||[]);this.salePlaying=false;}
}
