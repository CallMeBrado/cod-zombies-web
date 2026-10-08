// Origins' native generator progression, local spawners and excavation items.
// Timing/positions come from zm_tomb_capture_zones and the owned map entities.
import {KinoRules} from './bo1-engine.js';
import {NuketownRules} from './bo2-nuketown.js';
import {PERKS} from './map-rules.js';
const pos=e=>e.origin.split(/\s+/).map(Number),distance=(a,b)=>Math.hypot(...a.map((v,k)=>v-b[k]));
const within=(p,h)=>h.mins.every((v,k)=>p[k]>=v-2)&&h.maxs.every((v,k)=>p[k]<=v+2)&&h.planes.every(q=>q[0]*p[0]+q[1]*p[1]+q[2]*p[2]<=q[3]+2);
const choose=a=>a[Math.floor(Math.random()*a.length)];
const PERK={...PERKS,specialty_longersprint:{name:'Stamin-Up',cost:2000,sting:'mx_stamin_sting'},specialty_additionalprimaryweapon:{name:'Mule Kick',cost:4000,sting:'mx_mule_sting'},specialty_rof:{...PERKS.specialty_rof,name:'Double Tap II'}};
const STAFF={air:'Wind',water:'Ice',fire:'Fire',lightning:'Lightning'};
export class OriginsRules extends KinoRules {
  get maxHealth(){return this.perks.has('specialty_armorvest')?250:100;}
  reset(){
    super.reset();this.papOn=true;this.generators=Object.fromEntries(this.data.generators.map(g=>[g.id,{progress:0,phase:'off',started:0}]));
    this.activeCapture=null;this.captureSpawnDue=0;this.nextPanzerRound=8;this.panzerCount=0;this.panzerDue=null;this.seenRound=0;
    this.collected=new Set();this.dug=new Set();this.shovel=false;this.digCount=0;this.cryptOpen=false;this.portalOpen=new Set();this.crafted=new Set();this.mudScale=1;
    this.itemChoices=new Set(Object.values(this.data.parts).map(choose));this.game.activeBox=choose(['bunker_tank_chest','bunker_cp_chest']);this.nextLogic=0;
  }
  installInteractions(){
    const targets=new Set(['origins_generator','origins_crypt','origins_portal','origins_return','origins_staff_bench','origins_wunderfizz']);
    const g=this.game;for(const e of g.entities)if(e.originsItem||targets.has(e.targetname)){
      if(!g.interactions.some(x=>x.itemId&&x.itemId===e.itemId||x.targetname===e.targetname&&x.origin===e.origin))g.interactions.push({...e,position:pos(e)});
    }
  }
  activeZones(){const zones=super.activeZones();if(this.portalOpen?.size)for(const v of this.data.volumes)if(v.name.startsWith('zone_chamber_'))zones.add(v.name);return zones;}
  negotiationLink(a,b,l){return NuketownRules.prototype.negotiationLink.call(this,a,b,l);}
  startTraversal(e){return NuketownRules.prototype.startTraversal.call(this,e);}
  advanceTraversal(e,dt){return NuketownRules.prototype.advanceTraversal.call(this,e,dt);}
  spawnerWindows(origin){
    this.namedWindows??=new Map(this.game.spawnEntities.filter(e=>e.nativeNoteworthy==='spawn_location').map(e=>[pos(e).join(','),this.game.windows.filter(w=>this.data.goals[w.target]?.barricade===e.script_string)]));
    const own=this.namedWindows.get(origin.join(','));return own?.length?own:null;
  }
  isPowered(e){return !e.generator||e.generator===7?(!e.generator||this.power):this.generators[e.generator]?.phase==='on';}
  visible(e){
    if(e.originsItem)return this.itemChoices.has(e.itemId)&&!this.collected.has(e.itemGroup)&&!(e.originsItem==='dig'&&this.dug.has(e.itemId));
    if(e.targetname==='origins_return')return this.portalOpen.has(e.portal);
    if(e.targetname==='origins_crypt')return !this.cryptOpen;
    if(e.targetname==='treasure_chest_use'&&this.game.powerup.fire_sale)return true;
    return super.visible(e);
  }
  generatorCost(){return 200*(this.game.coop?.playerPositions().length||1);}
  staffParts(staff){const prefix='elemental_'+staff.replace(/_zm$/,'');return ['lower_staff','middle_staff','upper_staff','gem'].map(s=>prefix+'_'+s);}
  prompt(e,key){
    const g=this.game;
    if(e.targetname==='origins_generator'){
      const s=this.generators[e.generator];return s.phase==='on'?'Generator '+e.generator+' online':s.phase==='capturing'?'Defend Generator '+e.generator+' · '+Math.floor(s.progress)+'%':this.activeCapture?'Another generator is being captured':key+' · Activate Generator '+e.generator+' · '+this.generatorCost()+' points';}
    if(e.originsItem==='shovel')return this.shovel?'Shovel equipped':key+' · Pick up shovel';
    if(e.originsItem==='dig')return this.shovel?key+' · Dig':'Requires a shovel';
    if(e.originsItem==='record')return key+' · Pick up '+(e.itemGroup.endsWith('_player')?'gramophone':e.itemGroup.endsWith('_master')?'black record':e.itemGroup.split('_').at(-1)+' record');
    if(e.originsItem==='staffPart')return key+' · Pick up '+STAFF[e.itemGroup.split('_')[2]]+' Staff part';
    if(e.targetname==='origins_crypt')return this.collected.has('gramophone_vinyl_master')&&this.collected.has('gramophone_vinyl_player')?key+' · Place gramophone and open excavation':'Find the gramophone and black record';
    if(e.targetname==='origins_portal'){
      const p=this.data.portals.find(p=>p.id===e.portal);return this.portalOpen.has(p.id)?key+' · Enter the Crazy Place':this.collected.has('gramophone_vinyl_player')&&this.collected.has(p.record)?key+' · Open portal with the gramophone':'Requires the gramophone and '+p.record.split('_').at(-1)+' record';}
    if(e.targetname==='origins_return')return key+' · Return from the Crazy Place';
    if(e.targetname==='origins_staff_bench')return this.crafted.has(e.staff)?key+' · Take '+g.weaponName(e.staff):key+' · Build '+g.weaponName(e.staff)+' · '+this.staffParts(e.staff).filter(p=>this.collected.has(p)).length+'/4 parts';
    if(e.targetname==='origins_wunderfizz')return !this.isPowered(e)?'Activate Generator '+e.generator+' first':key+' · Der Wunderfizz · 1500 points';
    if(e.targetname==='zombie_vending'){
      const id=e.script_noteworthy,p=PERK[id],quick=id==='specialty_quickrevive';if(!p)return '';
      if(this.perks.has(id))return p.name+' purchased';if(!this.isPowered(e)&&!(quick&&!g.coop))return 'Activate Generator '+e.generator+' first';
      if(this.perks.size>=4)return 'Four perks already purchased';return key+' · Buy '+p.name+' · '+(quick&&!g.coop?500:p.cost)+' points';}
    if(e.targetname==='zombie_vending_upgrade'&&!this.power)return 'Activate all six generators · '+Object.values(this.generators).filter(s=>s.phase==='on').length+'/6';
    return super.prompt(e,key);
  }
  use(e){
    const g=this.game,t=e.targetname;
    if(t==='origins_generator'){
      const s=this.generators[e.generator];if(s.phase!=='off'||this.activeCapture||!g.spendPoints(this.generatorCost()))return true;
      Object.assign(s,{phase:'capturing',progress:.01,started:g.time});this.activeCapture=e.generator;this.captureSpawnDue=g.time+.8;
      g.emit('sound',{alias:'zmb_capturezone_generator_piston_start',position:pos(e)});g.message('Stay near Generator '+e.generator+' and defend it');return true;
    }
    if(e.originsItem){
      if(!this.visible(e))return true;
      if(e.originsItem==='shovel'){if(!this.shovel){this.shovel=true;g.message('Shovel acquired');}return true;}
      if(e.originsItem==='dig'){if(this.shovel)this.dig(e);return true;}
      this.collected.add(e.itemGroup);g.emit('sound',{alias:'cha_ching'});g.message(this.prompt(e,'').replace(' · Pick up ','')+' acquired');return true;
    }
    if(t==='origins_crypt'){
      if(this.collected.has('gramophone_vinyl_master')&&this.collected.has('gramophone_vinyl_player')){this.cryptOpen=true;this.flags.add('activate_zone_crypt');this.openTargets(['junk_nml_chamber_clip','junk_nml_chamber']);g.message('Excavation chamber opened');}return true;}
    if(t==='origins_portal'){
      const p=this.data.portals.find(p=>p.id===e.portal);
      if(this.collected.has('gramophone_vinyl_player')&&this.collected.has(p.record)){this.portalOpen.add(p.id);this.flags.add('activate_zone_chamber');this.teleport(p.to);g.yaw=p.yaw*Math.PI/180;g.emit('originsTeleport',{yaw:g.yaw});g.message('The Crazy Place');}return true;}
    if(t==='origins_return'){
      const p=this.data.portals.find(p=>p.id===e.portal);this.teleport(p.back);g.yaw=p.backYaw*Math.PI/180;g.emit('originsTeleport',{yaw:g.yaw});return true;}
    if(t==='origins_staff_bench'){
      if(this.staffParts(e.staff).every(p=>this.collected.has(p))){this.crafted.add(e.staff);g.giveWeapon(e.staff);g.message(g.weaponName(e.staff)+' assembled');}return true;}
    if(t==='origins_wunderfizz'){
      if(!this.isPowered(e)||this.perks.size>=4||g.gesture)return true;
      const choices=Object.keys(PERK).filter(p=>g.data.gestures[p]&&!this.perks.has(p));if(choices.length&&g.spendPoints(1500))this.drink(choose(choices));return true;}
    if(t==='zombie_vending'){
      const id=e.script_noteworthy,p=PERK[id],quick=id==='specialty_quickrevive';
      if(!p||this.perks.has(id)||this.perks.size>=4||g.gesture||!this.isPowered(e)&&!(quick&&!g.coop)||quick&&!g.coop&&this.revivesUsed>=3)return true;
      if(g.spendPoints(quick&&!g.coop?500:p.cost))this.drink(id);return true;
    }
    if(t==='zombie_vending_upgrade'&&!this.power)return true;
    return super.use(e);
  }
  drink(id){const g=this.game;g.startGesture(id,()=>{this.perks.add(id);if(id==='specialty_armorvest')g.player.health=this.maxHealth;g.message(PERK[id].name+' acquired');});g.emit('sound',{alias:PERK[id].sting});}
  dig(e){
    const g=this.game;this.dug.add(e.itemId);this.digCount++;g.emit('sound',{alias:'evt_dig'});
    // Ice staff pieces are unearthed in the map's three regions. Snow and
    // the complete golden-shovel reward table are a later fidelity pass.
    const p=pos(e),region=p[1]>2000?'lower_staff':p[1]<-1000?'upper_staff':'middle_staff',part='elemental_staff_water_'+region;
    if(!this.collected.has(part)&&this.digCount%3===0){this.collected.add(part);g.message('Ice Staff part found');return;}
    if(Math.random()<.35){g.addDrop('full_ammo',[p[0],p[1],p[2]+25]);g.message('Max Ammo unearthed');}
    else{g.awardPoints(50+Math.floor(Math.random()*5)*50);g.message('Blood Money');}
  }
  boxJoker(){return NuketownRules.prototype.boxJoker.call(this);}
  boxCost(e){return this.game.powerup.fire_sale?10:Number(e.zombie_cost)||950;}
  tick(){
    super.tick();const g=this.game;if(g.phase==='ready'||g.phase==='dead'||g.mirror)return;
    const dt=Math.min(.25,Math.max(0,g.time-(this.lastTime??g.time)));this.lastTime=g.time;
    if(g.round!==this.seenRound){this.seenRound=g.round;this.dug.clear();}
    if(this.activeCapture){
      const id=this.activeCapture,s=this.generators[id],d=this.data.generators.find(x=>x.id===id),p=g.player.position;
      const inside=Math.hypot(p[0]-d.origin[0],p[1]-d.origin[1])<220&&p[2]>d.origin[2]-40&&p[2]<d.origin[2]+140;
      s.progress=Math.max(0,Math.min(100,s.progress+dt*(inside?100/(g.coop?10:12):-5)));
      if(g.time>=this.captureSpawnDue&&g.enemies.filter(e=>!e.dead&&e.captureGenerator===id).length<4){this.captureSpawnDue=g.time+.5;this.spawnGuard(d);}
      if(s.progress>=100||s.progress<=0){
        s.phase=s.progress>=100?'on':'off';this.activeCapture=null;s.started=g.time;
        for(const e of g.enemies)if(!e.dead&&e.captureGenerator===id){e.dead=true;e.deathTime=g.time;g.emit('kill',e);}
        if(s.phase==='on'){g.awardPoints(100);g.emit('sound',{alias:'perks_power_on',position:d.origin});g.message('Generator '+id+' online');}
        this.power=Object.values(this.generators).every(s=>s.phase==='on');if(this.power){this.flags.add('power_on');g.message('All generators online · Pack-a-Punch unlocked');}
      }
    }
    if(g.round>=this.nextPanzerRound&&this.flags.has('activate_zone_nml')&&!g.enemies.some(e=>!e.dead&&e.kind==='panzer')){
      this.panzerDue??=g.time+10+Math.random()*5;
      if(g.time>=this.panzerDue&&this.spawnPanzer()){this.panzerDue=null;this.nextPanzerRound=g.round+4+Math.floor(Math.random()*2);this.panzerCount++;}
    }
    // Poll map volumes at 10 Hz; never trace the entire map every frame.
    if(g.time>=this.nextLogic){this.nextLogic=g.time+.1;const inMud=this.data.mud.some(h=>within([g.player.position[0],g.player.position[1],g.player.position[2]+1],h));
      const target=inMud?(this.perks.has('specialty_longersprint')?.7:.6):1;this.mudScale=target<this.mudScale?Math.max(target,this.mudScale-(this.perks.has('specialty_longersprint')?.05:.1)):target;}
    for(const e of g.enemies)if(e.kind==='panzer'&&!e.dead&&g.time>=(e.flameDue||0)&&distance(e.position,g.player.position)<260){
      e.flameDue=g.time+1;const a=[e.position[0],e.position[1],e.position[2]+45],b=[g.player.position[0],g.player.position[1],g.player.position[2]+35];
      if(g.collision.trace(a,b,[0,0,0],1).fraction>=.98){g.damagePlayer(25,{from:e.position,enemy:e});g.emit('effect',{name:'maps/zombie_tomb/fx_tomb_mech_wpn_flamethrower',position:a,duration:.6});}}
  }
  spawnAt(origin,kind,extra={}){
    const g=this.game;let at;try{at=g.collision.actor(()=>g.settleFeet([origin[0],origin[1],origin[2]+48]));}catch{return false;}
    if(!g.walkableLink(at,g.player.position)&&!g.path(at,g.player.position,true).length)return false;
    const gait=g.zombieGait(),e={id:g.nextId++,kind,position:at,previousPosition:at.slice(),health:kind==='panzer'?Math.min(22500,5000+1000*this.panzerCount):g.zombieHealth,
      window:null,stage:'rise',...g.riseClip(gait),path:[],attackDue:0,navDue:0,angle:0,dead:false,age:0,spawnTime:g.time,gait:kind==='panzer'?'ai_zombie_walk_v1':gait.name,speed:kind==='panzer'?95:gait.speed,...extra};
    g.enemies.push(e);g.emit('spawn',e);return e;
  }
  spawnGuard(generator){
    const g=this.game,rows=[...generator.guardSpawns].sort(()=>Math.random()-.5);
    for(const at of rows)if(distance(at,g.player.position)>90&&!g.enemies.some(e=>!e.dead&&distance(e.position,at)<48)&&this.spawnAt(at,'crusader',{captureGenerator:generator.id,ignoreRound:true}))return true;
    return false;
  }
  spawnPanzer(){
    const g=this.game,groups=new Set(this.enabledSpawners().map(e=>e.targetname)),rows=this.data.mechSpawns.filter(s=>groups.has(s.group)&&distance(s.origin,g.player.position)>240).sort((a,b)=>distance(a.origin,g.player.position)-distance(b.origin,g.player.position));
    for(const s of rows.slice(0,8)){const e=this.spawnAt(s.origin,'panzer',{stage:'hunt',ignoreNuke:true,ignoreInstaKill:true});if(e){g.message('Panzer Soldat incoming');g.emit('sound',{alias:'zmb_ai_mechz_incoming_alarm'});return true;}}return false;
  }
  saveState(){return {...super.saveState(),generators:this.generators,activeCapture:this.activeCapture,captureSpawnDue:this.captureSpawnDue,nextPanzerRound:this.nextPanzerRound,panzerCount:this.panzerCount,panzerDue:this.panzerDue,seenRound:this.seenRound,
    collected:[...this.collected],dug:[...this.dug],itemChoices:[...this.itemChoices],shovel:this.shovel,digCount:this.digCount,cryptOpen:this.cryptOpen,portalOpen:[...this.portalOpen],crafted:[...this.crafted]};}
  loadState(s){super.loadState(s);for(const k of ['generators','activeCapture','captureSpawnDue','nextPanzerRound','panzerCount','panzerDue','seenRound','shovel','digCount','cryptOpen'])if(s[k]!==undefined)this[k]=s[k];
    for(const k of ['collected','dug','itemChoices','portalOpen','crafted'])this[k]=new Set(s[k]||[]);this.lastTime=this.game.time;this.power=Object.values(this.generators).every(s=>s.phase==='on');}
  coopState(){return this.saveState();}
  applyCoopState(s){if(s)this.loadState(s);}
}
