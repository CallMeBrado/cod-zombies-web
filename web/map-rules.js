const position=e=>e.origin.split(/\s+/).map(Number);
const PERKS={specialty_armorvest:{name:'Jugger-Nog',cost:2500,sting:'mx_jugger_sting',family:'jugger'},specialty_fastreload:{name:'Speed Cola',cost:3000,sting:'mx_speed_sting',family:'speed'},specialty_rof:{name:'Double Tap',cost:2000,sting:'mx_doubletap_sting',family:'doubletap'},specialty_quickrevive:{name:'Quick Revive',cost:1500,sting:'mx_revive_sting',family:'revive'}};
// perksacola struct script_sound -> the level.*_jingle flag it shares with its sting.
const JINGLES={mx_jugger_jingle:'jugger',mx_speed_jingle:'speed',mx_doubletap_jingle:'doubletap',mx_revive_jingle:'revive',mx_packa_jingle:'packa'};
// The exported aliases carry no min/max distance, so these ranges are chosen
// per kind of sound: music carries across nearby rooms, machinery is local.
const RANGE={music:{near:150,far:1400},machine:{near:80,far:900},hum:{near:40,far:420},tick:{near:60,far:700}};
const PAP_TIMEOUT=15;
const between=(a,b)=>a+Math.random()*(b-a);

// Map-specific interactions and zone connections recovered from the factory
// entities/GSC. The shared combat/physics loop remains the same on both maps.
export class FactoryRules {
  constructor(game){this.game=game;this.data=game.data.map;}
  reset(){this.flags=new Set();this.perks=new Set();this.power=false;this.links=new Set();this.linkPending=null;this.teleportDue=0;this.teleportCooldown=0;this.pap=null;this.machines=null;this.papOn=false;}
  activeZones(){
    const active=new Set([this.data.initialZone]);let changed=true;
    while(changed){changed=false;for(const [a,b,flag]of this.data.connections)if(this.flags.has(flag)){
      if(active.has(a)&&!active.has(b)){active.add(b);changed=true;}
      if(active.has(b)&&!active.has(a)){active.add(a);changed=true;}
    }}return active;
  }
  windows(){
    const active=this.activeZones();
    // Roof/drop negotiation routes need native traversal support. Until a
    // physical approach is prepared, use the other barriers in the zone so an
    // unreachable zombie cannot hold the entire round open indefinitely.
    return this.game.windows.filter(w=>active.has(this.data.goals[w.target]?.zone)&&
      (!this.game.spawnRoutes.has(w.target)||this.game.spawnRoutes.get(w.target).choices.length));
  }
  group(window){return this.data.goals[window.target]?.spawners;}
  visible(e){
    if(e.script_noteworthy==='electric_door')return false;
    if(e.targetname==='treasure_chest_use')return e.target===this.data.initialBox;
    if(e.targetname==='use_power_switch')return !this.power;
    return true;
  }
  onOpen(e){if(e.script_flag)this.flags.add(e.script_flag);}
  prompt(e,key){
    if(e.targetname==='use_power_switch')return key+' · Turn on the power';
    if(e.targetname==='zombie_vending'){
      const perk=PERKS[e.script_noteworthy];
      if(!perk)return 'Perk machine';if(!this.power)return 'You must turn on the power first';
      if(e.script_noteworthy==='specialty_quickrevive')return 'Quick Revive · Used to revive teammates';
      return this.perks.has(e.script_noteworthy)?perk.name+' purchased':key+' · Buy '+perk.name+' · '+perk.cost+' points';
    }
    if(e.targetname==='zombie_vending_upgrade'){
      if(!this.power||this.links.size<3)return 'Link all three teleporters to unlock Pack-a-Punch';
      if(this.pap)return this.pap.phase==='ready'?key+' · Take the '+this.game.weaponName(this.pap.upgraded):'Pack-a-Punch · upgrading…';
      if(!this.game.weapon.definition.upgrade)return 'No further upgrade available for this weapon';
      return key+' · Pack-a-Punch · 5000 points';
    }
    if(e.targetname==='trigger_teleport_core')return this.linkPending?key+' · Complete teleporter link · '+Math.ceil(this.linkPending.due-this.game.time)+'s':'Mainframe · '+this.links.size+' / 3 teleporters linked';
    if(e.targetname.startsWith('trigger_teleport_pad_')){
      if(!this.power)return 'You must turn on the power first';
      const id=Number(e.targetname.at(-1));
      return this.links.has(id)?key+' · Teleport to mainframe · 1500 points':key+' · Link teleporter to mainframe';
    }
    if(e.zombie_weapon_upgrade==='stielhandgranate')return key+' · Buy grenades · 250 points';
    return null;
  }
  use(e){
    const g=this.game,key=e.targetname;
    if(key==='use_power_switch'){
      this.power=true;this.flags.add('electricity_on');
      for(const target of ['outside_south_east_door','outside_south_west_door','wnuen_bridge_clip','warehouse_bridge_clip'])this.openTarget(target);
      g.emit('power');g.emit('sound',{alias:'switch_flip'});g.emit('sound',{alias:'bridge_lower'});g.message('Power restored');return true;
    }
    if(key==='zombie_vending'){
      const perk=PERKS[e.script_noteworthy];if(!perk||!this.power||this.perks.has(e.script_noteworthy))return true;
      // WaW Quick Revive speeds up reviving teammates; it does not revive a
      // solo player automatically. Preserve that behavior rather than BO's perk.
      if(e.script_noteworthy==='specialty_quickrevive'){g.message('Quick Revive is for reviving teammates.');return true;}
      if(g.gesture||!g.spendPoints(perk.cost))return true;
      // vending_trigger_think: dispense and sting at the machine, then drink;
      // the perk is set once the bottle's raise (the drink) completes.
      const at=position(e),id=e.script_noteworthy;
      this.sound('bottle_dispense3d',at,RANGE.machine);this.sound(perk.sting,at,RANGE.music,perk.family);
      g.startGesture(id,()=>{if(g.phase==='dead')return;this.perks.add(id);if(id==='specialty_armorvest')g.player.health=250;});
      return true;
    }
    if(key.startsWith('trigger_teleport_pad_')){
      if(!this.power||this.teleportDue||g.time<this.teleportCooldown)return true;
      const id=Number(key.at(-1));
      if(!this.links.has(id)){this.linkPending={id,due:g.time+30};g.message('Return to the mainframe within 30 seconds to complete the link.');}
      else if(g.spendPoints(1500)){this.teleportDue=g.time+2;g.emit('sound',{alias:'teleport_out'});g.message('Teleporting…');}return true;
    }
    if(key==='trigger_teleport_core'){
      if(this.linkPending&&g.time<this.linkPending.due){this.links.add(this.linkPending.id);this.linkPending=null;g.emit('sound',{alias:'cha_ching'});g.message('Teleporter linked · '+this.links.size+' / 3');if(this.links.size===3){this.openTarget('pack_door');this.openTarget('pack_door_clip');}}return true;
    }
    if(key==='zombie_vending_upgrade'){
      if(this.pap){if(this.pap.phase==='ready')this.takeUpgrade();return true;}
      const upgraded=g.weapon.definition.upgrade;
      if(!this.power||this.links.size<3||!upgraded||g.gesture||!g.spendPoints(5000))return true;
      // vending_upgrade: the gun is taken (a Colt is given if it was the only
      // primary), the hands crack their knuckles, and the world gun is upgraded.
      const at=position(e),weapon=g.weapon;
      this.sound('bottle_dispense3d',at,RANGE.machine);this.sound('mx_packa_sting',at,RANGE.music,'packa');
      g.inventory.splice(g.slot,1);if(!g.inventory.length)g.inventory.push(g.makeWeapon('zombie_colt'));g.slot=0;
      const machine=g.entities.find(x=>x.targetname===e.target),origin=machine?position(machine):at;
      this.pap={phase:'in',started:g.time,weapon:weapon.name,upgraded,at,playerYaw:g.yaw*180/Math.PI,origin:[origin[0],origin[1],origin[2]+35],yaw:Number((machine?.angles||'0 0 0').split(/\s+/)[1])+90};
      g.startGesture('knuckle_crack');return true;
    }
    if(e.zombie_weapon_upgrade==='stielhandgranate'){
      if(g.player.grenades<4&&g.spendPoints(250))g.player.grenades=4;return true;
    }
    return false;
  }
  saveState(){return {power:this.power,flags:[...this.flags],perks:[...this.perks],links:[...this.links]};}
  loadState(s){if(!s)return;this.power=s.power;this.flags=new Set(s.flags);this.perks=new Set(s.perks);this.links=new Set(s.links);}
  sound(alias,position,range,exclusive){this.game.emit('sound',{alias,position,...range,exclusive});}
  takeUpgrade(){
    const g=this.game,pap=this.pap;if(g.gesture)return;
    this.pap=null;g.emit('stopLoop',{id:'packa_timer'});
    g.giveWeapon(pap.upgraded);g.weapon.reserve=g.weapon.definition.maxAmmo;
  }
  machineSounds(){
    const g=this.game;
    // Perk machines come on with the power; Pack-a-Punch once all three
    // teleporters are linked (Pack_A_Punch_on), with its rollers hum.
    if(this.power&&!this.machines){
      this.machines=g.entities.filter(e=>e.targetname==='perksacola'&&JINGLES[e.script_sound]&&e.script_sound!=='mx_packa_jingle').map(e=>({at:position(e),jingle:e.script_sound,jingleDue:g.time+between(31,45),surgeDue:g.time+between(7,18)}));
      for(const e of g.interactions.filter(e=>e.targetname==='zombie_vending'))this.sound('perks_power_on',position(e),RANGE.machine);
    }
    if(this.power&&this.links.size===3&&!this.papOn){
      this.papOn=true;const trigger=g.interactions.find(e=>e.targetname==='zombie_vending_upgrade'),struct=g.entities.find(e=>e.targetname==='perksacola'&&e.script_sound==='mx_packa_jingle');
      if(trigger){this.sound('perks_power_on',position(trigger),RANGE.machine);g.emit('loop',{id:'packa_rollers',alias:'packa_rollers_loop',position:position(trigger),...RANGE.hum});}
      if(struct)this.machines?.push({at:position(struct),jingle:struct.script_sound,jingleDue:g.time+between(31,45),surgeDue:Infinity});
    }
    // perks_a_cola_jingle / play_random_broken_sounds: an electrical surge
    // every 7-18 s, and a 15% chance of the machine's jingle every 31-45 s.
    for(const m of this.machines||[]){
      if(g.time>=m.surgeDue){m.surgeDue=g.time+between(7,18);if(m.jingle==='mx_revive_jingle')this.sound('broken_random_jingle',m.at,RANGE.music);this.sound('electrical_surge',m.at,RANGE.machine);}
      if(g.time>=m.jingleDue){m.jingleDue=g.time+between(31,45);if(Math.random()<.15){this.sound('electrical_surge',m.at,RANGE.machine);this.sound(m.jingle,m.at,RANGE.music,JINGLES[m.jingle]);}}
    }
  }
  updateUpgrade(){
    const g=this.game,pap=this.pap;if(!pap)return;const t=g.time-pap.started;
    // third_person_weapon_upgrade timings: in at 0.5 s, ready 3.35 s later,
    // out over 0.5 s, then wait_for_player_to_take until the 15 s timeout.
    if(pap.phase==='in'&&t>=.5&&!pap.rolling){pap.rolling=true;this.sound('packa_weap_upgrade',pap.at,RANGE.machine);}
    if(pap.phase==='in'&&t>=3.85){pap.phase='out';this.sound('packa_weap_ready',pap.at,RANGE.machine);}
    if(pap.phase==='out'&&t>=4.35){pap.phase='ready';pap.readyAt=g.time;g.emit('loop',{id:'packa_timer',alias:'ticktock_loop',position:pap.at,...RANGE.tick});}
    if(pap.phase==='ready'&&g.time>=pap.readyAt+PAP_TIMEOUT){this.pap=null;g.emit('stopLoop',{id:'packa_timer'});this.sound('packa_deny',pap.at,RANGE.machine);}
  }
  openTarget(target){const g=this.game;g.opened.add(target);g.collision.disabled.add(target);g.invalidateNavigation([target]);g.emit('open',{target});}
  tick(){
    const g=this.game;
    if(this.linkPending&&g.time>=this.linkPending.due){this.linkPending=null;g.message('Teleporter link timed out');}
    if(this.teleportDue&&g.time>=this.teleportDue){
      this.teleportDue=0;this.teleportCooldown=g.time+5;
      const destination=position(g.entities.find(e=>e.targetname==='origin_teleport_player_0'));
      const floor=g.collision.move(destination,[0,0,-64]);
      g.player.position=floor.position;g.player.previousPosition=floor.position.slice();g.player.velocityZ=0;g.player.grounded=floor.grounded;
      g.targetNodeDue=0;g.targetNode=-1;g.emit('teleport');g.emit('sound',{alias:'teleport_in'});
    }
    this.machineSounds();this.updateUpgrade();
  }
  get maxHealth(){return this.perks.has('specialty_armorvest')?250:100;}
  get reloadScale(){return this.perks.has('specialty_fastreload')?.5:1;}
  get fireScale(){return this.perks.has('specialty_rof')?.75:1;}
}
