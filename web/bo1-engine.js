import {TestingGame} from './testing.js';
import {FactoryRules,PERKS} from './map-rules.js';
import {weaponVoxType,KILL_CHANCE} from './player-voice.js';

const pos=e=>e.origin.split(/\s+/).map(Number);
// no_money / door_deny / perk_deny force the variant for each situation.
const DENIED={weapon:['general','no_money',0],ammo:['general','no_money',0],box:['general','no_money',2],door:['general','door_deny',0],debris:['general','door_deny',1],perk:['general','perk_deny',0],perk_owned:['general','perk_deny',1]};
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
    if(e.targetname==='zombie_vending'&&e.script_noteworthy==='specialty_quickrevive')return !!this.game.coop||this.revivesUsed<3;
    return !e.script_noteworthy?.includes('electric_door');
  }
  prompt(e,key){
    if(e.targetname==='use_power_switch')return key+' · Turn on the power';
    if(e.targetname==='zombie_vending'){
      const p=PERKS[e.script_noteworthy],quick=e.script_noteworthy==='specialty_quickrevive';
      if(!p)return '';if(this.perks.has(e.script_noteworthy))return p.name+' purchased';
      if(!this.power&&!(quick&&!this.game.coop))return 'You must turn on the power first';
      return key+' · Buy '+p.name+' · '+(quick&&!this.game.coop?500:p.cost)+' points';
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
      if(p&&this.perks.has(id)){g.voiceEvent('denied','perk_owned');return true;}
      // Co-op Quick Revive needs the power, costs 1500 and speeds up reviving teammates.
      const solo=!g.coop;
      if(!p||(!this.power&&!(quick&&solo))||g.gesture||quick&&solo&&this.revivesUsed>=3)return true;
      if(!g.spendPoints(quick&&solo?500:p.cost)){g.voiceEvent('denied','perk');return true;}
      // give_perk() threads perk_vox(), which waits 1.5 s after the drink.
      g.startGesture(id,()=>{this.perks.add(id);if(id==='specialty_armorvest')g.player.health=250;g.laterDialog(1.5,'perk',id);});g.emit('sound',{alias:p.sting});return true;
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
      const w=g.weapon,upgraded=w.definition.upgrade;if(!upgraded||!this.power||g.gesture)return true;
      if(!g.spendPoints(5000)){g.voiceEvent('denied','perk');return true;}
      g.dialog('weapon_pickup','upgrade_wait');
      const machine=g.entities.find(x=>x.targetname===e.target),origin=machine?pos(machine):pos(e);
      g.inventory.splice(g.slot,1);if(!g.inventory.length)g.inventory.push(g.makeWeapon(g.data.startWeapon));g.slot=0;
      this.pap={phase:'in',started:g.time,weapon:w.name,upgraded,at:pos(e),origin:[origin[0],origin[1],origin[2]+35],playerYaw:g.yaw*180/Math.PI,yaw:Number((machine?.angles||'0 0 0').split(' ')[1])+90};
      g.startGesture('knuckle_crack');g.emit('weapon',g.weapon);return true;
    }
    if(e.zombie_weapon_upgrade==='frag_grenade_zm'){if(g.player.grenades<4){if(g.spendPoints(250)){g.player.grenades=4;g.voiceEvent('weapon','frag_grenade_zm');}else g.voiceEvent('denied','weapon');}return true;}
    if(e.zombie_weapon_upgrade==='bowie_knife_zm'){if(g.spendPoints(3000)){for(const w of g.inventory)w.definition={...w.definition,meleeDamage:300};g.message('Bowie knife purchased');g.dialog('weapon_pickup','bowie');}else g.dialog('general','no_money',1);return true;}
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
  // Taking the upgraded gun plays its pickup line (wpck_upgrade or favourite).
  takeUpgrade(){const upgraded=this.pap?.upgraded;super.takeUpgrade();if(upgraded&&!this.pap)this.game.voiceEvent('weapon',upgraded);}
  saveState(){return {...super.saveState(),coreLinked:this.coreLinked,teleporterLinked:this.teleporterLinked,projectionUntil:this.projectionUntil,revivesUsed:this.revivesUsed,reviveDue:this.reviveDue};}
  loadState(s){super.loadState(s);for(const key of ['coreLinked','teleporterLinked','projectionUntil','revivesUsed','reviveDue'])this[key]=s[key]??0;}
  get announcer(){return {full_ammo:'zmb_vox_ann_maxammo',insta_kill:'zmb_vox_ann_instakill',double_points:'zmb_vox_ann_doublepoints',nuke:'zmb_vox_ann_nuke',carpenter:'zmb_vox_ann_carpenter'};}
}

export class BlackOpsEngine extends TestingGame {
  constructor(manifest,collision,paths,events={},presentation={},rulesFactory=g=>new KinoRules(g)){
    super(manifest,collision,paths,events,presentation,rulesFactory);
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
    this.character??=0;this.voiceJobs=[];this.killLineUntil=0;this.killStreak=null;this.ammoLowUntil=0;this.ammoOutUntil=0;this.ammoOutAt=0;this.ammoCheckDue=0;this.killMod=null;
  }
  // create_and_play_dialog(): the client resolves the character's alias and
  // variant. Nothing but the going-down line is said while downed.
  dialog(category,type,variant){if(this.mapRules.reviveDue&&type!=='revive_down')return;this.emit('dialog',{category,type,variant});}
  laterDialog(delay,category,type,variant){this.voiceJobs.push({at:this.time+delay,category,type,variant});}
  voiceEvent(event,detail){
    if(event==='weapon')this.dialog('weapon_pickup',weaponVoxType(this.character,detail));
    else if(event==='denied'&&DENIED[detail])this.dialog(...DENIED[detail]);
  }
  // play_level_start_vox_delayed(): a level-start line five seconds in.
  start(){const fresh=this.phase==='ready';super.start();if(fresh)this.laterDialog(5,'general','intro');}
  // player_zombie_kill_vox() / get_mod_type(): the kind of kill decides the
  // line and its chance; a line blocks further kill lines for two seconds.
  killVox(enemy,head,melee){
    if(this.killMod==='nuke')return;
    // player_killstreak_timer(): more than seven kills within five seconds.
    if(!this.killStreak||this.time>this.killStreak.until)this.killStreak={until:this.time+5,count:0};
    if(++this.killStreak.count>7){this.killStreak=null;this.dialog('kill','streak');}
    if(enemy.hitPlayer)this.dialog('kill','damage');
    const dist=distance(this.player.position,enemy.position),insta=!!this.powerup.insta_kill,weapon=this.weapon.name,splash=this.killMod==='splash',explosive=this.killMod==='explosive';
    let death='default';
    if(melee&&dist<64)death=insta?'melee_instakill':'melee';
    else if(explosive)death=insta?'weapon_instakill':'explosive';
    else if(weapon.startsWith('ray_gun')&&dist>400)death=insta?'weapon_instakill':'raygun';
    else if(!melee&&!splash&&head&&dist>400&&!insta)death='headshot';
    else if(dist<64&&!insta)death='closekill';
    else if(!melee&&!splash)death=insta?'weapon_instakill':'bullet';
    if((KILL_CHANCE[death]??1)>1+Math.floor(Math.random()*99)&&this.time>=this.killLineUntil){this.killLineUntil=this.time+2;this.dialog('kill',death);}
  }
  updateGrenades(dt){this.killMod='explosive';try{super.updateGrenades(dt);}finally{this.killMod=null;}}
  pickup(drop){
    this.killMod=drop.type==='nuke'?'nuke':null;try{super.pickup(drop);}finally{this.killMod=null;}
    // powerup_vo(): 3 to 3.5 s after the grab.
    this.laterDialog(3+Math.random()*.5,'powerup',drop.type);
  }
  settleFeet(at){
    // Native spawn markers float above the theater floor. Small fixed sweeps
    // avoid a long sweep touching an unrelated triangle's expanded edge. The
    // player stands on the real floor, not on a tiny prop (collision.js).
    const was=this.collision.playerMovement;this.collision.playerMovement=true;
    try{
      let feet=at.slice();for(let i=0;i<128;i++){
        const result=this.collision.move(feet,[0,0,-1]);
        if(result.grounded&&Math.abs(result.position[2]-feet[2])<.01)return result.position;
        feet=result.position;
      }
    }finally{this.collision.playerMovement=was;}
    throw new Error('Kino spawn has no stable walkable floor.');
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
    if(['ready','dead'].includes(this.phase))return;
    for(const job of this.voiceJobs.filter(j=>this.time>=j.at)){this.voiceJobs.splice(this.voiceJobs.indexOf(job),1);this.dialog(job.category,job.type,job.variant);}
    // track_players_ammo_count(): every half second, the current gun's total
    // ammo below five warns once per 20 s; empty for two seconds likewise.
    if(this.time>=this.ammoCheckDue){
      this.ammoCheckDue=this.time+.5;const w=this.weapon,total=w.clip+w.reserve;
      if(this.gesture||this.mapRules.reviveDue||this.pendingGrenade){}
      else if(total>0&&total<5){this.ammoOutAt=0;if(this.time>=this.ammoLowUntil){this.ammoLowUntil=this.time+20;this.dialog('general','ammo_low');}}
      else if(total===0){if(!this.ammoOutAt)this.ammoOutAt=this.time+2;else if(this.time>=this.ammoOutAt){this.ammoOutAt=0;if(this.time>=this.ammoOutUntil){this.ammoOutUntil=this.time+20;this.dialog('general','ammo_out');}}}
      else this.ammoOutAt=0;
    }
    if(this.reloadEnd||this.pendingGrenade||this.gesture||this.switching||this.time<this.meleeDue)this.burstRemaining=0;
    if(this.burstRemaining&&this.time>=this.cooldown){if(this.nativeShot())this.burstRemaining--;else this.burstRemaining=0;}
  }
  startRound(){
    super.startRound();
    // Original T5 default_max_zombie_func, distinct from the T4 cuts.
    // Solo adds half a per-player set; co-op (players-1) full sets of 6.
    const players=this.coop?.playerCount()||1,r=this.round,m=Math.max(1,r/5)*(r>=10?r*.15:1),max=this.vars.zombie_max_ai+Math.trunc((players>1?(players-1)*6:3)*m);
    this.remaining=Math.trunc(max*(r===1?.25:r===2?.3:r===3?.5:r===4?.7:r===5?.9:1));
  }
  damagePlayer(amount){
    if(this.attackingEnemy)this.attackingEnemy.hitPlayer=true;
    if(this.mods?.god||this.mapRules.reviveDue)return;
    const r=this.mapRules;
    // Solo Quick Revive revives the player; in co-op teammates revive instead.
    if(!this.coop&&this.player.health<=amount&&r.perks.has('specialty_quickrevive')&&r.revivesUsed<3){
      r.revivesUsed++;r.perks.clear();r.reviveDue=this.time+8;this.player.health=1;this.lastDamage=this.time;
      this.pendingFire=false;this.sprinting=false;this.message('Downed · Quick Revive');this.emit('damage',amount);this.dialog('general','revive_down');return;
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
        if(ray.hit?.enemy===enemy){super.hitEnemy(enemy,enemy.health,false,false);this.emit('hit',false);if(30>1+Math.floor(Math.random()*99))this.dialog('kill','thundergun');}
      }
    }return fired;
  }
  nativeShot(){this.firingNative=true;try{return super.fire();}finally{this.firingNative=false;}}
  canSave(){return !this.burstRemaining&&super.canSave();}
  saveState(){return {...super.saveState(),character:this.character};}
  loadState(s){const character=this.character;super.loadState(s);this.character=Number.isInteger(s.character)?s.character:character;}
  tickEnemy(enemy,dt){
    // Solo: the zombies wait while the only player is away or reviving.
    if(!this.coop&&(this.mapRules.projectionUntil||this.mapRules.reviveDue)){if(!enemy.dead)enemy.age+=dt;return;}
    this.attackingEnemy=enemy;try{super.tickEnemy(enemy,dt);}finally{this.attackingEnemy=null;}
  }
  hitEnemy(enemy,damage,head=false,melee=false){
    if(this.firingNative&&this.weapon.name.startsWith('thundergun')&&!melee)return;
    const alive=!enemy.dead;
    super.hitEnemy(enemy,damage,head,melee);
    // A co-op teammate's kill is voiced on their own browser.
    if(alive&&enemy.dead&&!this.coop?.credit)this.killVox(enemy,head,melee);
    if(this.firingNative&&this.weapon.name.startsWith('ray_gun')&&!melee){
      const d=this.weapon.definition,at=enemy.position;
      for(const other of this.enemies){if(other===enemy||other.dead)continue;const range=distance(at,other.position);if(range>=d.explosionRadius)continue;
        const a=[at[0],at[1],at[2]+35],b=[other.position[0],other.position[1],other.position[2]+35];if(this.collision.trace(a,b,[0,0,0],1).fraction<.98)continue;
        const living=!other.dead;super.hitEnemy(other,d.explosionOuterDamage+(d.explosionInnerDamage-d.explosionOuterDamage)*(1-range/d.explosionRadius),false,false);
        if(living&&other.dead){this.killMod='splash';try{this.killVox(other,false,false);}finally{this.killMod=null;}}
      }
    }
  }
}
