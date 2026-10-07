import {BlackOpsEngine,KinoRules} from './bo1-engine.js';
import {PERKS} from './map-rules.js';
import {BuriedEquipment} from './bo2-equipment.js';
import {Arthur} from './bo2-arthur.js';

export const BO2_CHARACTERS=['Russman','Stuhlinger','Misty','Marlton'];
export const BO2_ARMS=['c_zom_oldman_viewhands','c_zom_reporter_viewhands','c_zom_farmgirl_viewhands','c_zom_engineer_viewhands'];
export const BO2_PERKS={...PERKS,
  specialty_rof:{...PERKS.specialty_rof,name:'Double Tap II'},
  specialty_longersprint:{name:'Stamin-Up',cost:2000,sting:'mx_stamin_sting'},
  specialty_additionalprimaryweapon:{name:'Mule Kick',cost:4000,sting:'mx_mule_sting'},
  specialty_nomotionsensor:{name:'Vulture Aid',cost:3000,sting:'mx_vulture_sting'}};
const pos=e=>e.origin.split(/\s+/).map(Number),distance=(a,b)=>Math.hypot(...a.map((v,k)=>v-b[k]));
const itemKinds={keys_zm_p6_zm_bu_sloth_key:'key',booze_p6_zm_bu_booze:'booze',candy_p6_zm_bu_sloth_candy_bowl:'candy',chalk_p6_zm_bu_chalk:'chalk'};

// T6 progression is driven by the Buried zone volumes and authored item,
// door and barricade entities. T5's theater teleporter never participates.
export class BuriedRules extends KinoRules {
  reset(){
    super.reset();this.visited=new Set([this.data.initialZone]);this.carry=null;
    this.chalk=new Map();this.collected=new Set();this.itemRespawn=new Map();
    this.bank=0;this.weaponLocker=null;this.arthur=new Arthur(this);this.hold=null;
    // The start area's authored fxanims: the catwalk and the floor boards.
    this.fxanims={};
    this.ghostActive=false;this.ghostRemaining=0;this.ghostDue=0;this.lastGhostRound=-5;this.wasInMansion=false;
    this.equipment=new BuriedEquipment(this);this.meleeUpgrade=null;this.vultureDrops=[];this.vultureProtected=false;
    this.maze=0;this.applyMaze();this.nextZoneCheck=0;this.occupiedCache=[];
    this.catwalkDue=null;this.catwalkClipDue=null;this.triggered=new Set();
    const items=this.game.entities.filter(e=>e.nativeItemTarget),choose=rows=>rows[Math.floor(Math.random()*rows.length)]?.itemId;
    this.activeItems=new Set(items.filter(e=>e.nativeItemTarget.includes('chalk')||e.script_forcespawn==='1').map(e=>e.itemId));
    for(const kind of ['booze','candy']){
      const rows=items.filter(e=>e.nativeItemTarget.startsWith(kind)&&e.script_forcespawn!=='1');const id=choose(rows);if(id)this.activeItems.add(id);
    }
  }
  applyMaze(){
    const allowed=new Set(this.data.mazePermutations?.[this.maze]||[]),g=this.game;
    for(const e of g.entities.filter(e=>e.nativeMaze)){if(allowed.has(e.nativeMaze))g.collision.disabled.delete(e.targetname);else g.collision.disabled.add(e.targetname);}
    if(g.gateNavigation)g.invalidateNavigation(g.entities.filter(e=>e.nativeMaze).map(e=>e.targetname));
  }
  occupied(){
    if(this.game.time<this.nextZoneCheck&&this.lastOccupiedPoint&&distance(this.lastOccupiedPoint,this.game.player.position)<8)return this.occupiedCache;
    this.nextZoneCheck=this.game.time+.1;
    this.lastOccupiedPoint=this.game.player.position.slice();
    const points=(this.game.coop?.playerPositions()||[this.game.player.position]).map(p=>[p[0],p[1],p[2]+25]);
    return this.occupiedCache=this.data.volumes.filter(v=>points.some(p=>v.hulls.some(h=>h.mins.every((x,k)=>p[k]>=x-2)&&h.maxs.every((x,k)=>p[k]<=x+2)&&h.planes.every(pl=>pl.slice(0,3).reduce((s,x,k)=>s+x*p[k],0)<=pl[3]+2))));
  }
  activeZones(){
    const active=new Set(this.visited),occupied=this.occupied();for(const v of occupied)active.add(v.name);
    let changed=true;while(changed){changed=false;for(const [a,b,flag]of this.data.connections)if(this.flags.has(flag)){
      if(active.has(a)&&!active.has(b)){active.add(b);changed=true;}if(active.has(b)&&!active.has(a)){active.add(a);changed=true;}
    }}return active;
  }
  enabledSpawners(){
    const occupied=this.occupied(),zones=new Set(occupied.length?occupied.map(v=>v.name):[this.data.initialZone]);
    for(const [a,b,flag]of this.data.connections)if(this.flags.has(flag)){if(occupied.some(v=>v.name===a))zones.add(b);if(occupied.some(v=>v.name===b))zones.add(a);}
    const groups=new Set(this.data.volumes.filter(v=>zones.has(v.name)).map(v=>v.spawners));
    return this.game.spawnEntities.filter(e=>groups.has(e.targetname));
  }
  // Booze, candy, chalk, the key and parts. The key is used up opening the
  // cell; candy only spawns once Arthur has broken out of the jail
  // (wait_start_candy_booze waits for "jail_barricade_down").
  itemVisible(e){
    const kind=e.buriedItem||itemKinds[e.nativeItemTarget];
    return (!kind||this.activeItems.has(e.itemId))&&!this.collected.has(e.itemId)&&(kind!=='key'||!this.arthur.cellOpen)&&(kind!=='candy'||this.flags.has('jail_door1'));
  }
  visible(e){
    if(e.buriedItem||e.buriedPart)return this.itemVisible(e);
    if(e.targetname==='buried_arthur')return this.hold?.kind==='gift'||this.arthur.canGift();
    if(e.targetname==='buried_jail')return !this.arthur.cellOpen;
    if(e.targetname==='buried_barricade')return false;
    if(e.targetname==='buried_chalk_place')return !this.chalk.has(e.target);
    return super.visible(e);
  }
  prompt(e,key){
    const g=this.game;
    if(e.buriedItem||e.buriedPart)return this.carry?'Already carrying '+this.carry.kind:key+' · Pick up '+(e.buriedPart?this.equipment.name(e.buriedPart)+' part':e.buriedItem==='chalk'?g.weaponName(e.zombie_weapon_upgrade)+' chalk':e.buriedItem);
    // Holds run on the host; a co-op guest's would never finish.
    if(g.mirror&&(e.buriedBench||['buried_jail','buried_arthur'].includes(e.targetname)))return 'The host player handles this for now';
    if(e.buriedBench)return this.equipment.prompt(e,key);
    if(e.targetname==='buried_equipment')return this.equipment.held?'Already carrying equipment':key+' · Pick up equipment';
    if(e.zombie_weapon_upgrade==='tazer_knuckles_zm')return this.meleeUpgrade==='tazer_knuckles_zm'?'Galvaknuckles purchased':key+' · Buy Galvaknuckles · 6000 points';
    if(e.targetname==='buried_jail')return this.hold?.kind==='key'?'Unlocking…':this.carry?.kind==='key'?'Hold '+key+' · Unlock':'Find the cell key';
    if(e.targetname==='buried_arthur')return this.hold?.kind==='gift'?'Giving…':'Hold '+key+' · Give Arthur '+(this.carry?.kind==='candy'?'candy':'booze');
    if(e.targetname==='buried_chalk_place')return this.carry?.kind==='chalk'?key+' · Draw '+g.weaponName(this.carry.weapon):'Pick up weapon chalk at the gunsmith';
    if(e.targetname==='buried_bank_deposit')return key+' · Deposit 1,000 points · Balance '+this.bank;
    if(e.targetname==='buried_bank_withdraw')return key+' · Withdraw 1,000 points · Fee 100 · Balance '+this.bank;
    if(e.targetname==='buried_weapon_locker')return key+' · '+(this.weaponLocker?'Swap with '+g.weaponName(this.weaponLocker.name):'Store current weapon');
    if(e.targetname==='zombie_vending'){
      const p=BO2_PERKS[e.script_noteworthy],quick=e.script_noteworthy==='specialty_quickrevive';if(!p)return '';
      if(this.perks.has(e.script_noteworthy))return p.name+' purchased';
      if(!this.equipment.powered(e.position)&&!(quick&&!g.coop))return 'You must turn on the power first';
      if(this.perks.size>=4)return 'Four perks already purchased';
      return key+' · Buy '+p.name+' · '+(quick&&!g.coop?500:p.cost)+' points';
    }
    if(e.targetname==='zombie_vending_upgrade'){
      if(!this.power)return 'You must turn on the power first';
      if(this.pap)return this.pap.phase==='ready'?key+' · Take '+g.weaponName(this.pap.upgraded):'Pack-a-Punch · upgrading…';
      return g.weapon.definition.upgrade?key+' · Pack-a-Punch · 5000 points':'No further upgrade available';
    }
    return super.prompt(e,key);
  }
  use(e){
    const g=this.game,tag=e.targetname;
    if(e.buriedItem||e.buriedPart){
      if(this.carry||!this.visible(e))return true;this.carry={kind:e.buriedPart?'part':e.buriedItem,equipment:e.buriedPart,weapon:e.zombie_weapon_upgrade,itemId:e.itemId};this.collected.add(e.itemId);
      g.emit('buriedItem',{id:e.itemId,visible:false});g.emit('sound',{alias:e.buriedItem==='booze'?'zmb_booze_pickup':'cha_ching'});g.message('Picked up '+(this.carry.weapon?g.weaponName(this.carry.weapon)+' chalk':this.carry.kind));return true;
    }
    if(g.mirror&&(e.buriedBench||tag==='buried_jail'||tag==='buried_arthur'))return true;
    if(e.buriedBench)return this.equipment.use(e);
    if(tag==='buried_equipment')return this.equipment.pickup(e);
    if(e.zombie_weapon_upgrade==='tazer_knuckles_zm'){
      if(this.meleeUpgrade!=='tazer_knuckles_zm'&&g.spendPoints(6000)){this.meleeUpgrade='tazer_knuckles_zm';g.message('Galvaknuckles purchased');}return true;
    }
    if(e.zombie_weapon_upgrade==='bowie_knife_zm'){
      if(this.meleeUpgrade!=='bowie_knife_zm'&&g.spendPoints(3000)){this.meleeUpgrade='bowie_knife_zm';g.message('Bowie Knife purchased');}return true;
    }
    // keysbuildable(): the key is "built" into the cell door, a 3 s hold with
    // the builder hands (zombie_builder_zm), and the cell opens.
    if(tag==='buried_jail'){
      if(this.carry?.kind!=='key'||this.hold||this.arthur.cellOpen)return true;
      this.hold={kind:'key',started:g.time,due:g.time+3};g.startHoldGesture('zombie_builder');return true;
    }
    // The sloth gift trigger: a 0.75 s hold, each facing the other.
    if(tag==='buried_arthur'){
      if(this.hold||!this.arthur.canGift())return true;
      this.hold={kind:'gift',started:g.time,due:g.time+.75};this.arthur.holding=true;return true;
    }
    if(tag==='buried_chalk_place'){
      if(this.carry?.kind!=='chalk'||this.chalk.has(e.target))return true;
      const name=this.carry.weapon;this.chalk.set(e.target,name);this.installChalk(e,name);this.carry=null;
      g.changePoints(this.chalk.size===6?2000:1000);g.emit('sound',{alias:'cha_ching'});g.emit('buriedChalk',{target:e.target,weapon:name});g.message(g.weaponName(name)+' wall buy drawn');return true;
    }
    if(tag==='buried_barricade')return true;
    if(tag==='buried_bank_deposit'){if(this.bank<250000&&g.spendPoints(1000)){this.bank+=1000;g.message('Bank balance: '+this.bank);}return true;}
    if(tag==='buried_bank_withdraw'){if(this.bank>=1000){this.bank-=1000;g.changePoints(900);g.emit('sound',{alias:'cha_ching'});g.message('Bank balance: '+this.bank);}return true;}
    if(tag==='buried_weapon_locker'){
      if(g.inventory.length<2&&!this.weaponLocker){g.message('You must keep one weapon');return true;}
      const w=g.weapon,stored=this.weaponLocker;this.weaponLocker={name:w.name,clip:w.clip,reserve:w.reserve};
      if(stored){g.giveWeapon(stored.name);g.weapon.clip=stored.clip;g.weapon.reserve=stored.reserve;}
      else{g.inventory.splice(g.slot,1);g.slot=0;g.beginSwitch(w);}g.emit('sound',{alias:'cha_ching'});return true;
    }
    if(tag==='zombie_vending'){
      const id=e.script_noteworthy,p=BO2_PERKS[id],quick=id==='specialty_quickrevive',solo=!g.coop;
      if(!p||this.perks.has(id)||this.perks.size>=4||(!this.equipment.powered(e.position)&&!(quick&&solo))||g.gesture||quick&&solo&&this.revivesUsed>=3)return true;
      if(!g.spendPoints(quick&&solo?500:p.cost))return true;
      g.startGesture(id,()=>{this.perks.add(id);if(id==='specialty_armorvest')g.player.health=250;g.laterDialog(1.5,'perk',id);});g.emit('sound',{alias:p.sting});return true;
    }
    return super.use(e);
  }
  installChalk(e,name){
    const existing=this.game.interactions.find(x=>x.chalkTarget===e.target);if(existing)return;
    this.game.interactions.push({...e,targetname:'weapon_upgrade',chalkTarget:e.target,zombie_weapon_upgrade:name,zombie_cost:String(this.game.data.wallCosts[name]||1000),script_ammo_clip:String(Math.floor((this.game.data.wallCosts[name]||1000)/2))});
  }
  // watch_cell_open_close(): the door swings open and its clip goes.
  openCell(){this.openTargets(this.data.jailTargets||[]);this.arthur.unlock();}
  tickHold(){
    const g=this.game,h=this.hold;if(!h)return;
    // The press lands between ticks; the held state follows on the next one.
    const cancel=!g.useHeld&&g.time-h.started>.1||g.phase==='dead'||(h.kind==='key'?this.carry?.kind!=='key':!this.arthur.canGift()||!this.arthur.carrier());
    if(cancel||g.time>=h.due){
      this.hold=null;this.arthur.holding=false;g.endHoldGesture();if(cancel)return;
      if(h.kind==='key'){this.carry=null;this.openCell();}
      else{const item=this.carry;this.carry=null;this.itemRespawn.set(item.itemId,g.time+60);this.arthur.give(item.kind);}
    }
  }
  tick(){
    // Pack-a-Punch and solo revival timings are shared with the T5 rules.
    super.tick();const g=this.game;if(g.mirror)return;
    this.tickHold();this.equipment.tick(1/120);
    this.tickEnvironment();
    const occupied=this.occupied();for(const v of occupied)this.visited.add(v.name);
    const inMansion=occupied.some(v=>v.name==='zone_mansion');
    if(inMansion&&!this.wasInMansion&&!this.ghostActive){this.ghostActive=true;this.ghostRemaining=6;this.ghostDue=g.time;this.ghostReward=g.round>=this.lastGhostRound+5;}
    this.wasInMansion=inMansion;
    if(this.ghostActive&&this.ghostRemaining>0&&g.time>=this.ghostDue&&g.enemies.filter(e=>!e.dead&&e.kind==='ghost').length<6){if(g.spawnGhost())this.ghostRemaining--;this.ghostDue=g.time+2;}
    if(this.ghostActive&&!this.ghostRemaining&&!g.enemies.some(e=>!e.dead&&e.kind==='ghost')){
      this.ghostActive=false;if(this.ghostReward){this.lastGhostRound=g.round;const choices=Object.keys(BO2_PERKS).filter(p=>!this.perks.has(p));if(choices.length){const id=choices[Math.floor(Math.random()*choices.length)];this.perks.add(id);if(id==='specialty_armorvest')g.player.health=250;g.emit('sound',{alias:BO2_PERKS[id].sting});g.message('Free '+BO2_PERKS[id].name);}}
    }
    for(const [id,due]of this.itemRespawn)if(g.time>=due){this.itemRespawn.delete(id);this.collected.delete(id);g.emit('buriedItem',{id,visible:true});}
    this.arthur.tick(1/120);
    const arthur=g.interactions.find(e=>e.targetname==='buried_arthur');if(arthur)arthur.position=this.arthur.giftOrigin();
  }
  // Shared with co-op guests: Arthur, the cell, the items and the start area.
  coopState(){return {arthur:this.arthur.view(),collected:[...this.collected],activeItems:[...this.activeItems],fxanims:this.fxanimAges()};}
  applyCoopState(s){
    const g=this.game;this.arthur.applyView(s.arthur);this.collected=new Set(s.collected);this.activeItems=new Set(s.activeItems);
    this.fxanims=Object.fromEntries(Object.entries(s.fxanims||{}).map(([k,age])=>[k,g.time-age]));
  }
  fxanimAges(){return Object.fromEntries(Object.entries(this.fxanims).map(([k,at])=>[k,this.game.time-at]));}
  tickEnvironment(){
    const g=this.game,p=[g.player.position[0],g.player.position[1],g.player.position[2]+g.viewHeight/2];
    for(const trigger of g.data.environmentTriggers||[]){
      const touching=trigger.hulls.some(h=>h.mins.every((v,k)=>p[k]>=v-(k<2?14:28))&&h.maxs.every((v,k)=>p[k]<=v+(k<2?14:28))&&h.planes.every(pl=>pl.slice(0,3).reduce((s,v,k)=>s+v*p[k],0)<=pl[3]+16));
      if(!touching)continue;
      if(trigger.kind==='force_from_prone'){if(g.player.stance==='prone')g.changeStance('crouch');continue;}
      if(this.triggered.has(trigger.id))continue;this.triggered.add(trigger.id);
      // The catwalk shakes (an earthquake on the player: 0.3, 3 s, radius
      // 128) and gives way 2 s later, or as soon as the LSAT is bought.
      if(trigger.kind==='start_platform_trig'){this.catwalkDue=g.time+2;g.emit('sound',{alias:'zmb_catwalk_shake',position:trigger.position});g.emit('shake',{position:g.player.position.slice(),amplitude:.3,duration:3,radius:128});}
      // The floor boards under the start room break (client field "bda").
      if(trigger.kind==='hole_breakthrough'){this.openTargets([trigger.target]);if(trigger.target==='pf641_auto6')this.fxanims.boards=g.time;g.emit('sound',{alias:'zmb_floor_collapse',position:trigger.position});}
    }
    if(this.catwalkDue&&(g.time>=this.catwalkDue||g.inventory.some(w=>w.name.startsWith('lsat')))){
      // cw_fall plays the catwalk's fxanim; its delayed clip goes 3 s later.
      this.catwalkDue=null;this.catwalkClipDue=g.time+3;this.fxanims.catwalk=g.time;this.openTargets(['start_platform']);g.emit('sound',{alias:'zmb_catwalk_fall'});
    }
    if(this.catwalkClipDue&&g.time>=this.catwalkClipDue){this.catwalkClipDue=null;this.openTargets(['start_platform_delayed_clip']);}
  }
  saveState(){return {...super.saveState(),visited:[...this.visited],carry:this.carry,chalk:[...this.chalk],collected:[...this.collected],itemRespawn:[...this.itemRespawn],bank:this.bank,weaponLocker:this.weaponLocker,arthur:this.arthur.saveState(),fxanims:this.fxanimAges(),catwalkClipDue:this.catwalkClipDue,ghostActive:this.ghostActive,ghostRemaining:this.ghostRemaining,ghostDue:this.ghostDue,lastGhostRound:this.lastGhostRound,wasInMansion:this.wasInMansion,ghostReward:this.ghostReward,equipment:this.equipment.saveState(),activeItems:[...this.activeItems],maze:this.maze,meleeUpgrade:this.meleeUpgrade,catwalkDue:this.catwalkDue,triggered:[...this.triggered]};}
  loadState(s){super.loadState(s);this.visited=new Set(s.visited||[this.data.initialZone]);this.carry=s.carry||null;this.chalk=new Map(s.chalk||[]);this.collected=new Set(s.collected||[]);this.itemRespawn=new Map(s.itemRespawn||[]);
    this.arthur.loadState(s.arthur);this.fxanims=Object.fromEntries(Object.entries(s.fxanims||{}).map(([k,age])=>[k,this.game.time-age]));this.catwalkClipDue=s.catwalkClipDue??null;
    for(const key of ['bank','weaponLocker','ghostActive','ghostRemaining','ghostDue','lastGhostRound','wasInMansion','ghostReward'])if(s[key]!==undefined)this[key]=s[key];
    this.activeItems=new Set(s.activeItems||[...this.activeItems]);this.maze=s.maze||0;this.applyMaze();this.meleeUpgrade=s.meleeUpgrade||null;this.equipment.loadState(s.equipment);
    this.catwalkDue=s.catwalkDue??null;this.triggered=new Set(s.triggered||[]);
    this.game.interactions=this.game.interactions.filter(e=>!e.chalkTarget);for(const [target,name]of this.chalk){const e=this.game.interactions.find(e=>e.targetname==='buried_chalk_place'&&e.target===target);if(e)this.installChalk(e,name);}
    for(const e of this.game.interactions.filter(e=>e.buriedItem))this.game.emit('buriedItem',{id:e.itemId,visible:!this.collected.has(e.itemId)});
  }
  get fireScale(){return 1;}
}

export class BlackOps2Engine extends BlackOpsEngine {
  settleFeet(at){
    const from=[at[0],at[1],at[2]+8],hit=this.collision.trace(from,[from[0],from[1],from[2]-160],[0,0,0]);
    if(hit.fraction<1&&hit.normal[2]>.65&&!hit.allSolid){
      const center=[hit.end[0],hit.end[1],hit.end[2]+35.1];
      if(!this.collision.trace(center,center,[14,14,34.9]).allSolid)return hit.end;
    }
    return super.settleFeet(at);
  }
  projectGround(at){
    const from=[at[0],at[1],at[2]+1],hit=this.collision.trace(from,[from[0],from[1],from[2]-65],[0,0,0]);
    // T6's dense terrain has vertical triangle edges whose swept box axes
    // look like a floor. Resolve the foot to the actual upward face below it.
    if(hit.fraction<1&&hit.normal[2]>.65&&!hit.allSolid&&at[2]-hit.end[2]>1){
      const center=[hit.end[0],hit.end[1],hit.end[2]+35.1];
      // A point can fit beside a sloped brush while the full actor cannot.
      // Keep the swept support height rather than placing its feet in solid.
      if(!this.collision.trace(center,center,[14,14,34.9]).allSolid)return hit.end;
    }
    return at;
  }
  walkableLink(p,q,navigation=false){
    if(!navigation)return super.walkableLink(p,q,false);
    const length=Math.hypot(q[0]-p[0],q[1]-p[1]);if(length>1024||Math.abs(q[2]-p[2])>256)return false;
    let at=p.slice(),velocity=0;
    for(let i=0;i<Math.ceil(length/.475)+120;i++){
      const dx=q[0]-at[0],dy=q[1]-at[1],left=Math.hypot(dx,dy);if(left<1&&Math.abs(at[2]-q[2])<8)return true;
      const step=Math.min(.475,left);velocity-=800/120;const r=this.collision.step(at,[left?dx/left*step:0,left?dy/left*step:0,velocity/120]);
      at=r.grounded?this.projectGround(r.position):r.position;if(r.grounded)velocity=0;if(at[2]<Math.min(p[2],q[2])-72)return false;
    }return false;
  }
  advancePath(e,dt,target){
    const done=super.advancePath(e,dt,target);
    if(e.velocityZ===0){const floor=this.projectGround(e.position);if(e.position[2]-floor[2]>18)e.position=floor;}
    return done;
  }
  prepareSpawnPaths(prepared){super.prepareSpawnPaths(prepared);this.navigationReady=!!prepared?.version;}
  nearest(position,visible=false,regular=false,options={}){
    // The packaged graph was walked on the host. Live actors only need a
    // local connection to it; do not re-walk 32 distant nodes per zombie.
    if(this.navigationReady&&visible&&options.physics===undefined)options={cheap:16,physics:2,...options};
    return super.nearest(position,visible,regular,options);
  }
  constructor(manifest,collision,paths,events={},presentation={}){
    super(manifest,collision,paths,events,presentation,g=>new BuriedRules(g));this.engine='black-ops-t6';
    // Only original, authored hedge gates contribute these solid bounds.
    for(const hull of manifest.map.collisionHulls||[])if(!collision.brushes.some(b=>b.target===hull.target))collision.add(hull,[0,0,0],hull.target);
    for(const e of manifest.entities){
      const kind=itemKinds[e.nativeItemTarget||e.targetname];let tag;
      if(kind||e.buriedPart){if(kind==='key'&&e.script_forcespawn!=='1')continue;this.interactions.push({...e,position:pos(e),buriedItem:kind,itemId:e.itemId||e.guid});continue;}
      if(/^(?:turbine|springpad_zm|headchopper_zm|subwoofer_zm)_buildable_trigger$/.test(e.targetname||'')){this.interactions.push({...e,position:pos(e),buriedBench:true});continue;}
      if(e.targetname==='chalk_buildable_trigger')tag='buried_chalk_place';
      if(e.targetname==='sloth_barricade')tag='buried_barricade';
      if(e.targetname==='cell_door_trigger')tag='buried_jail';
      if(e.targetname==='bank_deposit')tag='buried_bank_deposit';if(e.targetname==='bank_withdraw')tag='buried_bank_withdraw';
      if(e.targetname==='weapons_locker')tag='buried_weapon_locker';
      if(tag)this.interactions.push({...e,position:pos(e),targetname:tag});
    }
    if(!this.interactions.some(e=>e.targetname==='buried_jail'))this.interactions.push({targetname:'buried_jail',position:[-1128,522,41],origin:'-1128 522 41'});
    this.interactions.push({targetname:'buried_arthur',position:this.mapRules.arthur.giftOrigin()});
  }
  newGame(){
    super.newGame();this.interactions=this.interactions.filter(e=>!e.chalkTarget);this.paralyzerHeat=0;this.paralyzerLock=false;this.paralyzerFiredAt=-100;
    this.equipmentFlight=null;this.slideVelocity=null;this.projectiles=[];this.nextProjectileId=1;this.recycleHealth=[];
    this.windows.forEach(w=>{if(!w.boardEntities.some(e=>e.nativeBoard))w.boards=0;});
    this.interactions=this.interactions.filter(e=>!e.equipmentId);
  }
  get movementBlocked(){return super.movementBlocked||!!this.mapRules?.equipment?.building||!!this.mapRules?.hold;}
  weaponName(name){
    const labels={slowgun_zm:'Paralyzer',slowgun_upgraded_zm:'Petrifier',m1911_upgraded_zm:'Mustang & Sally',raygun_mark2_zm:'Ray Gun Mark II',raygun_mark2_upgraded_zm:'Porter’s Mark II Ray Gun',fnfal_zm:'FAL',rnma_zm:'Remington New Model Army'};
    if(labels[name])return labels[name];
    if(name.includes('_upgraded_'))return this.weaponName(name.replace('_upgraded',''))+' (Pack-a-Punch)';
    return super.weaponName(name);
  }
  placeEquipment(){return this.mapRules.equipment.place();}
  movePlayerOverride(p,input,dt){
    if(this.mods?.noclip)return super.movePlayerOverride(p,input,dt);
    // The factory chute is slick: gravity accelerates along its real slope.
    // The low exit needs the crouched hull rather than stopping at its lip.
    const at=p.position,inChute=this.opened.has('pf641_auto6')&&at[0]>-3200&&at[0]<-1340&&at[1]>-540&&at[1]<-60&&at[2]>360&&at[2]<1270;
    if(inChute){
      if(at[0]>-1550&&p.stance==='stand')this.changeStance('crouch');
      const center=[at[0],at[1],at[2]+this.playerHull[2]],floor=this.collision.trace(center,[center[0],center[1],center[2]-6],this.playerHull);
      const v=this.slideVelocity||[0,0,p.velocityZ||0];v[2]-=800*dt;
      // Native slide-push destination: (-1336, -320, 360).
      if(at[0]>-1600)v[1]+=(-320-at[1])*dt*15;
      if(floor.fraction<1&&floor.normal[2]>.1){const n=floor.normal,dot=v.reduce((sum,x,k)=>sum+x*n[k],0);if(dot<0)for(let k=0;k<3;k++)v[k]-=dot*n[k];}
      const length=Math.hypot(...v);if(length>650)for(let k=0;k<3;k++)v[k]*=650/length;
      const result=this.collision.step(at,v.map(x=>x*dt),this.playerHull);p.position=result.position;p.grounded=result.grounded;p.velocityZ=v[2];this.slideVelocity=v;this.sprinting=false;return true;
    }this.slideVelocity=null;
    if(this.opened.has('pf641_auto6')&&at[0]>-1400&&at[0]<-750&&at[1]>-540&&at[1]<-60&&at[2]>270&&at[2]<350&&input.forward>0){
      const dir=[Math.cos(this.yaw),Math.sin(this.yaw)],normal=this.collision.step(at,[dir[0],dir[1],0],this.playerHull);
      if(Math.hypot(normal.position[0]-at[0],normal.position[1]-at[1])<.1){
        const mode=this.collision.playerMovement;this.collision.playerMovement=false;let step;
        try{step=this.collision.step(at,[dir[0]*2,dir[1]*2,0],this.playerHull);}finally{this.collision.playerMovement=mode;}
        if(Math.hypot(step.position[0]-at[0],step.position[1]-at[1])>1){p.position=step.position;p.grounded=step.grounded;p.velocityZ=0;return true;}
      }
    }
    const f=this.equipmentFlight;if(!f)return false;
    f.velocity[2]-=800*dt;const result=this.collision.step(p.position,f.velocity.map(v=>v*dt),this.playerHull);p.position=result.position;p.velocityZ=f.velocity[2];p.grounded=result.grounded;
    if(result.grounded||result.position[2]<-500)this.equipmentFlight=null;this.sprinting=false;return true;
  }
  giveWeapon(name){
    if(!this.mapRules.perks.has('specialty_additionalprimaryweapon')||this.inventory.length>=3||this.inventory.some(w=>w.name===name))return super.giveWeapon(name);
    const previous=this.weapon;this.inventory.push(this.makeWeapon(name));this.slot=this.inventory.length-1;this.beginSwitch(previous);
  }
  hitEnemy(enemy,damage,head=false,melee=false){
    if(this.firingNative&&this.weapon.definition.weaponType==='projectile'&&!melee)return;
    if(!enemy.dead)enemy.damaged=true;
    if(this.firingNative&&!melee&&this.mapRules.perks.has('specialty_rof')&&!this.weapon.name.startsWith('slowgun'))damage*=2;
    const alive=!enemy.dead;super.hitEnemy(enemy,damage,head,melee);
    if(alive&&enemy.dead&&enemy.kind!=='ghost'&&enemy.stage==='hunt'&&this.mapRules.perks.has('specialty_nomotionsensor')&&Math.random()<.65&&this.drops.filter(d=>!d.used&&d.type.startsWith('vulture_')).length<20){
      const type=Math.random()<.5?'vulture_ammo':'vulture_points';const drop=this.addDrop(type,enemy.position);if(drop)drop.expires=this.time+12;
    }
  }
  spawnEnemy(){
    const before=this.nextId;
    const spawners=this.enabledSpawners(),inside=spawners.filter(e=>e.nativeNoteworthy==='riser_location');
    const reachable=at=>this.walkableLink(at,this.player.position)||this.path(at,this.player.position,true).length>0;
    const windows=super.availableWindows().filter(w=>reachable(w.entry));
    if(inside.length&&(!windows.length||Math.random()<inside.length/Math.max(1,spawners.length))){
      for(const spawner of inside.sort(()=>Math.random()-.5)){
        let at;const p=pos(spawner);for(const height of [80,32]){try{const candidate=this.settleFeet([p[0],p[1],p[2]+height]);if(reachable(candidate)){at=candidate;break;}}catch{}}
        if(!at||distance(at,this.player.position)<110)continue;const gait=this.zombieGait();
        const enemy={id:this.nextId++,position:at,previousPosition:at.slice(),health:this.zombieHealth,window:this.windows[0],stage:'rise',riseUntil:this.time+1.5,path:[],attackDue:0,navDue:0,angle:Number((spawner.angles||'0 0 0').split(' ')[1])*Math.PI/180,dead:false,age:0,spawnTime:this.time,gait:gait.name,speed:gait.speed};
        if(this.recycleHealth.length)enemy.health=this.recycleHealth.shift();this.enemies.push(enemy);this.remaining--;this.emit('spawn',enemy);return;
      }
    }if(!windows.length)return;
    // Native roof/faller goals without a supported route must never strand
    // the round. Keep the authored windows that can reach this occupied room.
    const available=this.availableWindows;this.availableWindows=()=>windows;try{super.spawnEnemy();}finally{this.availableWindows=available;}
    const enemy=this.enemies.find(e=>e.id===before);if(enemy&&this.recycleHealth.length)enemy.health=this.recycleHealth.shift();
  }
  tickEnemy(e,dt){
    if(e.kind==='ghost'&&!e.dead){
      e.age+=dt;const target=this.player.position,d=target.map((v,k)=>v-e.position[k]),length=Math.hypot(...d);e.angle=Math.atan2(d[1],d[0]);
      if(length<58&&this.time>=e.attackDue){e.attackDue=this.time+1;this.changePoints(-Math.min(2000,this.player.points));e.dead=true;e.deathTime=this.time;this.emit('kill',e);this.emit('sound',{alias:'zmb_ai_ghost_money_drain'});}
      else if(length>1)e.position=e.position.map((v,k)=>v+d[k]/length*Math.min(length,75*dt));return;
    }
    if(e.stage==='rise'&&!e.dead){e.age+=dt;if(this.time>=e.riseUntil)e.stage='hunt';return;}
    // Recycle a zombie left at the factory after the one-way
    // descent. Its remaining health and place in the round stay intact.
    const players=this.coop?.playerPositions()||[this.player.position];
    if(!e.dead&&this.time-e.spawnTime>12&&players.every(p=>distance(e.position,p)>2400)){
      e.recycleAt??=this.time+(e.damaged?20:4);if(this.time>=e.recycleAt){e.dead=true;e.deathTime=this.time;this.recycleHealth.push(e.health);this.remaining++;e.window.attackers=e.window.attackers?.map(x=>x===e?null:x);if(e.window.traverser===e)e.window.traverser=null;this.emit('removeEnemy',e);return;}
    }else e.recycleAt=null;
    const speed=e.speed;if(e.paralyzedUntil>this.time)e.speed*=.15;try{super.tickEnemy(e,dt);}finally{e.speed=speed;}
    if(!e.dead&&e.stage==='hunt'&&!e.clear&&!e.path.length){
      e.unreachableSince??=this.time;
      if(this.time-e.unreachableSince>15&&distance(e.position,this.player.position)>150){const from=[...this.player.position];from[2]+=this.viewHeight;const to=[...e.position];to[2]+=35;
        if(this.collision.trace(from,to,[0,0,0],1).fraction<.98){e.dead=true;e.deathTime=this.time;this.recycleHealth.push(e.health);this.remaining++;this.emit('removeEnemy',e);}}
    }else e.unreachableSince=null;
  }
  spawnGhost(){
    const rows=this.entities.filter(e=>/^ghost_(?:from_maze_)?zone_.*_spawners$/.test(e.targetname||''));
    const options=rows.filter(e=>distance(pos(e),this.player.position)>120).sort((a,b)=>distance(pos(a),this.player.position)-distance(pos(b),this.player.position));if(!options.length)return false;
    const at=pos(options[Math.floor(Math.random()*Math.min(4,options.length))]),enemy={id:this.nextId++,kind:'ghost',position:at,previousPosition:at.slice(),health:100,window:this.windows[0],stage:'hunt',path:[],attackDue:0,navDue:0,angle:0,dead:false,age:0,spawnTime:this.time,gait:'ai_zombie_walk_v1',speed:75};
    this.enemies.push(enemy);this.emit('spawn',enemy);this.emit('sound',{alias:'zmb_ai_ghost_apparate',position:at});return true;
  }
  fire(){
    if(!this.weapon.name.startsWith('slowgun'))return super.fire();
    if(['dead','ready'].includes(this.phase)||this.movementBlocked||this.switching||this.gesture||this.pendingGrenade||this.mapRules.reviveDue||this.paralyzerLock||this.time<this.cooldown)return false;
    if(this.sprinting){this.sprinting=false;this.sprintExitUntil=this.time+.3;return false;}if(this.time<this.sprintExitUntil)return false;
    const definition=this.weapon.definition;
    this.cooldown=this.time+.1;this.paralyzerFiredAt=this.time;this.paralyzerHeat+=(definition.overheatRate-(definition.coolWhileFiring?definition.cooldownRate:0))*.1;this.shots++;
    if(this.paralyzerHeat>=115){this.paralyzerHeat=115;this.paralyzerLock=true;}
    const origin=[...this.player.position];origin[2]+=this.viewHeight;
    for(const e of this.enemies){if(e.dead)continue;
      const d=e.position.map((v,k)=>v-origin[k]+(k===2?35:0)),range=Math.hypot(...d),yaw=Math.atan2(d[1],d[0]),pitch=Math.atan2(d[2],Math.hypot(d[0],d[1]));
      if(range>550||Math.cos(yaw-this.yaw)<.94||Math.abs(pitch-this.pitch)>.35)continue;
      const ray=this.rayHit(550,yaw,pitch);if(ray.hit?.enemy!==e)continue;
      e.paralyzedUntil=this.time+.35;e.paralyzerExposure=(e.paralyzerExposure||0)+.1;
      if(e.paralyzerExposure>=1){
        let damage=(this.weapon.name.includes('upgraded')?60:40)*(.667+Math.random()*.833)*(e.paralyzerMultiplier||1);
        if(e.paralyzerDamage>47073)damage*=47073/e.paralyzerDamage;
        e.paralyzerDamage=(e.paralyzerDamage||0)+damage;e.paralyzerMultiplier=Math.min(50,(e.paralyzerMultiplier||1)*1.15);
        super.hitEnemy(e,damage,false,false);this.emit('hit',false);
      }
    }
    this.emit('shot',{origin,dir:[Math.cos(this.pitch)*Math.cos(this.yaw),Math.cos(this.pitch)*Math.sin(this.yaw),Math.sin(this.pitch)],rays:[]});this.emit('sound',{alias:this.weapon.definition.fireSoundPlayer});
    if(this.pitch<-.9){this.player.velocityZ=Math.max(this.player.velocityZ,160);this.player.grounded=false;}return true;
  }
  reload(){if(this.weapon.name.startsWith('slowgun'))return false;return super.reload();}
  pickup(drop){
    if(!drop.type.startsWith('vulture_'))return super.pickup(drop);
    if(!this.mapRules.perks.has('specialty_nomotionsensor'))return;drop.used=true;this.emit('pickup',drop);this.emit('stopLoop',{id:'drop'+drop.id});
    if(drop.type==='vulture_ammo'){
      const w=this.weapon;if(w.name.startsWith('slowgun'))this.paralyzerHeat=Math.max(0,this.paralyzerHeat-1-Math.floor(Math.random()*2));
      else w.reserve=Math.min(w.definition.maxAmmo,w.reserve+Math.max(1,Math.floor(w.definition.maxAmmo*Math.random()*.025)));
      this.emit('sound',{alias:'zmb_vulture_drop_pickup_ammo'});
    }else{this.changePoints(5*(1+Math.floor(Math.random()*4)));this.emit('sound',{alias:'zmb_vulture_drop_pickup_money'});}
  }
  tick(dt,input){
    super.tick(dt,input);if(this.phase==='ready'||this.phase==='dead')return;
    if(this.player.grounded&&!this.mods?.noclip&&!this.dive){const floor=this.projectGround(this.player.position);if(this.player.position[2]-floor[2]>18)this.player.position=floor;}
    if(this.time-this.paralyzerFiredAt>.2){this.paralyzerHeat=Math.max(0,this.paralyzerHeat-dt*(this.weapon.definition.cooldownRate||3));if(this.paralyzerHeat<=(this.weapon.definition.overheatEndVal||87))this.paralyzerLock=false;}
    for(const e of this.enemies)if(e.paralyzedUntil<this.time){e.paralyzerExposure=Math.max(0,(e.paralyzerExposure||0)-dt*.5);e.paralyzerMultiplier=1;}
    this.updateProjectiles(dt);
  }
  emit(type,value){
    if(type==='shot'&&this.firingNative&&this.weapon.definition.weaponType==='projectile'){
      const d=this.weapon.definition,p={id:this.nextProjectileId++,weapon:this.weapon.name,position:value.origin.slice(),previousPosition:value.origin.slice(),direction:value.dir.slice(),velocity:value.dir.map(v=>v*(d.projectileSpeed||2300)),due:this.time+(d.projectileLifetime||5),hitIds:[]};
      this.projectiles.push(p);super.emit('buriedProjectile',p);value={...value,rays:[]};
    }return super.emit(type,value);
  }
  updateProjectiles(dt){
    for(const p of this.projectiles){if(p.done)continue;const d=this.data.weapons[p.weapon],old=p.position;
      if(d.projTrajectory==='gravity')p.velocity[2]-=800*dt;
      const move=p.velocity.map(v=>v*dt),length=Math.hypot(...move),dir=move.map(v=>v/length),ray=this.events.traceShot?.(old,dir,length);
      p.previousPosition=old.slice();p.position=ray?.hit||ray?.wall?ray.end.slice():old.map((v,k)=>v+move[k]);
      if(ray?.hit&&!p.hitIds.includes(ray.hit.enemy.id)){
        p.hitIds.push(ray.hit.enemy.id);this.hitEnemy(ray.hit.enemy,d.damage*(ray.hit.head?d.locHead||1:1),ray.hit.head,false);super.emit('hit',ray.hit.head);super.emit('projectileImpact',ray);
      }
      const penetrates=p.weapon.startsWith('raygun_mark2');
      if(penetrates&&ray?.hit){p.position=old.map((v,k)=>v+move[k]);}
      if(ray?.wall||ray?.hit&&!penetrates||this.time>=p.due){
        p.done=true;
        if(d.explosionRadius>0){
          for(const e of this.enemies.filter(e=>!e.dead)){const to=[e.position[0],e.position[1],e.position[2]+35],r=distance(p.position,to);if(r>=d.explosionRadius||this.collision.trace(p.position,to,[0,0,0],1).fraction<.98)continue;
            this.hitEnemy(e,d.explosionOuterDamage+(d.explosionInnerDamage-d.explosionOuterDamage)*(1-r/d.explosionRadius),false,false);}
          const player=[...this.player.position];player[2]+=35;const r=distance(p.position,player);
          if(r<d.explosionRadius&&this.collision.trace(p.position,player,[0,0,0],1).fraction>.98)this.damagePlayer(Math.min(100,d.explosionOuterDamage+(d.explosionInnerDamage-d.explosionOuterDamage)*(1-r/d.explosionRadius)));
          super.emit('explosion',p);super.emit('sound',{alias:d.projExplosionSound||'grenade_explode',position:p.position});
        }
        // Non-explosive projectiles (Ray Gun Mark II) still burst where they stop.
        else if(d.projExplosionEffect&&(ray?.wall||ray?.hit))super.emit('explosion',p);
        super.emit('buriedProjectileRemove',p.id);
      }
    }this.projectiles=this.projectiles.filter(p=>!p.done);
  }
  melee(){
    const w=this.weapon,d=w.definition,upgrade=this.data.meleeUpgrades?.[this.mapRules.meleeUpgrade];
    if(upgrade)w.definition={...d,meleeDamage:upgrade.meleeDamage};try{return super.melee();}finally{w.definition=d;}
  }
  canSave(){return !this.mapRules.equipment.building&&!this.equipmentFlight&&!this.slideVelocity&&!this.projectiles.length&&super.canSave();}
  saveState(){return {...super.saveState(),paralyzerHeat:this.paralyzerHeat,paralyzerLock:this.paralyzerLock,recycleHealth:this.recycleHealth};}
  loadState(s){super.loadState(s);this.paralyzerHeat=s.paralyzerHeat||0;this.paralyzerLock=!!s.paralyzerLock;this.recycleHealth=s.recycleHealth||[];}
}
