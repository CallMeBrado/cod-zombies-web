// Black Ops' zombies menu backdrop: the frontend map (the interrogation room)
// seen from the chair, in zombie_frontend_menus.vision's red grade, with the
// TV wall playing the frontend cinematic's zombie footage (frontend.gsc:
// bink_monitor_zombies / bink_zombie_footage_select).
import * as THREE from 'three';
import {get,loadMap,model,cloneModel,shadeModel,film} from './assets.js';

// vision/zombie_frontend_menus.vision (r_film*).
const VISION={saturation:[.8807,.6456,.4070],darkTint:[.9996,.5299,.4596],midTint:[1.2,.765,.5798],lightTint:[1.1576,.9996,.7369],contrast:[1.5,1.5,1.5],midStart:.5,midEnd:.5,preExposure:.46,exposure:.95};
const vec=s=>String(s||'0 0 0').trim().split(/\s+/).map(Number);
function parseEntities(text){
  const out=[];let current=null;
  for(const line of text.split(/\r?\n/)){const t=line.trim();
    if(t==='{'){current={};continue;}if(t==='}'){if(current)out.push(current);current=null;continue;}
    const m=current&&t.match(/^"([^"]*)"\s+"([^"]*)"$/);if(m)current[m[1]]=m[2];}
  return out;
}
// The cinematic is an 8 x 8 atlas of 128-pixel tiles.
const tileRect=n=>new THREE.Vector4((n%8)/8,1-(Math.floor(n/8)+1)/8,1/8,1/8);
// bink_zombie_footage_select(): 10% the whole-wall picture (100: a random
// zombie tile here), 78% zombie footage (16-30), then bars, logo, Treyarch, static.
function footageTile(){
  const toss=Math.floor(Math.random()*100);
  if(toss<88)return 16+Math.floor(Math.random()*15);
  return toss<91?39:toss<94?47:toss<97?55:63;
}

export class Bo1Frontend {
  constructor({visible}){
    this.visible=visible;this.ready=false;this.monitors=[];this.clock=new THREE.Clock();
    const canvas=document.createElement('canvas');canvas.id='frontend-view';canvas.setAttribute('aria-hidden','true');document.body.prepend(canvas);this.canvas=canvas;
    this.renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.scene=new THREE.Scene();this.scene.background=new THREE.Color(0);
    this.camera=new THREE.PerspectiveCamera(50,1,1,6000);this.camera.up.set(0,0,1);
    addEventListener('resize',()=>this.resize());this.resize();
  }
  // cg_fov 65 is horizontal at 4:3 (about 50.5 degrees vertical); wider
  // screens see more at the sides.
  resize(){const w=innerWidth,h=innerHeight;this.renderer.setSize(w,h,false);this.camera.aspect=w/h;
    this.camera.fov=THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(THREE.MathUtils.degToRad(65)/2)*.75));this.camera.updateProjectionMatrix();}
  async load(menu){
    const world=menu.world;
    const [entities]=await Promise.all([get('/data/'+world.zone+'/maps/'+world.asset+'.d3dbsp.ents').then(b=>parseEntities(new TextDecoder().decode(b)))]);
    this.map=await loadMap(this.scene,()=>{},{zone:world.zone,asset:world.asset,vision:VISION});
    // The monitors' cinematic: one video, each screen showing its own tile.
    const video=document.createElement('video');Object.assign(video,{src:menu.monitors,muted:true,loop:true,playsInline:true,crossOrigin:'anonymous',preload:'auto'});
    this.video=video;video.play().catch(()=>{});
    const texture=new THREE.VideoTexture(video);texture.colorSpace=THREE.SRGBColorSpace;this.videoTexture=texture;
    const time={value:0};this.time=time;
    // The room's script models at their placement (the main room only; the
    // fake-player set below the floor and duplicate camera feeds stay hidden).
    const props=entities.filter(e=>e.classname==='script_model'&&e.model&&vec(e.origin)[2]>-20&&!/extracam|^fx_|viewmodel|projectile|weapon_/.test(e.model));
    await Promise.all(props.map(async e=>{
      let object;try{object=cloneModel(await model(e.model));}catch{return;}
      shadeModel(object,this.map.illumination(vec(e.origin)),VISION);
      const group=new THREE.Group(),a=vec(e.angles).map(THREE.MathUtils.degToRad);group.position.fromArray(vec(e.origin));group.rotation.set(a[2],-a[0],a[1],'ZYX');group.add(object);this.scene.add(group);
      if(/_bink$/.test(e.model))this.screen(object,texture,time,e);
    }));
    // Seated in interrogation_chair, facing the TV wall (monitor_01..09).
    const chair=entities.find(e=>e.targetname==='interrogation_chair'),wall=entities.filter(e=>/^monitor_0\d$/.test(e.targetname||''));
    const seat=vec(chair?.origin||'50.9 459.5 2'),target=wall.reduce((sum,e)=>sum.map((v,k)=>v+vec(e.origin)[k]/wall.length),[0,0,0]);
    this.eye=new THREE.Vector3(seat[0],seat[1],seat[2]+50);this.target=new THREE.Vector3(...target);this.target.z+=4;
    this.camera.position.copy(this.eye);this.camera.lookAt(this.target);
    // Monitors start in snow, then change footage every 0-15 s.
    for(const m of this.monitors)m.rect.value.copy(tileRect(63));
    this.nextFootage=1+Math.random()*2;this.ready=true;
    this.renderer.compile(this.scene,this.camera);
    requestAnimationFrame(()=>this.frame());
    document.body.classList.add('frontend-ready');
  }
  // sw4_3d_tv_bink: the screen shows a tile of the cinematic, bright, with
  // static (StaticAmount .2) and rolling scanlines (ScanlineIntensity .1).
  screen(object,texture,time,entity){
    object.traverse(mesh=>{if(!mesh.isMesh)return;
      const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material];
      materials.forEach((old,i)=>{if(!/bink/.test(old.name))return;
        // The screen's own UV range, remapped to one tile.
        const g=mesh.geometry,uv=g.attributes.uv,index=g.index,group=g.groups.find(x=>x.materialIndex===i)||{start:0,count:index?index.count:uv.count};
        let u0=Infinity,v0=Infinity,u1=-Infinity,v1=-Infinity;
        for(let k=group.start;k<group.start+group.count;k++){const v=index?index.getX(k):k;u0=Math.min(u0,uv.getX(v));u1=Math.max(u1,uv.getX(v));v0=Math.min(v0,uv.getY(v));v1=Math.max(v1,uv.getY(v));}
        const rect={value:tileRect(63)},range={value:new THREE.Vector4(u0,v0,Math.max(1e-4,u1-u0),Math.max(1e-4,v1-v0))};
        const mat=new THREE.MeshBasicMaterial({map:texture});mat.name='frontend screen';
        mat.onBeforeCompile=shader=>{
          Object.assign(shader.uniforms,{tileRect:rect,uvRange:range,tvTime:time});
          shader.fragmentShader='uniform vec4 tileRect,uvRange; uniform float tvTime;\nfloat tvHash(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}\n'+shader.fragmentShader.replace('#include <map_fragment>',`
            vec2 local=clamp((vMapUv-uvRange.xy)/uvRange.zw,0.,1.);local.y=1.-local.y;
            vec3 tv=texture2D(map,tileRect.xy+local*tileRect.zw).rgb*1.35;
            float noise=tvHash(floor(local*vec2(320.,240.))+fract(tvTime*7.13)*91.7);
            tv=mix(tv,vec3(noise)*.8,.07)+.05*pow(.5+.5*sin((local.y+tvTime*.667)*6.2832*24.),10.);
            diffuseColor.rgb=tv;`);
          // The vision grades the whole frame, the screens included.
          film(shader,VISION);
        };
        mat.customProgramCacheKey=()=>'frontend-screen';
        if(Array.isArray(mesh.material))mesh.material[i]=mat;else mesh.material=mat;
        this.monitors.push({rect,entity});
      });
    });
  }
  frame(){
    requestAnimationFrame(()=>this.frame());
    const dt=Math.min(.1,this.clock.getDelta());
    if(!this.ready||!this.visible()){if(this.canvas.style.visibility!=='hidden'){this.canvas.style.visibility='hidden';this.video?.pause();}return;}
    if(this.canvas.style.visibility==='hidden'){this.canvas.style.visibility='';this.video?.play().catch(()=>{});}
    this.time.value+=dt;
    // bink_zombie_footage_select(): every screen a different tile.
    if((this.nextFootage-=dt)<=0){this.nextFootage=Math.random()*15;const used=new Set();
      for(const m of this.monitors){let n=footageTile();for(let tries=0;used.has(n)&&tries<20;tries++)n=footageTile();used.add(n);m.rect.value.copy(tileRect(n));}}
    // player_camera_idle_drift: the seated view sways a little.
    const t=this.time.value;this.camera.position.set(this.eye.x+Math.sin(t*.31)*.6,this.eye.y+Math.sin(t*.23)*.5,this.eye.z+Math.sin(t*.41)*.4);
    this.camera.lookAt(this.target.x+Math.sin(t*.17)*3,this.target.y+Math.cos(t*.13)*2,this.target.z+Math.sin(t*.19)*2);
    this.map.updateVisibility?.(this.camera);
    this.renderer.render(this.scene,this.camera);
  }
}
