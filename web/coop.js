// Online co-op. The host's browser runs the one real game world: rounds,
// zombies (which hunt the nearest valid player), doors, barriers, the box,
// power-ups and the map's power/teleporter state. Guests run their own player
// locally and mirror that world from the host's snapshots, reporting their
// hits, purchases and repairs; the host pays guests' points and kills back.
// Everyone sends their own player state so the others can draw them.
// Last stand follows the co-op rules: a downed player keeps a pistol until a
// teammate holds Use to revive them, bleeds out after 30 s, respawns at the
// next round, and the game ends when every player is down or dead.
import {changeStance as setStance} from './player-movement.js';
const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const round1=v=>Math.round(v*10)/10;
// Player colours of the co-op scoreboard (players 1-4).
export const PLAYER_COLORS=['#ffffff','#78b4ff','#ffd24a','#7fdc6a'];
export const BLEEDOUT_SECONDS=30,REVIVE_SECONDS=3,QUICK_REVIVE_SECONDS=1.5,REVIVE_RANGE=64,PLAYER_RADIUS=15;
// Host sounds every player hears: round, barriers, box, power-ups, power,
// teleporter, PA and the theater/factory machinery.
const WORLD_SOUNDS=new Set(['round_over','chalk','remove_boards','lid_open','lid_close','music_box','spawn_powerup','powerup_grabbed','carp_end','switch_flip','bridge_lower',
  'electrical_surge','perks_power_on','evt_teleporter_activate_start','evt_teleporter_activate_finish','clock_tick_1sec','bolt','spawn','pre_spawn','sam_nospawn',
  'full_ammo','insta_kill','ma_vox','insta_vox','dp_vox','nuke_vox','carp_vox','evt_teleporter']);
const worldSound=alias=>WORLD_SOUNDS.has(alias)||alias.startsWith('pa_')||alias.startsWith('zmb_vox_ann_');

export class Coop {
  constructor(game,session,{host,localId,slot=0,character=null}){
    Object.assign(this,{game,session,host,localId,slot,character});this.guest=!host;
    this.remotes=new Map();this.credit=null;this.down=null;this.dead=false;this.over=false;this.revive=null;this.shots=0;this.snapshots=[];this.mirrored=new Map();this.lastRound=0;
    game.coop=this;game.mirror=this.guest;this.install();
  }
  // ----- shared helpers --------------------------------------------------
  playerCount(){return 1+[...this.remotes.values()].filter(r=>r.present).length;}
  playerPositions(){return [this.game.player.position,...[...this.remotes.values()].filter(r=>r.present&&r.state&&!r.state.dead).map(r=>r.state.p)];}
  toHost(msg){if(this.host)this.handle(this.localId,msg);else this.session.send('host',msg);}
  to(id,msg){if(id===this.localId)this.handle(this.localId,msg);else this.session.send(id,msg);}
  toAll(msg){this.session.send('all',msg);}
  cannotPickUp(){return !!this.down||this.dead;}
  ownsBox(box){return box.owner==null||box.owner===this.localId;}
  shooter(){return this.credit?this.remotes.get(this.credit)?.proxy||null:null;}
  awardPoints(amount){if(!this.credit)return false;this.to(this.credit,{type:'points',amount});return true;}
  // A guest reports its hit; the host applies it (and pays the guest).
  forwardHit(enemy,damage,head,melee){if(!this.guest)return false;if(damage>0)this.toHost({type:'hit',enemy:enemy.id,damage,head:!!head,melee:!!melee});return true;}
  remote(id){let r=this.remotes.get(id);if(!r){r={id,present:false,state:null,proxy:{position:[0,0,0],kills:0,headshots:0,barrierReward:0},node:-1,nodeDue:0};this.remotes.set(id,r);}return r;}
  nameOf(id,characterNames){const r=id===this.localId?{slot:this.slot,character:this.character}:this.remotes.get(id);if(!r)return 'PLAYER';return characterNames&&r.character!=null?characterNames[r.character]:'PLAYER '+((r.slot??0)+1);}

  // ----- method hooks ----------------------------------------------------
  install(){
    const g=this.game,damage=g.damagePlayer.bind(g),changeStance=g.changeStance.bind(g),use=g.use.bind(g),tickEnemy=g.tickEnemy.bind(g),pickup=g.pickup.bind(g),startRound=g.startRound.bind(g),updateCarpenter=g.updateCarpenter.bind(g),emit=g.emit.bind(g);
    // Going down instead of dying; nothing hurts a downed or dead player.
    g.damagePlayer=amount=>{
      if(this.down||this.dead||this.over)return;
      if(!g.mods?.god&&g.player.health-amount<=0){this.goDown();g.emit('damage',amount);return;}
      damage(amount);
    };
    g.changeStance=name=>this.down||this.dead?false:changeStance(name);
    g.use=()=>{
      if(this.down||this.dead)return false;
      const e=g.nearInteraction();
      if(this.guest&&e&&this.worldUse(e)){this.toHost({type:'use',index:g.interactions.indexOf(e)});return true;}
      // Kino: using the linked teleporter spends the shared link.
      const r=g.mapRules,linked=r?.teleporterLinked&&!r.teleportDue,result=use();
      if(this.guest&&linked&&r.teleportDue)this.toHost({type:'teleported'});
      return result;
    };
    // Kills give the shooter's character lines; the host sends guests theirs.
    if(this.host){
      g.tickEnemy=(enemy,dt)=>{
        if(enemy.dead||enemy.stage!=='hunt')return tickEnemy(enemy,dt);
        const target=this.targetFor(enemy);if(!target||target.local)return tickEnemy(enemy,dt);
        this.asTarget(target,()=>tickEnemy(enemy,dt));
      };
      g.pickup=drop=>{
        pickup(drop);
        // Max ammo refills every player; a nuke pays every player 400.
        this.toAll({type:'powerup',drop:drop.type,by:this.pickupBy??this.localId});
      };
      g.startRound=()=>{startRound();for(const r of this.remotes.values())r.proxy.barrierReward=0;this.roundStarted();};
      g.updateCarpenter=()=>{const running=g.carpenter;updateCarpenter();if(running&&!g.carpenter)this.toAll({type:'points',amount:200});};
      g.emit=(type,value)=>{emit(type,value);if(type==='sound'&&worldSound(value.alias))this.forwardSound(value);};
    }
  }
  forwardSound(s){
    const msg={type:'sound',sound:{alias:s.alias,volume:s.volume,position:s.position,near:s.near,far:s.far,exclusive:s.exclusive}};
    for(const r of this.remotes.values())if(r.present)this.session.send(r.id,msg);
  }
  // Power, teleporter links and the mainframe change the shared world; the
  // host runs them. A paid teleport moves only the player who used it.
  worldUse(e){
    const r=this.game.mapRules,name=e.targetname;if(!r)return false;
    if(name==='use_power_switch'||name==='trigger_teleport_core')return true;
    if(name.startsWith('trigger_teleport_pad_'))return r.teleporterLinked!==undefined?!r.teleporterLinked:!r.links?.has(Number(name.at(-1)));
    return false;
  }
  // ----- host: targets ---------------------------------------------------
  // get_closest_valid_player(): the nearest player who is not down, dead or
  // out of reach in the projection room; kept briefly to avoid flip-flopping.
  candidates(){
    const g=this.game,list=[];
    if(!this.down&&!this.dead&&!g.mapRules?.projectionUntil&&!g.noclipping)list.push({local:true,id:this.localId,position:g.player.position});
    for(const r of this.remotes.values())if(r.present&&r.state&&!r.state.down&&!r.state.dead&&!r.state.proj)list.push({local:false,id:r.id,position:r.state.p,record:r});
    return list;
  }
  targetFor(enemy){
    const g=this.game,list=this.candidates();if(!list.length)return null;
    let best=null,bestDistance=Infinity;for(const c of list){const d=distance(c.position,enemy.position);if(d<bestDistance){best=c;bestDistance=d;}}
    const current=list.find(c=>c.id===enemy.coopTarget);
    if(current&&g.time<(enemy.coopTargetUntil||0)&&distance(current.position,enemy.position)<bestDistance*1.25+48)best=current;
    if(best.id!==enemy.coopTarget){enemy.coopTarget=best.id;enemy.coopTargetUntil=g.time+1;enemy.navDue=0;enemy.path=[];}
    return best;
  }
  // Run one zombie's hunt as if this remote player were the player: its own
  // node cache, and its damage goes to that browser.
  asTarget(target,fn){
    const g=this.game,r=target.record,saved={player:g.player,targetNode:g.targetNode,targetNodeDue:g.targetNodeDue,noclipping:g.noclipping,damagePlayer:g.damagePlayer};
    r.proxy.position=target.position;g.player=r.proxy;g.targetNode=r.node;g.targetNodeDue=r.nodeDue;g.noclipping=false;g.damagePlayer=amount=>this.to(r.id,{type:'damage',amount});
    try{fn();}finally{r.node=g.targetNode;r.nodeDue=g.targetNodeDue;Object.assign(g,saved);}
  }
  // ----- host: guest requests -------------------------------------------
  withCredit(id,fn){const previous=this.credit;this.credit=id===this.localId?null:id;try{return fn();}finally{this.credit=previous;}}
  handle(from,msg){
    const g=this.game;
    switch(msg?.type){
      case 'hit':{if(!this.host)return;const enemy=g.enemies.find(e=>e.id===msg.enemy);if(!enemy||enemy.dead)return;
        const r=this.remotes.get(from);if(r?.state)enemy.killFrom=r.state.p;
        this.withCredit(from,()=>g.hitEnemy(enemy,Number(msg.damage)||0,!!msg.head,!!msg.melee));
        if(enemy.dead)this.to(from,{type:'killed',enemy:enemy.id,head:!!msg.head,melee:!!msg.melee});return;}
      // A purchase that lost a race (already open, box busy) is refunded.
      case 'open':{if(!this.host)return;const e=g.interactions.find(x=>x.target===msg.target&&['zombie_door','zombie_debris'].includes(x.targetname));
        if(e&&!g.opened.has(e.target))this.withCredit(from,()=>g.openDoor(e));else this.to(from,{type:'points',amount:Number(e?.zombie_cost)||0});return;}
      case 'box':{if(!this.host)return;const box=g.boxes.get(msg.target);
        if(box?.phase==='closed')g.openBox(box,Array.isArray(msg.names)?msg.names.filter(n=>g.data.weapons[n]):[],from);else this.to(from,{type:'points',amount:Number(msg.cost)||950});return;}
      case 'teleported':{if(!this.host)return;const r=g.mapRules;if(r&&r.teleporterLinked!==undefined){r.teleporterLinked=false;r.teleportCooldown=g.time+90;g.emit('power');}return;}
      case 'boxTake':{if(!this.host)return;const box=g.boxes.get(msg.target),settings=g.presentation.box||{cooldown:3};
        if(box?.phase==='offered'&&box.owner===from){box.phase='closing';box.closedAt=g.time;box.due=g.time+settings.cooldown;box.timedOut=false;g.emit('sound',{alias:'lid_close'});}return;}
      case 'rebuild':{if(!this.host)return;const w=g.windows.find(x=>x.target===msg.target);if(!w||w.boards>=6||w.traverser&&!w.traverser.dead)return;
        this.withCredit(from,()=>{const wasOpen=w.boards===0;w.boards++;g.collision.disabled.delete(w.target);if(wasOpen)g.invalidateNavigation([w.target]);g.emit('barrier',w);
          const repairer=this.shooter()||g;if((repairer.barrierReward||0)<Math.min(500,50*g.round)){g.awardPoints(10*(g.powerup.double_points?2:1));repairer.barrierReward=(repairer.barrierReward||0)+10;}});return;}
      case 'use':{if(!this.host)return;const e=g.interactions[msg.index];if(e&&this.worldUse(e))this.withCredit(from,()=>g.mapRules.use(e));return;}
      // ----- every player -----
      case 'points':g.changePoints(Number(msg.amount)||0);return;
      case 'killed':{g.player.kills++;if(msg.head)g.player.headshots++;const enemy=g.enemies.find(e=>e.id===msg.enemy);if(enemy&&g.killVox)g.killVox(enemy,msg.head,msg.melee);return;}
      case 'damage':g.damagePlayer(Number(msg.amount)||0);return;
      case 'sound':if(msg.sound?.alias)g.emit('sound',msg.sound);return;
      case 'powerup':this.sharePowerup(msg.drop,msg.by);return;
      case 'revive':this.revived(from);return;
      case 'gameOver':this.gameOver(msg);return;
      case 'respawn':this.respawn();return;
    }
  }
  // The host applied a power-up; every other player gets their own share.
  sharePowerup(type,by){
    const g=this.game;if(this.host)return;
    if(type==='full_ammo'){for(const w of g.inventory){w.clip=w.definition.clipSize;w.reserve=w.definition.maxAmmo;}if(this.down)for(const w of this.down.inventory){w.clip=w.definition.clipSize;w.reserve=w.definition.maxAmmo;}g.player.grenades=4;}
    else if(type==='nuke')g.changePoints(400);
    g.message({'full_ammo':'Max ammo','insta_kill':'Insta-kill · 30 seconds','double_points':'Double points · 30 seconds','nuke':'Nuke','carpenter':'Carpenter'}[type]||'');
    if(by===this.localId)g.laterDialog?.(3+Math.random()*.5,'powerup',type);
  }
  // ----- per frame -------------------------------------------------------
  update(){
    const g=this.game;
    for(const [id,p]of this.session.players){const r=this.remote(id);Object.assign(r,{present:p.present,slot:p.slot,character:p.character,state:p.state});if(p.state)r.proxy.position=p.state.p;}
    for(const id of [...this.remotes.keys()])if(!this.session.players.has(id))this.remotes.delete(id);
    if(this.down){g.player.health=1;g.lastDamage=g.time;if(g.time>=this.down.bleedout)this.bleedOut();}
    this.separate();
    if(this.guest)this.mirror();
    if(this.host&&!this.over){
      // A teammate standing on a power-up collects it for everyone.
      for(const drop of g.drops)for(const r of this.remotes.values())if(!drop.used&&r.present&&r.state&&!r.state.down&&!r.state.dead&&distance([drop.position[0],drop.position[1],drop.position[2]+40],r.state.p)<64){this.pickupBy=r.id;const dialog=g.laterDialog;g.laterDialog=()=>{};try{g.pickup(drop);}finally{this.pickupBy=null;g.laterDialog=dialog;}}
      // Game over once nobody is left standing.
      if(g.phase!=='ready'&&g.phase!=='dead'&&!this.candidatesAlive())this.endGame();
    }
  }
  // Teammates are solid to each other: this player is pushed out of any
  // standing teammate (through the world collision, never into a wall).
  separate(){
    const g=this.game,p=g.player;if(this.dead||g.noclipping)return;
    for(const r of this.remotes.values()){
      const s=r.state;if(!r.present||!s||s.dead||s.down)continue;
      const dx=p.position[0]-s.p[0],dy=p.position[1]-s.p[1],d=Math.hypot(dx,dy),overlap=PLAYER_RADIUS*2-d;
      if(overlap<=0||Math.abs(p.position[2]-s.p[2])>60)continue;
      const nx=d>.01?dx/d:Math.cos(this.slot),ny=d>.01?dy/d:Math.sin(this.slot);
      p.position=g.collision.step(p.position,[nx*overlap,ny*overlap,0],g.playerHull).position;
    }
  }
  // A teammate's body stops this player's shots (friendly fire does no
  // damage): hits beyond them are dropped and the bullet ends there.
  blockShot(ray,origin,dir,sample){
    let nearest=Infinity;
    for(const r of this.remotes.values()){
      const s=r.present&&sample(r.id);if(!s||s.dead)continue;
      const height=s.down||s.stance==='prone'?22:s.stance==='crouch'?50:70,lo=[s.p[0]-PLAYER_RADIUS,s.p[1]-PLAYER_RADIUS,s.p[2]],hi=[s.p[0]+PLAYER_RADIUS,s.p[1]+PLAYER_RADIUS,s.p[2]+height];
      let near=0,far=Infinity,miss=false;
      for(let k=0;k<3;k++){if(Math.abs(dir[k])<1e-9){if(origin[k]<lo[k]||origin[k]>hi[k]){miss=true;break;}continue;}const a=(lo[k]-origin[k])/dir[k],b=(hi[k]-origin[k])/dir[k];near=Math.max(near,Math.min(a,b));far=Math.min(far,Math.max(a,b));if(near>far){miss=true;break;}}
      if(!miss&&near>1)nearest=Math.min(nearest,near);
    }
    const end=Math.hypot(...ray.end.map((v,i)=>v-origin[i]));if(nearest>=end)return ray;
    const hits=(ray.hits||(ray.hit?[ray.hit]:[])).filter(h=>h.distance<nearest);
    return {...ray,hits,hit:hits[0]||null,end:origin.map((v,i)=>v+dir[i]*nearest),wall:false,teammate:true};
  }
  candidatesAlive(){
    if(!this.down&&!this.dead)return true;
    for(const r of this.remotes.values())if(r.present&&r.state&&!r.state.down&&!r.state.dead)return true;return false;
  }
  // The state other players draw this player from.
  state(){
    const g=this.game,p=g.player;
    return {p:p.position.map(round1),yaw:Math.round(g.yaw*1000)/1000,pitch:Math.round(g.pitch*1000)/1000,stance:p.stance,moving:!!g.moving,sprinting:!!g.sprinting,ads:Math.round((g.ads||0)*100)/100,
      weapon:g.weapon?.name,points:p.points,kills:p.kills,health:Math.round(p.health),down:!!this.down,bleed:this.down?Math.max(0,Math.ceil(this.down.bleedout-g.time)):0,dead:this.dead,
      dive:g.dive?{phase:g.dive.phase,yaw:Math.round(g.dive.yaw*1000)/1000}:null,shots:this.shots,proj:!!g.mapRules?.projectionUntil,reload:!!g.reloadEnd,character:this.character,slot:this.slot};
  }
  // ----- host snapshot ---------------------------------------------------
  snapshot(){
    const g=this.game,now=g.time,stage={approach:0,barrier:1,enter:2,traverse:3,hunt:4};
    return {
      time:now,phase:g.phase,round:g.round,remaining:g.remaining,roundIn:Math.max(0,g.roundDue-now),zombieHealth:g.zombieHealth,over:this.over,
      powerup:Object.fromEntries(Object.entries(g.powerup).map(([k,v])=>[k,round1(v-now)])),
      opened:[...g.opened],disabled:[...g.collision.disabled],boards:g.windows.map(w=>w.boards),
      enemies:g.enemies.map(e=>{
        const out={i:e.id,p:e.position.map(round1),a:Math.round(e.angle*100)/100,s:stage[e.stage]??4,g:e.gait};
        if(e.dead){out.d=1;out.h=e.deathHeadshot?1:0;const from=e.killFrom||g.player.position;out.k=e.position.map((v,i)=>round1(v-from[i]));}
        if(e.attacking)out.x=1;
        if(e.tear)out.t=[e.tear.name,round1(e.age-(e.tear.started-e.spawnTime))];
        if(e.stage==='traverse')out.v=[e.traverseAnim,Math.round(e.traverseTime*100)/100];
        return out;
      }),
      boxes:[...g.boxes].map(([target,b])=>[target,{phase:b.phase,weapon:b.weapon,owner:b.owner??null,index:b.index,timedOut:!!b.timedOut,
        started:b.started!=null?b.started-now:null,nextAt:b.nextAt!=null?b.nextAt-now:null,offeredAt:b.offeredAt!=null?b.offeredAt-now:null,due:b.due!=null?b.due-now:null,closedAt:b.closedAt!=null?b.closedAt-now:null}]),
      activeBox:g.activeBox??null,
      drops:g.drops.filter(d=>!d.used).map(d=>({id:d.id,type:d.type,p:d.position.map(round1),age:round1(now-d.spawned),left:round1(d.expires-now)})),
      rules:this.rulesState(),
    };
  }
  rulesState(){
    const r=this.game.mapRules;if(!r)return null;const now=this.game.time;
    return {power:r.power,powerAge:r.powerStartedAt!=null?now-r.powerStartedAt:null,flags:[...r.flags],links:r.links?[...r.links]:[],
      linkPending:r.linkPending?{id:r.linkPending.id,left:r.linkPending.due-now,age:now-r.linkPending.started,ticks:r.linkPending.ticks}:null,
      teleporterLinked:r.teleporterLinked??null,coreLinked:r.coreLinked??null,cooldown:Math.max(0,(r.teleportCooldown||0)-now),
      // Map-specific shared state (Buried: Arthur, the cell, items).
      extra:r.coopState?.()??null};
  }
  // ----- guest mirror ----------------------------------------------------
  receive(snap,now){
    this.snapshots.push({t:snap.t,at:now,snap});if(this.snapshots.length>12)this.snapshots.shift();
    this.applyWorld(snap);
  }
  applyWorld(s){
    const g=this.game;
    if(s.round>g.round){g.round=s.round;g.roundStartedAt=g.time;g.emit('round',s.round);if(this.lastRound&&this.dead)this.respawn();this.lastRound=s.round;}
    if(g.phase!=='dead'&&g.phase!=='ready'&&!this.over){if(s.phase==='round'&&g.phase==='between')g.roundStartedAt=g.time;if(s.phase==='between'&&g.phase==='round')g.roundEndedAt=g.time;g.phase=s.phase==='ready'||s.phase==='dead'?g.phase:s.phase;}
    g.remaining=s.remaining;g.roundDue=g.time+s.roundIn;g.zombieHealth=s.zombieHealth;
    g.powerup=Object.fromEntries(Object.entries(s.powerup).map(([k,left])=>[k,g.time+left]));
    for(const target of s.opened)if(!g.opened.has(target)){g.opened.add(target);g.emit('open',{target});}
    g.collision.disabled=new Set(s.disabled);
    s.boards.forEach((boards,i)=>{const w=g.windows[i];if(w&&w.boards!==boards){w.boards=boards;g.emit('barrier',w);}});
    for(const [target,b]of s.boxes){const box=g.boxes.get(target);if(!box)continue;const at=v=>v==null?null:g.time+v;
      Object.assign(box,{phase:b.phase,weapon:b.weapon,owner:b.owner,index:b.index,timedOut:b.timedOut,started:at(b.started),nextAt:at(b.nextAt),offeredAt:at(b.offeredAt),due:at(b.due),closedAt:at(b.closedAt)});}
    if(s.activeBox!==undefined&&s.activeBox!==g.activeBox){g.activeBox=s.activeBox;g.emit('boxMoved',s.activeBox);}
    const live=new Set(s.drops.map(d=>d.id));
    for(const d of s.drops)if(!g.drops.some(x=>x.id===d.id)){const drop={id:d.id,type:d.type,position:d.p.slice(),spawned:g.time-d.age,expires:g.time+d.left,restored:true};g.drops.push(drop);g.emit('drop',drop);g.dropLoop(drop);}
    for(const drop of g.drops)if(!live.has(drop.id)&&!drop.used){drop.used=true;g.emit('stopLoop',{id:'drop'+drop.id});}
    g.drops=g.drops.filter(d=>!d.used);
    const r=g.mapRules,w=s.rules;
    if(r&&w){const powered=r.power;r.power=w.power;r.powerStartedAt=w.powerAge!=null?g.time-w.powerAge:null;r.flags=new Set(w.flags);if(r.links)r.links=new Set(w.links);
      r.linkPending=w.linkPending?{id:w.linkPending.id,due:g.time+w.linkPending.left,started:g.time-w.linkPending.age,ticks:w.linkPending.ticks}:null;
      if(w.teleporterLinked!==null)r.teleporterLinked=w.teleporterLinked;if(w.coreLinked!==null)r.coreLinked=w.coreLinked;if(w.cooldown)r.teleportCooldown=Math.max(r.teleportCooldown||0,g.time+w.cooldown);
      if(powered!==r.power||w.teleporterLinked!==null)g.emit('power');if(w.extra)r.applyCoopState?.(w.extra);}
    if(s.over&&!this.over)this.gameOver({round:s.round});
  }
  // Zombies are drawn 100 ms behind the newest snapshot, between two of them.
  mirror(delay=100){
    const g=this.game,list=this.snapshots;if(!list.length)return;
    const newest=list.at(-1),renderAt=performance.now()-delay;let a=newest,b=newest,t=0;
    for(let i=list.length-1;i>0;i--)if(list[i-1].at<=renderAt){a=list[i-1];b=list[i];t=Math.min(1,Math.max(0,(renderAt-a.at)/((b.at-a.at)||1)));break;}
    const before=new Map(a.snap.enemies.map(e=>[e.i,e])),present=new Set();
    for(const e of b.snap.enemies){
      present.add(e.i);const prev=before.get(e.i)||e,p=prev.p.map((v,k)=>v+(e.p[k]-v)*t),angle=prev.a+Math.atan2(Math.sin(e.a-prev.a),Math.cos(e.a-prev.a))*t;
      let enemy=this.mirrored.get(e.i);
      if(!enemy){enemy={id:e.i,position:p,previousPosition:p.slice(),angle,stage:'hunt',gait:e.g,speed:37.64,dead:false,age:0,spawnTime:0,path:[],health:1};this.mirrored.set(e.i,enemy);g.enemies.push(enemy);g.emit('spawn',enemy);}
      enemy.position=p;enemy.previousPosition=p.slice();enemy.angle=angle;enemy.gait=e.g;enemy.stage=['approach','barrier','enter','traverse','hunt'][e.s]||'hunt';enemy.attacking=!!e.x;
      if(e.t){enemy.tear={name:e.t[0],started:0};enemy.spawnTime=0;enemy.age=e.t[1];}else enemy.tear=null;
      if(e.v){enemy.traverseAnim=e.v[0];enemy.traverseTime=e.v[1];}
      if(e.d&&!enemy.dead){enemy.dead=true;enemy.deathTime=g.time;enemy.deathHeadshot=!!e.h;enemy.killDirection=e.k;g.emit('kill',enemy);}
    }
    for(const [id,enemy]of this.mirrored)if(!present.has(id)&&!newest.snap.enemies.some(e=>e.i===id)){this.mirrored.delete(id);const i=g.enemies.indexOf(enemy);if(i>=0)g.enemies.splice(i,1);g.emit('removeEnemy',enemy);}
  }
  // ----- last stand ------------------------------------------------------
  goDown(){
    const g=this.game,pistol=g.inventory.find(w=>/pistol/i.test(w.definition.weaponClass||'')||['m1911_zm','zombie_colt'].includes(w.name));
    this.down={since:g.time,bleedout:g.time+BLEEDOUT_SECONDS,inventory:g.inventory,slot:g.slot};
    const sidearm=g.makeWeapon(pistol?.name||g.data.startWeapon||'zombie_colt');sidearm.raised=true;g.inventory=[sidearm];g.slot=0;g.reloadEnd=0;g.pendingFire=false;g.sprinting=false;g.switching=null;g.gesture=null;
    g.mapRules?.perks?.clear();g.player.health=1;
    if(!setStance(g,'prone',{toggle:false,dive:false}))g.player.stance='prone';
    g.emit('weapon',g.weapon);g.message('You are down! A teammate has '+BLEEDOUT_SECONDS+' seconds to revive you.');g.dialog?.('general','revive_down');
  }
  revived(by){
    const g=this.game;if(!this.down)return;
    g.inventory=this.down.inventory;g.slot=Math.min(this.down.slot,g.inventory.length-1);this.down=null;g.player.health=100;g.lastDamage=g.time;
    setStance(g,'stand',{toggle:false,dive:false});g.emit('weapon',g.weapon);g.message('Revived');
  }
  bleedOut(){
    const g=this.game;this.down=null;this.dead=true;g.inventory=[g.makeWeapon(g.data.startWeapon||'zombie_colt')];g.inventory[0].raised=true;g.slot=0;
    g.message('You bled out. You will respawn next round.');
  }
  roundStarted(){if(this.dead)this.respawn();for(const r of this.remotes.values())if(r.present&&r.state?.dead)this.to(r.id,{type:'respawn'});}
  respawn(){
    const g=this.game;if(!this.dead)return;this.dead=false;g.player.health=100;g.lastDamage=g.time;
    const spawn=this.spawnPoint();g.player.position=spawn.slice();g.player.previousPosition=spawn.slice();g.player.velocityZ=0;g.player.grounded=true;
    setStance(g,'stand',{toggle:false,dive:false});g.emit('weapon',g.weapon);g.message('Respawned');
  }
  // Player n starts at the map's nth initial_spawn_points marker.
  spawnPoint(){
    const g=this.game,markers=g.entities.filter(e=>e.targetname==='initial_spawn_points'),marker=markers[this.slot%Math.max(1,markers.length)];
    const at=marker?marker.origin.split(/\s+/).map(Number):g.spawn;
    if(g.settleFeet)try{return g.settleFeet(at);}catch{return g.player.position.slice();}
    g.collision.playerMovement=true;try{return g.collision.move(at,[0,0,-64]).position;}finally{g.collision.playerMovement=false;}
  }
  spawnYaw(){const g=this.game,markers=g.entities.filter(e=>e.targetname==='initial_spawn_points'),marker=markers[this.slot%Math.max(1,markers.length)];return marker?Number((marker.angles||'0 0 0').split(/\s+/)[1])*Math.PI/180:null;}
  // The teammate this player can revive: downed, within reach.
  reviveTarget(){
    if(this.down||this.dead)return null;const p=this.game.player.position;let best=null,range=REVIVE_RANGE;
    for(const r of this.remotes.values())if(r.present&&r.state?.down){const d=distance(r.state.p,p);if(d<range){best=r;range=d;}}return best;
  }
  // Holding Use next to a downed teammate revives them.
  updateRevive(using,dt){
    const target=this.reviveTarget();
    if(!target||!using){this.revive=null;return null;}
    if(this.revive?.id!==target.id)this.revive={id:target.id,progress:0};
    const time=this.game.mapRules?.perks?.has('specialty_quickrevive')?QUICK_REVIVE_SECONDS:REVIVE_SECONDS;
    this.revive.progress+=dt/time;
    if(this.revive.progress>=1){this.to(target.id,{type:'revive'});this.revive=null;this.game.message('Teammate revived');return null;}
    return this.revive;
  }
  endGame(){this.over=true;this.toAll({type:'gameOver',round:this.game.round});this.gameOver({round:this.game.round});}
  gameOver(){
    const g=this.game;if(this.over&&g.phase==='dead')return;this.over=true;this.down=null;g.phase='dead';
    g.emit('death',{round:g.round,kills:g.player.kills,points:g.player.points});
  }
  // Teammates for the scoreboard, in player order.
  scoreboard(names){
    const rows=[{id:this.localId,slot:this.slot,local:true,points:this.game.player.points,down:!!this.down,dead:this.dead}];
    for(const r of this.remotes.values())if(r.present&&r.state)rows.push({id:r.id,slot:r.slot??0,local:false,points:r.state.points,down:r.state.down,dead:r.state.dead});
    return rows.sort((a,b)=>a.slot-b.slot).map(row=>({...row,name:this.nameOf(row.id,names),color:PLAYER_COLORS[row.slot%4]}));
  }
}
