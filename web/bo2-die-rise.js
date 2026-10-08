// Classic Die Rise: zm_highrise*.gsc on the shared T6 engine. The perk and
// Pack-a-Punch machines ride the building's elevators; the escape pod drops
// to the ground floor; leaper rounds replace hellhound rounds.
import {KinoRules} from './bo1-engine.js';
import {NuketownRules} from './bo2-nuketown.js';
import {BuriedEquipment} from './bo2-equipment.js';
import {PERKS} from './map-rules.js';
const pos=e=>e.origin.split(/\s+/).map(Number),distance=(a,b)=>Math.hypot(...a.map((v,k)=>v-b[k]));
const inside=(at,h)=>h.mins.every((v,k)=>at[k]>=v)&&h.maxs.every((v,k)=>at[k]<=v)&&h.planes.every(p=>p[0]*at[0]+p[1]*at[1]+p[2]*at[2]<=p[3]+1);
const shuffle=items=>{const a=items.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
// randomintrange(a,b): a..b-1.
const between=(a,b)=>a+Math.floor(Math.random()*(b-a));
export const RISE_PERKS={...PERKS,specialty_rof:{...PERKS.specialty_rof,name:'Double Tap II'},
  specialty_additionalprimaryweapon:{name:'Mule Kick',cost:4000,sting:'mx_mule_sting'},
  specialty_finalstand:{name:'Who’s Who',cost:2000,sting:'mx_whoswho_sting'}};
// elevator_think(): 100 units/s, moveto with a quarter of the time each
// accelerating and decelerating.
const SPEED=100,ACCEL=.25;
const travel=f=>{const v=1/(1-ACCEL);f=Math.max(0,Math.min(1,f));return f<ACCEL?v*f*f/(2*ACCEL):f<1-ACCEL?v*(ACCEL/2+f-ACCEL):1-v*(1-f)**2/(2*ACCEL);};
// p6_anim_zm_hr_elevator_common: 192 x 208, roof at 138, doors on local -x.
const CAR={half:[96,104],roof:138,boxes:[[[-96,-104,-12],[96,104,0]],[[-96,-104,126],[96,104,138]],[[88,-104,0],[96,104,126]],[[-96,-104,0],[96,-96,126]],[[-96,96,0],[96,104,126]]],door:[[-96,-104,0],[-88,104,126]]};
// p6_anim_zm_hr_elevator_freight (the escape pod): 192 x 192.
const POD={half:[96,96],roof:150,boxes:[[[-96,-96,-13],[96,96,0]],[[88,-96,0],[96,96,150]],[[-96,-96,0],[96,-88,150]],[[-96,88,0],[96,96,150]]],door:[[-96,-96,0],[-88,96,150]]};
const WHOS_WHO_BLEEDOUT=45;

class RiseEquipment extends BuriedEquipment {
  prompt(e,key){const b=this.benches.get(e.targetname),kind=e.riseBench;
    if(kind==='slipgun_zm'&&b?.complete)return this.rules.slipgunTaken?'Sliquifier taken · it is now in the Mystery Box':key+' · Take Sliquifier';
    if(this.rules.carry?.kind==='key')return 'Carrying the elevator key';
    if(this.rules.carry?.equipment&&this.rules.carry.equipment!==kind)return 'This bench builds '+this.name(kind);
    return super.prompt(e,key);}
  use(e){const kind=e.riseBench,g=this.game;if(!kind)return true;
    if(this.rules.carry&&this.rules.carry.equipment!==kind)return true;
    const b=this.benches.get(e.targetname);
    // slipgunbuildable(): the Sliquifier is taken once, then joins the box.
    if(kind==='slipgun_zm'&&b?.complete){if(this.rules.slipgunTaken)return true;this.rules.slipgunTaken=true;g.giveWeapon('slipgun_zm');g.emit('sound',{alias:'wpn_slipgun_pickup_plr'});
      if(!g.data.map.boxWeapons.includes('slipgun_zm'))g.data.map.boxWeapons.push('slipgun_zm');return true;}
    return super.use(e);}
}

export class DieRiseRules extends KinoRules {
  get maxHealth(){return this.perks.has('specialty_armorvest')?250:100;}
  reset(){
    super.reset();const g=this.game;this.flags.add('always_on');
    g.data.map.boxWeapons=g.data.map.boxWeapons.filter(n=>n!=='slipgun_zm');this.slipgunTaken=false;
    this.collected=new Set();this.partChoices={};for(const [group,choices]of Object.entries(this.data.partGroups))this.partChoices[group]=choices[Math.floor(Math.random()*choices.length)];
    this.equipment=new RiseEquipment(this);this.carry=null;this.meleeUpgrade=null;this.keySpot=this.data.keySpawns[Math.floor(Math.random()*this.data.keySpawns.length)];
    this.leaperRound=false;this.leaperRounds=0;this.nextLeaperRound=1+between(4,7);this.leaperReward=true;this.leaperDue=0;this.usedLeaperSpawns=new Set();
    this.goo=[];this.whosWho=null;this.hazardDue=0;this.lastTick=g.time;this.salePlaying=false;
    this.assignMachines();this.resetElevators();
    const p=this.data.escapePod;this.pod={state:'top',z:p.home[2],from:p.home[2],to:p.home[2],started:0,duration:0,ready:0,due:0};
    this.installed&&this.syncInteractions();
  }
  // init_elevator_perks(): Quick Revive on the forced 1b struct, Who's Who and
  // Speed Cola split between the other green cars, the blue machines shuffled.
  assignMachines(){
    const cars=this.data.elevators,green=shuffle(cars.filter(c=>c.slot.building==='green'&&!c.quickRevive)),blue=shuffle(cars.filter(c=>c.slot.building==='blue'));
    const slots=[cars.find(c=>c.quickRevive),...green,...blue],perks=this.data.perkMachines;
    const order=[perks[0],...shuffle(perks.filter(p=>p.building==='green'&&p!==perks[0])),...shuffle(perks.filter(p=>p.building==='blue'))];
    this.machineCar={};order.forEach((m,i)=>{if(slots[i])this.machineCar[m.perk]=slots[i].name;});
  }
  resetElevators(){
    // main(): 3 and 3b start on opposite stops, chosen by a coin toss.
    const flip=Math.random()>.5;
    this.cars={};for(const c of this.data.elevators){
      let force=c.force,offset=0;if(c.pair){const first=c.name==='3';force=first===flip?1:2;offset=force===1?-1264:0;}
      const s={name:c.name,z:c.origin[2],floor:c.start,next:null,force,phase:'power',due:0,from:0,to:0,started:0,duration:0,touch:0,early:false,skip:false,doors:false,papHold:null};
      if(force!=null){s.floor=String(force);s.z=c.floors[s.floor]+offset;}
      this.cars[c.name]=s;
    }
  }
  installInteractions(){const g=this.game;this.installed=true;
    for(const e of g.entities)if(e.risePart||e.riseBench||e.riseKey||['rise_elevator_call','rise_pod_console'].includes(e.targetname))g.interactions.push({...e,position:pos(e)});
    g.interactions.push({targetname:'rise_whoswho_body',position:[0,0,-1e5]});
    this.syncInteractions();
  }
  car(name){return this.data.elevators.find(c=>c.name===name);}
  frame(c,s=this.cars[c.name]){return {position:[c.origin[0],c.origin[1],s.z],yaw:c.yaw*Math.PI/180};}
  local(frame,at){const dx=at[0]-frame.position[0],dy=at[1]-frame.position[1],c=Math.cos(frame.yaw),s=Math.sin(frame.yaw);return [dx*c+dy*s,-dx*s+dy*c,at[2]-frame.position[2]];}
  // A machine stays where random_elevator_perks() linked it to its car.
  machinePose(perk){
    const c=this.car(this.machineCar[perk]),m=this.data.perkMachines.find(m=>m.perk===perk);if(!c)return null;
    const yaw=c.yaw*Math.PI/180,o=c.slot.origin,lift=c.name==='3b'?8:0,z=this.cars[c.name].z-c.origin[2];
    return {position:[o[0]-Math.cos(yaw)*m.offset,o[1]-Math.sin(yaw)*m.offset,o[2]+lift+z],angles:c.slot.angles};
  }
  syncInteractions(){const g=this.game;
    if(this.syncedFrom!==g.interactions){this.syncedFrom=g.interactions;this.synced=g.interactions.filter(e=>e.riseMachine||e.targetname==='rise_whoswho_body');}
    this.machineModels??=g.entities.filter(e=>e.riseMachine&&e.classname==='script_model');
    for(const e of this.synced){
      if(e.riseMachine){const p=this.machinePose(e.riseMachine);if(!p)continue;e.position=[p.position[0],p.position[1],p.position[2]+35];e.origin=e.position.join(' ');e.angles=p.angles;}
      else e.position=this.whosWho?this.whosWho.body.slice():[0,0,-1e5];
    }
    for(const e of this.machineModels){const p=this.machinePose(e.riseMachine);if(p){e.origin=p.position.join(' ');e.angles=p.angles;}}
  }
  // The renderer's movers: each car and the escape pod.
  get moverTargets(){return [...this.data.elevators.map(c=>c.body),this.data.escapePod.body];}
  moverOffset(entity){
    if(entity.targetname===this.data.escapePod.body)return [0,0,this.pod.z-this.data.escapePod.home[2]];
    const c=this.data.elevators.find(c=>c.body===entity.targetname);if(!c)return null;
    return [0,0,this.cars[c.name].z-pos(entity)[2]];
  }
  // Navigation was walked with the shafts empty; a car standing at the
  // floor links its interior to the hallway (elevator_enable_paths).
  negotiationLink(a,b,l){
    if(!l.negotiation&&(this.shaftNode(a)||this.shaftNode(b))&&!this.blockedNode(a)&&!this.blockedNode(b)){const p=this.game.nodes[a].origin,q=this.game.nodes[b].origin;if(Math.abs(p[2]-q[2])<24&&Math.hypot(p[0]-q[0],p[1]-q[1])<256)return true;}
    return NuketownRules.prototype.negotiationLink.call(this,a,b,l);
  }
  startTraversal(e){return NuketownRules.prototype.startTraversal.call(this,e);}
  advanceTraversal(e,dt){return NuketownRules.prototype.advanceTraversal.call(this,e,dt);}
  boxJoker(){return NuketownRules.prototype.boxJoker.call(this);}
  boxCost(e){return this.game.powerup.fire_sale?10:Number(e.zombie_cost)||950;}
  // highrise_zone_init(): zones enabled at load, zone_blue_level4b once the
  // power is on; the fourth argument of add_adjacent_zone is one-way.
  activeZones(){
    const active=new Set(this.data.initialZones);if(this.power)active.add('zone_blue_level4b');let changed=true;
    while(changed){changed=false;for(const [a,b,flag,one]of this.data.connections)if(this.flags.has(flag)){
      if(active.has(a)&&!active.has(b)){active.add(b);changed=true;}if(!one&&active.has(b)&&!active.has(a)){active.add(a);changed=true;}}}
    return active;
  }
  occupiedZones(){
    const g=this.game,points=(g.coop?.playerPositions()||[g.player.position]).map(p=>[p[0],p[1],p[2]+25]);
    const occupied=new Set(this.data.volumes.filter(v=>points.some(p=>v.hulls.some(h=>h.mins.every((m,k)=>p[k]>=m-2)&&h.maxs.every((m,k)=>p[k]<=m+2)&&h.planes.every(pl=>pl[0]*p[0]+pl[1]*p[1]+pl[2]*p[2]<=pl[3]+2)))).map(v=>v.name));
    if(!occupied.size)occupied.add(this.data.initialZone);return occupied;
  }
  spawnZones(){
    const enabled=this.activeZones(),occupied=this.occupiedZones(),zones=new Set(occupied);
    for(const [a,b,flag,one]of this.data.connections)if(this.flags.has(flag)){if(occupied.has(a))zones.add(b);if(!one&&occupied.has(b))zones.add(a);}
    return new Set([...zones].filter(z=>enabled.has(z)||occupied.has(z)));
  }
  enabledSpawners(){
    const zones=this.spawnZones(),groups=new Set(this.data.volumes.filter(v=>zones.has(v.name)).map(v=>v.spawners));
    // faller_location_logic(): no faller climbs out where a car is at the door.
    return this.game.spawnEntities.filter(e=>groups.has(e.targetname)&&!(e.fallerElevator&&this.carNear(e.fallerElevator.replace('bldg',''),pos(e))));
  }
  // A spawn_location attacks the barricade its script_string names.
  spawnerWindows(origin){
    const g=this.game;this.namedWindows??=new Map(g.spawnEntities.filter(e=>e.nativeNoteworthy==='spawn_location').map(e=>[pos(e).join(','),
      g.windows.filter(w=>this.data.goals[w.target]?.barricade===e.script_string)]));
    const own=this.namedWindows.get(origin.join(','));return own?.length?own:null;
  }
  carNear(name,at){const c=this.car(name);return !!c&&Math.abs(this.cars[name].z-at[2])<128;}
  visible(e){const g=this.game;
    if(e.risePart)return this.partChoices[e.partGroup]===e.itemId&&!this.collected.has(e.itemId);
    if(e.riseKey)return e.itemId===this.keySpot&&this.carry?.kind!=='key';
    if(e.targetname==='rise_whoswho_body')return !!this.whosWho;
    if(e.targetname==='rise_pod_console')return this.pod.state==='bottom';
    if(e.targetname==='buried_equipment')return this.equipment.placed.some(p=>p.id===e.equipmentId);
    if(e.targetname==='treasure_chest_use'&&g.powerup.fire_sale)return true;
    if(e.targetname==='zombie_vending'&&e.script_noteworthy==='specialty_quickrevive')return !!g.coop||this.revivesUsed<3;
    return super.visible(e);
  }
  prompt(e,key){const g=this.game;
    if((e.risePart||e.riseBench)&&g.mirror)return 'The host assembles buildables';
    if(e.risePart)return this.carry?'Already carrying '+(this.carry.kind==='key'?'the key':'a part'):key+' · Pick up '+this.equipment.name(e.risePart)+' part';
    if(e.riseKey)return this.carry?'Already carrying a part':key+' · Pick up the elevator key';
    if(e.riseBench)return this.equipment.prompt(e,key);
    if(e.targetname==='buried_equipment')return key+' · Pick up '+this.equipment.name(this.equipment.placed.find(p=>p.id===e.equipmentId)?.kind||'springpad_zm');
    if(e.targetname==='rise_whoswho_body')return key+' · Revive your body · '+Math.max(0,Math.ceil(this.whosWho.due-g.time))+'s';
    if(e.targetname==='rise_pod_console')return this.carry?.kind==='key'?key+' · Use the key to call the escape pod':'The escape pod needs the elevator key';
    if(e.targetname==='rise_elevator_call'){
      if(!this.power)return 'You must turn on the power first';const s=this.cars[e.script_noteworthy.replace('bldg','')];if(!s)return '';
      if(this.callTarget(e)===s.floor&&s.phase!=='moving')return 'The elevator is here';
      return this.carry?.kind==='key'?key+' · Call the elevator':'Requires the elevator key';}
    if(e.targetname==='zombie_vending'){
      const id=e.script_noteworthy,p=RISE_PERKS[id],quick=id==='specialty_quickrevive';if(!p)return '';
      if(this.perks.has(id))return p.name+' purchased';if(!this.power&&!(quick&&!g.coop))return 'You must turn on the power first';
      if(this.perks.size>=4)return 'Four perks already purchased';
      return key+' · Buy '+p.name+' · '+(quick&&!g.coop?500:p.cost)+' points';}
    if(e.targetname==='zombie_vending_upgrade'){
      if(!this.power)return 'You must turn on the power first';
      if(this.pap)return this.pap.phase==='ready'?key+' · Take '+g.weaponName(this.pap.upgraded):'Pack-a-Punch · upgrading…';
      return g.weapon.definition.upgrade?key+' · Pack-a-Punch · 5000 points':'No further upgrade available';}
    if(e.zombie_weapon_upgrade==='tazer_knuckles_zm')return this.meleeUpgrade==='tazer_knuckles_zm'?'Galvaknuckles purchased':key+' · Buy Galvaknuckles · 6000 points';
    if(e.zombie_weapon_upgrade==='bowie_knife_zm')return this.meleeUpgrade==='bowie_knife_zm'?'Bowie Knife purchased':key+' · Buy Bowie Knife · 3000 points';
    if(e.targetname==='treasure_chest_use'&&g.powerup.fire_sale&&g.boxes.get(e.target)?.phase==='closed')return key+' · Mystery box · 10 points';
    return super.prompt(e,key);
  }
  // ekeys: a console's script_parameters N calls its car to stop "N+1" ("0"
  // when there is none).
  callTarget(e){const c=this.car(e.script_noteworthy.replace('bldg','')),n=Number(e.script_parameters);return c.floors[String(n+1)]!==undefined?String(n+1):'0';}
  use(e){const g=this.game,tag=e.targetname;
    if((e.risePart||e.riseBench)&&g.mirror)return true;
    if(e.risePart){if(!this.carry&&this.visible(e)){this.carry={kind:'part',equipment:e.risePart,itemId:e.itemId};this.collected.add(e.itemId);g.emit('buriedItem',{id:e.itemId,visible:false});g.emit('sound',{alias:'zmb_buildable_pickup'});}return true;}
    if(e.riseKey){if(!this.carry&&this.visible(e)){this.carry={kind:'key'};g.emit('buriedItem',{id:e.itemId,visible:false});g.emit('sound',{alias:'zmb_buildable_pickup'});g.message('Picked up the elevator key');}return true;}
    if(e.riseBench)return this.equipment.use(e);
    if(tag==='buried_equipment')return this.equipment.pickup(e);
    if(tag==='rise_whoswho_body'){this.reviveBody();return true;}
    if(tag==='rise_pod_console'){if(this.pod.state==='bottom'&&this.carry?.kind==='key'){this.useKey();this.pod.state='rocking';this.pod.due=g.time+6;}return true;}
    if(tag==='rise_elevator_call'){
      const name=e.script_noteworthy.replace('bldg',''),s=this.cars[name];if(!this.power||!s||this.carry?.kind!=='key'||s.phase==='moving'||s.phase==='power')return true;
      if(this.callTarget(e)===s.floor)return true;
      this.useKey();s.force=Number(e.script_parameters);s.skip=true;if(['cycle','wait','delay','alarm'].includes(s.phase))s.phase='depart';g.emit('sound',{alias:'zmb_elevator_ding',position:e.position});return true;}
    if(tag==='zombie_vending'){
      const id=e.script_noteworthy,p=RISE_PERKS[id],quick=id==='specialty_quickrevive',solo=!g.coop;
      if(!p||this.perks.has(id)||this.perks.size>=4||(!this.power&&!(quick&&solo))||g.gesture||quick&&solo&&this.revivesUsed>=3)return true;
      if(!g.spendPoints(quick&&solo?500:p.cost)){g.voiceEvent?.('denied','perk');return true;}
      g.startGesture(id,()=>{this.perks.add(id);if(id==='specialty_armorvest')g.player.health=this.maxHealth;g.laterDialog?.(1.5,'perk',id);});g.emit('sound',{alias:p.sting});return true;}
    if(['bowie_knife_zm','tazer_knuckles_zm'].includes(e.zombie_weapon_upgrade)){const id=e.zombie_weapon_upgrade;if(this.meleeUpgrade!==id&&g.spendPoints(id==='tazer_knuckles_zm'?6000:3000)){this.meleeUpgrade=id;g.message(id==='tazer_knuckles_zm'?'Galvaknuckles purchased':'Bowie Knife purchased');}return true;}
    if(tag==='use_power_switch'&&!this.power){const done=super.use(e);g.emit('sound',{alias:'evt_poweron_front'});return done;}
    return super.use(e);
  }
  // keys_zm / ekeys_zm are "unbuilt" once used: the key turns up again at
  // one of its spots on the ground floor.
  useKey(){this.carry=null;const spots=this.data.keySpawns.filter(k=>k!==this.keySpot);this.keySpot=spots[Math.floor(Math.random()*spots.length)]||this.keySpot;this.game.emit('buriedItem',{id:this.keySpot,visible:true});}
  // ---- Elevators (zm_highrise_elevators.gsc) ----
  nextFloor(c,s){
    if(s.force!=null){const f=s.force;s.force=null;return f;}
    if(s.next==null)return 0;return s.next+1<Object.keys(c.floors).length?s.next+1:0;
  }
  carRiders(c,s=this.cars[c.name]){
    const g=this.game,frame=this.frame(c,s),players=[g.player],on=at=>{const l=this.local(frame,at);return Math.abs(l[0])<=CAR.half[0]&&Math.abs(l[1])<=CAR.half[1]&&(l[2]>-3&&l[2]<70||l[2]>CAR.roof-3&&l[2]<CAR.roof+40);};
    return {player:players.some(p=>on(p.position)),enemies:g.enemies.filter(e=>!e.dead&&!e.nativeTraversal&&on(e.position))};
  }
  updateCar(c,s,dt){
    const g=this.game,solo=!g.coop,revive=this.machineCar.specialty_quickrevive===c.name,pap=this.machineCar.specialty_weapupgrade===c.name;
    switch(s.phase){
      case 'power':if(this.power||revive&&solo){s.doors=true;s.phase='cycle';}return;
      case 'cycle':
        s.skip=s.skip||s.force!=null;
        if(s.skip){s.phase='depart';return;}
        s.phase='wait';s.due=g.time+(revive?between(15,25):between(5,20));s.touch=0;s.early=false;return;
      case 'wait':{
        // elevator_depart_early(): a player on the car for 5 s sends it.
        const riding=this.carRiders(c,s).player;s.touch=riding?s.touch+dt:0;if(s.touch>=5)s.early=true;
        if(g.time>=s.due||s.early){s.phase='delay';s.due=g.time+(s.early?0:5);}return;}
      case 'delay':
        if(g.time<s.due)return;
        if(pap){if(this.pap){s.papHold=null;return;}if(s.papHold==null){s.papHold=g.time+between(1,3);return;}if(g.time<s.papHold)return;s.papHold=null;}
        s.phase='depart';return;
      case 'depart':{
        const next=this.nextFloor(c,s);s.next=next;const level=c.floors[String(next+1)]!==undefined?String(next+1):'0';
        s.target=level;s.from=s.z;s.to=c.floors[level];
        if(level==='0'&&!s.skip){s.phase='alarm';s.due=g.time+3;g.emit('loop',{id:'rise_alarm_'+c.name,alias:'amb_alarm_bell',position:[c.origin[0],c.origin[1],s.z],near:100,far:1600});return;}
        this.startMove(c,s);return;}
      case 'alarm':if(g.time>=s.due){g.emit('stopLoop',{id:'rise_alarm_'+c.name});this.startMove(c,s);}return;
      case 'moving':{
        const before=s.z,f=s.duration?(g.time-s.started)/s.duration:1;s.z=s.from+(s.to-s.from)*travel(f);
        this.carryRiders(c,s,s.z-before);
        if(f>=1){s.z=s.to;s.phase=revive&&!solo&&!this.power?'power':'cycle';s.doors=true;g.emit('stopLoop',{id:'rise_car_'+c.name});
          g.emit('sound',{alias:'zmb_elevator_run_stop',position:[c.origin[0],c.origin[1],s.z]});g.emit('sound',{alias:'zmb_elevator_ding',position:[c.origin[0],c.origin[1],s.z]});this.routesChanged();}
        return;}
    }
  }
  startMove(c,s){
    const g=this.game;s.skip=false;s.floor=s.target;s.from=s.z;s.duration=Math.abs(s.to-s.z)/SPEED;s.started=g.time;s.doors=false;s.phase='moving';this.routesChanged();
    if(!s.duration){s.phase='cycle';s.doors=true;return;}
    const at=[c.origin[0],c.origin[1],s.z];g.emit('sound',{alias:'zmb_elevator_ding',position:at});g.emit('sound',{alias:'zmb_elevator_run_start',position:at});
    g.emit('loop',{id:'rise_car_'+c.name,alias:'zmb_elevator_run',position:at,near:100,far:1400,follow:()=>[c.origin[0],c.origin[1],this.cars[c.name].z]});
  }
  // Riders move with the car; anyone caught under a descending car is
  // crushed (squashed_death_init's instant_death triggers on each car).
  carryRiders(c,s,dz){
    if(!dz)return;const g=this.game,frame=this.frame(c,s),riders=this.carRiders(c,{...s,z:s.z-dz});
    if(riders.player){g.player.position[2]+=dz;g.player.previousPosition[2]+=dz;}
    for(const e of riders.enemies){e.position[2]+=dz;if(e.previousPosition)e.previousPosition[2]+=dz;}
    const l=this.local(frame,g.player.position);
    if(dz<0&&!riders.player&&Math.abs(l[0])<CAR.half[0]-8&&Math.abs(l[1])<CAR.half[1]-8&&l[2]<-12&&l[2]+70>-12&&g.phase!=='dead')this.squash();
    for(const e of g.enemies){if(e.dead||riders.enemies.includes(e))continue;const q=this.local(frame,e.position);if(dz<0&&Math.abs(q[0])<CAR.half[0]&&Math.abs(q[1])<CAR.half[1]&&q[2]<-12&&q[2]+60>-12)this.removeEnemy(e);}
  }
  squash(){const g=this.game;g.message('Crushed');this.toSafety();g.damagePlayer(100000);}
  removeEnemy(e){const g=this.game;e.dead=true;e.deathTime=g.time;g.recycleHealth?.push(e.health);g.remaining++;g.emit('removeEnemy',e);}
  routesChanged(){const g=this.game;g.pathCache?.clear();g.targetNodeDue=0;g.spawnDistanceCache=null;}
  // Shaft nodes are only walkable while a car stands at their floor
  // (elevator_enable_paths links them to the car).
  shaftNode(n){
    // Within a car's footprint and between its lowest stop and its roof at
    // the highest stop (rooms above or below a shaft are not part of it).
    this.shaftNodes??=this.game.nodes.map(node=>{for(const c of this.data.elevators){const l=this.local({position:[c.origin[0],c.origin[1],0],yaw:c.yaw*Math.PI/180},node.origin),z=Object.values(c.floors);
      if(Math.abs(l[0])<CAR.half[0]-4&&Math.abs(l[1])<CAR.half[1]-4&&node.origin[2]>Math.min(...z)-40&&node.origin[2]<Math.max(...z)+CAR.roof+20)return c.name;}return null;});
    return this.shaftNodes[n];
  }
  blockedNode(n){const name=this.shaftNode(n);if(!name)return false;const s=this.cars[name];return s.phase==='moving'||Math.abs(this.game.nodes[n].origin[2]-s.z)>40;}
  // ---- Escape pod (zm_highrise_classic.gsc escape_pod) ----
  podFrame(){const p=this.data.escapePod;return {position:[p.home[0],p.home[1],this.pod.z],yaw:p.yaw*Math.PI/180};}
  onPod(at){const l=this.local(this.podFrame(),at);return Math.abs(l[0])<=POD.half[0]&&Math.abs(l[1])<=POD.half[1]&&l[2]>-3&&l[2]<80;}
  updatePod(dt){
    const g=this.game,p=this.pod,data=this.data.escapePod,here=[data.home[0],data.home[1],p.z];
    if(p.state==='top'){
      // Every living player inside the pod for 3 s breaks its cable.
      const present=data.trigger.some(h=>inside(g.player.position.map((v,k)=>v+(k===2?30:0)),h))||this.onPod(g.player.position);
      if(!present||g.phase==='dead'){if(p.ready){p.ready=0;}return;}
      if(!p.ready){p.ready=g.time+3;g.emit('sound',{alias:'zmb_esc_pod_bump',position:here});}
      if(g.time>=p.ready){p.state='shaking';p.due=g.time+1.5;g.emit('shake',{position:here,amplitude:.25,duration:1.5,radius:256});g.emit('sound',{alias:'zmb_esc_pod_break',position:here});}
      return;}
    if(p.state==='shaking'){if(g.time>=p.due){p.state='falling';p.from=p.z;p.to=data.bottom[2];p.started=g.time;p.duration=3;}return;}
    if(p.state==='falling'||p.state==='returning'){
      const before=p.z,f=Math.min(1,(g.time-p.started)/p.duration);p.z=p.from+(p.to-p.from)*(f<.033?f*f/.066:f>.967?1-(1-f)**2/.066:f*1.0345-.017);
      const dz=p.z-before;if(this.onPod([g.player.position[0],g.player.position[1],g.player.position[2]-dz])){g.player.position[2]+=dz;g.player.previousPosition[2]+=dz;}
      for(const e of g.enemies)if(!e.dead&&this.onPod([e.position[0],e.position[1],e.position[2]-dz]))e.position[2]+=dz;
      if(f<1)return;p.z=p.to;g.emit('stopLoop',{id:'rise_pod'});
      if(p.state==='falling'){p.state='bottom';g.emit('sound',{alias:'zmb_esc_pod_crash',position:[data.home[0],data.home[1],p.z]});g.emit('shake',{position:g.player.position.slice(),amplitude:.3,duration:1.5,radius:256});
        // The riders land prone and dazed (shellshock elevator_crash, 4.5 s).
        if(this.onPod(g.player.position)){g.changeStance?.('prone');g.emit('shake',{position:g.player.position.slice(),amplitude:.5,duration:4.5,radius:400});}}
      else{p.state='top';p.ready=0;g.emit('sound',{alias:'zmb_esc_pod_crash',position:here});g.emit('sound',{alias:'zmb_elevator_ding',position:here});}
      this.routesChanged();return;}
    if(p.state==='rocking'&&g.time>=p.due){p.state='returning';p.from=p.z;p.to=data.home[2];p.started=g.time;p.duration=3;
      g.emit('sound',{alias:'zmb_elevator_run_start',position:here});g.emit('loop',{id:'rise_pod',alias:'zmb_elevator_run',position:here,near:100,far:1400});}
  }
  // ---- Moving collision: the cars and the pod are solid, as in T6. ----
  platformTrace(start,end,half,result){
    if(['ready','dead'].includes(this.game.phase)||half[2]<10)return result;
    const lo=start.map((v,k)=>Math.min(v,end[k])-half[k]),hi=start.map((v,k)=>Math.max(v,end[k])+half[k]);
    for(const c of this.data.elevators){const s=this.cars[c.name];if(lo[2]>s.z+CAR.roof+2||hi[2]<s.z-14||Math.max(lo[0]-c.origin[0],c.origin[0]-hi[0],lo[1]-c.origin[1],c.origin[1]-hi[1])>150)continue;
      result=boxTrace(this.frame(c,s),s.doors?CAR.boxes:[...CAR.boxes,CAR.door],start,end,half,result);}
    const p=this.data.escapePod,f=this.podFrame();
    if(!(lo[2]>this.pod.z+POD.roof+2||hi[2]<this.pod.z-15||Math.max(lo[0]-p.home[0],p.home[0]-hi[0],lo[1]-p.home[1],p.home[1]-hi[1])>150))
      result=boxTrace(f,['top','bottom'].includes(this.pod.state)?POD.boxes:[...POD.boxes,POD.door],start,end,half,result);
    return result;
  }
  // ---- Leaper rounds (_zm_ai_leaper.gsc) ----
  roundCount(round,players){
    this.leaperRound=round===this.nextLeaperRound;
    if(!this.leaperRound)return null;
    this.leaperRounds++;this.nextLeaperRound=round+between(4,6);this.leaperReward=false;this.usedLeaperSpawns.clear();this.leaperDue=this.game.time+2;
    this.game.emit('sound',{alias:'dog_start'});this.game.emit('sound',{alias:'vox_zmba_event_dogstart_0'});
    return this.leaperCount=players*this.data.leapersPerPlayer;
  }
  roundOverride(){return this.leaperRound?this.leaperCount:null;}
  maxAlive(){return this.leaperRound?2*(this.game.coop?.playerCount()||1):24;}
  spawnEnemy(){
    if(!this.leaperRound)return false;const g=this.game;if(g.time<this.leaperDue)return true;
    const zones=this.spawnZones(),groups=new Set(this.data.volumes.filter(v=>zones.has(v.name)).map(v=>v.spawners)),players=g.coop?.playerPositions()||[g.player.position];
    let options=this.data.leaperSpawns.filter(s=>groups.has(s.group)&&!this.usedLeaperSpawns.has(s.origin.join(','))&&!(s.elevator&&this.carNear(s.elevator.replace('elevator_',''),s.origin)));
    if(!options.length){this.usedLeaperSpawns.clear();options=this.data.leaperSpawns.filter(s=>groups.has(s.group));}
    // Many native points start a leap from a neighbouring roof (an authored
    // building-leap animation not recreated here). Unreachable ones fall back
    // to the zone's own spawn points.
    const fallback=g.spawnEntities.filter(e=>groups.has(e.targetname)&&e.nativeNoteworthy!=='spawn_location').map(e=>({origin:pos(e),yaw:Number((e.angles||'0 0 0').split(/\s+/)[1])}));
    return g.collision.actor(()=>{
      let tries=0;
      for(const s of [...shuffle(options),...shuffle(fallback)]){if(++tries>10)break;
        let at;try{at=g.settleFeet([s.origin[0],s.origin[1],s.origin[2]+40]);}catch{continue;}
        if(players.some(q=>distance(at,q)<200)||!players.some(q=>g.walkableLink(at,q)||g.path(at,q,true).length))continue;
        this.usedLeaperSpawns.add(s.origin.join(','));
        const health=this.data.leaperHealth[Math.min(this.leaperRounds,this.data.leaperHealth.length)-1];
        const e={id:g.nextId++,kind:'leaper',position:at,previousPosition:at.slice(),health,window:null,stage:'hunt',path:[],attackDue:0,navDue:0,angle:s.yaw*Math.PI/180,dead:false,age:0,spawnTime:g.time,gait:'ai_zombie_walk_v1',speed:250};
        g.enemies.push(e);g.remaining--;g.emit('spawn',e);g.emit('sound',{alias:'zmb_leaper_spawn_fx',position:at});g.emit('sound',{alias:'zmb_vocals_leaper_spawn',position:at});
        g.emit('effect',{name:'maps/zombie/fx_zmb_leaper_spawn',position:at,duration:1.5});
        // waiting_for_next_leaper_spawn(): 3 / 2.5 / 2 / 1.5 s by leaper round.
        this.leaperDue=g.time+[3,2.5,2,1.5][Math.min(3,this.leaperRounds-1)];return true;
      }
      return true;
    });
  }
  // ---- Who's Who (_zm_chugabud.gsc) ----
  // A downed player rises elsewhere as a clone with only a pistol; reviving
  // the body left behind restores the loadout and the other perks.
  interceptDown(amount){
    const g=this.game;if(g.coop||this.whosWho||g.player.health>amount||!this.perks.has('specialty_finalstand'))return false;
    const body=g.player.position.slice(),perks=[...this.perks].filter(p=>p!=='specialty_finalstand');
    this.whosWho={body,due:g.time+WHOS_WHO_BLEEDOUT,perks,inventory:JSON.parse(JSON.stringify(g.inventory.map(w=>({name:w.name,clip:w.clip,reserve:w.reserve})))),slot:g.slot,grenades:g.player.grenades};
    this.perks.clear();g.inventory=[g.makeWeapon(g.data.startWeapon)];g.slot=0;g.emit('weapon',g.weapon);
    const spot=this.respawnSpot(body,500);if(spot)this.teleport(spot);
    g.player.health=this.maxHealth;g.lastDamage=g.time;g.message('Who’s Who · revive your body within '+WHOS_WHO_BLEEDOUT+' s');g.emit('sound',{alias:'zmb_perks_whoswho_lose'});this.syncInteractions();return true;
  }
  reviveBody(){
    const g=this.game,w=this.whosWho;if(!w)return;this.whosWho=null;
    g.inventory=w.inventory.map(x=>{const weapon=g.makeWeapon(x.name);weapon.clip=x.clip;weapon.reserve=x.reserve;return weapon;});g.slot=Math.min(w.slot,g.inventory.length-1);g.player.grenades=w.grenades;
    for(const p of w.perks)this.perks.add(p);if(this.perks.has('specialty_armorvest'))g.player.health=this.maxHealth;
    this.teleport(w.body);g.emit('weapon',g.weapon);g.message('Body revived');this.syncInteractions();
  }
  respawnSpot(from,minimum=0){
    const g=this.game,zones=this.activeZones(),points=g.entities.filter(e=>e.targetname==='player_respawn_point'&&zones.has(e.script_noteworthy)).sort((a,b)=>distance(pos(a),from)-distance(pos(b),from));
    const point=points.find(e=>distance(pos(e),from)>=minimum)||points[0];if(!point)return null;
    const spots=g.entities.filter(e=>e.targetname===point.target);const spot=spots.length?spots[Math.floor(Math.random()*spots.length)]:point;
    try{return g.settleFeet(pos(spot).map((v,k)=>v+(k===2?8:0)));}catch{return pos(spot);}
  }
  toSafety(){const g=this.game,start=g.entities.find(e=>e.targetname==='player_respawn_point'&&e.script_noteworthy==='zone_green_start');
    const spot=start?(()=>{const spots=g.entities.filter(e=>e.targetname===start.target);return pos(spots[Math.floor(Math.random()*spots.length)]||start);})():null;if(spot)try{this.teleport(g.settleFeet(spot));}catch{this.teleport(spot);}}
  teleport(at){const g=this.game;Object.assign(g.player,{position:at.slice(),previousPosition:at.slice(),velocityZ:0,grounded:true});g.targetNode=-1;g.targetNodeDue=0;g.spawnDistanceCache=null;g.emit('teleport');}
  // ---- The Sliquifier's goo (_zm_weap_slipgun.gsc) ----
  explosive(at,source){
    if(!source?.weapon?.startsWith('slipgun'))return;const g=this.game,upgraded=source.weapon.includes('upgraded');
    this.goo.push({position:at.slice(),until:g.time+(upgraded?36:24)});g.emit('effect',{name:'weapon/liquifier/fx_liquifier_goo_splat',position:at.slice(),duration:upgraded?36:24});
    for(const e of g.enemies)if(!e.dead&&!e.ignoreRound&&distance(e.position,at)<120)this.slip(e);
  }
  slip(e){const g=this.game;g.hitEnemy(e,e.health+1,false,false);g.emit('sound',{alias:'wpn_slipgun_zombie_explode',position:e.position.slice()});g.emit('effect',{name:'weapon/liquifier/fx_liquifier_goo_explo',position:e.position.slice(),duration:1.2});}
  tick(){
    const g=this.game,dt=Math.max(0,Math.min(.1,g.time-(this.lastTick??g.time)));this.lastTick=g.time;
    if(!g.mirror&&!['ready','dead'].includes(g.phase)){for(const c of this.data.elevators)this.updateCar(c,this.cars[c.name],dt);this.updatePod(dt);}
    this.syncInteractions();super.tick();if(g.mirror||['ready','dead'].includes(g.phase))return;
    this.equipment.tick(dt);
    if(this.whosWho&&g.time>=this.whosWho.due){this.whosWho=null;g.message('Your body bled out');this.syncInteractions();}
    this.goo=this.goo.filter(goo=>g.time<goo.until);
    for(const goo of this.goo)for(const e of g.enemies)if(!e.dead&&!e.ignoreRound&&e.stage==='hunt'&&distance(e.position,goo.position)<60)this.slip(e);
    if(g.time>=this.hazardDue){this.hazardDue=g.time+.25;const feet=[g.player.position[0],g.player.position[1],g.player.position[2]+25];
      if(this.data.killVolumes.some(v=>v.kind!=='zombie_fell_off'&&v.hulls.some(h=>inside(feet,h))))this.squash();
      for(const e of g.enemies)if(!e.dead&&this.data.killVolumes.some(v=>v.hulls.some(h=>inside([e.position[0],e.position[1],e.position[2]+25],h))))this.removeEnemy(e);}
    // leaper_round_aftermath(): Max Ammo where the last leaper fell.
    if(this.leaperRound&&!this.leaperReward&&g.phase==='round'&&g.remaining===0&&g.enemies.every(e=>e.dead||e.ignoreRound)){
      this.leaperReward=true;const last=[...g.enemies].reverse().find(e=>e.kind==='leaper');if(last)g.addDrop('full_ammo',last.position);g.emit('sound',{alias:'dog_end'});}
    const sale=!!g.powerup.fire_sale;if(sale!==this.salePlaying){this.salePlaying=sale;g.emit(sale?'loop':'stopLoop',sale?{id:'rise_sale',alias:'mus_fire_sale'}:{id:'rise_sale'});}
  }
  saveState(){return {...super.saveState(),collected:[...this.collected],partChoices:this.partChoices,carry:this.carry,equipment:this.equipment.saveState(),meleeUpgrade:this.meleeUpgrade,keySpot:this.keySpot,slipgunTaken:this.slipgunTaken,
    machineCar:this.machineCar,cars:JSON.parse(JSON.stringify(this.cars)),pod:{...this.pod},leaperRound:this.leaperRound,leaperRounds:this.leaperRounds,nextLeaperRound:this.nextLeaperRound,leaperReward:this.leaperReward,whosWho:this.whosWho,goo:this.goo};}
  loadState(s){super.loadState(s);this.collected=new Set(s.collected||[]);
    for(const k of ['partChoices','carry','meleeUpgrade','keySpot','slipgunTaken','machineCar','cars','pod','leaperRound','leaperRounds','nextLeaperRound','leaperReward','whosWho','goo'])if(s[k]!==undefined)this[k]=s[k];
    this.equipment.loadState(s.equipment);this.lastTick=this.game.time;if(this.slipgunTaken&&!this.game.data.map.boxWeapons.includes('slipgun_zm'))this.game.data.map.boxWeapons.push('slipgun_zm');this.syncInteractions();this.routesChanged();}
  coopState(){return {cars:this.cars,pod:this.pod,machineCar:this.machineCar,partChoices:this.partChoices,collected:[...this.collected],keySpot:this.keySpot};}
  applyCoopState(s){Object.assign(this,{cars:s.cars,pod:s.pod,machineCar:s.machineCar,partChoices:s.partChoices,keySpot:s.keySpot});this.collected=new Set(s.collected||[]);this.syncInteractions();}
}

// Swept-box test against boxes in a platform's local frame (the bus's
// version, generalised to any yaw-rotated platform).
export function boxTrace(frame,boxes,start,end,half,result){
  const local=at=>{const dx=at[0]-frame.position[0],dy=at[1]-frame.position[1],c=Math.cos(frame.yaw),s=Math.sin(frame.yaw);return [dx*c+dy*s,-dx*s+dy*c,at[2]-frame.position[2]];};
  const a=local(start),z=local(end),c=Math.cos(frame.yaw),s=Math.sin(frame.yaw),h=[Math.abs(c)*half[0]+Math.abs(s)*half[1],Math.abs(s)*half[0]+Math.abs(c)*half[1],half[2]];
  let fraction=result.fraction,normal=result.normal,solid=result.solid,allSolid=result.allSolid,grounded=false;
  for(const [lo,hi]of boxes){let near=0,far=1,hit=null,within=true,endWithin=true,reject=false;
    for(let k=0;k<3;k++){const min=lo[k]-h[k],max=hi[k]+h[k],d=z[k]-a[k];if(a[k]<min-.03||a[k]>max+.03)within=false;if(z[k]<min-.03||z[k]>max+.03)endWithin=false;
      if(Math.abs(d)<1e-9){if(a[k]<min||a[k]>max)reject=true;continue;}const t1=(min-a[k])/d,t2=(max-a[k])/d,n=Math.min(t1,t2);if(n>=near){near=n;hit=[0,0,0];hit[k]=d>0?-1:1;}far=Math.min(far,Math.max(t1,t2));if(near>far)reject=true;}
    if(reject)continue;if(within){solid=true;if(endWithin){let closest=-Infinity,face=null;for(let k=0;k<3;k++)for(const [d,sign]of [[lo[k]-h[k]-a[k],-1],[a[k]-hi[k]-h[k],1]])if(d>closest){closest=d;face=[0,0,0];face[k]=sign;}
      if(closest<-.06){allSolid=true;fraction=0;}else if(face.reduce((v,n,k)=>v+n*(z[k]-a[k]),0)<-1e-9){fraction=0;normal=[face[0]*c-face[1]*s,face[0]*s+face[1]*c,face[2]];}}continue;}
    if(hit&&near>=0&&near<fraction){fraction=Math.max(0,near-.001);normal=[hit[0]*c-hit[1]*s,hit[0]*s+hit[1]*c,hit[2]];}
  }
  if(fraction===result.fraction&&normal===result.normal&&solid===result.solid&&allSolid===result.allSolid)return result;
  return {...result,fraction,normal,solid,allSolid,end:start.map((v,k)=>v+(end[k]-v)*fraction)};
}
