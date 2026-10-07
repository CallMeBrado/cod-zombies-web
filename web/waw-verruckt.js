// Verrückt (nazi_zombie_asylum.gsc) on the WaW engine. The perks share Der
// Riese's rules; Verrückt keeps Nacht-style spawning: spawner groups added by
// doors, volumes that switch spawners and windows while a player is inside
// (manage_zone), courtyard risers, a random start side, the power switch that
// opens the middle door 6 s later, the two electric traps and the moving box.
import {FactoryRules} from './map-rules.js';

const vec=s=>String(s||'0 0 0').trim().split(/\s+/).map(Number);
const inside=(p,hulls)=>hulls.some(h=>h.mins.every((m,k)=>p[k]>=m-2)&&h.maxs.every((m,k)=>p[k]<=m+2)&&h.planes.every(q=>q[0]*p[0]+q[1]*p[1]+q[2]*p[2]<=q[3]+2));
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
// init_zombie_asylum(): goals whose is_active is set from the start.
const ACTIVE_GOALS=new Set(['north_init_goal','south_init_goal','north_upstairs_volume_goal','south_upstairs_volume_goal']);
const TRAP_COST=1000,TRAP_TIME=25,TRAP_COOLDOWN=25,SWITCH_TIME=.5,PERK_DELAY=6.3;

export class VerrucktRules extends FactoryRules {
  constructor(game){
    super(game);
    // Nacht's round_spawning: no network-frame wait and no solo bonus.
    this.spawnNetFrame=0;
    const E=game.entities;
    this.sides={north:E.filter(e=>e.targetname==='initial_spawn_points'&&e.script_noteworthy==='north_spawn'),south:E.filter(e=>e.targetname==='initial_spawn_points'&&e.script_noteworthy==='south_spawn')};
    // Spawners a door adds start locked: manage_zone never adds them earlier.
    this.locked=new Set(Object.values(this.data.doorSpawners).flat());
    this.goalStructs=new Map(E.filter(e=>e.targetname==='exterior_goal').map(e=>[e.target,e]));
    // init_elec_trap_trigs(): the "gas_access" levers and their damage triggers.
    // The lever targets its damage trigger_multiple and the structs the sparks play at.
    this.traps=E.filter(e=>e.targetname==='gas_access').map(e=>{
      return {trigger:{...e,position:vec(e.origin)},hulls:this.data.trapHulls?.[e.target]||[],points:E.filter(x=>x.targetname===e.target&&x.classname==='script_struct').map(x=>vec(x.origin)),
        speaker:vec(E.find(x=>x.targetname==='loudspeaker')?.origin)};});
    game.interactions.push(...this.traps.map(t=>t.trigger));
    // Spawn routes by origin and window, found or not; reset whenever a door
    // or barrier changes the navigation.
    this.routes=new Map();const invalidate=game.invalidateNavigation.bind(game);
    game.invalidateNavigation=targets=>{this.routes.clear();return invalidate(targets);};
  }
  reset(){
    super.reset();
    const g=this.game;
    this.switched=false;this.perksDue=0;this.traps.forEach(t=>t.state=null);
    this.spawners=new Set(this.data.initialSpawners);this.unlocked=new Set();this.goalsOff=new Set();this.zoneDue=0;
    // spawn_point_override(): side1 is north unless randomint(100)>50.
    this.side=Math.floor(Math.random()*100)>50?'south':'north';
    const marker=this.sides[this.side]?.[0];
    if(marker){
      g.spawn=vec(marker.origin);this.spawnYaw=vec(marker.angles)[1]*Math.PI/180;
      g.collision.playerMovement=true;const floor=g.collision.move(g.spawn,[0,0,-64]);g.collision.playerMovement=false;
      g.player.position=floor.position;g.player.previousPosition=floor.position.slice();
    }
    this.manageZones();
  }
  // ----- spawning and windows (manage_zone) ---------------------------------
  occupied(zone){
    const g=this.game,points=(g.coop?.playerPositions()||[g.player.position]).map(p=>[p[0],p[1],p[2]+25]);
    // The magic-box room counts once its doors are bought (magic_door_flags).
    const extra=zone.extra&&zone.extra.flags.every(f=>this.flags.has(f));
    return points.some(p=>inside(p,zone.hulls)||extra&&inside(p,zone.extra.hulls));
  }
  // manage_zone() polls every second: an occupied volume adds its unlocked
  // spawners and turns on its "<volume>_goal" windows; an empty one removes
  // spawners whose script_string names it and turns those windows off.
  manageZones(){
    const g=this.game;
    for(const zone of this.data.zones){
      const active=this.occupied(zone),goal=zone.name+'_goal';
      if(zone.spawners)for(const e of g.spawnEntities.filter(e=>e.targetname===zone.spawners)){
        if(active){if(!this.locked.has(e.targetname)||this.unlocked.has(e.targetname))this.spawners.add(e.targetname);}
        else if(e.script_string===zone.name)this.spawners.delete(e.targetname);
      }
      if(active)this.goalsOff.delete(goal);else this.goalsOff.add(goal);
    }
  }
  addSpawners(groups){for(const group of groups||[]){this.unlocked.add(group);this.spawners.add(group);}}
  goalActive(window){
    const tag=this.data.windows[window.target];if(!tag)return true;
    // activate_goals_when_door_opened(): off until the door's flag is set.
    const door=this.data.doorWindows[tag.noteworthy];
    if(door&&!door.some(flag=>this.flags.has(flag)))return false;
    const managed=ACTIVE_GOALS.has(tag.noteworthy)||!!door;
    return !(managed&&tag.zone&&this.goalsOff.has(tag.zone));
  }
  enabledSpawners(){return this.game.spawnEntities.filter(e=>this.spawners.has(e.targetname));}
  windows(){return this.game.windows.filter(w=>this.goalActive(w));}
  group(){return null;}
  activeZones(){return new Set(this.data.zones.filter(z=>this.occupied(z)).map(z=>z.name));}
  // round_spawning(): rounds 1 and 2 hold six zombies solo, players*3+round in co-op.
  roundCount(round,players){return round<3?(players>1?players*3+round:6):null;}
  get soloAiFactor(){return 0;}
  // zombie_think(): a riser (75%) climbs out of a random courtyard struct; every
  // zombie then takes one of the three goals nearest its spawner's target (or
  // itself), dropping any more than 500 units further than the previous one.
  spawnEnemy(){
    const g=this.game,spawners=this.enabledSpawners();if(!spawners.length)return false;
    const spawner=spawners[Math.floor(Math.random()*spawners.length)],rise=spawner.script_string==='riser'&&Math.floor(Math.random()*100)>25&&this.data.riseSpots.length;
    let origin=vec(spawner.origin),angle=vec(spawner.angles)[1]*Math.PI/180;
    if(rise){
      const spot=this.data.riseSpots[Math.floor(Math.random()*this.data.riseSpots.length)];
      const f=g.collision.actor(()=>g.collision.trace([spot[0],spot[1],spot[2]+51],[spot[0],spot[1],spot[2]-93],[14,14,35]));
      origin=f.fraction<1?[spot[0],spot[1],f.end[2]-35]:spot.slice();
    }
    const target=spawner.target&&g.entities.find(e=>e.targetname===spawner.target),from=target?vec(target.origin):origin;
    // A goal the zombie cannot path to is skipped (zombie_assure_node sends a
    // stuck zombie to the closest reachable entrance instead).
    const key=origin.join(','),nodes=[];
    for(const w of this.windows().sort((a,b)=>distance(a.outside,from)-distance(b.outside,from))){
      const prepared=!rise&&g.spawnRoutes.get(w.target)?.routes.get(key);
      const id=key+'>'+w.target;if(!prepared&&!this.routes.has(id))this.routes.set(id,g.path(origin,w.outside));
      const route=(prepared||this.routes.get(id)).map(p=>p.slice());
      if(route.length&&distance(route.at(-1),w.outside)<40)nodes.push({w,route});
      if(nodes.length===3)break;
    }
    if(!nodes.length)return false;
    const desired=[nodes[0]];
    for(let i=1;i<nodes.length;i++){if(distance(origin,nodes[i].w.outside)-distance(origin,nodes[i-1].w.outside)>500)break;desired.push(nodes[i]);}
    const {w:window,route}=desired[Math.floor(Math.random()*desired.length)];
    const gait=g.zombieGait();
    if(rise){const goal=window.outside;angle=Math.atan2(goal[1]-origin[1],goal[0]-origin[0]);}
    const enemy={id:g.nextId++,position:origin.slice(),previousPosition:origin.slice(),health:g.zombieHealth,window,stage:rise?'rise':'approach',afterRise:'approach',
      ...(rise?this.riseClip(gait):{}),path:route,entryDistance:distance(origin,window.outside),attackDue:0,navDue:0,angle,dead:false,age:0,spawnTime:g.time,gait:gait.name,speed:gait.speed};
    g.enemies.push(enemy);g.remaining--;g.emit('spawn',enemy);return true;
  }
  // do_zombie_rise(): walkers rise on version 1 or 2, runners and sprinters on 1.
  riseClip(gait){
    const g=this.game,name=/sprint/.test(gait.name)?'ai_zombie_traverse_ground_climbout_fast':/run|fast/.test(gait.name)?'ai_zombie_traverse_ground_v1_run':
      Math.random()<.5?'ai_zombie_traverse_ground_v1_walk':'ai_zombie_traverse_ground_v2_walk_altA',clip=g.presentation.animations?.[name];
    return clip?{riseAnim:name,riseUntil:g.time+clip.duration}:{riseUntil:g.time+1.5};
  }
  // ----- the moving box (_zombiemode_weapons + magic_box_limit_location_init)
  // chance_of_joker: none for the first four uses, then uses+3 percent.
  boxJoker(){
    if(this.game.boxes.size<2)return false;
    const accessed=this.game.boxUses+1,chance=accessed<5?0:accessed+3;
    return Math.floor(Math.random()*100)<=chance;
  }
  // magic_box_explore_only: the box only lands where the players have been.
  nextBox(current){
    const f=this.flags,open=new Set(['opened_chest','start_chest']);
    if(f.has('magic_box_south')||f.has('south_access_1'))open.add('magic_box_south');
    if(f.has('south_access_1')||f.has('south_upstairs_blocker'))open.add('magic_box_bathroom');
    if(f.has('north_door1')||f.has('north_upstairs_blocker'))open.add('magic_box_hallway');
    const options=Object.entries(this.data.chests).filter(([note,target])=>open.has(note)&&target!==current).map(([,target])=>target);
    return options.length?options[Math.floor(Math.random()*options.length)]:current;
  }
  // The bear shows 1 s, flies 0.5 + 2 s later and rises over 4 s; the box then
  // lifts for 5 s, poofs, and the next one appears 5.1 s later (show_magic_box).
  get boxSequence(){return {teddy:7.5,laughAt:1.5,laugh:'laugh_child',leave:10.1,leaveSounds:['box_move','whoosh','ann_vox_magicbox'],poofAt:5,poof:'box_poof',arrive:.5,arriveSound:'box_poof',landSound:'couch_slam'};}
  // ----- power and doors ------------------------------------------------------
  onOpen(e){
    super.onOpen(e);
    // The trigger's first door brush (or every debris piece) adds spawners.
    this.addSpawners(this.data.doorSpawners[e.target]);
  }
  visible(e){
    if(e.targetname==='gas_access')return true;
    if(e.targetname==='use_power_switch')return !this.switched;
    if(e.script_noteworthy==='electric_door')return !this.power;
    return super.visible(e);
  }
  prompt(e,key){
    if(e.targetname==='use_power_switch')return key+' · Turn on the power';
    if(e.targetname==='gas_access'){
      const t=this.trapFor(e).state;
      if(!this.switched)return 'The electric trap needs power';
      if(t&&this.game.time<t.ready)return 'Electric trap unavailable';
      return key+' · Activate the electric trap · '+TRAP_COST+' points';
    }
    if(e.script_noteworthy==='electric_door'&&!this.power)return 'The power must be turned on';
    return super.prompt(e,key);
  }
  trapFor(e){return this.traps.find(t=>t.trigger.target===e.target);}
  use(e){
    const g=this.game;
    if(e.targetname==='use_power_switch'){
      // master_electric_switch(): the lever flips, the traps come on now and
      // the perks and middle door 6 s after the lever finishes.
      if(this.switched)return true;this.switched=true;this.powerStartedAt=g.time;this.flags.add('electric_switch_used');this.perksDue=g.time+PERK_DELAY;
      g.emit('sound',{alias:'switch_flip',position:e.position});
      for(const name of ['amb_sparks_l','amb_sparks_r','amb_sparks_l_b','amb_sparks_r_b']){const at=g.entities.find(x=>x.targetname==='audio_swtch_'+(name.endsWith('_b')?'b_':'')+(name.includes('_l')?'left':'right'));if(at)g.emit('sound',{alias:name,position:vec(at.origin)});}
      const speaker=g.entities.find(x=>x.targetname==='loudspeaker');if(speaker)g.emit('sound',{alias:'alarm',position:vec(speaker.origin)});
      g.message('Power restored');return true;
    }
    if(e.targetname==='gas_access'){
      const trap=this.trapFor(e),t=trap.state;
      if(!this.switched||t&&g.time<t.ready)return true;
      if(g.player.points<TRAP_COST){g.spendPoints(TRAP_COST);return true;}
      // electric_trap_think(): the lever swings over 0.5 s, then the points go.
      const live=g.time+SWITCH_TIME;
      trap.state={charge:live,live,until:live+TRAP_TIME,ready:live+TRAP_TIME+TRAP_COOLDOWN,arcDue:live,warned:false,charged:false};
      g.emit('sound',{alias:'amb_sparks_l_b',position:e.position});return true;
    }
    if(e.script_noteworthy==='electric_door')return true;
    return super.use(e);
  }
  tick(){
    const g=this.game;
    // Perks follow this.power (FactoryRules); the middle divider opens with them.
    if(this.perksDue&&g.time>=this.perksDue){
      this.perksDue=0;this.power=true;this.flags.add('electricity_on');g.emit('power');
      const trigger=g.interactions.find(x=>x.script_noteworthy==='electric_door');
      if(trigger&&!g.opened.has(trigger.target)){this.dividerOpenedAt=g.time;this.openTargets([trigger.target]);g.emit('sound',{alias:'door_slide_open',position:trigger.position});}
    }
    super.tick();
    if(!g.mirror&&g.time>=this.zoneDue){this.zoneDue=g.time+1;this.manageZones();}
    for(const trap of this.traps)this.tickTrap(trap);
  }
  // activate_electric_trap(): 25 s of current; zombies touching it die within
  // 1.25 s, players are downed (or take 50 with Jugger-Nog); 25 s later the
  // lever resets and the PA plays "warning".
  tickTrap(trap){
    const g=this.game,t=trap.state;if(!t)return;
    if(!t.charged&&g.time>=t.charge){t.charged=true;if(!g.spendPoints(TRAP_COST)){trap.state=null;return;}
      // electric_trap_fx(): each struct starts and loops its current.
      trap.points.forEach((at,i)=>{g.emit('sound',{alias:'elec_start',position:at});g.emit('loop',{id:'trap_'+trap.trigger.target+'_'+i,alias:'elec_loop',position:at,near:100,far:900});});}
    if(g.time<t.live)return;
    if(g.time<t.until){
      if(g.time>=t.arcDue){t.arcDue=g.time+.1+Math.random()*.4;g.emit('sound',{alias:'elec_arc',position:trap.points[Math.floor(Math.random()*trap.points.length)]||trap.trigger.position});}
      for(const z of g.enemies){if(z.dead||z.shockDue||!inside([z.position[0],z.position[1],z.position[2]+30],trap.hulls))continue;
        z.shockDue=g.time+Math.random()*1.25;g.emit('sound',{alias:'zombie_arc',position:z.position.slice()});}
      const p=g.player.position;
      if(['round','between'].includes(g.phase)&&g.time>=(t.shockedUntil||0)&&inside([p[0],p[1],p[2]+30],trap.hulls)){
        t.shockedUntil=g.time+.1;
        const jugg=this.perks.has('specialty_armorvest')&&g.player.health-100>=1;
        g.damagePlayer(jugg?50:g.player.health+100);g.emit('sound',{alias:'zombie_arc'});
      }
    }else if(!t.stopped){t.stopped=true;trap.points.forEach((_,i)=>g.emit('stopLoop',{id:'trap_'+trap.trigger.target+'_'+i}));}
    if(g.time>=t.ready&&!t.warned){t.warned=true;g.emit('sound',{alias:'warning',position:trap.speaker});trap.state=null;}
    // zombie_elec_death(): the shocked zombie dies after its random delay.
    // No attacker, so no points (dodamage from the level).
    for(const z of g.enemies)if(!z.dead&&z.shockDue&&g.time>=z.shockDue){z.shockDue=0;z.health=0;z.dead=true;z.deathTime=g.time;g.emit('kill',z);}
  }
  saveState(){return {...super.saveState(),switched:this.switched,perksDue:this.perksDue,spawners:[...this.spawners],unlocked:[...this.unlocked],goalsOff:[...this.goalsOff],side:this.side,
    traps:this.traps.map(t=>t.state&&{...t.state})};}
  loadState(s){if(!s)return;super.loadState(s);this.switched=!!s.switched;this.perksDue=s.perksDue||0;this.spawners=new Set(s.spawners||this.data.initialSpawners);this.unlocked=new Set(s.unlocked||[]);
    this.goalsOff=new Set(s.goalsOff||[]);this.side=s.side||this.side;(s.traps||[]).forEach((state,i)=>{if(this.traps[i])this.traps[i].state=state;});}
}
