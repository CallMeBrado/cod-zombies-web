// Dead Ops Arcade (T5 zombietron), independent of the first-person engine.
// Native arena order, weapon values, spawn groups and limits come from GSC.
export const DOA_STEP=1/120;
const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const clone=value=>JSON.parse(JSON.stringify(value));
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
export const DOA_WEAPON_LABELS={m60_zt:'M60',minigun_zt:'MINIGUN',spas_zt:'SPAS-12',china_lake_zt:'CHINA LAKE',rpg_zt:'RPG',ray_gun_zt:'RAY GUN',m2_flamethrower_zt:'FLAMETHROWER'};
export class DeadOpsEngine {
  constructor(manifest,collision,navigation,events={}){
    this.data=manifest;this.collision=collision;this.navigation=navigation;this.events=events;this.engine='dead-ops-t5';this.newGame();
  }
  emit(name,data){this.events[name]?.(data);}
  random(){let t=this.seed+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;}
  newGame(){
    this.seed=0xD0A123;this.time=0;this.accumulator=0;this.round=0;this.arenaIndex=0;this.phase='ready';this.nextId=1;
    this.player={position:this.data.arenas[0].spawn.slice(),previousPosition:this.data.arenas[0].spawn.slice(),angle:Math.PI/2,health:100,lives:3,bombs:1,boosters:2,points:0,kills:0,headshots:0};
    this.inventory=[{name:'m60_zt'}];this.weapon='m60_zt';this.weaponUntil=0;this.weaponRemaining=0;this.weaponDuration=10;this.effects={};this.enemies=[];this.shots=[];this.drops=[];this.spawnQueue=[];this.exitOpen=[];
    this.nextLife=200000;this.multiplier=1;this.prizeBar=0;this.boostUntil=0;this.invulnerableUntil=0;this.fireDue=0;this.deathUntil=0;this.flowDue=0;this.exitReadyAt=0;this.fate=null;this.mods={god:false};
    this.enterArena(0);this.emit('reset');
  }
  get arena(){return this.data.arenas[this.arenaIndex];}
  get grid(){return this.navigation.arenas[this.arenaIndex];}
  get remaining(){return this.spawnQueue.length;}
  get weaponDefinition(){return this.data.weapons[this.weapon];}
  get moving(){return !!this.isMoving;}
  ground(p){
    const start=[p[0],p[1],p[2]+100],r=this.collision.trace(start,[p[0],p[1],p[2]-220],[0,0,0],1);
    return r.fraction<1&&r.normal[2]>.45&&!r.allSolid?r.end:p.slice();
  }
  nearest(p){let index=-1,best=Infinity;this.grid.nodes.forEach((n,i)=>{const d=(n.p[0]-p[0])**2+(n.p[1]-p[1])**2+(n.p[2]-p[2])**2;if(d<best){best=d;index=i;}});return index;}
  enterArena(index){
    this.arenaIndex=index%this.data.arenas.length;let p=this.ground(this.arena.spawn);const start=this.nearest(p);if(start>=0&&dist(p,this.grid.nodes[start].p)>64)p=this.grid.nodes[start].p.slice();this.player.position=p;this.player.previousPosition=p.slice();this.player.health=100;
    this.enemies=[];this.shots=[];this.drops=[];this.exitOpen=[];this.flowDue=0;this.collision.disabled=new Set(this.data.arenas.flatMap(a=>a.exits.map(e=>e.target).filter(Boolean)));
    this.invulnerableUntil=this.time+3;this.emit('arena',this.arena);
  }
  start(){if(this.phase==='ready'){this.round=1;this.startRound();}}
  startRound(){
    this.phase='round';this.exitOpen=[];this.emit('round',this.round);
    const groups=Math.min(6+this.round,30*(1+Math.floor((this.round-1)/40)));let at=this.time+2;
    this.spawnQueue=[];
    for(let wave=0;wave<groups;wave++){
      const duration=1+this.random()*(1+wave*.3)+this.random()*(1+this.round*.2),side=['top','bottom','left','right'][Math.floor(this.random()*4)];
      for(let age=0;age<duration;age+=.6)this.spawnQueue.push({due:at+age,side,kind:'zombie'});
      at+=1+this.random()*duration;
    }
    const special={9:'sergei',13:'quad',17:'engineer',23:'engineer',30:'sergei',34:'dog'}[(this.round-1)%40+1];
    if(special)for(let i=0;i<3;i++)this.spawnQueue.push({due:this.time+8+i*6,side:'top',kind:special});
    if(this.round%40===0)this.spawnQueue.push({due:this.time+4,side:'top',kind:'ape'});
    this.spawnQueue.sort((a,b)=>a.due-b.due);this.player.boosters=Math.max(this.player.boosters,this.fate==='feet'?3:1);
  }
  spawn(request){
    const candidates=this.arena.spawners.filter(s=>s.side===request.side);const s=(candidates.length?candidates:this.arena.spawners)[Math.floor(this.random()*(candidates.length||this.arena.spawners.length))];
    if(!s)return;let p=this.ground(s.position);const i=this.nearest(p);if(i<0)return;
    // Spawner markers outside the arena floor join its reachable boundary.
    if(dist(p,this.grid.nodes[i].p)>48||Math.abs(p[2]-this.grid.nodes[i].p[2])>32)p=this.grid.nodes[i].p.slice();
    const kind=request.kind,health=kind==='ape'?500000:kind==='zombie'?1000+150*(this.round-1):10000+500*(this.round-1);
    const e={id:this.nextId++,kind,position:p,previousPosition:p.slice(),health,maxHealth:health,angle:0,speed:kind==='ape'?175:kind==='dog'?210:Math.min(160,30+5*(this.round-1)),gait:this.round>6?'ai_zombie_run_v1':'ai_zombie_walk_v1',stage:'hunt',dead:false,stalled:0,born:this.time};
    this.enemies.push(e);this.emit('spawn',e);
  }
  buildFlow(){
    const nodes=this.grid.nodes,origin=this.nearest(this.player.position);this.flow=new Int32Array(nodes.length).fill(-1);if(origin<0)return;
    const q=[origin];this.flow[origin]=0;for(let k=0;k<q.length;k++)for(const j of nodes[q[k]].links)if(this.flow[j]<0){this.flow[j]=this.flow[q[k]]+1;q.push(j);}
  }
  move(p,dx,dy,actor=false){
    if(Math.abs(dx)+Math.abs(dy)<1e-8)return this.ground(p);
    const run=()=>this.collision.step(p,[dx,dy,-800*DOA_STEP*DOA_STEP],[12,12,30]);const result=actor?this.collision.actor(run):run();
    // A point floor test avoids accumulating the swept hull's terrain edge height.
    if(result.grounded)return this.ground(result.position);return result.position;
  }
  boost(){
    if(this.phase!=='round'||!this.player.boosters||this.time<this.deathUntil)return false;
    this.player.boosters--;this.boostUntil=this.time+.65;this.invulnerableUntil=Math.max(this.invulnerableUntil,this.time+.85);this.boostAngle=this.moveAngle??this.player.angle;this.emit('sound','zmb_speed_boost_activate');return true;
  }
  nuke(){
    if(!['round','exit'].includes(this.phase)||!this.player.bombs||this.time<this.deathUntil)return false;
    this.player.bombs--;for(const e of this.enemies)if(!e.dead)this.damage(e,e.kind==='ape'?50000:e.health);
    this.invulnerableUntil=Math.max(this.invulnerableUntil,this.time+1);this.emit('blast',{position:this.player.position.slice(),radius:1600,nuke:true});this.emit('sound',this.data.weapons.rpg_zt.projExplosionSound);return true;
  }
  fire(){
    if(this.phase!=='round'||this.time<this.deathUntil||this.time<this.fireDue)return false;
    const d=this.weaponDefinition;this.fireDue=this.time+Math.max(DOA_STEP,d.fireTime||.022);
    const pellets=this.weapon==='spas_zt'?7:1,flame=this.weapon==='m2_flamethrower_zt';
    const angles=Array.from({length:pellets},(_,i)=>this.player.angle+(pellets>1?(i-(pellets-1)/2)*.065:0));
    if(this.effects.chicken>this.time||this.fate==='friendship')angles.push(this.player.angle-.1,this.player.angle+.1);
    for(const a of angles){
      const projectile=d.projectileSpeed>0;
      this.shots.push({id:this.nextId++,position:[this.player.position[0]+Math.cos(a)*8,this.player.position[1]+Math.sin(a)*8,this.player.position[2]+32],
        previousPosition:null,angle:a,speed:projectile?d.projectileSpeed:2600,damage:d.damage||235,range:flame?260:1800,traveled:0,radius:flame?38:projectile?16:7,pierce:!projectile||this.weapon==='ray_gun_zt'||flame,hits:[],weapon:this.weapon});
    }
    this.emit('shot',{position:this.player.position.slice(),angle:this.player.angle,weapon:this.weapon});return true;
  }
  damage(e,amount){if(e.dead)return;e.health-=amount;this.emit('hit',e);if(e.health>0)return;
    e.dead=true;e.died=this.time;this.player.kills++;this.addPoints(e.kind==='ape'?30000:100);this.emit('kill',e);
    for(let i=0;i<(e.kind==='ape'?25:this.fate==='fortune'?6:3);i++)this.drop(i===0&&this.random()<.09?'weapon':this.random()<.03?'ruby':'gold',e.position);
    if(this.random()<.035)this.drop(['bomb','booster','speed','chicken','turret','tank','heli','monkey','barrel','tesla','teddy'][Math.floor(this.random()*11)],e.position);
    if(e.kind==='ape'){this.emit('message','COSMIC SILVERBACK DEFEATED');this.emit('sound','zmb_boss_death');}
  }
  addPoints(points){this.player.points+=Math.round(points*this.multiplier);while(this.player.points>=this.nextLife){this.nextLife+=200000;this.player.lives=Math.min(9,this.player.lives+1);this.emit('sound','zmb_pickup_life');this.emit('message','EXTRA LIFE');}}
  drop(kind,position){
    const a=this.random()*Math.PI*2,r=12+this.random()*35,p=this.ground([position[0]+Math.cos(a)*r,position[1]+Math.sin(a)*r,position[2]]);
    if(kind==='weapon')kind=Object.keys(this.data.weapons).filter(n=>n!=='m60_zt')[Math.floor(this.random()*6)];
    if(this.drops.length>=160)this.drops.shift();this.drops.push({id:this.nextId++,kind,position:p,expires:this.time+12});
  }
  pickup(d){
    d.used=true;const p=this.player,k=d.kind;this.emit('pickup',d);this.emit('sound',this.data.weapons[k]?'zmb_pickup_weapon':['gold','silver','ruby','diamond'].includes(k)?'zmb_pickup_money':k==='life'?'zmb_pickup_life':['tank','heli'].includes(k)?'zmb_pickup_vehicle':'zmb_pickup_powerup');
    if(k==='gold'||k==='silver'||k==='ruby'||k==='diamond'){
      this.addPoints(k==='ruby'?10000:k==='diamond'?15000:125);this.prizeBar+=20;if(this.prizeBar>=100){this.prizeBar-=100;this.multiplier=Math.min(9,this.multiplier+1);}return;
    }
    if(this.data.weapons[k]){this.weapon=k;this.weaponRemaining=10*(this.fate==='fortune'?2:1);this.weaponDuration=this.weaponRemaining;this.weaponUntil=this.time+this.weaponRemaining;return;}
    if(k==='bomb')p.bombs=Math.min(9,p.bombs+1);else if(k==='booster')p.boosters=Math.min(9,p.boosters+1);else if(k==='life')p.lives=Math.min(9,p.lives+1);
    else {this.effects[k]=this.time+({speed:10,chicken:40,turret:30,tank:20,heli:20,monkey:10,barrel:20,tesla:40,teddy:20}[k]||20);if(k==='turret'||k==='monkey')this.effects[k+'Position']=d.position.slice();}
  }
  loseLife(){
    if(this.mods.god||this.time<this.invulnerableUntil||this.time<this.deathUntil||this.effects.tank>this.time||this.effects.heli>this.time)return;
    this.player.lives--;this.multiplier=1;this.prizeBar=0;this.weapon=this.fate==='fire'?'minigun_zt':'m60_zt';this.weaponUntil=0;this.weaponRemaining=0;this.effects={};
    this.emit('sound','zmb_player_death');this.emit('playerDeath');
    if(this.player.lives<=0){this.player.health=0;this.phase='dead';this.emit('death',{round:this.round,kills:this.player.kills,points:this.player.points});return;}
    this.deathUntil=this.time+1.5;this.invulnerableUntil=this.time+5.5;
  }
  openExits(){
    this.phase='exit';this.exitReadyAt=this.time+1.5;const sides=this.grid.exitSides||this.arena.exits.map(e=>e.side);this.exitOpen=this.arena.exits.filter(e=>sides.includes(e.side));this.emit('sound','zmb_exit_open');this.emit('message','ROUND COMPLETE — FOLLOW A GOLD EXIT ARROW');
  }
  takeExit(){
    if(this.phase!=='exit'||this.time<this.exitReadyAt)return false;
    this.round++;if((this.round-1)%4===0)this.enterArena(this.arenaIndex+1);
    else {this.enemies=[];this.shots=[];this.drops=[];this.player.position=this.ground(this.arena.spawn);this.player.previousPosition=this.player.position.slice();this.invulnerableUntil=this.time+2;}
    this.emit('sound','zmb_exit_taken');
    if(this.round===13&&!this.fate){this.phase='fate';this.emit('fate');return true;}
    this.startRound();return true;
  }
  chooseFate(fate){
    if(this.phase!=='fate'||!['fire','feet','fortune','friendship'].includes(fate))return false;
    this.fate=fate;if(fate==='fire'){this.weapon='minigun_zt';this.weaponUntil=Infinity;}if(fate==='feet')this.player.boosters=Math.max(3,this.player.boosters);
    this.startRound();return true;
  }
  setRound(round){const n=clamp(Math.floor(Number(round)||1),1,100);this.round=n;this.enterArena(Math.floor((n-1)/4)%10);this.emit('reset');this.startRound();}
  tick(dt,input){
    this.time+=dt;const p=this.player;p.previousPosition=p.position.slice();
    if(this.time>=this.deathUntil){
      let dx=Number(input.x)||0,dy=Number(input.y)||0;const magnitude=Math.hypot(dx,dy);if(magnitude>1){dx/=magnitude;dy/=magnitude;}
      if(magnitude>.05)this.moveAngle=Math.atan2(dy,dx);this.isMoving=magnitude>.05;
      let speed=this.effects.speed>this.time||this.fate==='feet'?285:190;
      if(this.time<this.boostUntil){speed=1800;dx=Math.cos(this.boostAngle);dy=Math.sin(this.boostAngle);}
      p.position=this.move(p.position,dx*speed*dt,dy*speed*dt);if(p.position[2]<this.arena.center[2]-350){this.loseLife();p.position=this.ground(this.arena.spawn);}
      if(Number.isFinite(input.angle))p.angle=input.angle;if(input.fire)this.fire();
    }
    if(this.mods.resources){p.bombs=9;p.boosters=9;}
    if(this.mods.points)p.points=99999999;
    if(this.weaponRemaining>0&&!this.mods.permanentWeapon){this.weaponRemaining=Math.max(0,this.weaponRemaining-dt*(input.fire?1:.2));this.weaponUntil=this.time+this.weaponRemaining;
      if(!this.weaponRemaining){this.weapon=this.fate==='fire'?'minigun_zt':'m60_zt';this.weaponUntil=0;}}
    for(const d of this.drops)if(!d.used&&dist(p.position,d.position)<42&&Math.abs(p.position[2]-d.position[2])<80)this.pickup(d);
    this.drops=this.drops.filter(d=>!d.used&&d.expires>this.time);
    if(this.phase==='exit'){
      for(const e of this.exitOpen)if(p.position[0]>=e.mins[0]-25&&p.position[0]<=e.maxs[0]+25&&p.position[1]>=e.mins[1]-25&&p.position[1]<=e.maxs[1]+25){this.takeExit();break;}
      return;
    }
    if(this.phase!=='round')return;
    if(this.time>=this.flowDue){this.flowDue=this.time+.3;this.buildFlow();}
    while(this.spawnQueue[0]?.due<=this.time&&this.enemies.filter(e=>!e.dead).length<32)this.spawn(this.spawnQueue.shift());
    for(const e of this.enemies){if(e.dead)continue;e.previousPosition=e.position.slice();let target=p.position;
      if(this.effects.monkey>this.time)target=this.effects.monkeyPosition;
      const eye=[e.position[0],e.position[1],e.position[2]+30],goal=[target[0],target[1],target[2]+30];
      if(this.collision.actor(()=>this.collision.trace(eye,goal,[8,8,12])).fraction<.98){
        const n=this.nearest(e.position),node=this.grid.nodes[n];if(node){let best=n;for(const link of node.links)if(this.flow?.[link]>=0&&(this.flow[best]<0||this.flow[link]<this.flow[best]))best=link;target=this.grid.nodes[best].p;}
      }
      const dx=target[0]-e.position[0],dy=target[1]-e.position[1],length=Math.hypot(dx,dy);if(length>2){e.angle=Math.atan2(dy,dx);e.position=this.move(e.position,dx/length*e.speed*dt,dy/length*e.speed*dt,true);}
      if(dist(e.position,e.previousPosition)<.05)e.stalled+=dt;else e.stalled=0;
      if(e.stalled>3){const n=this.nearest(e.position);if(n>=0)e.position=this.grid.nodes[n].p.slice();e.stalled=0;}
      if(dist(e.position,p.position)<(e.kind==='ape'?55:30)&&Math.abs(e.position[2]-p.position[2])<65){if(this.time<this.boostUntil)this.damage(e,e.health);else this.loseLife();}
      const shield=['barrel','tesla','teddy'].some(k=>this.effects[k]>this.time);
      if(shield&&dist(e.position,p.position)<95)this.damage(e,this.effects.tesla>this.time?10000*dt:e.health);
    }
    for(const s of this.shots){if(s.done)continue;s.previousPosition=s.position.slice();const step=Math.min(s.speed*dt,s.range-s.traveled),end=[s.position[0]+Math.cos(s.angle)*step,s.position[1]+Math.sin(s.angle)*step,s.position[2]],wall=this.collision.trace(s.position,end,[0,0,0],1);
      let stop=wall.fraction;const hits=[];
      for(const e of this.enemies){if(e.dead||s.hits.includes(e.id)||Math.abs(e.position[2]+32-s.position[2])>80)continue;
        const dx=e.position[0]-s.position[0],dy=e.position[1]-s.position[1],along=dx*Math.cos(s.angle)+dy*Math.sin(s.angle),cross=Math.abs(dx*Math.sin(s.angle)-dy*Math.cos(s.angle));
        if(along>=-20&&along<=step&&cross<22+s.radius)hits.push({e,t:clamp(along/step,0,1)});
      }
      hits.sort((a,b)=>a.t-b.t);for(const {e,t} of hits){if(t>stop)break;this.damage(e,s.damage);s.hits.push(e.id);if(!s.pierce){stop=t;s.done=true;break;}if(s.weapon!=='ray_gun_zt'&&s.weapon!=='m2_flamethrower_zt'){s.damage*=.55;if(s.hits.length>=3){stop=t;s.done=true;break;}}}
      s.position=s.position.map((v,k)=>v+(end[k]-v)*stop);s.traveled+=step*stop;if(wall.fraction<1||s.traveled>=s.range)s.done=true;
      if(s.done&&this.data.weapons[s.weapon].explosionRadius>0){const d=this.data.weapons[s.weapon];for(const e of this.enemies)if(!e.dead&&dist(e.position,s.position)<d.explosionRadius)this.damage(e,d.explosionInnerDamage||d.damage);this.emit('blast',{position:s.position.slice(),radius:d.explosionRadius});}
    }
    const turret=this.effects.turret>this.time,vehicle=this.effects.tank>this.time||this.effects.heli>this.time;
    if((turret||vehicle)&&this.time>=(this.supportDue||0)){this.supportDue=this.time+.12;const origin=turret?this.effects.turretPosition:p.position,enemy=this.enemies.find(e=>!e.dead&&dist(e.position,origin)<600);if(enemy){this.damage(enemy,vehicle?1800:500);this.emit('supportShot',{origin,position:enemy.position});}}
    this.shots=this.shots.filter(s=>!s.done);this.enemies=this.enemies.filter(e=>!e.dead||this.time-e.died<2);
    if(!this.spawnQueue.length&&this.enemies.every(e=>e.dead))this.openExits();
  }
  update(dt,input={}){if(!['round','exit'].includes(this.phase))return;this.accumulator+=clamp(dt,0,.25);while(this.accumulator>=DOA_STEP){this.tick(DOA_STEP,input);this.accumulator-=DOA_STEP;if(!['round','exit'].includes(this.phase))break;}}
  renderPosition(actor){const a=clamp(this.accumulator/DOA_STEP,0,1),p=actor.previousPosition||actor.position;return actor.position.map((v,k)=>p[k]+(v-p[k])*a);}
  saveState(){return {version:2,engine:this.engine,player:clone(this.player),inventory:[{name:this.weapon}],...clone({seed:this.seed,time:this.time,round:this.round,arenaIndex:this.arenaIndex,phase:this.phase,nextId:this.nextId,weapon:this.weapon,weaponUntil:Number.isFinite(this.weaponUntil)?this.weaponUntil:null,weaponRemaining:this.weaponRemaining,weaponDuration:this.weaponDuration,effects:this.effects,enemies:this.enemies,shots:this.shots,drops:this.drops,spawnQueue:this.spawnQueue,exitOpen:this.exitOpen,nextLife:this.nextLife,multiplier:this.multiplier,prizeBar:this.prizeBar,boostUntil:this.boostUntil,boostAngle:this.boostAngle,invulnerableUntil:this.invulnerableUntil,fireDue:this.fireDue,deathUntil:this.deathUntil,exitReadyAt:this.exitReadyAt,fate:this.fate})};}
  loadState(s){if(s.engine!==this.engine||!Number.isInteger(s.arenaIndex)||!this.data.arenas[s.arenaIndex]||!['round','exit','fate'].includes(s.phase))throw new Error('This is not a resumable Dead Ops save.');this.newGame();Object.assign(this,clone(s));if(this.fate==='fire'&&this.weaponUntil===null)this.weaponUntil=Infinity;this.accumulator=0;this.flowDue=0;this.player.previousPosition=this.player.position.slice();this.emit('arena',this.arena);this.emit('reset');}
}
