import * as THREE from 'three';
import {clone} from 'three/addons/utils/SkeletonUtils.js';

// Keep GPU resources allocated across shots and restarts. Shotgun pellets reuse
// the oldest slot when the short-lived impact pool is full.
export class CombatEffects {
  constructor(scene,capacity=64){
    this.geometry=new THREE.SphereGeometry(1,6,5);
    this.impacts=Array.from({length:capacity},()=>{
      const mesh=new THREE.Mesh(this.geometry,new THREE.MeshBasicMaterial({transparent:true,depthWrite:false}));
      mesh.visible=false;scene.add(mesh);return {mesh,due:0,born:0,radius:1};
    });
    this.grenadeMaterial=new THREE.MeshBasicMaterial({color:0x75634b});
    this.grenades=Array.from({length:4},()=>{const mesh=new THREE.Mesh(this.geometry,this.grenadeMaterial);mesh.scale.setScalar(3);mesh.visible=false;scene.add(mesh);return {mesh,grenade:null};});
    this.next=0;
    this.scene=scene;this.explosions=[];this.nextExplosion=0;
  }
  prepareGrenades(template,effects){
    this.effects=effects;
    for(const slot of this.grenades){this.scene.remove(slot.mesh);slot.mesh=clone(template);slot.mesh.visible=false;this.scene.add(slot.mesh);}
    for(let i=0;i<4;i++)this.explosions.push(this.blast(['explosions/grenadeexp_concrete','explosions/fx_grenade_flash']));
    this.weaponBlasts=new Map();
    const geometries=new Set(),materials=new Set();for(const root of [...this.impacts.map(v=>v.mesh),...this.grenades.map(v=>v.mesh),...this.explosions.map(v=>v.root)])root.traverse(n=>{if(n.isMesh){geometries.add(n.geometry);for(const m of [n.material].flat())materials.add(m);}});this.resourceCounts={geometries:geometries.size,materials:materials.size};
  }
  // An effect's local X is its forward; explosions are played facing up.
  blast(names){const root=new THREE.Group();root.rotation.y=-Math.PI/2;for(const name of names)root.add(this.effects.create(name,0));root.visible=false;this.scene.add(root);return {root,due:0,born:0};}
  // A weapon's own impact effect (the Ray Gun's green burst), else the grenade.
  explosion(grenade,time,effect=null){
    if(!this.explosions.length)return;
    let pool=this.explosions;
    if(effect&&this.effects.has(effect)){if(!this.weaponBlasts.has(effect))this.weaponBlasts.set(effect,{slots:[this.blast([effect]),this.blast([effect])],next:0});pool=this.weaponBlasts.get(effect).slots;}
    const slot=pool===this.explosions?this.explosions[this.nextExplosion++%this.explosions.length]:pool[this.weaponBlasts.get(effect).next++%pool.length];slot.born=time;slot.root.position.fromArray(grenade.position);slot.root.position.z+=4;slot.root.visible=true;
    for(const root of slot.root.children)this.effects.restart(root,time);
    slot.due=Math.max(...slot.root.children.map(root=>this.effects.endTime(root)));
  }
  impact(ray,time){
    if(!ray.hit&&!ray.wall)return;
    const slot=this.impacts[this.next++%this.impacts.length];
    slot.born=time;slot.due=time+(ray.hit?.22:.12);slot.radius=ray.hit?2.7:1.1;
    slot.mesh.position.fromArray(ray.end);slot.mesh.scale.setScalar(slot.radius);slot.mesh.material.color.setHex(ray.hit?0x5d0807:0xaaaa90);slot.mesh.material.opacity=.7;slot.mesh.visible=true;
  }
  grenade(grenade){const slot=this.grenades.find(v=>v.grenade===grenade)||this.grenades.find(v=>!v.grenade);if(!slot)return;slot.grenade=grenade;slot.mesh.position.fromArray(grenade.position);slot.mesh.visible=true;}
  update(time,interpolation=1){
    for(const v of this.impacts){if(!v.mesh.visible)continue;if(time>=v.due){v.mesh.visible=false;continue;}const age=time-v.born;v.mesh.scale.setScalar(v.radius*Math.exp(age*7));v.mesh.material.opacity=.7*Math.exp(-age*9);}
    for(const v of this.grenades){if(!v.grenade)continue;if(v.grenade.exploded){v.grenade=null;v.mesh.visible=false;}else{const g=v.grenade,p=g.previousPosition||g.position;v.mesh.visible=!g.held;v.mesh.position.set(...g.position.map((x,i)=>p[i]+(x-p[i])*interpolation));const age=time-(g.spawned||0);v.mesh.rotation.set(age*7,age*4,age*3);}}
    for(const v of [...this.explosions,...[...(this.weaponBlasts?.values()||[])].flatMap(b=>b.slots)]){if(!v.root.visible)continue;if(time>=v.due){v.root.visible=false;continue;}for(const root of v.root.children)this.effects.update(root,time);}
  }
  reset(){for(const v of this.impacts)v.mesh.visible=false;for(const v of this.grenades){v.mesh.visible=false;v.grenade=null;}for(const v of [...this.explosions,...[...(this.weaponBlasts?.values()||[])].flatMap(b=>b.slots)])v.root.visible=false;this.next=0;this.nextExplosion=0;}
  diagnostics(){return {impactCapacity:this.impacts.length,activeImpacts:this.impacts.filter(v=>v.mesh.visible).length,activeGrenades:this.grenades.filter(v=>v.grenade).length,explosionCapacity:this.explosions.length,activeExplosions:this.explosions.filter(v=>v.root.visible).length,originalGrenade:!!this.effects,...(this.resourceCounts||{geometries:1,materials:this.impacts.length+1})};}
}
