import * as THREE from 'three';
import {originalTexture,t4Effects} from './assets.js';

// Billboards face the camera. Tail and line elements (sparks, debris streaks,
// smoke tendrils) instead stretch along their direction of travel: width is
// size.x and length size.y, laid along the projected velocity.
const vertex=`attribute vec3 center;attribute vec2 size;attribute vec4 tint;attribute vec4 atlas;attribute float angle;attribute vec3 axis;attribute float stretch;
varying vec2 vUv;varying vec4 vTint;
void main(){vec4 eye=modelViewMatrix*vec4(center,1.);
  if(stretch>.5){vec3 ahead=(modelViewMatrix*vec4(center+axis,1.)).xyz-eye.xyz;vec2 d=length(ahead.xy)>1e-5?normalize(ahead.xy):vec2(0.,1.);vec2 n=vec2(-d.y,d.x);
    eye.xy+=n*position.x*size.x*2.+d*position.y*size.y*2.;}
  else{float c=cos(angle),s=sin(angle);eye.xy+=mat2(c,-s,s,c)*position.xy*size*2.;}
  gl_Position=projectionMatrix*eye;vUv=atlas.xy+uv*atlas.zw;vTint=tint;}`;
const fragment=`uniform sampler2D sprite;varying vec2 vUv;varying vec4 vTint;
// Additive contributions stay linear; encoding every particle before summing
// amplifies dark texels and turns the overlapping green sprites white.
void main(){vec4 texel=texture2D(sprite,vUv);vec3 tint=pow(vTint.rgb,vec3(2.2));
gl_FragColor=vec4(texel.rgb*tint,texel.a*vTint.a);}`;
const random=r=>r[0]+Math.random()*r[1];
// FxElemType. T5/T6: 0-2 sprites, 3 tail, 4 line, 5 trail, 6 cloud.
// T4: 0-1 sprites, 2 tail, 3 line, 4 trail, 5 cloud.
const STRETCHED=new Set(t4Effects?[2,3,4]:[3,4,5]);
const G=800,down=new THREE.Vector3(),worldQuaternion=new THREE.Quaternion();

// Original sprite atlases and exported lifetime/color/size curves, batched on GPU.
export class OriginalEffects {
  constructor(presentation){this.data=presentation.effects;this.templates=new Map();}
  async prepare(){
    for(const effect of Object.values(this.data))for(const e of effect.elements)if(e.textures.length)for(const url of e.textures){
      const key=url+'|'+(e.blending||'additive');if(this.templates.has(key))continue;
      const map=await originalTexture(url),normal=e.blending==='normal';this.templates.set(key,new THREE.ShaderMaterial({uniforms:{sprite:{value:map}},vertexShader:vertex,fragmentShader:normal?fragment.replace('}', '\n#include <colorspace_fragment>\n}'):fragment,
        transparent:true,depthWrite:false,depthTest:true,blending:normal?THREE.NormalBlending:THREE.AdditiveBlending}));
    }
  }
  has(name){return !!this.data[name];}
  create(name,time=0){
    const root=new THREE.Group(),emitters=[];
    for(const e of this.data[name]?.elements||[]){
      if(!e.textures.length||!e.samples.length)continue;
      const count=Math.min(64,Math.max(1,e.looping?Math.ceil((e.life[0]+e.life[1])/Math.max(1,e.interval)):e.count));
      const plane=new THREE.PlaneGeometry(1,1),geometry=new THREE.InstancedBufferGeometry();geometry.index=plane.index;geometry.attributes.position=plane.attributes.position;geometry.attributes.uv=plane.attributes.uv;geometry.instanceCount=count;
      for(const [attribute,size] of [['center',3],['size',2],['tint',4],['atlas',4],['angle',1],['axis',3],['stretch',1]])geometry.setAttribute(attribute,new THREE.InstancedBufferAttribute(new Float32Array(count*size),size).setUsage(THREE.DynamicDrawUsage));
      geometry.attributes.stretch.array.fill(STRETCHED.has(e.type)?1:0);
      const mesh=new THREE.Mesh(geometry,this.templates.get(e.textures[0]+'|'+(e.blending||'additive')));mesh.frustumCulled=false;root.add(mesh);
      const particles=Array.from({length:count},(_,i)=>this.particle(e,time+(e.looping?i*Math.max(.02,e.interval/1000):random(e.delay)/1000)));
      emitters.push({e,mesh,particles});
    }
    root.userData.fx={name,time,emitters};return root;
  }
  // Velocities are per millisecond in the effect's own frame (local) and in
  // the world; gravity is a fraction of the world's 800 units/s².
  // Spawn offset (FX_ELEM_SPAWN_OFFSET): a sphere, or a cylinder around the
  // effect's forward (local X) axis with its height along it. With
  // FX_ELEM_RUN_RELATIVE_TO_OFFSET the particle's velocity frame faces out
  // from the centre, which is what spreads sparks into a burst.
  particle(e,born){
    const r=[Math.random(),Math.random(),Math.random()],radius=random(e.radius),shape=e.flags&0x30,radial=(e.flags&0xc0)===0xc0;
    let offset=[0,0,0],out=null;
    if(shape===0x10){const z=Math.random()*2-1,a=Math.random()*Math.PI*2,h=Math.sqrt(1-z*z);out=[z,h*Math.cos(a),h*Math.sin(a)];offset=out.map(v=>v*radius);}
    else if(shape===0x20){const a=Math.random()*Math.PI*2;out=[0,Math.cos(a),Math.sin(a)];offset=[random(e.height),out[1]*radius,out[2]*radius];}
    let frame=null;
    if(radial&&out){const x=new THREE.Vector3(...out).normalize(),helper=Math.abs(x.x)<.9?new THREE.Vector3(1,0,0):new THREE.Vector3(0,1,0),y=new THREE.Vector3().crossVectors(helper,x).normalize(),z=new THREE.Vector3().crossVectors(x,y);frame=[x,y,z];}
    return {born,life:Math.max(.01,random(e.life)/1000),seed:Math.random(),cell:Math.floor(Math.random()*Math.max(1,e.atlas.entries)),
      gravity:e.blending?random(e.gravity)*G:0,r,frame,
      center:e.origin.map((range,k)=>random(range)+offset[k])};
  }
  restart(root,time){root.userData.fx.time=time;for(const emitter of root.userData.fx.emitters){const e=emitter.e;for(let i=0;i<emitter.particles.length;i++)emitter.particles[i]=this.particle(e,time+random(e.delay)/1000);}this.update(root,time);}
  endTime(root){return Math.max(root.userData.fx.time,...root.userData.fx.emitters.flatMap(e=>e.particles.map(p=>p.born+p.life)));}
  // Velocity of a particle at a fraction of its life, from the velocity graph.
  velocity(e,p,progress,out){
    const graph=e.velocity;if(!graph?.length){out.set(0,0,0,0,0,0);return out;}
    const at=progress*(graph.length-1),i=Math.min(graph.length-1,Math.floor(at)),j=Math.min(graph.length-1,i+1),t=at-i;
    for(let k=0;k<3;k++){const a=graph[i],b=graph[j],sample=(v,amp)=>(v[k]+p.r[k]*amp[k]);
      out[k]=(sample(a.local,a.localAmplitude)*(1-t)+sample(b.local,b.localAmplitude)*t)*1000;
      out[k+3]=(sample(a.world,a.worldAmplitude)*(1-t)+sample(b.world,b.worldAmplitude)*t)*1000;}
    if(p.frame){const [x,y,z]=p.frame,a=out[0],b=out[1],c=out[2];for(let k=0;k<3;k++)out[k]=x.getComponent(k)*a+y.getComponent(k)*b+z.getComponent(k)*c;}
    return out;
  }
  update(root,time){
    // World-space forces in the effect's frame: the root may be turned so its
    // local X (the effect's forward) points up or along a surface normal.
    root.getWorldQuaternion(worldQuaternion).invert();down.set(0,0,-1).applyQuaternion(worldQuaternion);
    const toLocal=v=>v.applyQuaternion(worldQuaternion),local=new THREE.Vector3(),world=new THREE.Vector3(),vel=[0,0,0,0,0,0];
    for(const emitter of root.userData.fx.emitters){const {e,mesh,particles}=emitter,a=mesh.geometry.attributes;
      for(let i=0;i<particles.length;i++){
        let p=particles[i],age=time-p.born;
        if(age>p.life&&e.looping){p=particles[i]=this.particle(e,time);age=0;}
        const progress=Math.max(0,Math.min(1,age/p.life)),at=progress*(e.samples.length-1),index=Math.floor(at),left=e.samples[index],right=e.samples[Math.min(index+1,e.samples.length-1)],t=at-index;
        const blend=(key,k)=>left[key][k]+(right[key][k]-left[key][k])*t;
        const opacity=age<0||age>p.life?0:1,s=Math.max(0,age);
        // Position: the mean of the start and current velocity over the age
        // approximates the graph's integral; gravity falls in world space.
        this.velocity(e,p,0,vel);const v0l=[vel[0],vel[1],vel[2]],v0w=[vel[3],vel[4],vel[5]];this.velocity(e,p,progress,vel);
        world.set((v0w[0]+vel[3])/2,(v0w[1]+vel[4])/2,(v0w[2]+vel[5])/2);toLocal(world);
        local.set((v0l[0]+vel[0])/2,(v0l[1]+vel[1])/2,(v0l[2]+vel[2])/2).add(world).multiplyScalar(s).addScaledVector(down,p.gravity*s*s/2);
        a.center.setXYZ(i,p.center[0]+local.x,p.center[1]+local.y,p.center[2]+local.z);
        world.set(vel[3],vel[4],vel[5]);toLocal(world);
        a.axis.setXYZ(i,vel[0]+world.x+down.x*p.gravity*s,vel[1]+world.y+down.y*p.gravity*s,vel[2]+world.z+down.z*p.gravity*s);
        a.size.setXY(i,Math.max(0,blend('size',0)+blend('sizeAmplitude',0)*p.seed),Math.max(0,blend('size',1)+blend('sizeAmplitude',1)*p.seed));
        a.tint.setXYZW(i,blend('color',0)/255,blend('color',1)/255,blend('color',2)/255,blend('color',3)/255*opacity);
        const columns=2**e.atlas.cols,rows=2**e.atlas.rows,cell=(p.cell+Math.floor(s*e.atlas.fps))%Math.max(1,e.atlas.entries);
        a.atlas.setXYZW(i,(cell%columns)/columns,Math.floor(cell/columns)/rows,1/columns,1/rows);
        a.angle.setX(i,left.rotation+(right.rotation-left.rotation)*t);
      }
      for(const attribute of Object.values(a))if(attribute.isInstancedBufferAttribute)attribute.needsUpdate=true;
    }
  }
  dispose(root){root.traverse(n=>{if(n.isMesh)n.geometry.dispose();});root.removeFromParent();}
}
