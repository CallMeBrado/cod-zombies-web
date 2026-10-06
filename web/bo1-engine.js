import {TestingGame} from './testing.js';
import {FactoryRules,PERKS} from './map-rules.js';

const pos=e=>e.origin.split(/\s+/).map(Number);
const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));

// T5's theater owns its progression, solo perks and teleporter lifecycle.
// Rendering, original animation decoding and fixed-step hull physics are shared.
export class KinoRules extends FactoryRules {
  reset(){
    super.reset();this.flags.add('always_on');this.coreLinked=false;this.teleporterLinked=false;
    this.projectionUntil=0;this.revivesUsed=0;this.reviveDue=0;this.papOn=false;
  }
  visible(e){
    if(e.targetname==='use_power_switch')return !this.power;
    if(e.targetname==='treasure_chest_use')return e.target===this.data.initialBox;
    if(e.targetname==='zombie_vending'&&e.script_noteworthy==='specialty_quickrevive')return this.revivesUsed<3;
    return !e.script_noteworthy?.includes('electric_door');
  }
  prompt(e,key){
    if(e.targetname==='use_power_switch')return key+' · Turn on the power';
    if(e.targetname==='zombie_vending'){
      const p=PERKS[e.script_noteworthy],quick=e.script_noteworthy==='specialty_quickrevive';
      if(!p)return '';if(this.perks.has(e.script_noteworthy))return p.name+' purchased';
      if(!this.power&&!quick)return 'You must turn on the power first';
      return key+' · Buy '+p.name+' · '+(quick?500:p.cost)+' points';
    }
    if(e.targetname==='trigger_teleport_pad_0'){
      if(!this.power)return 'You must turn on the power first';
      if(this.game.time<this.teleportCooldown)return 'Teleporter cooling down · '+Math.ceil(this.teleportCooldown-this.game.time)+'s';
      return key+(this.teleporterLinked?' · Teleport to projection room':' · Initiate link to pad');
    }
    if(e.targetname==='trigger_teleport_core')return !this.power?'You must turn on the power first':this.coreLinked?key+' · Link mainframe to teleporter':'Initiate the link at the theater teleporter';
    if(e.targetname==='zombie_vending_upgrade'){
      if(this.pap)return this.pap.phase==='ready'?key+' · Take '+this.game.weaponName(this.pap.upgraded):'Pack-a-Punch · upgrading…';
      if(this.game.weapon.name==='m1911_zm')return 'Mustang & Sally is not available in this preview yet.';
      return this.game.weapon.definition.upgrade?key+' · Pack-a-Punch · 5000 points':'No further upgrade available';
    }
    return null;
  }
  use(e){
    const g=this.game,tag=e.targetname;
    if(tag==='use_power_switch'){
      if(this.power)return true;this.power=true;this.powerStartedAt=g.time;this.flags.add('power_on');
      this.openTargets(this.data.powerTargets);g.emit('power');g.emit('sound',{alias:'switch_flip'});g.emit('sound',{alias:'electrical_surge'});g.message('Power restored');return true;
    }
    if(tag==='zombie_vending'){
      const id=e.script_noteworthy,p=PERKS[id],quick=id==='specialty_quickrevive';
      if(!p||this.perks.has(id)||(!this.power&&!quick)||g.gesture||quick&&this.revivesUsed>=3)return true;
      if(!g.spendPoints(quick?500:p.cost))return true;
      g.startGesture(id,()=>{this.perks.add(id);if(id==='specialty_armorvest')g.player.health=250;});g.emit('sound',{alias:p.sting});return true;
    }
    if(tag==='trigger_teleport_pad_0'){
      if(!this.power||g.time<this.teleportCooldown||this.teleportDue)return true;
      if(!this.teleporterLinked){this.coreLinked=true;g.message('Link the mainframe pad in the lobby.');g.emit('sound',{alias:'evt_teleporter_activate_start'});}
      else{this.teleportDue=g.time+1.8;g.message('Teleporting…');g.emit('sound',{alias:'evt_teleporter'});}return true;
    }
    if(tag==='trigger_teleport_core'){
      if(this.power&&this.coreLinked){this.teleporterLinked=true;this.coreLinked=false;g.message('Teleporter linked');g.emit('sound',{alias:'evt_teleporter_activate_finish'});g.emit('power');}return true;
    }
    if(tag==='zombie_vending_upgrade'){
      if(this.pap){if(this.pap.phase==='ready')this.takeUpgrade();return true;}
      const w=g.weapon,upgraded=w.definition.upgrade;if(!upgraded||!this.power||g.gesture||!g.spendPoints(5000))return true;
      const machine=g.entities.find(x=>x.targetname===e.target),origin=machine?pos(machine):pos(e);
      g.inventory.splice(g.slot,1);if(!g.inventory.length)g.inventory.push(g.makeWeapon(g.data.startWeapon));g.slot=0;
      this.pap={phase:'in',started:g.time,weapon:w.name,upgraded,at:pos(e),origin:[origin[0],origin[1],origin[2]+35],playerYaw:g.yaw*180/Math.PI,yaw:Number((machine?.angles||'0 0 0').split(' ')[1])+90};
      g.startGesture('knuckle_crack');g.emit('weapon',g.weapon);return true;
    }
    if(e.zombie_weapon_upgrade==='frag_grenade_zm'){if(g.player.grenades<4&&g.spendPoints(250))g.player.grenades=4;return true;}
    if(e.zombie_weapon_upgrade==='bowie_knife_zm'){if(g.spendPoints(3000)){for(const w of g.inventory)w.definition={...w.definition,meleeDamage:300};g.message('Bowie knife purchased');}return true;}
    if(e.zombie_weapon_upgrade==='claymore_zm'){g.message('Claymores are not available in this preview.');return true;}
    return false;
  }
  teleport(at){
    const g=this.game,floor=g.collision.move(at,[0,0,-64]);
    if(!floor.grounded)throw new Error('Kino teleporter destination has no floor.');
    Object.assign(g.player,{position:floor.position,previousPosition:floor.position.slice(),velocityZ:0,grounded:true});
    g.targetNode=-1;g.targetNodeDue=0;g.spawnDistanceCache=null;g.emit('teleport');
  }
  tick(){
    const g=this.game;
    if(this.power&&!this.papOn){
      this.papOn=true;for(const e of g.interactions.filter(e=>['zombie_vending','zombie_vending_upgrade'].includes(e.targetname)))g.emit('sound',{alias:'perks_power_on',position:pos(e),near:40,far:500});
      const pap=g.interactions.find(e=>e.targetname==='zombie_vending_upgrade');if(pap)g.emit('loop',{id:'kino_pap_rollers',alias:'packa_rollers_loop',position:pos(pap),near:40,far:400});
    }
    if(this.teleportDue&&g.time>=this.teleportDue){this.teleportDue=0;this.teleportCooldown=g.time+90;this.projectionUntil=g.time+30;this.teleporterLinked=false;this.teleport(this.data.teleportDestination);g.message('Projection room · 30 seconds');}
    if(this.projectionUntil&&g.time>=this.projectionUntil){this.projectionUntil=0;this.teleport(this.data.teleportReturn);g.message('Returned to the lobby');}
    if(this.reviveDue&&g.time>=this.reviveDue){this.reviveDue=0;g.player.health=100;g.lastDamage=g.time;g.emit('weapon',g.weapon);g.message('Revived · '+(3-this.revivesUsed)+' Quick Revives remaining');}
    this.updateUpgrade();
  }
  saveState(){return {...super.saveState(),coreLinked:this.coreLinked,teleporterLinked:this.teleporterLinked,projectionUntil:this.projectionUntil,revivesUsed:this.revivesUsed,reviveDue:this.reviveDue};}
  loadState(s){super.loadState(s);for(const key of ['coreLinked','teleporterLinked','projectionUntil','revivesUsed','reviveDue'])this[key]=s[key]??0;}
  get announcer(){return {full_ammo:'zmb_vox_ann_maxammo',insta_kill:'zmb_vox_ann_instakill',double_points:'zmb_vox_ann_doublepoints',nuke:'zmb_vox_ann_nuke',carpenter:'zmb_vox_ann_carpenter'};}
}

export class BlackOpsEngine extends TestingGame {
  constructor(manifest,collision,paths,events={},presentation={}){
    super(manifest,collision,paths,events,presentation,g=>new KinoRules(g));
    this.engine='black-ops-t5';
    const disabled=collision.disabled;
    try{
      collision.disabled=new Set([...disabled,...this.windows.map(w=>w.target),...this.interactions.filter(e=>e.targetname==='zombie_door').map(e=>e.target),...manifest.map.powerTargets]);
      const ground=p=>{try{return this.settleFeet([p[0],p[1],p[2]+16]);}catch{return p;}};
      this.nodes.forEach((n,i)=>n.origin=ground([paths.nodes[i].origin[0],paths.nodes[i].origin[1],paths.nodes[i].origin[2]-16]));
      for(const w of this.windows)for(const key of ['outside','begin','entry'])w[key]=ground(w[key]);
    }finally{collision.disabled=disabled;}
  }
  newGame(){
    super.newGame();this.burstRemaining=0;this.player.position=this.settleFeet(this.spawn);this.player.previousPosition=this.player.position.slice();
  }
  settleFeet(at){
    // Native spawn markers float above the theater floor. Small fixed sweeps
    // avoid a long sweep touching an unrelated triangle's expanded edge.
    let feet=at.slice();for(let i=0;i<128;i++){
      const result=this.collision.move(feet,[0,0,-1]);
      if(result.grounded&&Math.abs(result.position[2]-feet[2])<.01)return result.position;
      feet=result.position;
    }throw new Error('Kino spawn has no stable walkable floor.');
  }
  prepareSpawnPaths(prepared){super.prepareSpawnPaths(prepared);this.targetNavigation=prepared?.targetNavigation?new Map(prepared.targetNavigation.links):null;}
  invalidateNavigation(targets){
    if(!this.targetNavigation)return super.invalidateNavigation(targets);
    this.pathCache.clear();this.targetNodeDue=0;this.spawnDistanceCache=null;
    const changed=new Set(targets);for(const [key,row]of this.targetNavigation){if(!row.targets.some(t=>changed.has(t)))continue;
      const mask=row.targets.reduce((bits,t,i)=>bits|(this.collision.disabled.has(t)?1<<i:0),0);this.linkCache.set(key,row.values[mask]);
    }
  }
  tick(dt,input){
    super.tick(dt,this.mapRules.reviveDue?{}:input);if(this.mapRules.reviveDue)this.player.health=1;
    if(this.reloadEnd||this.pendingGrenade||this.gesture||this.switching||this.time<this.meleeDue)this.burstRemaining=0;
    if(this.burstRemaining&&this.time>=this.cooldown){if(this.nativeShot())this.burstRemaining--;else this.burstRemaining=0;}
  }
  startRound(){
    super.startRound();
    // Original T5 default_max_zombie_func, distinct from the T4 cuts.
    const r=this.round,m=Math.max(1,r/5)*(r>=10?r*.15:1),max=this.vars.zombie_max_ai+Math.trunc(3*m);
    this.remaining=Math.trunc(max*(r===1?.25:r===2?.3:r===3?.5:r===4?.7:r===5?.9:1));
  }
  damagePlayer(amount){
    if(this.mods?.god||this.mapRules.reviveDue)return;
    const r=this.mapRules;
    if(this.player.health<=amount&&r.perks.has('specialty_quickrevive')&&r.revivesUsed<3){
      r.revivesUsed++;r.perks.clear();r.reviveDue=this.time+8;this.player.health=1;this.lastDamage=this.time;
      this.pendingFire=false;this.sprinting=false;this.message('Downed · Quick Revive');this.emit('damage',amount);return;
    }
    super.damagePlayer(amount);
  }
  fire(){
    if(this.mapRules.reviveDue||this.burstRemaining)return false;
    const fired=this.nativeShot();if(fired&&this.weapon.definition.fireType==='3-Round Burst')this.burstRemaining=2;
    if(fired&&this.weapon.name.startsWith('thundergun')){
      for(const enemy of this.enemies.filter(e=>!e.dead).sort((a,b)=>distance(this.player.position,a.position)-distance(this.player.position,b.position))){if(distance(this.player.position,enemy.position)>512)continue;
        const d=enemy.position.map((v,k)=>v-this.player.position[k]),yaw=Math.atan2(d[1],d[0]);if(Math.cos(yaw-this.yaw)<.86)continue;
        const ray=this.rayHit(600,yaw,Math.atan2(d[2]-25,Math.hypot(d[0],d[1])));
        if(ray.hit?.enemy===enemy){super.hitEnemy(enemy,enemy.health,false,false);this.emit('hit',false);}
      }
    }return fired;
  }
  nativeShot(){this.firingNative=true;try{return super.fire();}finally{this.firingNative=false;}}
  canSave(){return !this.burstRemaining&&super.canSave();}
  tickEnemy(enemy,dt){
    if(this.mapRules.projectionUntil||this.mapRules.reviveDue){if(!enemy.dead)enemy.age+=dt;return;}
    super.tickEnemy(enemy,dt);
  }
  hitEnemy(enemy,damage,head=false,melee=false){
    if(this.firingNative&&this.weapon.name.startsWith('thundergun')&&!melee)return;
    super.hitEnemy(enemy,damage,head,melee);
    if(this.firingNative&&this.weapon.name.startsWith('ray_gun')&&!melee){
      const d=this.weapon.definition,at=enemy.position;
      for(const other of this.enemies){if(other===enemy||other.dead)continue;const range=distance(at,other.position);if(range>=d.explosionRadius)continue;
        const a=[at[0],at[1],at[2]+35],b=[other.position[0],other.position[1],other.position[2]+35];if(this.collision.trace(a,b,[0,0,0],1).fraction<.98)continue;
        super.hitEnemy(other,d.explosionOuterDamage+(d.explosionInnerDamage-d.explosionOuterDamage)*(1-range/d.explosionRadius),false,false);
      }
    }
  }
}
