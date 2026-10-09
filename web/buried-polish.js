import * as THREE from 'three';
import {originalTexture,viewPolish} from './assets.js';
import {polishLight,DYNAMIC_LIGHTS,polishUniforms} from './polish-light.js';
import {contactSurfaceName} from './dive-audio.js';

// Buried's presentation polish: dynamic light, particles, beams, debris and
// decals driven by the game's own state and events. Every effect is pooled
// and timed on game time, so nothing piles up across rounds or restarts and
// the picture is the same at 30, 60 or 144 frames per second.
//
// Presentation timings (seconds unless noted) live here so they can be tuned.
export const POLISH_TIMING={
  muzzleFlash:.05,muzzleLight:.055,sparks:[.1,.3],impactDust:[.35,.6],
  barrierDust:[.8,1.5],barrierCloud:[2.2,3.2],debris:[3,5],shakeNear:2.2,shakeRadius:900,
  decalLife:30,decalFade:6,paralyzerFade:.12,disintegrate:1.25,
};
// Low, medium and high effects quality. Combat cues (muzzle light, impact
// sparks, the beam, barrier dust) stay at every level; ambient detail scales.
export const QUALITY=[
  {lights:4,ambient:.35,particles:.5,decals:32,debris:12,shafts:false,fog:.4},
  {lights:6,ambient:.7,particles:.8,decals:64,debris:24,shafts:true,fog:.7},
  {lights:8,ambient:1,particles:1,decals:96,debris:36,shafts:true,fog:1},
];
const rand=(a,b)=>a+Math.random()*(b-a);
// Instanced marks fade through their per-instance color: its brightness
// scales the alpha as well as the color.
const fadeByColor=material=>{material.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
#ifdef USE_COLOR
diffuseColor.a*=clamp(max(vColor.r,max(vColor.g,vColor.b))*1.25,0.,1.);
#endif`);};material.customProgramCacheKey=()=>'fade-by-color';return material;};
const srgb=(r,g,b)=>new THREE.Color().setRGB(r/255,g/255,b/255,THREE.SRGBColorSpace);
const PARALYZER={normal:{core:srgb(205,205,255),outer:srgb(96,96,255),light:srgb(120,120,255)},upgraded:{core:srgb(230,200,230),outer:srgb(235,60,85),light:srgb(255,90,110)}};
// Original lamp flicker: a sum of incommensurate sines, the same on the GPU
// (halo sprites) and the CPU (the light the lamp throws), so both agree.
const flicker=(t,phase)=>.5+.22*Math.sin(t*7.3+phase)+.17*Math.sin(t*13.1+phase*1.7)+.11*Math.sin(t*23.7+phase*2.9);
const FLICKER_GLSL='float wawFlicker(float t,float p){return .5+.22*sin(t*7.3+p)+.17*sin(t*13.1+p*1.7)+.11*sin(t*23.7+p*2.9);}';
const FOG_GLSL='float wawFog(float depth){return 1.-exp(-fogDensity*fogDensity*depth*depth);}';

// GPU particles: every particle's motion is analytic from its spawn state
// (drag, gravity, wobble, a floor it settles on), so the CPU only writes a
// slot when one is born. Slots are a ring: the oldest is reused, nothing is
// allocated after load.
class ParticlePool {
  constructor(scene,texture,{cols=1,rows=1,additive=false,max=1024,order=0}={}){
    this.max=max;this.next=0;this.dirtyLow=Infinity;this.dirtyHigh=-1;
    const g=new THREE.InstancedBufferGeometry(),quad=new THREE.PlaneGeometry(1,1);g.index=quad.index;g.setAttribute('position',quad.getAttribute('position'));g.setAttribute('uv',quad.getAttribute('uv'));
    this.arrays={};for(const [name,size]of [['aP0',3],['aV0',3],['aT',4],['aS',4],['aC',4],['aM',4]]){const a=new Float32Array(max*size);if(name==='aT')for(let i=0;i<max;i++)a[i*4]=-1e9;const attribute=new THREE.InstancedBufferAttribute(a,size);attribute.setUsage(THREE.DynamicDrawUsage);g.setAttribute(name,attribute);this.arrays[name]=attribute;}
    g.instanceCount=max;
    this.uniforms={map:{value:texture},uTime:{value:0},uAtlas:{value:new THREE.Vector2(cols,rows)},uAdditive:{value:additive?1:0},fogColor:{value:new THREE.Color()},fogDensity:{value:0}};
    this.material=new THREE.ShaderMaterial({uniforms:this.uniforms,transparent:true,depthWrite:false,
      blending:additive?THREE.CustomBlending:THREE.NormalBlending,blendSrc:THREE.OneFactor,blendDst:THREE.OneFactor,blendEquation:THREE.AddEquation,
      vertexShader:`attribute vec3 aP0,aV0;attribute vec4 aT,aS,aC,aM;uniform float uTime;uniform vec2 uAtlas;varying vec2 vUv;varying vec4 vColor;varying float vDepth;
        void main(){
          float t=uTime-aT.x,life=aT.y,u=t/life;
          if(t<0.||u>=1.){gl_Position=vec4(2.,2.,2.,1.);return;}
          float k=aT.z,g=aT.w,e=exp(-k*t),s=k>.001?(1.-e)/k:t,sg=k>.001?(t-s)/k:.5*t*t;
          vec3 p=aP0+aV0*s-vec3(0.,0.,g*sg),vel=aV0*e-vec3(0.,0.,k>.001?g*(1.-e)/k:g*t);
          if(aM.w>0.){float seed=aT.x*7.31+aP0.x*.013;p+=aM.w*vec3(sin(uTime*.71+seed),cos(uTime*.53+seed*1.3),.5*sin(uTime*.37+seed*2.1));}
          if(p.z<aM.z){p.z=aM.z;vel=vec3(0.);}
          float size=mix(aS.x,aS.y,sqrt(u));
          vec4 mv=modelViewMatrix*vec4(p,1.);vec2 c=position.xy;
          if(aM.y>0.){vec2 sv=(modelViewMatrix*vec4(vel,0.)).xy;float L=length(sv);vec2 ax=L>.001?sv/L:vec2(1.,0.),ay=vec2(-ax.y,ax.x);c=ax*c.x*(1.+aM.y*L*.012)+ay*c.y;}
          else{float a=aS.z+aS.w*t;c=mat2(cos(a),sin(a),-sin(a),cos(a))*c;}
          mv.xy+=c*size;gl_Position=projectionMatrix*mv;
          float frame=floor(aM.x+.5);vec2 cell=vec2(mod(frame,uAtlas.x),floor(frame/uAtlas.x));vUv=(cell+vec2(uv.x,1.-uv.y))/uAtlas;
          // Large soft sprites (fog, clouds) fade out as the camera nears them, so
          // their flat cards never show a hard cut where they meet a wall up close.
          vColor=vec4(aC.rgb,aC.a*smoothstep(0.,.08,u)*(1.-smoothstep(.4,1.,u))*smoothstep(max(4.,size*.35),max(24.,size*1.3),-mv.z));vDepth=-mv.z;
        }`,
      fragmentShader:`uniform sampler2D map;uniform float uAdditive;uniform vec3 fogColor;uniform float fogDensity;varying vec2 vUv;varying vec4 vColor;varying float vDepth;${FOG_GLSL}
        void main(){vec4 t=texture2D(map,vUv);float a=t.a*vColor.a,fog=wawFog(vDepth);
          if(uAdditive>.5)gl_FragColor=vec4(t.rgb*vColor.rgb*a*(1.-fog),1.);
          else{if(a<.004)discard;gl_FragColor=vec4(mix(t.rgb*vColor.rgb,fogColor,fog),a);}
          #include <colorspace_fragment>
        }`});
    this.mesh=new THREE.Mesh(g,this.material);this.mesh.frustumCulled=false;this.mesh.renderOrder=order;this.geometry=g;scene.add(this.mesh);
  }
  // p: position, v: velocity, time, life, drag, gravity, size0/1, rot, spin,
  // color (THREE.Color), alpha, frame, stretch, floor, wobble.
  emit(p){
    const i=this.next;this.next=(i+1)%this.max;const A=this.arrays;
    A.aP0.array.set(p.p,i*3);A.aV0.array.set(p.v||[0,0,0],i*3);
    A.aT.array.set([p.time,p.life,p.drag||0,p.gravity||0],i*4);A.aS.array.set([p.size0,p.size1??p.size0,p.rot??Math.random()*6.283,p.spin||0],i*4);
    const c=p.color||{r:1,g:1,b:1};A.aC.array.set([c.r,c.g,c.b,p.alpha??1],i*4);A.aM.array.set([p.frame||0,p.stretch||0,p.floor??-1e9,p.wobble||0],i*4);
    this.dirtyLow=Math.min(this.dirtyLow,i);this.dirtyHigh=Math.max(this.dirtyHigh,i);
  }
  update(time,fog){
    this.uniforms.uTime.value=time;if(fog){this.uniforms.fogColor.value.copy(fog.color);this.uniforms.fogDensity.value=fog.density;}
    if(this.dirtyHigh<0)return;
    for(const [name,a]of Object.entries(this.arrays)){const size=a.itemSize;a.clearUpdateRanges();a.addUpdateRange(this.dirtyLow*size,(this.dirtyHigh-this.dirtyLow+1)*size);a.needsUpdate=true;}
    this.dirtyLow=Infinity;this.dirtyHigh=-1;
  }
  clear(){const t=this.arrays.aT.array;for(let i=0;i<this.max;i++)t[i*4]=-1e9;this.dirtyLow=0;this.dirtyHigh=this.max-1;}
}

// Static billboards (lamp halos) that flicker with their lamp on the GPU.
function haloMesh(texture,halos){
  const g=new THREE.InstancedBufferGeometry(),quad=new THREE.PlaneGeometry(1,1);g.index=quad.index;g.setAttribute('position',quad.getAttribute('position'));g.setAttribute('uv',quad.getAttribute('uv'));
  const P=new Float32Array(halos.length*4),C=new Float32Array(halos.length*4);halos.forEach((h,i)=>{P.set([...h.p,h.size],i*4);C.set([h.color.r,h.color.g,h.color.b,h.phase],i*4);});
  g.setAttribute('aP',new THREE.InstancedBufferAttribute(P,4));g.setAttribute('aC',new THREE.InstancedBufferAttribute(C,4));g.instanceCount=halos.length;
  const uniforms={map:{value:texture},uTime:{value:0},uStrength:{value:1},fogColor:{value:new THREE.Color()},fogDensity:{value:0}};
  const material=new THREE.ShaderMaterial({uniforms,transparent:true,depthWrite:false,blending:THREE.CustomBlending,blendSrc:THREE.OneFactor,blendDst:THREE.OneFactor,
    vertexShader:`attribute vec4 aP,aC;uniform float uTime;varying vec2 vUv;varying vec3 vColor;varying float vDepth;${FLICKER_GLSL}
      void main(){vec4 mv=modelViewMatrix*vec4(aP.xyz,1.);float d=-mv.z;
        float f=aC.a<0.?1.:mix(.78,1.12,wawFlicker(uTime,aC.a));
        // Halos shrink toward the camera and pull slightly toward it so
        // they sit in front of their own lamp glass, not inside it.
        mv.xyz+=normalize(-mv.xyz)*min(6.,d*.1);
        mv.xy+=position.xy*aP.w*(.7+.3*f)*clamp(d/90.,.35,1.);gl_Position=projectionMatrix*mv;
        vUv=uv;vColor=aC.rgb*f*smoothstep(20.,70.,d)*(1.-smoothstep(1800.,2600.,d));vDepth=d;}`,
    fragmentShader:`uniform sampler2D map;uniform float uStrength;uniform vec3 fogColor;uniform float fogDensity;varying vec2 vUv;varying vec3 vColor;varying float vDepth;${FOG_GLSL}
      void main(){vec3 t=texture2D(map,vUv).rgb;gl_FragColor=vec4(t*vColor*uStrength*(1.-wawFog(vDepth)),1.);
      #include <colorspace_fragment>
      }`});
  const mesh=new THREE.Mesh(g,material);mesh.frustumCulled=false;mesh.renderOrder=5;return {mesh,uniforms};
}

// God rays: soft ribbons along each createfx ray, turned about their own
// axis to face the camera, faded at both ends, along the view axis and
// when the camera stands inside them. Depth testing occludes them.
function shaftMesh(texture,shafts){
  const g=new THREE.InstancedBufferGeometry(),quad=new THREE.PlaneGeometry(1,1,1,8);g.index=quad.index;g.setAttribute('position',quad.getAttribute('position'));g.setAttribute('uv',quad.getAttribute('uv'));
  const A=new Float32Array(shafts.length*4),B=new Float32Array(shafts.length*4),C=new Float32Array(shafts.length*4);
  shafts.forEach((s,i)=>{A.set([...s.from,s.width],i*4);B.set([...s.axis,s.phase],i*4);C.set([s.color.r,s.color.g,s.color.b,s.alpha],i*4);});
  for(const [n,a]of [['aA',A],['aB',B],['aC',C]])g.setAttribute(n,new THREE.InstancedBufferAttribute(a,4));g.instanceCount=shafts.length;
  const uniforms={map:{value:texture},uTime:{value:0},uStrength:{value:1},fogColor:{value:new THREE.Color()},fogDensity:{value:0}};
  const material=new THREE.ShaderMaterial({uniforms,transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.CustomBlending,blendSrc:THREE.OneFactor,blendDst:THREE.OneFactor,
    vertexShader:`attribute vec4 aA,aB,aC;uniform float uTime;varying vec2 vUv;varying vec4 vColor;varying float vDepth;
      void main(){vec3 axis=aB.xyz,along=normalize(axis);vec3 p=aA.xyz+axis*(position.y+.5);
        vec3 toCam=normalize(cameraPosition-p),side=normalize(cross(along,toCam));
        float spread=mix(.55,1.,position.y+.5);p+=side*position.x*aA.w*spread;
        vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;vUv=vec2(uv.x,uv.y);vDepth=-mv.z;
        float facing=1.-abs(dot(along,toCam));
        float inside=smoothstep(aA.w*.6,aA.w*2.2,length(cross(cameraPosition-aA.xyz,along)));
        vColor=vec4(aC.rgb*aC.a*(.85+.15*sin(uTime*.45+aB.w))*smoothstep(.05,.45,facing)*inside,1.);}`,
    fragmentShader:`uniform sampler2D map;uniform float uStrength;uniform vec3 fogColor;uniform float fogDensity;varying vec2 vUv;varying vec4 vColor;varying float vDepth;${FOG_GLSL}
      void main(){float ends=smoothstep(0.,.18,vUv.y)*smoothstep(1.,.62,vUv.y);float edge=smoothstep(0.,.35,vUv.x)*smoothstep(1.,.65,vUv.x);
        vec3 t=texture2D(map,vec2(vUv.x,.15+vUv.y*.7)).rgb;gl_FragColor=vec4(t*vColor.rgb*ends*edge*uStrength*(1.-wawFog(vDepth)),1.);
        #include <colorspace_fragment>
      }`});
  const mesh=new THREE.Mesh(g,material);mesh.frustumCulled=false;mesh.renderOrder=4;return {mesh,uniforms};
}

// The Paralyzer's sustained beam: a bright core and turbulent outer strands
// between the muzzle and what the beam actually reaches, displaced on the
// GPU by moving noise. One strip mesh, positioned by uniforms each frame.
function beamMesh(texture){
  const strands=4,segments=36,P=[],I=[];
  for(let s=0;s<strands;s++)for(let i=0;i<=segments;i++)for(const side of [-1,1])P.push(i/segments,side,s);
  for(let s=0;s<strands;s++)for(let i=0;i<segments;i++){const a=(s*(segments+1)+i)*2;I.push(a,a+1,a+2,a+1,a+3,a+2);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(P,3));g.setIndex(I);
  const uniforms={map:{value:texture},uStart:{value:new THREE.Vector3()},uEnd:{value:new THREE.Vector3()},uTime:{value:0},uIntensity:{value:0},uCore:{value:new THREE.Color()},uOuter:{value:new THREE.Color()},uHeat:{value:0}};
  const material=new THREE.ShaderMaterial({uniforms,transparent:true,depthWrite:false,blending:THREE.CustomBlending,blendSrc:THREE.OneFactor,blendDst:THREE.OneFactor,side:THREE.DoubleSide,
    vertexShader:`uniform vec3 uStart,uEnd;uniform float uTime,uHeat;varying float vT,vSide,vStrand;
      float h(float n){return fract(sin(n)*43758.5453);}
      float noise(float x){float i=floor(x),f=fract(x);return mix(h(i),h(i+1.),f*f*(3.-2.*f))*2.-1.;}
      void main(){float t=position.x,strand=position.z;vT=t;vSide=position.y;vStrand=strand;
        vec3 dir=uEnd-uStart;float len=length(dir);vec3 f=dir/max(len,.001);
        vec3 p=uStart+dir*t;
        vec3 up=abs(f.z)<.95?vec3(0.,0.,1.):vec3(1.,0.,0.),a=normalize(cross(f,up)),b=cross(f,a);
        // Outer strands writhe; amplitude swells mid-beam and with heat.
        float amp=strand<.5?0.:(2.2+strand*1.6)*(1.+uHeat*.8)*sin(3.14159*t)*min(1.,len/120.);
        float x=t*len*.035*(1.+strand*.37)-uTime*(5.+strand*1.7);
        p+=(a*noise(x+strand*17.)+b*noise(x*1.3+strand*31.+5.))*amp;
        vec3 toCam=normalize(cameraPosition-p),side=normalize(cross(f,toCam));
        float width=strand<.5?1.4:(2.4+strand*.9)*(1.+uHeat*.35);
        width*=mix(.45,1.,smoothstep(0.,.08,t));
        p+=side*position.y*width;gl_Position=projectionMatrix*viewMatrix*vec4(p,1.);}`,
    fragmentShader:`uniform sampler2D map;uniform float uTime,uIntensity,uHeat;uniform vec3 uCore,uOuter;varying float vT,vSide,vStrand;
      void main(){float across=1.-abs(vSide),profile=pow(across,vStrand<.5?.8:1.6);
        float flick=.75+.25*sin(vT*60.-uTime*40.+vStrand*3.);
        vec3 tex=texture2D(map,vec2(fract(vT*4.-uTime*3.),across)).rgb;
        vec3 c=vStrand<.5?mix(uOuter,uCore,profile)*(1.6+uHeat)*(.6+.4*tex.r):uOuter*(.35+.25*uHeat)*flick*(.5+.5*tex.r);
        float ends=smoothstep(0.,.03,vT)*smoothstep(1.,.97,vT);
        gl_FragColor=vec4(c*profile*ends*uIntensity,1.);
        #include <colorspace_fragment>
      }`});
  const mesh=new THREE.Mesh(g,material);mesh.frustumCulled=false;mesh.renderOrder=6;mesh.visible=false;return {mesh,uniforms};
}

// Cosmetic debris: a few solid pieces with their own simple bounce on the
// floor found under each at spawn. They never touch collision or navigation.
class DebrisPool {
  constructor(scene,kinds,max){
    this.max=max;this.pieces=[];this.meshes={};this.next={};
    for(const [kind,{geometry,material}]of Object.entries(kinds)){const mesh=new THREE.InstancedMesh(geometry,material,max);mesh.count=0;mesh.frustumCulled=false;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);scene.add(mesh);this.meshes[kind]=mesh;}
    this.m=new THREE.Matrix4();this.q=new THREE.Quaternion();this.e=new THREE.Euler();this.s=new THREE.Vector3();this.v=new THREE.Vector3();
  }
  add(kind,piece){const list=this.pieces.filter(p=>p.kind===kind);if(list.length>=this.max){const oldest=list.reduce((a,b)=>a.born<b.born?a:b);this.pieces.splice(this.pieces.indexOf(oldest),1);}this.pieces.push({kind,...piece});}
  update(time,dt){
    const counts={};for(const kind in this.meshes)counts[kind]=0;
    this.pieces=this.pieces.filter(p=>time<p.born+p.life);
    for(const p of this.pieces){
      if(dt>0&&!p.rest){const step=Math.min(dt,.05);p.vel[2]-=800*step;for(let k=0;k<3;k++)p.pos[k]+=p.vel[k]*step;p.rot.x+=p.spin[0]*step;p.rot.y+=p.spin[1]*step;p.rot.z+=p.spin[2]*step;
        if(p.pos[2]<p.floor){p.pos[2]=p.floor;if(Math.abs(p.vel[2])<60){p.rest=true;p.rot.x=Math.round(p.rot.x/Math.PI)*Math.PI;p.rot.y=Math.round(p.rot.y/Math.PI)*Math.PI;}else{p.vel[2]*=-.32;p.vel[0]*=.55;p.vel[1]*=.55;p.spin=p.spin.map(s=>s*.5);}}}
      const age=time-p.born,fade=1-THREE.MathUtils.smoothstep(age,p.life-.7,p.life),sink=p.rest?(1-fade)*2:0;
      const mesh=this.meshes[p.kind],i=counts[p.kind]++;
      this.e.copy(p.rot);this.q.setFromEuler(this.e);this.s.setScalar(p.scale*Math.max(.001,.35+.65*fade));this.v.set(p.pos[0],p.pos[1],p.pos[2]-sink);
      this.m.compose(this.v,this.q,this.s);mesh.setMatrixAt(i,this.m);mesh.setColorAt(i,p.color);
    }
    for(const [kind,mesh]of Object.entries(this.meshes)){mesh.count=counts[kind];mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;}
  }
  clear(){this.pieces.length=0;for(const mesh of Object.values(this.meshes))mesh.count=0;}
}

// Bullet marks: small quads laid on the hit surface, kept only where all four
// corners find the same surface (no marks hanging over edges or seen through
// thin walls), drawn with a depth offset and faded out after a while.
class DecalPool {
  constructor(scene,max){
    this.max=max;this.items=[];this.next=0;
    const size=64,canvas=document.createElement('canvas');canvas.width=canvas.height=size;const c=canvas.getContext('2d');
    const g=c.createRadialGradient(size/2,size/2,0,size/2,size/2,size/2);g.addColorStop(0,'rgba(8,6,5,.95)');g.addColorStop(.28,'rgba(20,16,12,.85)');g.addColorStop(.55,'rgba(40,32,24,.35)');g.addColorStop(1,'rgba(40,32,24,0)');
    c.fillStyle=g;c.beginPath();for(let i=0;i<=24;i++){const a=i/24*Math.PI*2,r=size*(.36+Math.random()*.14);c.lineTo(size/2+Math.cos(a)*r,size/2+Math.sin(a)*r);}c.fill();
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    this.material=fadeByColor(new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-6}));
    this.mesh=new THREE.InstancedMesh(new THREE.PlaneGeometry(1,1),this.material,max);this.mesh.count=0;this.mesh.frustumCulled=false;this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);scene.add(this.mesh);
    this.m=new THREE.Matrix4();this.q=new THREE.Quaternion();this.z=new THREE.Vector3(0,0,1);this.n=new THREE.Vector3();this.r=new THREE.Quaternion();
  }
  add(position,normal,size,color,time){
    this.n.fromArray(normal).normalize();this.q.setFromUnitVectors(this.z,this.n);this.r.setFromAxisAngle(this.n,Math.random()*Math.PI*2);this.q.premultiply(this.r);
    const p=new THREE.Vector3().fromArray(position).addScaledVector(this.n,.35);
    const item={matrix:new THREE.Matrix4().compose(p,this.q.clone(),new THREE.Vector3(size,size,1)),color,born:time};
    if(this.items.length<this.max)this.items.push(item);else{this.items[this.next]=item;this.next=(this.next+1)%this.max;}
  }
  update(time){
    let n=0;const life=POLISH_TIMING.decalLife,fade=POLISH_TIMING.decalFade,c=new THREE.Color();
    this.items=this.items.filter(d=>time<d.born+life);this.next%=Math.max(1,this.max);
    for(const d of this.items){const k=1-THREE.MathUtils.smoothstep(time,d.born+life-fade,d.born+life);this.mesh.setMatrixAt(n,d.matrix);this.mesh.setColorAt(n,c.copy(d.color).multiplyScalar(k));n++;}
    this.mesh.count=n;this.mesh.instanceMatrix.needsUpdate=true;if(this.mesh.instanceColor)this.mesh.instanceColor.needsUpdate=true;
  }
  clear(){this.items.length=0;this.mesh.count=0;}
}

export class BuriedPolish {
  constructor({scene,camera,map,collision,settings,audio,emitShake}){
    this.scene=scene;this.camera=camera;this.map=map;this.collision=collision;this.settings=settings;this.audio=audio;this.emitShake=emitShake;
    this.lights=[];this.timers=[];this.vec=new THREE.Vector3();this.ready=false;this.lastTime=0;this.bodyFx=new Map();this.footContact=new Map();
  }
  get quality(){return QUALITY[Math.max(0,Math.min(2,this.settings?.value.effects??2))];}
  async prepare(manifest,polish){
    const t=polish?.textures;if(!t)return;
    const tex={};await Promise.all(Object.entries(t).map(async([k,v])=>{try{const x=await originalTexture(v.url);x.colorSpace=THREE.SRGBColorSpace;x.wrapS=x.wrapT=THREE.ClampToEdgeWrapping;tex[k]={texture:x,cols:v.cols,rows:v.rows};}catch(error){console.warn('Polish texture unavailable:',v.url,error.message);}}));
    const pool=(name,options)=>tex[name]?new ParticlePool(this.scene,tex[name].texture,{cols:tex[name].cols,rows:tex[name].rows,...options}):null;
    this.pools={
      smoke:pool('smoke',{max:768,order:2}),puff:pool('puff',{max:384,order:2}),dust:pool('dust',{max:512,order:2}),whisp:pool('whisp',{max:192,order:3}),
      mote:pool('mote',{max:1024,additive:true,order:3}),spark:pool('spark',{max:768,additive:true,order:4}),glow:pool('glow',{max:256,additive:true,order:4}),
      star:pool('star',{max:64,additive:true,order:4}),energy:pool('energy',{max:512,additive:true,order:4}),
      wood:pool('wood',{max:384,order:1}),rock:pool('rock',{max:384,order:1}),concrete:pool('concrete',{max:192,order:1}),metal:pool('metal',{max:128,order:1}),glass:pool('glass',{max:192,order:1}),
    };
    for(const [k,v]of Object.entries(this.pools))if(!v)delete this.pools[k];
    // Lamp halos at the original glow effect placements; each flickers with
    // the nearest scripted flicker light (fire_flicker), or holds steady.
    const flickerLights=manifest.entities.filter(e=>e.classname==='light'&&e.origin).map((e,i)=>{
      const origin=e.origin.split(/\s+/).map(Number),color=(e._color||'1 .8 .5').split(/\s+/).map(Number),intensity=Number(e.intensity)||1;
      const lo=Number(e.script_intensity_min),hi=Number(e.script_intensity_max),flickers=/flicker/.test(e.targetname||'')&&Number.isFinite(lo)&&Number.isFinite(hi)&&hi>lo;
      // script_intensity_min/max set the flicker's swing; it varies the baked
      // lamp light by a fraction either side, never removes it.
      return {origin,color:new THREE.Color(...color),intensity,radius:Math.min(600,Number(e.radius)||300),flickers,swing:flickers?(hi-lo)/(hi+lo):0,phase:i*2.399,mixer:e.script_mixer_event||''};
    });
    this.flickerLights=flickerLights.filter(l=>l.flickers);
    const nearestFlicker=p=>{let best=null,bd=96*96;for(const l of this.flickerLights){const d=(l.origin[0]-p[0])**2+(l.origin[1]-p[1])**2+(l.origin[2]-p[2])**2;if(d<bd){bd=d;best=l;}}return best;};
    const halos=[];
    for(const a of polish.ambient||[]){
      if(a.fx==='glow_kerosene_lamp'||a.fx==='glow_sconce'){const near=nearestFlicker(a.origin);halos.push({p:a.origin,size:a.fx==='glow_sconce'?26:20,color:new THREE.Color(1,.62,.3).multiplyScalar(.5),phase:near?near.phase:-1});}
    }
    if(tex.glow&&halos.length){this.halos=haloMesh(tex.glow.texture,halos);this.scene.add(this.halos.mesh);}
    // God rays along the createfx ray directions.
    const RAYS={god_ray_sm:[150,34,.11,'warm'],godray_ext_sm:[220,46,.1,'cool'],godray_ext_md:[300,70,.09,'cool'],godray_ext_lg:[420,110,.085,'cool'],godray_ext_thin:[320,22,.12,'cool'],godray_church:[420,120,.1,'warm']};
    const shafts=[];
    for(const a of polish.ambient||[]){const r=RAYS[a.fx];if(!r||!a.angles)continue;const [p,y]=a.angles.map(v=>v*Math.PI/180),f=[Math.cos(p)*Math.cos(y),Math.cos(p)*Math.sin(y),-Math.sin(p)];
      shafts.push({from:a.origin,axis:f.map(v=>v*r[0]),width:r[1],alpha:r[2],phase:Math.random()*6,color:r[3]==='warm'?new THREE.Color(1,.78,.52):new THREE.Color(.62,.72,.9)});}
    if(tex.ray&&shafts.length){this.shafts=shaftMesh(tex.ray.texture,shafts);this.scene.add(this.shafts.mesh);}
    // Ambient emitters near the camera: motes, falling ceiling dust, low fog.
    const kind={dust_motes_xlg:'motes',dust_motes_ext_xlg:'motes',dust_motes_ext_sm:'motes',dust_int_25x50:'motes',dust_flurry:'motes',
      dust_tunnel_ceiling:'ceiling',dust_ceiling_hole:'ceiling',dust_rising_sm:'rising',dust_rising_md:'rising',fog_md:'fog',fog_sm:'fog',steam_md:'fog',dust_edge_xlg:'edge',dust_edge_100:'edge',dust_edge_blown:'edge'};
    this.emitters=(polish.ambient||[]).filter(a=>kind[a.fx]).map(a=>({...a,kind:kind[a.fx],due:Math.random()*4,light:null}));
    if(tex.tracer){this.beam=beamMesh(tex.tracer.texture);this.scene.add(this.beam.mesh);}
    this.decals=new DecalPool(this.scene,96);
    // Debris pieces: splintered planks for the wooden blockers, chunks for stone.
    const plank=new THREE.BoxGeometry(14,3.2,1.3),chunk=new THREE.DodecahedronGeometry(2.4,0);
    const woodTex=tex.wood?.texture,rockTex=tex.rock?.texture;
    this.debris=new DebrisPool(this.scene,{
      wood:{geometry:plank,material:new THREE.MeshBasicMaterial({color:0xffffff,map:null})},
      stone:{geometry:chunk,material:new THREE.MeshBasicMaterial({color:0xffffff,map:null})},
    },36);
    this.woodColor=new THREE.Color(.42,.3,.2);this.stoneColor=new THREE.Color(.42,.4,.37);void woodTex;void rockTex;
    this.slothBarricades=manifest.map.slothBarricades||[];this.manifest=manifest;
    this.ready=true;
  }
  // ---------------------------------------------------------------- lights
  // A dynamic light for this frame (or for `life` seconds of game time).
  light(position,radius,color,intensity=1,{life=0,priority=1,time=0,decay=true}={}){
    const l={p:position.slice?position.slice():position,radius,color:color.clone?color.clone():new THREE.Color(...color),intensity,priority,born:time,life,decay};
    if(life>0)this.timers.push(l);else this.lights.push(l);return l;
  }
  flushLights(time){
    const camera=this.camera.position,list=[...this.lights];
    this.timers=this.timers.filter(l=>time<l.born+l.life&&time>=l.born-.001);
    for(const l of this.timers){const k=l.decay?1-(time-l.born)/l.life:1;list.push({...l,intensity:l.intensity*k*k});}
    // Flickering lamps near the camera vary the baked light they already cast.
    const q=this.quality;let lampSlots=Math.max(1,q.lights-3);
    for(const l of this.nearLamps||[]){if(lampSlots--<=0)break;const f=(flicker(time,l.phase)*2-1)*l.swing;list.push({p:l.origin,radius:l.radius*.8,color:l.color,intensity:.45*f,priority:.2});}
    list.sort((a,b)=>b.priority*Math.abs(b.intensity)/(1+(b.p[0]-camera.x)**2+(b.p[1]-camera.y)**2+(b.p[2]-camera.z)**2)*1e4-a.priority*Math.abs(a.intensity)/(1+(a.p[0]-camera.x)**2+(a.p[1]-camera.y)**2+(a.p[2]-camera.z)**2)*1e4);
    const u=polishLight.uniforms,n=Math.min(q.lights,DYNAMIC_LIGHTS,list.length),view=this.camera.matrixWorldInverse;
    for(let i=0;i<n;i++){const l=list[i];u.wawDynPos.value[i].set(l.p[0],l.p[1],l.p[2],l.radius);u.wawDynColor.value[i].set(l.color.r*l.intensity,l.color.g*l.intensity,l.color.b*l.intensity);
      this.vec.set(l.p[0],l.p[1],l.p[2]).applyMatrix4(view);viewPolish.wawDynPos.value[i].set(this.vec.x,this.vec.y,this.vec.z,l.radius);viewPolish.wawDynColor.value[i].copy(u.wawDynColor.value[i]);}
    u.wawDynCount.value=n;viewPolish.wawDynCount.value=n;this.lights.length=0;
  }
  // -------------------------------------------------------------- particles
  emit(name,n,spawn){const pool=this.pools?.[name];if(!pool)return;for(let i=0;i<n;i++)pool.emit(spawn(i));}
  scaled(n,cue=false){const q=this.quality;return Math.max(cue?1:0,Math.round(n*(cue?Math.max(.6,q.particles):q.particles)));}
  litColor(position,base,boost=1){const c=this.map.illumination(position);return new THREE.Color(base[0]*Math.min(1.6,c[0]*boost+.05),base[1]*Math.min(1.6,c[1]*boost+.05),base[2]*Math.min(1.6,c[2]*boost+.05));}
  // A cone of directions about `n` (a hemisphere when spread = 1).
  cone(n,spread){
    const N=new THREE.Vector3(...n).normalize(),a=Math.abs(N.z)<.9?new THREE.Vector3(0,0,1):new THREE.Vector3(1,0,0),u=new THREE.Vector3().crossVectors(N,a).normalize(),v=new THREE.Vector3().crossVectors(N,u);
    const phi=Math.random()*Math.PI*2,c=1-Math.random()*spread,s=Math.sqrt(1-c*c);return u.multiplyScalar(Math.cos(phi)*s).add(v.multiplyScalar(Math.sin(phi)*s)).add(N.multiplyScalar(c)).toArray();
  }
  floorBelow(p,reach=200){const t=this.collision.trace([p[0],p[1],p[2]+2],[p[0],p[1],p[2]-reach],[0,0,0]);return t.fraction<1?t.end[2]+.5:p[2]-reach;}
  // ------------------------------------------------------------ gunfire
  // Bullet impacts by surface: sparks off metal, chips and dust off stone,
  // splinters off wood, a dirt plume off the ground; a mark on the surface.
  impact(ray,time){
    if(!this.ready||!ray.wall||!ray.end)return;
    const n=ray.normal&&Math.hypot(...ray.normal)>.5?ray.normal:ray.dir.map(v=>-v),p=ray.end.map((v,k)=>v+n[k]*.6),surface=contactSurfaceName(ray.surface?{material:ray.surface,texture:''}:null);
    const kind=/metal/.test(surface)?'metal':/wood/.test(surface)?'wood':/concrete|gravel/.test(surface)||/stone|rock|brick/.test(ray.surface||'')?'stone':/dirt|mud|grass|snow/.test(surface)?'dirt':/wood|plank|board/.test(ray.surface||'')?'wood':'stone';
    const floor=this.floorBelow(p,120),T=POLISH_TIMING,light=this.litColor(p,[1,1,1],1.2);
    if(kind==='metal'){
      this.emit('spark',this.scaled(9,true),()=>({p,v:this.cone(n,.65).map(v=>v*rand(180,420)),time,life:rand(...T.sparks),drag:2,gravity:500,size0:rand(.9,1.6),size1:.3,color:new THREE.Color(1,.72,.38).multiplyScalar(1.6),frame:Math.floor(Math.random()*4),stretch:1.4,floor}));
      this.emit('glow',1,()=>({p,time,life:.07,size0:9,size1:14,color:new THREE.Color(1,.72,.42).multiplyScalar(.9)}));
      this.light(p,90,[1,.7,.4],.5,{life:.06,priority:1.5,time});
    }else if(kind==='wood'){
      this.emit('wood',this.scaled(6,true),()=>({p,v:this.cone(n,.7).map(v=>v*rand(110,260)),time,life:rand(.45,.8),drag:1.2,gravity:800,size0:rand(1.4,2.8),size1:rand(1.2,2.4),spin:rand(-14,14),color:light,frame:Math.floor(Math.random()*4),floor}));
    }else if(kind==='stone'){
      this.emit('rock',this.scaled(6,true),()=>({p,v:this.cone(n,.7).map(v=>v*rand(120,280)),time,life:rand(.4,.7),drag:1,gravity:800,size0:rand(.8,1.8),size1:rand(.6,1.4),spin:rand(-12,12),color:light,frame:Math.floor(Math.random()*4),floor}));
      this.emit('spark',this.scaled(2),()=>({p,v:this.cone(n,.5).map(v=>v*rand(150,300)),time,life:rand(.08,.15),drag:3,gravity:300,size0:.8,size1:.2,color:new THREE.Color(1,.8,.55),frame:Math.floor(Math.random()*4),stretch:1.2,floor}));
    }
    // Dust that hangs a little longer than the sparks.
    const dust=kind==='dirt'?'dust':'puff',tint=kind==='wood'?[.62,.52,.42]:kind==='dirt'?[.55,.47,.38]:[.6,.58,.55];
    this.emit(dust,this.scaled(kind==='dirt'?4:2,true),()=>({p:p.map((v,k)=>v+n[k]*rand(1,4)),v:this.cone(n,.4).map(v=>v*rand(20,60)),time,life:rand(...T.impactDust),drag:3,gravity:-6,size0:rand(4,7),size1:rand(14,24),color:this.litColor(p,tint,1.1),alpha:kind==='metal'?.35:.6,frame:Math.floor(Math.random()*2),rot:Math.random()*6,spin:rand(-1,1)}));
    if(this.decals&&this.decalFits(ray.end,n))this.decals.add(ray.end,n,rand(3.2,4.4),kind==='metal'?new THREE.Color(.55,.55,.55):kind==='wood'?new THREE.Color(.75,.72,.7):new THREE.Color(.85,.85,.85),time);
  }
  decalFits(p,n){
    if(this.decals.max<=0)return false;const N=new THREE.Vector3(...n).normalize(),a=Math.abs(N.z)<.9?new THREE.Vector3(0,0,1):new THREE.Vector3(1,0,0),u=new THREE.Vector3().crossVectors(N,a).normalize().multiplyScalar(2.2),v=new THREE.Vector3().crossVectors(N,u).normalize().multiplyScalar(2.2);
    for(const [i,j]of [[1,1],[1,-1],[-1,1],[-1,-1]]){const c=new THREE.Vector3(...p).addScaledVector(u,i).addScaledVector(v,j),from=c.clone().addScaledVector(N,2),hit=this.map.bullets.trace(from.toArray(),N.clone().negate().toArray(),4);if(!hit||Math.abs(hit.distance-2)>.8)return false;}
    return true;
  }
  // The muzzle: its flash already plays on tag_flash; this lights the
  // surroundings (and the hands) for the flash's own short life.
  muzzle(position,time,definition){
    const heavy=(definition?.damage||40)>=100;this.light(position,heavy?320:240,[1,.74,.45],heavy?1.4:1.05,{life:POLISH_TIMING.muzzleLight,priority:3,time});
  }
  // ------------------------------------------------------------- the beam
  // Visible exactly while the Paralyzer is firing (the gun's own firing
  // state), from the muzzle to where the beam actually stops.
  paralyzer(game,muzzle,dt,time){
    const w=game.weapon,on=!!this.beam&&w?.name?.startsWith('slowgun')&&game.paralyzerFiring&&!game.paralyzerLock&&!game.switching&&!['dead','ready'].includes(game.phase)&&game.paralyzerBeam&&time-game.paralyzerBeam.at<.2;
    this.beamLevel=THREE.MathUtils.clamp((this.beamLevel||0)+(on?1:-1)*dt/POLISH_TIMING.paralyzerFade,0,1);
    if(!this.beam)return;this.beam.mesh.visible=this.beamLevel>0&&!!muzzle;if(!this.beam.mesh.visible)return;
    const b=game.paralyzerBeam,palette=PARALYZER[w?.name?.includes('upgraded')||b.upgraded?'upgraded':'normal'],heat=THREE.MathUtils.clamp((game.paralyzerHeat||0)/115,0,1),u=this.beam.uniforms;
    u.uStart.value.copy(muzzle);u.uEnd.value.fromArray(b.end);u.uTime.value=time;u.uHeat.value=heat;u.uIntensity.value=this.beamLevel*(.85+.3*heat);
    u.uCore.value.copy(palette.core);u.uOuter.value.copy(palette.outer).lerp(new THREE.Color(1,1,1),heat*.25);
    if(!on)return;
    // Light at both ends, flickering with the energy.
    const f=.8+.2*Math.sin(time*37)+.1*Math.sin(time*61);
    this.light(muzzle.toArray(),170,palette.light,1.1*f*(.8+.4*heat),{priority:3});this.light(b.end,150,palette.light,.9*f,{priority:2.5});
    // Impact where the beam lands: crackling glow and sparks; dust kicked up
    // when the beam reaches the ground under a flying player.
    if(time>=(this.beamFxDue||0)){this.beamFxDue=time+.05;
      const n=b.normal&&Math.hypot(...b.normal)>.5?b.normal:[0,0,1],p=b.end.map((v,k)=>v+n[k]*1.5);
      this.emit('energy',this.scaled(3,true),()=>({p:p.map(v=>v+rand(-3,3)),v:this.cone(n,.9).map(v=>v*rand(20,90)),time,life:rand(.12,.3),drag:4,size0:rand(4,8),size1:rand(1,3),color:palette.light.clone().multiplyScalar(1.4),alpha:.9}));
      if(b.wall){this.emit('spark',this.scaled(2,true),()=>({p,v:this.cone(n,.7).map(v=>v*rand(80,220)),time,life:rand(.1,.25),drag:3,gravity:200,size0:.9,size1:.2,color:palette.core.clone().multiplyScalar(1.5),frame:Math.floor(Math.random()*4),stretch:1.2}));
        this.emit('glow',1,()=>({p,time,life:.08,size0:12,size1:16,color:palette.light.clone().multiplyScalar(.5)}));}
      if(b.wall&&n[2]>.6&&game.flight&&Math.hypot(...b.end.map((v,k)=>v-game.player.position[k]))<500)
        this.emit('dust',this.scaled(2,true),()=>({p:p.map((v,k)=>k<2?v+rand(-14,14):v+1),v:[rand(-60,60),rand(-60,60),rand(10,40)],time,life:rand(.8,1.3),drag:2,gravity:-4,size0:rand(6,10),size1:rand(22,34),color:this.litColor(p,[.6,.54,.46],1.1),alpha:.45,frame:0,rot:Math.random()*6,spin:rand(-.6,.6)}));
    }
  }
  // Zombies held by the beam glow with crackling energy on their bodies; a
  // lethal dose disintegrates them (the rig's dissolve) as they fall.
  paralyzedBodies(game,visuals,time,dt){
    for(const rig of visuals.values()){
      const e=rig.enemy;if(!e)continue;
      let fx=this.bodyFx.get(rig);if(!fx){fx={energy:0,dissolve:0,ghost:0,killedAt:null};this.bodyFx.set(rig,fx);}
      const held=!e.dead&&e.paralyzedUntil>time;fx.energy=THREE.MathUtils.clamp(fx.energy+(held?6:-3)*dt,0,1);
      if(e.dead&&e.paralyzerKill){if(fx.killedAt==null){fx.killedAt=time;this.disintegrateBurst(e,time);}fx.dissolve=THREE.MathUtils.clamp((time-fx.killedAt-.15)/POLISH_TIMING.disintegrate,0,1);}
      else if(e.kind==='ghost'){
        // Mansion ghosts: a translucent shimmer; they gather in over half a
        // second and smoke away when they die.
        fx.ghost=1;const born=e.spawnTime??time;
        if(e.dead){if(fx.killedAt==null){fx.killedAt=time;this.ghostBurst(e,time);}fx.dissolve=THREE.MathUtils.clamp((time-fx.killedAt)/.8,0,1);}
        else{fx.killedAt=null;fx.dissolve=THREE.MathUtils.clamp(1-(time-born)/.6,0,1);fx.energy=e.attacking||e.draining?.6+.4*Math.sin(time*9):0;
          if(time>=(fx.wispDue||0)){fx.wispDue=time+rand(.25,.5);const p=[e.position[0]+rand(-10,10),e.position[1]+rand(-10,10),e.position[2]+rand(20,60)];this.emit('whisp',1,()=>({p,v:[rand(-8,8),rand(-8,8),rand(10,25)],time,life:rand(1,1.6),drag:1,size0:rand(6,10),size1:rand(18,26),color:new THREE.Color(.5,.72,.85),alpha:.25,frame:Math.floor(Math.random()*2),spin:rand(-.4,.4)}));}}
      }
      else if(!e.dead){fx.killedAt=null;fx.dissolve=0;}
      const palette=PARALYZER[e.paralyzerUpgraded?'upgraded':'normal'],any=fx.energy>0||fx.dissolve>0||fx.ghost>0;
      for(const m of rig.materials){if(!m.userData.polish)continue;const u=polishUniforms(m);u.wawFx.value.set(fx.energy,fx.dissolve,fx.ghost,time);if(any)u.wawFxColor.value.copy(e.kind==='ghost'?new THREE.Color(.45,.75,.9):palette.light);}
      if(held&&time>=(fx.sparkDue||0)){fx.sparkDue=time+.07;const p=[e.position[0]+rand(-10,10),e.position[1]+rand(-10,10),e.position[2]+rand(15,65)];
        this.emit('energy',1,()=>({p,v:[rand(-30,30),rand(-30,30),rand(0,40)],time,life:rand(.12,.25),drag:3,size0:rand(3,6),size1:1,color:palette.light.clone().multiplyScalar(1.3),alpha:.8}));
        this.emit('spark',1,()=>({p,v:[rand(-120,120),rand(-120,120),rand(-40,120)],time,life:rand(.08,.18),drag:3,gravity:100,size0:.7,size1:.2,color:palette.core.clone().multiplyScalar(1.4),frame:Math.floor(Math.random()*4),stretch:1}));}
    }
  }
  ghostBurst(e,time){
    const c=[e.position[0],e.position[1],e.position[2]+40];
    this.emit('whisp',this.scaled(10,true),()=>({p:c.map((v,k)=>v+(k<2?rand(-12,12):rand(-25,25))),v:[rand(-40,40),rand(-40,40),rand(10,60)],time:time+rand(0,.3),life:rand(1,1.8),drag:1.4,gravity:-10,size0:rand(8,12),size1:rand(26,40),color:new THREE.Color(.55,.78,.9),alpha:.4,frame:Math.floor(Math.random()*2),spin:rand(-.6,.6)}));
    this.emit('glow',1,()=>({p:c,time,life:.35,size0:30,size1:60,color:new THREE.Color(.35,.55,.7)}));
    this.light(c,200,[.5,.75,.95],.8,{life:.4,priority:2,time});
  }
  // Ghost rigs draw translucent (set once; the shimmer itself is per body).
  prepareGhosts(actors){for(const rig of actors.variantPools?.get('ghost')||[])for(const m of rig.materials){m.transparent=true;m.depthWrite=false;m.needsUpdate=true;}}
  kill(e,time,game){if(e.arthurKill)this.arthurRunDown(e,time,game);}
  disintegrateBurst(e,time){
    const palette=PARALYZER[e.paralyzerUpgraded?'upgraded':'normal'],c=[e.position[0],e.position[1],e.position[2]+35];
    this.emit('energy',this.scaled(14,true),()=>({p:c.map((v,k)=>v+(k<2?rand(-12,12):rand(-30,30))),v:[rand(-60,60),rand(-60,60),rand(10,90)],time:time+rand(0,.6),life:rand(.3,.7),drag:2,gravity:-30,size0:rand(5,10),size1:1,color:palette.light.clone().multiplyScalar(1.3),alpha:.9}));
    this.emit('smoke',this.scaled(3,true),()=>({p:c.map((v,k)=>v+(k<2?rand(-10,10):rand(-25,25))),v:[rand(-15,15),rand(-15,15),rand(15,45)],time:time+rand(.1,.8),life:rand(1.4,2.2),drag:1.2,gravity:-10,size0:rand(10,16),size1:rand(28,40),color:new THREE.Color(.42,.42,.5),alpha:.25,frame:Math.floor(Math.random()*2),spin:rand(-.5,.5)}));
    this.light(c,180,PARALYZER[e.paralyzerUpgraded?'upgraded':'normal'].light,1.3,{life:.35,priority:2,time});
  }
  // -------------------------------------------------------------- Arthur
  // Foot contacts read off his skeleton: a foot that comes to rest near the
  // floor while he charges kicks up dust and thumps; a footstep note plays
  // the sound in the original, the dust goes where the foot actually lands.
  arthurFeet(object,a,time,game){
    if(!object||!a)return;const charging=a.state==='berserk'||a.state==='crash'||a.state==='drink';
    for(const name of ['j_ball_le','j_ball_ri']){const bone=object.getObjectByName(name);if(!bone)continue;
      bone.getWorldPosition(this.vec);const p=this.vec.toArray(),state=this.footContact.get(name)||{down:false,last:p,lastTime:time};
      const speed=Math.hypot(p[0]-state.last[0],p[1]-state.last[1],p[2]-state.last[2])/Math.max(1e-3,time-state.lastTime),height=p[2]-a.position[2];
      const down=height<6&&speed<140,up=height>9;
      if(!state.down&&down&&charging&&time-(state.at||0)>.2){state.at=time;this.footfall(p,a.state==='berserk'?1:.5,time,game);}
      if(down)state.down=true;else if(up)state.down=false;
      state.last=p;state.lastTime=time;this.footContact.set(name,state);
    }
  }
  footfall(p,strength,time,game){
    const floor=this.floorBelow([p[0],p[1],p[2]+4],24),at=[p[0],p[1],floor+1];
    this.emit('dust',this.scaled(4*strength+1,true),()=>({p:at.map((v,k)=>k<2?v+rand(-6,6):v),v:[rand(-50,50),rand(-50,50),rand(8,30)],time,life:rand(.7,1.1),drag:2.5,gravity:-3,size0:rand(5,8),size1:rand(16,26),color:this.litColor(at,[.62,.55,.46],1.1),alpha:.5*strength,rot:Math.random()*6,spin:rand(-.5,.5)}));
    this.emit('rock',this.scaled(3*strength),()=>({p:at,v:[rand(-60,60),rand(-60,60),rand(60,140)],time,life:rand(.4,.6),drag:1,gravity:800,size0:rand(.5,1),spin:rand(-10,10),color:this.litColor(at,[.7,.65,.6]),frame:Math.floor(Math.random()*4),floor}));
    if(strength>.8){this.audio?.play('fly_step_zombie',1,{position:at});this.shake(at,.35,.18,500,game);}
  }
  // The booze jug shatters where it hits the ground (drinkbooze "hitground").
  bottleBreak(position,time){
    const floor=this.floorBelow(position,64),p=[position[0],position[1],Math.max(floor+2,position[2])];
    this.emit('glass',this.scaled(10,true),()=>({p,v:[rand(-110,110),rand(-110,110),rand(60,190)],time,life:rand(.5,.9),drag:1,gravity:800,size0:rand(1,2.2),spin:rand(-16,16),color:new THREE.Color(.55,.7,.5),alpha:.9,frame:Math.floor(Math.random()*8),floor}));
    this.emit('spark',this.scaled(4),()=>({p,v:[rand(-90,90),rand(-90,90),rand(30,120)],time,life:rand(.1,.2),drag:2,gravity:500,size0:.6,size1:.2,color:new THREE.Color(.9,.95,.85),frame:Math.floor(Math.random()*4),stretch:1,floor}));
    this.emit('puff',this.scaled(3,true),()=>({p:[p[0],p[1],floor+2],v:[rand(-30,30),rand(-30,30),rand(5,20)],time,life:rand(.6,.9),drag:3,size0:4,size1:rand(12,16),color:new THREE.Color(.55,.42,.22),alpha:.45,frame:Math.floor(Math.random()*2)}));
    this.audio?.play('evt_bottle_break',1,{position:p});
  }
  // The barricade he smashes: a short burst of dust and fragments matched
  // to its material, then a softer cloud that drifts apart; loose pieces
  // tumble and settle for a few seconds. Shake and thump by distance.
  barricadeBreak(target,game,dynamic,time){
    const b=this.slothBarricades.find(x=>x.target===target);if(!b)return;
    const item=dynamic.get(target)?.[0],material=[];item?.object.traverse(n=>{if(n.isMesh)material.push(...[n.material].flat().map(m=>m.name||''));});
    const stone=material.length?material.every(n=>/stone|rock|brick|concrete/i.test(n)):false,kind=stone?'rock':'wood',T=POLISH_TIMING;
    const yaw=b.angles[1]*Math.PI/180,back=[-Math.cos(yaw),-Math.sin(yaw),0],center=b.position.slice(),floor=this.floorBelow(center,120);
    const tint=stone?[.6,.58,.55]:[.58,.48,.38],lit=this.litColor(center,tint,1.15);
    // Initial burst: fast dust and fragments thrown through the opening.
    this.emit('smoke',this.scaled(16,true),()=>({p:[center[0]+rand(-30,30),center[1]+rand(-30,30),floor+rand(8,80)],v:back.map((v,k)=>v*rand(80,260)+(k<2?rand(-90,90):rand(0,80))),time,life:rand(...T.barrierDust),drag:2.8,gravity:-8,size0:rand(14,22),size1:rand(40,64),color:lit,alpha:.75,frame:Math.floor(Math.random()*2),spin:rand(-.8,.8)}));
    this.emit(kind,this.scaled(28,true),()=>({p:[center[0]+rand(-24,24),center[1]+rand(-24,24),floor+rand(10,80)],v:back.map((v,k)=>v*rand(150,420)+(k<2?rand(-140,140):rand(40,220))),time,life:rand(.8,1.4),drag:.6,gravity:800,size0:rand(2,4.5),spin:rand(-18,18),color:this.litColor(center,[1,1,1],1.2),frame:Math.floor(Math.random()*4),floor}));
    // The softer cloud left hanging, dispersing.
    this.emit('smoke',this.scaled(10,true),()=>({p:[center[0]+rand(-50,50),center[1]+rand(-50,50),floor+rand(10,70)],v:[rand(-30,30)+back[0]*40,rand(-30,30)+back[1]*40,rand(4,20)],time:time+rand(.15,.5),life:rand(...T.barrierCloud),drag:1,gravity:-4,size0:rand(30,44),size1:rand(80,120),color:lit,alpha:.35,frame:Math.floor(Math.random()*2),spin:rand(-.3,.3)}));
    // Dust shaken loose from the ceiling above.
    this.ceilingDust(center,time,1.4);
    // A handful of solid pieces.
    const count=Math.min(this.quality.debris,stone?8:10);
    for(let i=0;i<count;i++){const p=[center[0]+rand(-30,30),center[1]+rand(-30,30),floor+rand(15,70)];
      this.debris.add(stone?'stone':'wood',{pos:p,vel:back.map((v,k)=>v*rand(120,300)+(k<2?rand(-80,80):rand(80,200))),rot:new THREE.Euler(rand(0,6),rand(0,6),rand(0,6)),spin:[rand(-9,9),rand(-9,9),rand(-9,9)],floor:this.floorBelow(p.map((v,k)=>k<2?v+back[k]*rand(40,120):v),200),
        born:time,life:rand(...T.debris),scale:rand(.7,1.3),color:(stone?this.stoneColor:this.woodColor).clone().multiply(new THREE.Color(...this.map.illumination(center).map(v=>Math.min(1.5,v*1.6+.15))))});}
    this.light([center[0],center[1],floor+50],260,[1,.8,.6],.9,{life:.25,priority:2,time});
    this.shake(center,POLISH_TIMING.shakeNear,.45,POLISH_TIMING.shakeRadius,game);
  }
  // Dust trickling from the ceiling above a point (a disturbance or the
  // original dust_tunnel_ceiling / dust_ceiling_hole placements).
  ceilingDust(p,time,strength=1,ceiling=null){
    if(ceiling==null){const t=this.collision.trace([p[0],p[1],p[2]+10],[p[0],p[1],p[2]+420],[0,0,0]);if(t.fraction>=1)return;ceiling=t.end[2]-2;}
    const floor=this.floorBelow([p[0],p[1],ceiling-4],600),color=this.litColor([p[0],p[1],ceiling-20],[.62,.56,.48],1.2);
    this.emit('dust',this.scaled(10*strength,true),()=>{const fall=Math.max(.6,Math.min(3,Math.sqrt(2*(ceiling-floor)/90)));return {p:[p[0]+rand(-14,14),p[1]+rand(-14,14),ceiling],v:[rand(-6,6),rand(-6,6),rand(-40,-10)],time:time+rand(0,.6),life:fall*rand(.9,1.2),drag:.8,gravity:90,size0:rand(1.4,2.6),size1:rand(4,7),color,alpha:.55,stretch:.6,floor};});
    this.emit('smoke',this.scaled(2*strength),()=>({p:[p[0]+rand(-10,10),p[1]+rand(-10,10),ceiling-6],v:[rand(-8,8),rand(-8,8),rand(-25,-8)],time:time+rand(0,.3),life:rand(1.4,2.2),drag:1.5,gravity:6,size0:8,size1:rand(26,40),color,alpha:.22,frame:Math.floor(Math.random()*2),spin:rand(-.3,.3)}));
  }
  // His charge through a zombie: a thump of dust and a hit flash at contact.
  arthurRunDown(e,time,game){
    const p=[e.position[0],e.position[1],e.position[2]+40];
    this.emit('puff',this.scaled(4,true),()=>({p:p.map(v=>v+rand(-8,8)),v:[rand(-60,60),rand(-60,60),rand(0,50)],time,life:rand(.4,.7),drag:3,size0:6,size1:rand(18,26),color:this.litColor(p,[.55,.45,.4]),alpha:.5,frame:Math.floor(Math.random()*2)}));
    this.shake(p,.6,.15,400,game);
  }
  shake(position,amplitude,duration,radius,game){
    const d=this.camera.position.distanceTo(this.vec.set(...position));if(d>=radius)return;
    const k=1-d/radius;this.emitShake?.({amplitude:amplitude*k*k,duration,game});
  }
  // ------------------------------------------------------------- ambience
  ambient(game,time,dt,visibleCells){
    const camera=this.camera.position,q=this.quality,near=[];
    for(const e of this.emitters||[]){
      const d2=(e.origin[0]-camera.x)**2+(e.origin[1]-camera.y)**2+(e.origin[2]-camera.z)**2,reach=e.kind==='fog'?2200:e.kind==='edge'?1800:1300;if(d2>reach*reach)continue;
      if(visibleCells){const c=this.map.cellFor([e.origin[0],e.origin[1],e.origin[2]+8]);if(c>=0&&!visibleCells[c])continue;}
      near.push(e);if(time<e.due)continue;
      e.light??=this.litColor(e.origin,[1,1,1],1);
      if(e.kind==='motes'){e.due=time+rand(.25,.5)/q.ambient;
        // Motes show where light is: brightness follows the baked light.
        const lum=Math.min(1,(e.light.r+e.light.g+e.light.b)/1.2);if(lum<.05){e.due=time+2;continue;}
        this.emit('mote',2,()=>({p:[e.origin[0]+rand(-110,110),e.origin[1]+rand(-110,110),e.origin[2]+rand(-30,110)],v:[rand(-3,3),rand(-3,3),rand(-2,3)],time,life:rand(6,10),drag:.2,size0:rand(.5,1.1),size1:rand(.5,1.1),color:new THREE.Color(1,.86,.66).multiplyScalar(.35+.65*lum),alpha:.55,frame:Math.floor(Math.random()*4),wobble:rand(4,9)}));}
      else if(e.kind==='ceiling'){e.due=time+rand(3,9)/Math.max(.3,q.ambient);this.ceilingDust(e.origin,time,.6*q.ambient+.2,e.origin[2]);}
      else if(e.kind==='rising'){e.due=time+rand(.6,1.2)/q.ambient;this.emit('dust',1,()=>({p:[e.origin[0]+rand(-40,40),e.origin[1]+rand(-40,40),e.origin[2]+rand(0,10)],v:[rand(-6,6),rand(-6,6),rand(6,16)],time,life:rand(4,6),drag:.4,gravity:-2,size0:rand(10,16),size1:rand(30,48),color:this.litColor(e.origin,[.6,.54,.46],1.1),alpha:.18,rot:Math.random()*6,spin:rand(-.2,.2)}));}
      else if(e.kind==='fog'){e.due=time+rand(1.5,2.5)/q.fog;this.emit('smoke',1,()=>({p:[e.origin[0]+rand(-120,120),e.origin[1]+rand(-120,120),e.origin[2]+rand(10,50)],v:[rand(-8,8),rand(-8,8),rand(0,3)],time,life:rand(10,14),drag:.1,size0:rand(80,120),size1:rand(150,210),color:this.litColor(e.origin,[.55,.52,.5],1.1),alpha:.12,frame:Math.floor(Math.random()*2),spin:rand(-.06,.06)}));}
      else if(e.kind==='edge'){e.due=time+rand(1.2,2.4)/q.ambient;this.emit('smoke',1,()=>({p:[e.origin[0]+rand(-60,60),e.origin[1]+rand(-60,60),e.origin[2]+rand(0,30)],v:[rand(-14,14),rand(-14,14),rand(-12,-2)],time,life:rand(4,6),drag:.3,gravity:4,size0:rand(30,50),size1:rand(80,120),color:this.litColor(e.origin,[.6,.55,.5],1.1),alpha:.14,frame:Math.floor(Math.random()*2),spin:rand(-.1,.1)}));}
    }
    // The flickering lamps nearest the camera get dynamic light slots.
    if(time>=(this.lampDue||0)){this.lampDue=time+.25;this.nearLamps=(this.flickerLights||[]).map(l=>({l,d:(l.origin[0]-camera.x)**2+(l.origin[1]-camera.y)**2+(l.origin[2]-camera.z)**2})).filter(x=>x.d<900*900).sort((a,b)=>a.d-b.d).slice(0,4).map(x=>x.l);}
  }
  // Soft contact shadows under the characters (static props carry theirs
  // in the baked lighting already).
  ensureShadows(){
    if(this.shadowMesh)return;const size=64,canvas=document.createElement('canvas');canvas.width=canvas.height=size;const c=canvas.getContext('2d'),g=c.createRadialGradient(32,32,0,32,32,32);
    g.addColorStop(0,'rgba(0,0,0,.62)');g.addColorStop(.45,'rgba(0,0,0,.38)');g.addColorStop(1,'rgba(0,0,0,0)');c.fillStyle=g;c.fillRect(0,0,size,size);
    const texture=new THREE.CanvasTexture(canvas);this.shadowMesh=new THREE.InstancedMesh(new THREE.PlaneGeometry(1,1),fadeByColor(new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-3,color:0xffffff})),64);
    this.shadowMesh.frustumCulled=false;this.shadowMesh.renderOrder=1;this.scene.add(this.shadowMesh);this.shadowMatrix=new THREE.Matrix4();
  }
  shadows(entries){
    this.ensureShadows();let n=0;const m=this.shadowMatrix,s=new THREE.Vector3(),p=new THREE.Vector3(),q=new THREE.Quaternion();
    for(const {position,radius,fade=1}of entries){if(n>=64)break;
      const floor=this.floorBelow([position[0],position[1],position[2]+6],140),height=position[2]-floor,k=fade*(1-THREE.MathUtils.smoothstep(height,10,110));if(k<=.02)continue;
      s.set(radius*2*(1+height/160),radius*2*(1+height/160),1);p.set(position[0],position[1],floor+.4);m.compose(p,q,s);this.shadowMesh.setMatrixAt(n,m);this.shadowMesh.setColorAt(n,new THREE.Color(k,k,k));n++;}
    this.shadowMesh.count=n;this.shadowMesh.instanceMatrix.needsUpdate=true;if(this.shadowMesh.instanceColor)this.shadowMesh.instanceColor.needsUpdate=true;
  }
  // --------------------------------------------------------- interactables
  // Driven by the game's own state: the box lights from inside while open
  // and puffs as it closes, leaves or lands; a perk purchase flashes at its
  // machine; a chalk drawing or wall-buy purchase brightens its outline;
  // power-ups light their surroundings and flash when collected.
  interactables(game,time,{buriedView,drops}={}){
    const rules=game.mapRules;
    for(const [target,v]of buriedView?.boxes||[]){
      const box=game.boxes?.get(target);if(!box)continue;const last=this.boxPhase?.get(target),p=[v.origin[0],v.origin[1],v.origin[2]+30];
      (this.boxPhase??=new Map()).set(target,box.phase);
      if(['cycling','offered','teddy'].includes(box.phase)){const k=THREE.MathUtils.clamp((time-box.started)/.6,0,1),pulse=box.phase==='cycling'?.85+.15*Math.sin(time*18):1;
        this.light(p,170,box.phase==='teddy'?[.7,.8,1]:[1,.86,.62],.9*k*pulse,{priority:1.2});
        if(box.phase==='cycling'&&time>=(this.boxSparkDue||0)){this.boxSparkDue=time+.12;this.emit('mote',1,()=>({p:p.map((x,k)=>k<2?x+rand(-14,14):x+rand(-6,10)),v:[rand(-6,6),rand(-6,6),rand(20,45)],time,life:rand(.8,1.4),drag:.6,size0:rand(.8,1.4),size1:.3,color:new THREE.Color(1,.85,.55),alpha:.9,frame:Math.floor(Math.random()*4)}));}}
      if(last&&last!==box.phase){
        if(box.phase==='closing')this.emit('puff',this.scaled(5,true),()=>({p:p.map((x,k)=>k<2?x+rand(-18,18):x-12),v:[rand(-40,40),rand(-40,40),rand(5,25)],time:time+.35,life:rand(.6,.9),drag:3,size0:6,size1:rand(18,26),color:this.litColor(p,[.6,.55,.5]),alpha:.4,frame:Math.floor(Math.random()*2)}));
        if(box.phase==='leaving'||box.phase==='arriving'){const at=box.phase==='leaving'?time+5.5:time;
          this.emit('smoke',this.scaled(12,true),()=>({p:p.map((x,k)=>k<2?x+rand(-30,30):x+rand(-20,30)),v:[rand(-70,70),rand(-70,70),rand(10,60)],time:at+rand(0,.2),life:rand(1,1.6),drag:2.5,gravity:-6,size0:rand(14,20),size1:rand(40,60),color:new THREE.Color(.75,.8,.9),alpha:.5,frame:Math.floor(Math.random()*2),spin:rand(-.5,.5)}));
          this.light(p,260,[.75,.85,1],1.2,{life:.5,priority:2,time:at});}
      }
    }
    // Perk purchases: the machine nearest the player.
    const perks=rules?.perks?.size||0;if(this.perkCount!=null&&perks>this.perkCount){const m=this.nearestMachine(game.player.position);if(m)this.perkFlash(m,time);}this.perkCount=perks;
    // Chalk: a new drawing, and a purchase at a drawn chalk wall.
    if(rules?.chalk){if(this.chalkSeen)for(const [target,weapon]of rules.chalk)if(this.chalkSeen.get(target)!==weapon)this.chalkFlash(target,time,true);this.chalkSeen=new Map(rules.chalk);
      const points=game.player.points;if(this.lastPoints!=null&&points<this.lastPoints){const near=this.nearestChalk(game.player.position,rules.chalk);if(near)this.chalkFlash(near,time,false);}this.lastPoints=points;}
    for(const drop of drops||[]){if(drop.used)continue;const p=[drop.position[0],drop.position[1],drop.position[2]+40],vulture=drop.type?.startsWith('vulture_');
      this.light(p,vulture?110:150,vulture?[.45,1,.55]:[.55,1,.6],(vulture?.35:.55)*(.85+.15*Math.sin(time*4+drop.position[0])),{priority:.6});}
  }
  pickup(drop,time){
    const p=[drop.position[0],drop.position[1],drop.position[2]+40],vulture=drop.type?.startsWith('vulture_'),c=vulture?new THREE.Color(.5,1,.55):new THREE.Color(.65,1,.7);
    this.emit('glow',1,()=>({p,time,life:.3,size0:20,size1:60,color:c.clone().multiplyScalar(.7)}));
    this.emit('mote',this.scaled(14,true),()=>({p:p.map(v=>v+rand(-6,6)),v:this.cone([0,0,1],1).map(v=>v*rand(40,120)),time,life:rand(.4,.8),drag:2.5,size0:rand(1,2),size1:.3,color:c,alpha:1,frame:Math.floor(Math.random()*4)}));
    this.light(p,200,c,1,{life:.3,priority:2,time});
  }
  nearestMachine(p){
    this.machines??=(this.manifest?.entities||[]).filter(e=>e.classname==='script_model'&&/vending|vultureaid/.test(e.model||'')).map(e=>({origin:e.origin.split(/\s+/).map(Number),model:e.model}));
    let best=null,bd=220*220;for(const m of this.machines){const d=(m.origin[0]-p[0])**2+(m.origin[1]-p[1])**2;if(d<bd){bd=d;best=m;}}return best;
  }
  perkFlash(m,time){
    const tint={jugg:[1,.35,.3],doubletap:[1,.85,.35],three_gun:[.4,1,.45],revive:[.45,.7,1],marathon:[1,.6,.25],sleight:[.4,1,.5],vulture:[.45,1,.55]},key=Object.keys(tint).find(k=>m.model.includes(k)),c=new THREE.Color(...(tint[key]||[1,.85,.6]));
    const p=[m.origin[0],m.origin[1],m.origin[2]+60];
    this.emit('star',2,i=>({p,time:time+i*.08,life:.35,size0:30,size1:70,color:c.clone().multiplyScalar(.7),rot:Math.random()*6,spin:rand(-2,2)}));
    this.emit('mote',this.scaled(18,true),()=>({p:p.map((v,k)=>k<2?v+rand(-20,20):v+rand(-40,30)),v:[rand(-30,30),rand(-30,30),rand(20,70)],time,life:rand(.7,1.2),drag:1.5,size0:rand(1,1.8),size1:.3,color:c,alpha:1,frame:Math.floor(Math.random()*4)}));
    this.light(p,240,c,1.2,{life:.6,priority:2,time});
  }
  chalkSpot(target){const e=(this.manifest?.entities||[]).find(x=>x.targetname===target);if(!e)return null;const a=(e.angles||'0 0 0').split(/\s+/).map(v=>Number(v)*Math.PI/180);return {p:e.origin.split(/\s+/).map(Number),n:[Math.cos(a[1]),Math.sin(a[1]),0]};}
  nearestChalk(p,chalk){let best=null,bd=100*100;for(const target of chalk.keys()){const s=this.chalkSpot(target);if(!s)continue;const d=(s.p[0]-p[0])**2+(s.p[1]-p[1])**2;if(d<bd){bd=d;best=target;}}return best;}
  chalkFlash(target,time,drawn){
    const s=this.chalkSpot(target);if(!s)return;const p=s.p.map((v,k)=>v+s.n[k]*2);
    this.emit('dust',this.scaled(drawn?10:5,true),()=>({p:p.map((v,k)=>v+(k<2?rand(-10,10):rand(-10,10))),v:s.n.map((v,k)=>v*rand(10,40)+(k===2?rand(-10,10):rand(-10,10))),time,life:rand(.6,1.1),drag:2.5,gravity:30,size0:rand(1.5,3),size1:rand(6,10),color:new THREE.Color(.95,.95,.92),alpha:.6}));
    this.emit('glow',1,()=>({p,time,life:drawn?.5:.3,size0:30,size1:46,color:new THREE.Color(.5,.5,.48)}));
    this.light(p,120,[1,.97,.9],drawn?.6:.45,{life:drawn?.5:.3,priority:1.5,time});
  }
  // ---------------------------------------------------------------- frame
  update(game,dt,time,{visibleCells,buriedView,drops}={}){
    if(!this.ready)return;
    const q=this.quality;
    if(game&&dt>0)this.ambient(game,time,dt,visibleCells);
    if(game&&game.phase!=='ready')this.interactables(game,time,{buriedView,drops});
    for(const pool of Object.values(this.pools))pool.update(time,this.scene.fog);
    if(this.halos){this.halos.uniforms.uTime.value=time;this.halos.uniforms.fogColor.value.copy(this.scene.fog.color);this.halos.uniforms.fogDensity.value=this.scene.fog.density;}
    if(this.shafts){this.shafts.mesh.visible=q.shafts;this.shafts.uniforms.uTime.value=time;this.shafts.uniforms.fogColor.value.copy(this.scene.fog.color);this.shafts.uniforms.fogDensity.value=this.scene.fog.density;}
    this.debris?.update(time,dt);this.decals?.update(time);
    this.flushLights(time);this.lastTime=time;
  }
  // Round restarts and new games: every pooled effect goes back to empty.
  reset(){
    for(const pool of Object.values(this.pools||{}))pool.clear();this.debris?.clear();this.decals?.clear();this.timers.length=0;this.lights.length=0;
    this.beamLevel=0;if(this.beam)this.beam.mesh.visible=false;this.bodyFx.clear();this.footContact.clear();
    polishLight.uniforms.wawDynCount.value=0;viewPolish.wawDynCount.value=0;
    for(const e of this.emitters||[])e.due=0;
    this.boxPhase=null;this.perkCount=null;this.chalkSeen=null;this.lastPoints=null;
  }
}
