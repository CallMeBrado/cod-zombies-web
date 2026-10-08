import * as THREE from 'three';
import {model,cloneModel,shadeModel} from './assets.js';
import {VerrucktView} from './waw-verruckt-view.js';
import {PosedTrace} from './posed-trace.js';
import {floggerRotation} from './waw-shi-no-numa.js';

const rad=THREE.MathUtils.degToRad;
const PERK_MODELS={specialty_armorvest:'zombie_vending_jugg_on_price',specialty_fastreload:'zombie_vending_sleight_on_price',specialty_rof:'zombie_vending_doubletap_price',specialty_quickrevive:'zombie_vending_revive_on_price'};

export class ShiNoNumaView extends VerrucktView {
  constructor(scene,map,dynamic,manifest){
    super(scene,dynamic,manifest.entities,p=>map.illumination(p));this.map=map;this.manifest=manifest;
    // Keep the fog shader type stable through loading and dog rounds.
    scene.fog=new THREE.Fog(new THREE.Color(.58,.6,.56),729.34,2673.32);
    this.perks=[];this.projectiles=new Map();this.flashes=[];
    this.movers=['zipline','zip_handle','zip_temp_clip','pen_lever','pf4866_auto2',...manifest.map.flogger.targets].flatMap(name=>dynamic.get(name)||[]);
    for(const item of this.movers){item.restPosition=item.object.position.clone();item.restRotation=item.object.rotation.clone();}
    // Native bullet BVHs keep their initial transform. The cage/logs move,
    // so omit their old proxies instead of leaving an invisible shot blocker.
    const moving=new Set(this.movers.map(item=>item.object));map.bullets.entries=map.bullets.entries.filter(entry=>{for(let n=entry.owner;n;n=n.parent)if(moving.has(n))return false;return true;});
    this.moveTraces=[...moving].map(root=>({root,trace:new PosedTrace(root,{visibleOnly:true})}));this.poseTick=0;this.movingRay=new THREE.Ray();
    const worldTrace=map.bullets.trace.bind(map.bullets);
    map.bullets.trace=(origin,dir,range)=>{let result=worldTrace(origin,dir,range),limit=result?.distance??range;
      if(![...origin,...dir,range].every(Number.isFinite))return result;
      this.movingRay.origin.fromArray(origin);this.movingRay.direction.fromArray(dir);
      for(const item of this.moveTraces){item.root.updateWorldMatrix(true,true);const hit=item.trace.trace(this.movingRay,limit,this.poseTick);if(hit&&hit.distance<limit){limit=hit.distance;result={...hit,point:origin.map((v,k)=>v+dir[k]*limit),normal:[0,0,0]};}}return result;};
    this.boltGeometry=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3(0,0,-8)]);
    this.boltMaterials={ray_gun:new THREE.LineBasicMaterial({color:0x76ff54,transparent:true,opacity:.95,depthWrite:false,blending:THREE.AdditiveBlending}),tesla_gun:new THREE.LineBasicMaterial({color:0x8abaff,transparent:true,opacity:1,depthWrite:false,blending:THREE.AdditiveBlending})};
  }
  async prepare(){
    for(const [id,name]of Object.entries(PERK_MODELS)){
      const template=await model(name);
      for(const slot of this.manifest.map.perkSlots){const object=cloneModel(template);shadeModel(object,[1,1,1]);const root=new THREE.Group();root.add(object);root.visible=false;this.scene.add(root);this.perks.push({id,slot:slot.index,root,object});}
    }
    for(const e of this.manifest.entities.filter(e=>e.targetname==='zombie_vending'))for(const item of this.dynamic.get(e.target)||[])item.object.visible=false;
    // Prepare reusable flashes now; explosions allocate no new geometry.
    const geometry=new THREE.SphereGeometry(1,8,6);
    for(let i=0;i<12;i++){const material=new THREE.MeshBasicMaterial({color:0x9eff75,transparent:true,opacity:0,depthWrite:false,blending:THREE.AdditiveBlending}),mesh=new THREE.Mesh(geometry,material);mesh.visible=false;this.scene.add(mesh);this.flashes.push({mesh,until:0});}
  }
  reset(){for(const p of this.projectiles.values())this.scene.remove(p);this.projectiles.clear();for(const f of this.flashes)f.mesh.visible=false;}
  projectile(p){const root=new THREE.Line(this.boltGeometry,this.boltMaterials[p.weapon]);root.position.fromArray(p.position);const target=p.position.map((v,k)=>v+p.dir[k]);root.lookAt(new THREE.Vector3(...target));this.projectiles.set(p.id,root);this.scene.add(root);}
  removeProjectile(id){const root=this.projectiles.get(id);if(root)this.scene.remove(root);this.projectiles.delete(id);}
  impact({position,tesla,time}){const flash=this.flashes.find(f=>!f.mesh.visible)||this.flashes[0];flash.start=time;flash.until=time+.25;flash.mesh.position.fromArray(position);flash.mesh.material.color.set(tesla?0x78adff:0x9eff75);flash.mesh.visible=true;}
  update(game,cellObjects){
    super.update(game,cellObjects);const r=game.mapRules,t=game.time;
    this.poseTick++;
    if(!this.shiUnculled){this.shiUnculled=true;for(const item of this.movers){const holder=item.object.parent,i=cellObjects.findIndex(c=>c.holder===holder);if(i>=0){cellObjects.splice(i,1);holder.visible=true;}}}
    for(const e of this.manifest.entities.filter(e=>e.targetname==='zombie_vending'))for(const item of this.dynamic.get(e.target)||[])item.object.visible=false;
    // The native lottery cycles the remaining machine models every .15 s
    // for 4.5 s, rising 40 units, then settles over .3 s.
    for(const v of this.perks)v.root.visible=false;
    for(const slot of this.manifest.map.perkSlots){const start=r.reveals[slot.index];if(start==null)continue;
      const elapsed=t-start,chosen=Object.keys(r.placements).find(id=>r.placements[id]===slot.index);
      const variants=this.perks.filter(v=>v.slot===slot.index);
      const shown=elapsed<4.5?variants[Math.floor(Math.max(0,elapsed)/.15)%variants.length]:variants.find(v=>v.id===chosen);if(!shown)continue;
      shown.root.visible=true;shown.root.position.fromArray(slot.position);shown.root.position.z+=elapsed<4.5?40*Math.min(1,elapsed/3):40*Math.max(0,1-(elapsed-4.5)/.3);
      shown.root.rotation.set(rad(slot.angles[2]),-rad(slot.angles[0]),rad(slot.angles[1]),'ZYX');
      const color=this.map.illumination(slot.position);shown.object.traverse(n=>{if(n.isMesh)for(const m of Array.isArray(n.material)?n.material:[n.material])if(!m.userData.fixedLight)m.color.setRGB(...color);});
    }
    const flogger=r.flogger;
    // rotatepitch(14040,30,6,6): 39 full turns, six-second acceleration/deceleration.
    for(const target of this.manifest.map.flogger.targets)for(const item of this.dynamic.get(target)||[]){item.object.visible=true;item.object.rotation.copy(item.restRotation);if(flogger)item.object.rotation.y+=floggerRotation(t,flogger.live,flogger.direction);}
    const lever=flogger?Math.min(1,Math.max(0,(t-(flogger.live-1))/.5))*Math.min(1,Math.max(0,(flogger.until+.5-t)/.5)):0;
    for(const target of ['pen_lever','pf4866_auto2'])for(const item of this.dynamic.get(target)||[]){item.object.rotation.copy(item.restRotation);item.object.rotation.y-=Math.PI*lever;}
    const z=r.zipPosition(),delta=z.map((v,k)=>v-this.manifest.map.zipline.origin[k]);
    for(const target of ['zipline','zip_handle','zip_temp_clip'])for(const item of this.dynamic.get(target)||[]){item.object.visible=true;item.object.position.set(item.restPosition.x+delta[0],item.restPosition.y+delta[1],item.restPosition.z+delta[2]);}
    for(const p of game.projectiles||[]){const root=this.projectiles.get(p.id);if(root)root.position.fromArray(p.position);}
    for(const f of this.flashes)if(f.mesh.visible){if(t>=f.until)f.mesh.visible=false;else{const a=(t-f.start)/.25;f.mesh.scale.setScalar(3+a*35);f.mesh.material.opacity=(1-a)*.5;}}
    if(this.lastDogRound!==r.dogRound){this.lastDogRound=r.dogRound;this.scene.fog.color.setRGB(...(r.dogRound?[.38,.4,.4]:[.58,.6,.56]));this.scene.fog.near=r.dogRound?300:729.34;this.scene.fog.far=r.dogRound?1300:2673.32;}
  }
}
