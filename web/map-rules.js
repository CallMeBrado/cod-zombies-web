const position=e=>e.origin.split(/\s+/).map(Number);
const PERKS={specialty_armorvest:{name:'Jugger-Nog',cost:2500,sound:'mx_jugger_jingle'},specialty_fastreload:{name:'Speed Cola',cost:3000,sound:'mx_speed_jingle'},specialty_rof:{name:'Double Tap',cost:2000,sound:'mx_doubletap_jingle'},specialty_quickrevive:{name:'Quick Revive',cost:1500,sound:'mx_revive_jingle'}};

// Map-specific interactions and zone connections recovered from the factory
// entities/GSC. The shared combat/physics loop remains the same on both maps.
export class FactoryRules {
  constructor(game){this.game=game;this.data=game.data.map;}
  reset(){this.flags=new Set();this.perks=new Set();this.power=false;this.links=new Set();this.linkPending=null;this.teleportDue=0;this.teleportCooldown=0;this.upgradePending=null;}
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
      if(this.upgradePending)return 'Pack-a-Punch · upgrading…';
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
      if(g.spendPoints(perk.cost)){this.perks.add(e.script_noteworthy);if(e.script_noteworthy==='specialty_armorvest')g.player.health=250;g.emit('sound',{alias:perk.sound});g.message(perk.name+' purchased');}return true;
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
      const upgraded=g.weapon.definition.upgrade;
      if(this.power&&this.links.size===3&&!this.upgradePending&&upgraded&&g.spendPoints(5000)){
        this.upgradePending={weapon:g.weapon,upgraded,due:g.time+3};g.emit('sound',{alias:'mx_packa_jingle'});g.message('Pack-a-Punch upgrading…');
      }return true;
    }
    if(e.zombie_weapon_upgrade==='stielhandgranate'){
      if(g.player.grenades<4&&g.spendPoints(250))g.player.grenades=4;return true;
    }
    return false;
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
    if(this.upgradePending&&g.time>=this.upgradePending.due){
      const {weapon,upgraded}=this.upgradePending;this.upgradePending=null;
      const index=g.inventory.indexOf(weapon);if(index>=0){g.inventory[index]=g.makeWeapon(upgraded);if(g.slot===index){g.reloadEnd=0;g.emit('weapon',g.weapon);}g.message('Weapon upgraded');}
    }
  }
  get maxHealth(){return this.perks.has('specialty_armorvest')?250:100;}
  get reloadScale(){return this.perks.has('specialty_fastreload')?.5:1;}
  get fireScale(){return this.perks.has('specialty_rof')?.75:1;}
}
