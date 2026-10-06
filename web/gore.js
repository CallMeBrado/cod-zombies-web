import * as THREE from 'three';
import {originalTexture} from './assets.js';

const STEP=1/60,UP=new THREE.Vector3(0,0,1);
// A detached native head keeps its own frozen skeleton and moves independently
// of the body's ragdoll. Physical surfaces block it; player clips do not.
export class SeveredHead {
  constructor(root){
    this.root=root;this.p=new THREE.Vector3();this.previous=new THREE.Vector3();this.velocity=new THREE.Vector3();this.spin=new THREE.Vector3();this.q=new THREE.Quaternion();this.previousQ=new THREE.Quaternion();this.deltaQ=new THREE.Quaternion();this.euler=new THREE.Euler();this.normal=new THREE.Vector3();this.delta=new THREE.Vector3();this.target=new THREE.Vector3();this.startArray=[0,0,0];this.endArray=[0,0,0];this.half=[8,8,8];this.active=false;
  }
  start(position,direction,id=1){
    this.active=true;this.sleeping=false;this.elapsed=0;this.quiet=0;this.accumulator=0;this.p.fromArray(position);this.previous.copy(this.p);this.q.identity();this.previousQ.copy(this.q);
    this.velocity.set(direction?.[0]||0,direction?.[1]||0,0);if(this.velocity.lengthSq()<1e-8)this.velocity.set(1,0,0);this.velocity.normalize().multiplyScalar(90);this.velocity.z=105;
    this.spin.set(5*Math.sin(id*2.4),5*Math.cos(id*2.4),3);this.root.position.copy(this.p);this.root.quaternion.copy(this.q);this.root.visible=true;
  }
  update(dt,collision){
    if(!this.active||this.sleeping)return;
    if(Number.isFinite(dt)&&dt>0)this.accumulator+=Math.min(.1,dt);
    while(this.accumulator+1e-9>=STEP&&!this.sleeping){
      this.accumulator=Math.max(0,this.accumulator-STEP);this.previous.copy(this.p);this.previousQ.copy(this.q);this.velocity.z-=800*STEP;this.delta.copy(this.velocity).multiplyScalar(STEP);let contact=false;
      for(let attempt=0;attempt<3;attempt++){
        const target=this.target.copy(this.p).add(this.delta),hit=collision?.trace(this.p.toArray(this.startArray),target.toArray(this.endArray),this.half,1);
        if(!hit){this.p.copy(target);break;}
        if(hit.allSolid){this.velocity.set(0,0,0);contact=true;break;}
        this.p.fromArray(hit.end);if(hit.fraction===1)break;
        contact=true;this.normal.fromArray(hit.normal);this.p.addScaledVector(this.normal,.04);
        const speed=this.velocity.dot(this.normal);if(speed<0)this.velocity.addScaledVector(this.normal,-speed*1.18);
        this.velocity.multiplyScalar(hit.normal[2]>.65?.68:.9);this.spin.multiplyScalar(hit.normal[2]>.65?.7:.94);
        this.delta.copy(this.velocity).multiplyScalar(STEP*(1-hit.fraction));
      }
      this.deltaQ.setFromEuler(this.euler.set(this.spin.x*STEP,this.spin.y*STEP,this.spin.z*STEP));this.q.premultiply(this.deltaQ).normalize();this.elapsed+=STEP;
      this.quiet=contact&&this.velocity.lengthSq()<100?this.quiet+STEP:0;if(this.quiet>.3||this.elapsed>=4)this.sleeping=true;
    }
    const alpha=this.sleeping?1:this.accumulator/STEP;this.root.position.lerpVectors(this.previous,this.p,alpha);this.root.quaternion.slerpQuaternions(this.previousQ,this.q,alpha);
  }
  reset(){this.active=false;this.sleeping=false;this.root.visible=false;this.root.removeFromParent();}
}

const fragment=`uniform sampler2D sprite;varying vec2 vUv;varying float vOpacity;uniform vec3 tint;
void main(){vec4 pixel=texture2D(sprite,vUv);gl_FragColor=vec4(pixel.rgb*tint,pixel.a*vOpacity);
#include <colorspace_fragment>
}`;
const spriteVertex=`attribute vec3 center;attribute float size;attribute float angle;attribute float frame;attribute float opacity;
varying vec2 vUv;varying float vOpacity;
void main(){float c=cos(angle),s=sin(angle);vec4 eye=modelViewMatrix*vec4(center,1.);eye.xy+=mat2(c,-s,s,c)*position.xy*size;
gl_Position=projectionMatrix*eye;vUv=(vec2(mod(frame,4.),floor(frame/4.))+uv)/4.;vOpacity=opacity;}`;
const decalVertex=`attribute vec3 center;attribute vec3 axisU;attribute vec3 axisV;attribute float opacity;
varying vec2 vUv;varying float vOpacity;
void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(center+axisU*position.x+axisV*position.y,1.);vUv=uv;vOpacity=opacity;}`;

// Native blood atlases and surface textures, in five fixed GPU batches. Hitting
// many zombies/shotgun pellets never allocates another mesh or GPU resource.
export class BloodEffects {
  constructor(scene,{sprays=64,drops=128,decals=48}={}){
    this.scene=scene;this.plane=new THREE.PlaneGeometry(1,1);this.nextSpray=0;this.nextDrop=0;this.nextDecal=0;this.trace=null;
    this.p=new THREE.Vector3();this.d=new THREE.Vector3();this.normal=new THREE.Vector3();this.quaternion=new THREE.Quaternion();this.roll=new THREE.Quaternion();this.u=new THREE.Vector3();this.v=new THREE.Vector3();
    const batch=(count,decal=false)=>{
      const geometry=new THREE.InstancedBufferGeometry();geometry.index=this.plane.index;geometry.setAttribute('position',this.plane.attributes.position);geometry.setAttribute('uv',this.plane.attributes.uv);geometry.instanceCount=count;
      for(const [name,width]of decal?[['center',3],['axisU',3],['axisV',3],['opacity',1]]:[['center',3],['size',1],['angle',1],['frame',1],['opacity',1]])geometry.setAttribute(name,new THREE.InstancedBufferAttribute(new Float32Array(count*width),width).setUsage(THREE.DynamicDrawUsage));
      const material=new THREE.ShaderMaterial({uniforms:{sprite:{value:null},tint:{value:new THREE.Color(decal?0xffffff:0x81120f)}},vertexShader:decal?decalVertex:spriteVertex,fragmentShader:fragment,transparent:true,depthTest:true,depthWrite:false,blending:THREE.NormalBlending,polygonOffset:decal,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
      const mesh=new THREE.Mesh(geometry,material);mesh.frustumCulled=false;mesh.visible=false;mesh.renderOrder=decal?1:2;scene.add(mesh);
      return {mesh,slots:Array.from({length:count},()=>({born:-Infinity,due:-Infinity,position:new THREE.Vector3(),velocity:new THREE.Vector3(),size:0,angle:0}))};
    };
    this.sprays=batch(sprays);this.drops=batch(drops);this.decals=Array.from({length:3},()=>batch(Math.ceil(decals/3),true));this.ready=false;
  }
  async prepare(data){
    if(!data)return;const textures=await Promise.all([data.burst,data.drops,...data.decals].map(originalTexture));
    this.sprays.mesh.material.uniforms.sprite.value=textures[0];this.drops.mesh.material.uniforms.sprite.value=textures[1];this.decals.forEach((b,i)=>b.mesh.material.uniforms.sprite.value=textures[i+2]);this.ready=true;
  }
  decal(position,normal,size,time){
    if(!this.ready||Math.hypot(...normal)<.5)return;
    const index=this.nextDecal++,batch=this.decals[index%3],slot=Math.floor(index/3)%batch.slots.length,state=batch.slots[slot],a=batch.mesh.geometry.attributes;
    state.born=time;state.due=time+45;this.normal.fromArray(normal).normalize();this.p.fromArray(position).addScaledVector(this.normal,.09);
    this.quaternion.setFromUnitVectors(UP,this.normal).multiply(this.roll.setFromAxisAngle(UP,Math.random()*Math.PI*2));this.u.set(size,0,0).applyQuaternion(this.quaternion);this.v.set(0,size,0).applyQuaternion(this.quaternion);
    a.center.setXYZ(slot,...this.p.toArray());a.axisU.setXYZ(slot,...this.u.toArray());a.axisV.setXYZ(slot,...this.v.toArray());a.opacity.setX(slot,.88);for(const attribute of Object.values(a))if(attribute.isInstancedBufferAttribute)attribute.needsUpdate=true;batch.mesh.visible=true;
  }
  surface(position,direction,range,size,time){
    if(!this.trace)return;const hit=this.trace(position,direction,range);if(!hit)return;
    this.decal(position.map((x,i)=>x+direction[i]*hit.distance),hit.normal,size,time);
  }
  burst(position,direction,time,severed=false){
    if(!this.ready)return;
    this.d.fromArray(direction||[1,0,0]);if(this.d.lengthSq()<1e-8)this.d.set(1,0,0);this.d.normalize();const scale=severed?1.6:1;
    for(const [batch,count,key]of [[this.sprays,severed?4:2,'nextSpray'],[this.drops,severed?12:6,'nextDrop']])for(let i=0;i<count;i++){
      const slot=batch.slots[this[key]++%batch.slots.length];slot.position.fromArray(position);slot.born=time;slot.due=time+(batch===this.sprays?.42:.65);
      slot.velocity.copy(this.d).multiplyScalar((batch===this.sprays?30:65)+Math.random()*35);slot.velocity.x+=(Math.random()-.5)*50;slot.velocity.y+=(Math.random()-.5)*50;slot.velocity.z+=(Math.random()-.35)*60;
      slot.size=(batch===this.sprays?18+Math.random()*10:3+Math.random()*4)*scale;slot.angle=Math.random()*Math.PI*2;
    }
    const dir=this.d.toArray(),behind=position.map((x,i)=>x+dir[i]*5);this.surface(behind,dir,180,20*scale,time);
    const ground=position.map((x,i)=>x+(i===2?8:dir[i]*16));this.surface(ground,[0,0,-1],192,22*scale,time);
  }
  update(time){
    if(!this.ready)return;
    for(const batch of [this.sprays,this.drops]){const a=batch.mesh.geometry.attributes;let active=false;
      for(let i=0;i<batch.slots.length;i++){
        const s=batch.slots[i],age=time-s.born,alive=age>=0&&time<s.due;a.opacity.setX(i,alive?Math.max(0,1-age/(s.due-s.born))*.85:0);if(!alive)continue;active=true;
        const t=Math.min(age,.65),gravity=batch===this.drops?180:40;a.center.setXYZ(i,s.position.x+s.velocity.x*t,s.position.y+s.velocity.y*t,s.position.z+s.velocity.z*t-gravity*t*t/2);
        a.size.setX(i,s.size*(batch===this.sprays?1+age*1.5:1));a.angle.setX(i,s.angle+age*2);a.frame.setX(i,Math.min(15,Math.floor(age/(s.due-s.born)*16)));
      }
      for(const attribute of Object.values(a))if(attribute.isInstancedBufferAttribute)attribute.needsUpdate=true;batch.mesh.visible=active;
    }
    for(const batch of this.decals){let active=false;const opacity=batch.mesh.geometry.attributes.opacity;for(let i=0;i<batch.slots.length;i++){const s=batch.slots[i],alive=time>=s.born&&time<s.due;opacity.setX(i,alive?.88*Math.min(1,(s.due-time)/10):0);active||=alive;}opacity.needsUpdate=true;batch.mesh.visible=active;}
  }
  reset(){for(const b of [this.sprays,this.drops,...this.decals]){for(const s of b.slots){s.born=-Infinity;s.due=-Infinity;}b.mesh.geometry.attributes.opacity.array.fill(0);b.mesh.geometry.attributes.opacity.needsUpdate=true;b.mesh.visible=false;}this.nextSpray=0;this.nextDrop=0;this.nextDecal=0;}
  warmObjects(){return [this.sprays,this.drops,...this.decals].map(b=>b.mesh);}
  diagnostics(){return {sprayCapacity:this.sprays.slots.length,dropCapacity:this.drops.slots.length,decalCapacity:this.decals.reduce((sum,b)=>sum+b.slots.length,0),batches:5,ready:this.ready};}
}
