import {iwHealth,iwRoundCount,iwSpawnDelay} from './iw7-native.js';
import {raySphere,rayCapsule,damageAtRange} from './ballistics.js';

export class SpacelandMatch {
  constructor(data,{spawn,kill,hit,attack,round,score,gameOver,action,shot,wallTrace}={}){this.data=data;this.events={spawn,kill,hit,attack,round,score,gameOver,action,shot,wallTrace};this.reset();}
  reset(){this.round=0;this.points=500;this.health=100;this.maxHealth=100;this.kills=0;this.headshots=0;this.enemies=[];this.spawned=0;this.killed=0;this.phase='intro';this.timer=0;this.time=0;this.cooldown=0;this.lastDamage=-99;this.reload=null;this.melee=null;this.inventory=[{definition:this.data.weapon,clip:this.data.weapon.clip,reserve:Math.max(0,this.data.weapon.startAmmo-this.data.weapon.clip)}];this.slot=0;this.over=false;this.sequence=0;}
  get weapon(){return this.inventory[this.slot];}
  begin(){if(this.phase==='intro'){this.phase='intermission';this.timer=2;}}
  nextRound(){this.round++;this.total=iwRoundCount(this.round);this.spawned=this.killed=0;this.spawnClock=0;this.phase='active';this.events.round?.(this.round,'start');}
  addPoints(amount){this.points=Math.max(0,this.points+amount);this.events.score?.(amount);}
  reloadWeapon(){if(this.over||this.phase==='intro'||this.reload||this.melee||this.weapon.clip===this.weapon.definition.clip||!this.weapon.reserve)return false;const empty=!this.weapon.clip,d=this.weapon.definition,duration=empty?d.reloadEmptySeconds:d.reloadSeconds;this.reload={elapsed:0,duration,addAt:Math.min(duration,empty?(d.reloadEmptyAddSeconds??d.reloadAddSeconds):d.reloadAddSeconds),added:false};this.events.action?.('reload',empty);return true;}
  fire(origin,dir,ads=false){
    if(this.over||this.phase==='intro'||this.reload||this.melee||this.cooldown>0)return false;
    if(!this.weapon.clip){this.reloadWeapon();return false;}
    const definition=this.weapon.definition;this.weapon.clip--;this.cooldown=definition.fireSeconds;
    this.events.action?.('fire',ads);const wall=this.events.wallTrace?.(origin,dir,16000),range=wall?.distance??16000;
    const hits=[];
    for(const zombie of this.enemies){if(zombie.dead||zombie.headPosition&&zombie.headPosition[2]<zombie.position[2]+8)continue;const p=zombie.position,head=raySphere(origin,dir,zombie.headPosition||[p[0],p[1],p[2]+64],9,range),body=rayCapsule(origin,dir,[p[0],p[1],p[2]+17],zombie.torsoPosition||[p[0],p[1],p[2]+50],15,range);if(head!==null||body!==null)hits.push({zombie,head:head!==null&&(body===null||head<=body),distance:Math.min(head??Infinity,body??Infinity)});}
    hits.sort((a,b)=>a.distance-b.distance);
    for(let i=0;i<Math.min(4,hits.length);i++){const h=hits[i],amount=Math.max(1,Math.floor(damageAtRange(definition,h.distance)*(h.head?definition.headMultiplier:1)*.85**i));this.damage(h.zombie,amount,h.head,'bullet');}
    this.events.shot?.(hits,origin,dir,Math.min(hits[0]?.distance??range,2000));
    // Reload after the final shot's native action has finished, never swallow it.
    if(!this.weapon.clip&&this.weapon.reserve)this.autoReload=true;
    return true;
  }
  knife(origin,dir){
    if(this.over||this.phase==='intro'||this.reload||this.melee)return false;this.melee={elapsed:0,hit:false,origin:[...origin],dir:[...dir]};this.events.action?.('knife');return true;
  }
  damage(zombie,amount,head=false,method='bullet'){
    if(zombie.dead)return;zombie.health-=amount;this.events.hit?.(zombie,head,method);
    if(zombie.health<=0){zombie.dead=true;this.killed++;this.kills++;if(head)this.headshots++;this.addPoints(method==='knife'?130:head?100:60);this.events.kill?.(zombie,head);}
    else if(method==='bullet')this.addPoints(10);
  }
  hurt(amount){if(this.over)return;this.health=Math.max(0,this.health-amount);this.lastDamage=this.time;this.events.attack?.();if(!this.health){this.over=true;this.phase='over';this.events.gameOver?.();}}
  buyM1(){if(this.over||this.reload||this.melee||this.phase==='intro')return false;const found=this.inventory.findIndex(w=>w.definition.native===this.data.rifle.native),price=found<0?500:250;if(this.points<price)return false;this.addPoints(-price);if(found<0){const d=this.data.rifle;this.inventory.push({definition:d,clip:d.clip,reserve:Math.max(0,d.startAmmo-d.clip)});this.slot=this.inventory.length-1;}else{this.slot=found;this.weapon.reserve=this.weapon.definition.maxAmmo;}this.autoReload=false;this.events.action?.('equip');return true;}
  switchWeapon(){if(this.reload||this.melee||this.phase==='intro'||this.over||this.inventory.length<2)return;this.slot=(this.slot+1)%this.inventory.length;this.autoReload=false;this.events.action?.('equip');}
  step(dt,{canSpawn=true}={}){
    if(this.over)return;this.time+=dt;this.cooldown=Math.max(0,this.cooldown-dt);
    if(this.time-this.lastDamage>5)this.health=Math.min(this.maxHealth,this.health+dt*30);
    if(this.reload){const r=this.reload;r.elapsed+=dt;if(!r.added&&r.elapsed>=r.addAt){const n=Math.min(this.weapon.definition.clip-this.weapon.clip,this.weapon.reserve);this.weapon.clip+=n;this.weapon.reserve-=n;r.added=true;}if(r.elapsed>=r.duration)this.reload=null;}
    if(this.melee){const m=this.melee;m.elapsed+=dt;if(!m.hit&&m.elapsed>=.22){m.hit=true;const targets=this.enemies.filter(z=>!z.dead&&!z.entering).map(z=>({z,d:rayCapsule(m.origin,m.dir,[z.position[0],z.position[1],z.position[2]+16],[z.position[0],z.position[1],z.position[2]+60],25,105)})).filter(v=>v.d!==null).sort((a,b)=>a.d-b.d);const wall=this.events.wallTrace?.(m.origin,m.dir,105);if(targets[0]&&targets[0].d<(wall?.distance??105))this.damage(targets[0].z,150,false,'knife');}if(m.elapsed>=.8)this.melee=null;}
    if(this.autoReload&&!this.reload&&!this.melee&&this.cooldown===0){this.autoReload=false;this.reloadWeapon();}
    if(this.phase==='intermission'){this.timer-=dt;if(this.timer<=0)this.nextRound();}
    if(this.phase==='active'){
      this.spawnClock-=dt;
      if(canSpawn&&this.spawnClock<=0&&this.spawned<this.total&&this.enemies.filter(z=>!z.dead).length<24){const enemy=this.events.spawn?.({id:++this.sequence,health:iwHealth(this.round),round:this.round});if(enemy){this.enemies.push(enemy);this.spawned++;this.spawnClock=iwSpawnDelay(this.round);}}
      if(this.killed===this.total&&this.spawned===this.total){this.phase='intermission';this.timer=10;this.events.round?.(this.round,'end');}
    }
  }
}
