import * as THREE from 'three';
import {originalTexture} from './assets.js';

const vertex=`attribute vec3 center;attribute vec2 size;attribute vec4 tint;attribute vec4 atlas;attribute float angle;
varying vec2 vUv;varying vec4 vTint;
void main(){float c=cos(angle),s=sin(angle);vec2 p=mat2(c,-s,s,c)*position.xy*size*2.;vec4 eye=modelViewMatrix*vec4(center,1.);eye.xy+=p;gl_Position=projectionMatrix*eye;vUv=atlas.xy+uv*atlas.zw;vTint=tint;}`;
const fragment=`uniform sampler2D sprite;varying vec2 vUv;varying vec4 vTint;
// Additive contributions stay linear; encoding every particle before summing
// amplifies dark texels and turns the overlapping green sprites white.
void main(){vec4 texel=texture2D(sprite,vUv);vec3 tint=pow(vTint.rgb,vec3(2.2));
gl_FragColor=vec4(texel.rgb*tint,texel.a*vTint.a);}`;
const random=r=>r[0]+Math.random()*r[1];

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
  create(name,time=0){
    const root=new THREE.Group(),emitters=[];
    for(const e of this.data[name]?.elements||[]){
      if(!e.textures.length||!e.samples.length)continue;
      const count=Math.min(64,Math.max(1,e.looping?Math.ceil((e.life[0]+e.life[1])/Math.max(1,e.interval)):e.count));
      const plane=new THREE.PlaneGeometry(1,1),geometry=new THREE.InstancedBufferGeometry();geometry.index=plane.index;geometry.attributes.position=plane.attributes.position;geometry.attributes.uv=plane.attributes.uv;geometry.instanceCount=count;
      for(const [attribute,size] of [['center',3],['size',2],['tint',4],['atlas',4],['angle',1]])geometry.setAttribute(attribute,new THREE.InstancedBufferAttribute(new Float32Array(count*size),size).setUsage(THREE.DynamicDrawUsage));
      const mesh=new THREE.Mesh(geometry,this.templates.get(e.textures[0]+'|'+(e.blending||'additive')));mesh.frustumCulled=false;root.add(mesh);
      const particles=Array.from({length:count},(_,i)=>this.particle(e,time+(e.looping?i*Math.max(.02,e.interval/1000):random(e.delay)/1000)));
      emitters.push({e,mesh,particles});
    }
    root.userData.fx={name,time,emitters};return root;
  }
  particle(e,born){
    const angle=Math.random()*Math.PI*2,radius=random(e.radius),v=e.velocity[0];
    return {born,life:Math.max(.01,random(e.life)/1000),seed:Math.random(),cell:Math.floor(Math.random()*Math.max(1,e.atlas.entries)),
        gravity:e.blending?random(e.gravity)*1000:0,
        center:e.origin.map((r,k)=>random(r)+(k===0?Math.cos(angle)*radius:k===1?Math.sin(angle)*radius:random(e.height))),
      velocity:[0,1,2].map(k=>v?(v.local[k]+v.world[k]+Math.random()*(v.localAmplitude[k]+v.worldAmplitude[k]))*1000:0)};
  }
  restart(root,time){root.userData.fx.time=time;for(const emitter of root.userData.fx.emitters){const e=emitter.e;for(let i=0;i<emitter.particles.length;i++)emitter.particles[i]=this.particle(e,time+random(e.delay)/1000);}this.update(root,time);}
  endTime(root){return Math.max(root.userData.fx.time,...root.userData.fx.emitters.flatMap(e=>e.particles.map(p=>p.born+p.life)));}
  update(root,time){
    for(const emitter of root.userData.fx.emitters){const {e,mesh,particles}=emitter,a=mesh.geometry.attributes;
      for(let i=0;i<particles.length;i++){
        let p=particles[i],age=time-p.born;
        if(age>p.life&&e.looping){p=particles[i]=this.particle(e,time);age=0;}
        const progress=Math.max(0,Math.min(1,age/p.life)),at=progress*(e.samples.length-1),index=Math.floor(at),left=e.samples[index],right=e.samples[Math.min(index+1,e.samples.length-1)],t=at-index;
        const blend=(key,k)=>left[key][k]+(right[key][k]-left[key][k])*t;
        const opacity=age<0||age>p.life?0:1;
        a.center.setXYZ(i,...p.center.map((v,k)=>v+p.velocity[k]*Math.max(0,age)-(k===2?p.gravity*Math.max(0,age)**2/2:0)));
        a.size.setXY(i,Math.max(0,blend('size',0)+blend('sizeAmplitude',0)*p.seed),Math.max(0,blend('size',1)+blend('sizeAmplitude',1)*p.seed));
        a.tint.setXYZW(i,blend('color',0)/255,blend('color',1)/255,blend('color',2)/255,blend('color',3)/255*opacity);
        const columns=2**e.atlas.cols,rows=2**e.atlas.rows,cell=(p.cell+Math.floor(Math.max(0,age)*e.atlas.fps))%Math.max(1,e.atlas.entries);
        a.atlas.setXYZW(i,(cell%columns)/columns,Math.floor(cell/columns)/rows,1/columns,1/rows);
        a.angle.setX(i,left.rotation+(right.rotation-left.rotation)*t);
      }
      for(const attribute of Object.values(a))if(attribute.isInstancedBufferAttribute)attribute.needsUpdate=true;
    }
  }
  dispose(root){root.traverse(n=>{if(n.isMesh)n.geometry.dispose();});root.removeFromParent();}
}
