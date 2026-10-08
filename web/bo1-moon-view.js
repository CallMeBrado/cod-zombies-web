import * as THREE from 'three';
import {model,cloneModel,shadeModel} from './assets.js';
import {assetResponse} from './preload.js';
import {PosedTrace} from './posed-trace.js';
const vec=s=>String(s||'0 0 0').split(/\s+/).map(Number),rad=THREE.MathUtils.degToRad;

export class MoonView {
  constructor(scene,map,dynamic){this.scene=scene;this.map=map;this.dynamic=dynamic;this.blends=new Map();this.poseTick=0;scene.fog=new THREE.Fog(0x171c21,5000,14000);}
  async prepare(m,p){
    this.manifest=m;const find=name=>m.entities.find(e=>e.targetname===name),targets=new Set(['teleporter_gate','teleporter_gate_top','bunker_gate','bunker_gate_2',...m.map.airlocks.flatMap(a=>a.targets)]);
    this.movers=[...targets].flatMap(t=>this.dynamic.get(t)||[]);
    this.diggers=m.map.diggers.map(d=>({def:d,items:d.models.map(e=>({role:e.model,item:(this.dynamic.get(e.targetname)||[]).find(i=>i.entity.origin===e.origin)})).filter(v=>v.item)}));
    for(const d of this.diggers)for(const {item}of d.items)this.movers.push(item);
    this.chests=m.entities.filter(e=>e.targetname==='treasure_chest_use').map(t=>{const lid=find(t.target),origin=find(lid.target),base=find(origin.target);return {target:t.target,items:[...(this.dynamic.get(t.target)||[]),...(this.dynamic.get(base.targetname)||[])],at:vec(origin.origin),yaw:vec(origin.angles)[1]};});
    this.pesModels=m.map.equipment.filter(e=>e.zombie_equipment_upgrade==='equip_gasmask_zm').flatMap(e=>this.dynamic.get(e.target)||[]);
    this.hackerModels=m.map.equipment.filter(e=>e.zombie_equipment_upgrade==='equip_hacker_zm').flatMap(e=>this.dynamic.get(e.target)||[]);
    this.earthPerks=m.entities.filter(e=>e.targetname==='zombie_vending'&&vec(e.origin)[0]>10000).map(e=>({id:e.script_noteworthy,items:this.dynamic.get(e.target)||[]}));
    this.movers=[...new Set(this.movers)];
    for(const item of [...this.movers,...this.chests.flatMap(c=>c.items)]){item.restPosition=item.object.position.clone();item.restRotation=item.object.rotation.clone();}
    const moving=new Set(this.movers.map(i=>i.object));this.map.bullets.entries=this.map.bullets.entries.filter(e=>{for(let n=e.owner;n;n=n.parent)if(moving.has(n))return false;return true;});
    this.traces=[...moving].map(root=>({root,trace:new PosedTrace(root,{visibleOnly:true})}));this.ray=new THREE.Ray();const world=this.map.bullets.trace.bind(this.map.bullets);
    this.map.bullets.trace=(origin,dir,range)=>{let hit=world(origin,dir,range),limit=hit?.distance??range;if(![...origin,...dir,range].every(Number.isFinite))return hit;this.ray.origin.fromArray(origin);this.ray.direction.fromArray(dir);
      for(const i of this.traces){i.root.updateWorldMatrix(true,true);const h=i.trace.trace(this.ray,limit,this.poseTick);if(h&&h.distance<limit){limit=h.distance;hit={...h,point:origin.map((v,k)=>v+dir[k]*limit),normal:[0,0,0]};}}return hit;};
    this.teddy=cloneModel(await model(p.box.teddyModel));this.teddy.visible=false;shadeModel(this.teddy,[.5,.5,.5]);this.scene.add(this.teddy);
    const response=await assetResponse('/data/gameplay/bo1-moon/hud/zom_generic_overlay_hazmat_1.png');
    this.overlay=document.createElement('img');this.overlay.src=URL.createObjectURL(await response.blob());this.overlay.alt='';this.overlay.setAttribute('aria-hidden','true');
    Object.assign(this.overlay.style,{position:'fixed',inset:'0',width:'100%',height:'100%',objectFit:'fill',pointerEvents:'none',zIndex:'2',display:'none'});document.getElementById('viewport').after(this.overlay);
  }
  reset(){this.blends.clear();this.overlay.style.display='none';this.teddy.visible=false;}
  update(g,cells){const r=g.mapRules,t=g.time;this.poseTick++;
    if(!this.unculled){this.unculled=true;for(const item of [...this.movers,...this.chests.flatMap(c=>c.items),...this.hackerModels,...this.pesModels,...this.earthPerks.flatMap(p=>p.items)]){const holder=item.object.parent,i=cells.findIndex(c=>c.holder===holder);if(i>=0){cells.splice(i,1);holder.visible=true;}}}
    const dt=Math.max(0,Math.min(.1,t-(this.at??t)));this.at=t;
    for(const lock of g.data.map.airlocks){const target=lock.targets[0],goal=r.airlocks[target]?1:0,old=this.blends.get(target)??0,a=goal>old?Math.min(goal,old+dt/.25):Math.max(goal,old-dt/.25);this.blends.set(target,a);
      for(const item of this.dynamic.get(target)||[]){item.object.visible=true;const delta=vec(item.entity.script_vector);item.object.position.copy(item.restPosition);item.object.position.addScaledVector(new THREE.Vector3(...delta),a);}}
    for(const [target,ready,delta]of [['bunker_gate',r.earthGateReady,-195],['bunker_gate_2',r.earthGateReady,-96],['teleporter_gate',r.moonGateReady,-140],['teleporter_gate_top',r.moonGateReady,140]]){
      const open=t>=ready;for(const item of this.dynamic.get(target)||[]){item.object.visible=true;item.object.position.copy(item.restPosition);item.object.position.z+=(target.startsWith('bunker')?(open?0:delta):(open?delta:0));}}
    for(const {def:d,items}of this.diggers){const s=r.diggers[d.name],a=s?Math.max(0,Math.min(1,(t-s.started)/d.duration)):0,progress=s?.stopped?Math.min(1,Math.max(0,(s.stoppedAt-s.started)/d.duration))*Math.max(0,1-(t-s.stoppedAt)/11):a;
      const points=d.path,start=points[0],end=points.at(-1),offset=start.map((v,k)=>(end[k]-v)*progress);
      for(const {role,item}of items){item.object.visible=true;item.object.position.copy(item.restPosition);item.object.position.add(new THREE.Vector3(...offset));item.object.rotation.copy(item.restRotation);
        if(item.entity.targetname===d.arm)item.object.rotation.y+=rad(d.downAngle)*Math.max(0,(a-.95)/.05);
        if(item.entity.targetname===d.blade&&s&&!s.stopped)item.object.rotation.y+=rad((t-s.started)*80);}}
    for(const item of this.hackerModels)item.object.visible=item.entity.targetname===r.hackerTarget;
    for(const item of this.pesModels)item.object.visible=r.equipment!=='pes'||Math.hypot(item.object.position.x-g.player.position[0],item.object.position.y-g.player.position[1])>100;
    for(const p of this.earthPerks)for(const item of p.items)item.object.visible=p.id===r.earthPerk;
    let bear=null;for(const c of this.chests){const b=g.boxes.get(c.target),shown=g.activeBox===c.target||['cycling','offered','teddy','closing'].includes(b.phase);for(const i of c.items)i.object.visible=shown;if(b.phase==='teddy')bear=c;}
    this.teddy.visible=!!bear;if(bear){this.teddy.position.set(...bear.at);this.teddy.position.z+=40+Math.min(500,(t-g.boxes.get(bear.target).offeredAt)*40);this.teddy.rotation.z=rad(bear.yaw+90);}
    this.overlay.style.display=r.pes&&g.phase!=='ready'&&g.phase!=='dead'?'block':'none';
    this.scene.fog.color.setHex(r.earth?0x61583c:0x171c21);this.scene.fog.near=r.earth?7000:5000;this.scene.fog.far=r.earth?20000:14000;
  }
}
