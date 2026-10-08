import * as THREE from 'three';
import {model,cloneModel,shadeModel} from './assets.js';
import {PosedTrace} from './posed-trace.js';
import {sampleTempleRoute} from './bo1-shangri.js';
const vec=e=>String(e.origin||'0 0 0').split(/\s+/).map(Number),rad=THREE.MathUtils.degToRad;
const perkModels={specialty_armorvest:'zombie_vending_jugg',specialty_fastreload:'zombie_vending_sleight',specialty_rof:'zombie_vending_doubletap',specialty_longersprint:'zombie_vending_marathon',specialty_flakjacket:'zombie_vending_nuke',specialty_deadshot:'zombie_vending_ads'};

export class ShangriView {
  constructor(scene,map,dynamic,effects){Object.assign(this,{scene,map,dynamic,effects});this.perks=[];this.fires=new Map();this.poseTick=0;scene.fog=new THREE.Fog(0x8e9981,4000,18000);}
  async prepare(m,p){
    this.manifest=m;this.switches=m.map.switches.flatMap(s=>(this.dynamic.get(s.model)||[]).map(item=>({s,item})));
    this.stairs=m.map.papStairs.flatMap(e=>this.dynamic.get(e.targetname)||[]);this.cart=(this.dynamic.get(m.map.minecart.target)||[])[0];
    this.movers=[...this.switches.map(v=>v.item),...this.stairs,...(this.cart?[this.cart]:[])];
    this.hiddenPerks=m.map.perkSlots.flatMap(s=>this.dynamic.get(s.target)||[]);
    for(const item of [...this.movers,...this.hiddenPerks]){item.restPosition=item.object.position.clone();item.restRotation=item.object.rotation.clone();}
    for(const slot of m.map.perkSlots)for(const [id,name]of Object.entries(perkModels)){
      const object=cloneModel(await model(name)),onName=m.map.propModels.includes(name+'_on')?name+'_on':name,on=cloneModel(await model(onName));
      const root=new THREE.Group();root.position.fromArray(slot.position);root.rotation.z=rad(slot.angles[1]);object.rotation.z=rad(90);on.rotation.z=rad(90);root.add(object,on);shadeModel(root,this.map.illumination(slot.position));this.scene.add(root);this.perks.push({slot:slot.index,id,root,object,on});
    }
    const dynamicRoots=new Set([...this.movers,...this.hiddenPerks].map(i=>i.object));
    this.map.bullets.entries=this.map.bullets.entries.filter(e=>{for(let n=e.owner;n;n=n.parent)if(dynamicRoots.has(n))return false;return true;});
    this.traces=[...this.movers.map(i=>i.object),...this.perks.map(v=>v.root)].map(root=>({root,trace:new PosedTrace(root,{visibleOnly:true})}));
    this.ray=new THREE.Ray();const trace=this.map.bullets.trace.bind(this.map.bullets);
    this.map.bullets.trace=(origin,dir,range)=>{if(![...origin,...dir,range].every(Number.isFinite))return null;let hit=trace(origin,dir,range),limit=hit?.distance??range;this.ray.origin.fromArray(origin);this.ray.direction.fromArray(dir);
      for(const i of this.traces){if(!i.root.visible)continue;i.root.updateWorldMatrix(true,true);const h=i.trace.trace(this.ray,limit,this.poseTick);if(h&&h.distance<limit){limit=h.distance;hit={...h,point:origin.map((v,k)=>v+dir[k]*limit),normal:[0,0,0]};}}return hit;};
  }
  reset(){this.at=0;for(const v of this.fires.values()){this.effects.dispose(v);this.scene.remove(v);}this.fires.clear();document.getElementById('viewport').style.filter='';}
  update(g,cells){const r=g.mapRules,t=g.time;this.poseTick++;
    for(const [f,v]of this.fires)if(!r.fires.includes(f)){this.effects.dispose(v);this.scene.remove(v);this.fires.delete(f);}
    for(const f of r.fires){if(!this.fires.has(f)){const v=this.effects.create('temple/napalm_fire',t);v.position.fromArray(f.position);this.scene.add(v);this.fires.set(f,v);}this.effects.update(this.fires.get(f),t);}
    if(!this.unculled){this.unculled=true;for(const item of [...this.movers,...this.hiddenPerks]){const holder=item.object.parent,i=cells.findIndex(c=>c.holder===holder);if(i>=0){cells.splice(i,1);holder.visible=true;}}}
    for(const item of this.hiddenPerks)item.object.visible=false;
    for(const v of this.perks){v.root.visible=r.placements[v.slot]===v.id;v.object.visible=!r.power;v.on.visible=r.power;}
    for(const {s,item}of this.switches){const done=r.switches[s.flag.startsWith('left')?'left':'right'],a=done==null?0:Math.max(0,Math.min(1,(t-(done-.5))/.5));item.object.rotation.copy(item.restRotation);item.object.rotation.x-=rad(90)*a;}
    const open=r.papAvailable,blend=open?Math.min(1,(t-r.papOpened)/3):0;
    for(const item of this.stairs){item.object.position.copy(item.restPosition);const offset=vec({origin:item.entity.script_vector||'0 0 72'}),last=item.entity.targetname==='pap_stairs4';item.object.position.addScaledVector(new THREE.Vector3(...offset),last?blend:blend-1);}
    if(this.cart){let f=0;if(r.cart){const c=r.cart;f=t<c.returnAt?Math.min(1,(t-c.started)/c.duration):Math.max(0,1-(t-c.returnAt)/c.duration);}const s=sampleTempleRoute(g.data.map.minecart.path,f);this.cart.object.position.fromArray(s.position);this.cart.object.rotation.copy(this.cart.restRotation);this.cart.object.rotation.z=s.yaw+Math.PI/2;}
    document.getElementById('viewport').style.filter=t<r.sonicUntil?'blur(2px) brightness(1.35)':'';
  }
}
