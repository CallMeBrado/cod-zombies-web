import * as THREE from 'three';
import {BulletTrace} from './bullet-trace.js';
import {SpacelandMovement} from './iw7-test-movement.js';
import {PauseKeys} from './pause-keys.js';
import {rigGeometry,nativeSkinMaterial} from './iw7-native.js';
import {SpacelandCombat,combatClips} from './iw7-combat.js';
import {SpacelandAudio} from './iw7-audio.js';
import {GamepadControls,GamepadSettings} from './gamepad.js';
import {ControllerAimAssist} from './controller-aim-assist.js';

const base='/data/gameplay/iw7-spaceland/',el=id=>document.getElementById(id),canvas=el('viewport');
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(75,innerWidth/innerHeight,3,16000);
camera.up.set(0,0,1);
const renderer=new THREE.WebGLRenderer({canvas,antialias:false,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setSize(innerWidth,innerHeight);
renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.6;
scene.background=new THREE.Color(0x060815);scene.fog=new THREE.FogExp2(0x0c1027,.000055);
scene.add(new THREE.HemisphereLight(0x91a4c7,0x605068,2.2));
const sunlight=new THREE.DirectionalLight(0x90bcff,.4);sunlight.position.set(-600,400,1000);scene.add(sunlight);
const trace=new BulletTrace(),meshes=[],keys=new Set(),frameTimes=[],pauseKeys=new PauseKeys();
let movement=null,manifest=null,loading=false,ready=false,playing=false,paused=false,yaw=-Math.PI/2,pitch=0,accumulator=0,last=performance.now(),frames=0,statsTime=0;
let totalBytes=0,loadedBytes=0,bytesTime=0,collisionCells=new Map(),wideEntries=[];
let combat=null,combatData=null,sounds=null,mouseAim=false,lights=[],lightClock=0;
const audio=new SpacelandAudio(),padSettings=new GamepadSettings(localStorage);
const controllerAimAssist=new ControllerAimAssist();
function controllerLook(x,y,stick={}){
  if(!combat||!playing||paused)return;
  const origin=camera.position.toArray(),adjusted=controllerAimAssist.adjust({yaw,pitch,yawDelta:x,pitchDelta:y,...stick,origin,targets:combat.match.enemies,ads:combat.aimBlend,
    active:pads.active&&!combat.match.over&&!combat.currentAction,enabled:padSettings.value.aimAssist,strength:padSettings.value.aimAssistStrength,
    visible:(from,to)=>{const d=to.map((v,k)=>v-from[k]),range=Math.hypot(...d);return !collision(from,d.map(v=>v/range),Math.max(0,range-8),true);}});
  yaw+=adjusted.yaw;pitch=THREE.MathUtils.clamp(pitch+adjusted.pitch,-1.5,1.5);
}
const pads=new GamepadControls(padSettings,{mode:()=>combat?.match.over?'over':playing&&!paused?'playing':paused?'paused':'menu',aimBlend:()=>combat?.aimBlend||0,look:controllerLook,action:action=>{if(action==='pause')pause();if(action==='fire')combat?.fire(pads.aiming);if(action==='melee')combat?.melee();if(action==='interact')combat?.interact();if(action==='nextWeapon')combat?.match.switchWeapon();if(action==='equipment')combat?.useCard();},menu:a=>{if(combat?.match.over){if(a==='confirm')el('restart').click();else if(a==='back')el('quit').click();return;}if(paused&&['pause','confirm','back'].includes(a))enter();else if(a==='confirm')el('start').click();},disconnect:()=>pause()});

function downloadProgress(bytes){loadedBytes+=bytes;const now=performance.now();if(now-bytesTime<80&&loadedBytes<totalBytes)return;bytesTime=now;el('progress').value=Math.min(1,loadedBytes/totalBytes);el('bytes').textContent=`${(loadedBytes/1048576).toFixed(1)} / ${(totalBytes/1048576).toFixed(1)} MiB loaded`;}
async function download(url){const response=await fetch(base+url);if(!response.ok)throw new Error(`Native asset unavailable: ${url}`);const reader=response.body.getReader(),parts=[];let size=0;for(;;){const {value,done}=await reader.read();if(done)break;parts.push(value);size+=value.byteLength;downloadProgress(value.byteLength);}const result=new Uint8Array(size);let at=0;for(const part of parts){result.set(part,at);at+=part.length;}return result.buffer;}
function geometry(buffer,definition){const h=new DataView(buffer);if(h.getUint32(0,true)!==0x47375749||h.getUint32(4,true)!==1)throw new Error('Invalid IW7 render geometry');const count=h.getUint32(8,true),indexCount=h.getUint32(12,true);if(buffer.byteLength!==16+count*32+indexCount*4)throw new Error('Truncated IW7 geometry');const g=new THREE.BufferGeometry(),vertices=new THREE.InterleavedBuffer(new Float32Array(buffer,16,count*8),8);g.setAttribute('position',new THREE.InterleavedBufferAttribute(vertices,3,0));g.setAttribute('uv',new THREE.InterleavedBufferAttribute(vertices,2,3));g.setAttribute('normal',new THREE.InterleavedBufferAttribute(vertices,3,5));g.setIndex(new THREE.BufferAttribute(new Uint32Array(buffer,16+count*32,indexCount),1));definition.groups.forEach((group,i)=>g.addGroup(group.start,group.count,i));g.computeBoundingBox();g.computeBoundingSphere();return g;}
function matrix(instance){const a=instance.axis,o=instance.origin,s=instance.scale;return new THREE.Matrix4().set(a[0]*s,a[3]*s,a[6]*s,o[0],a[1]*s,a[4]*s,a[7]*s,o[1],a[2]*s,a[5]*s,a[8]*s,o[2],0,0,0,1);}
function indexCollision(){collisionCells.clear();wideEntries=[];for(const entry of trace.entries){const box=entry.box,minX=Math.floor(box.min.x/256),maxX=Math.floor(box.max.x/256),minY=Math.floor(box.min.y/256),maxY=Math.floor(box.max.y/256);if((maxX-minX+1)*(maxY-minY+1)>256){wideEntries.push(entry);continue;}for(let x=minX;x<=maxX;x++)for(let y=minY;y<=maxY;y++){const k=`${x},${y}`;if(!collisionCells.has(k))collisionCells.set(k,[]);collisionCells.get(k).push(entry);}}}
function collision(origin,direction,range,bullet=false){const end=origin.map((v,i)=>v+direction[i]*range),list=new Set(wideEntries);for(let x=Math.floor(Math.min(origin[0],end[0])/256);x<=Math.floor(Math.max(origin[0],end[0])/256);x++)for(let y=Math.floor(Math.min(origin[1],end[1])/256);y<=Math.floor(Math.max(origin[1],end[1])/256);y++)for(const entry of collisionCells.get(`${x},${y}`)||[])list.add(entry);trace.entries=[...list];if(!bullet)return trace.trace(origin,direction,range);const hidden=[];for(const entry of trace.entries)for(const m of Array.isArray(entry.material)?entry.material:[entry.material])if(m.colorWrite===false||/window_board|barricade_board/i.test(m.name)){if(m.visible){m.visible=false;hidden.push(m);}}try{return trace.trace(origin,direction,range);}finally{for(const m of hidden)m.visible=true;}}

async function load(){
  el('load-message').textContent='Reading the native Spaceland asset manifest…';
  const response=await fetch(base+'manifest.json');if(!response.ok)throw new Error('Spaceland has not been extracted yet');manifest=await response.json();
  if(!manifest.chunks?.length||!manifest.spawns?.length)throw new Error('The Spaceland world is incomplete');
  const responses=await Promise.all(['combat.json','sounds.json'].map(url=>fetch(base+url)));if(responses.some(r=>!r.ok))throw new Error('Spaceland combat assets have not been prepared');[combatData,sounds]=await Promise.all(responses.map(r=>r.json()));
  combatData.selectedCharacter=el('character').value;const character=combatData.characters.find(c=>c.id===combatData.selectedCharacter)||combatData.characters[0];
  const rigNames=[...combatData.zombies,character.arms,combatData.weapon.model,combatData.rifle.model,combatData.wallWeapon.model,character.knife,'zmb_card_01'],rigDefs=rigNames.map(n=>combatData.rigs[n]),clipDefs=combatClips(character).map(n=>combatData.animations[n]);
  if(clipDefs.some(v=>!v))throw new Error('A required original combat animation is missing');
  const materialDefs={...manifest.materials,...combatData.materials};
  const definitions=[...manifest.chunks,...Object.values(manifest.models)],imageDefs=new Map();
  for(const m of Object.values(materialDefs))for(const t of [m.diffuse,m.emissive])if(t)imageDefs.set(t.url,t);
  for(const face of manifest.sky||[])imageDefs.set(face.url,face);
  const audioDefs=new Map(Object.values(sounds).flat().map(d=>[d.url,d]));
  totalBytes=[...definitions,...rigDefs,...clipDefs,...imageDefs.values(),...audioDefs.values()].reduce((sum,d)=>sum+d.bytes,0);loadedBytes=0;
  const geometryBuffers=new Map(),textures=new Map(),images=new Map(),tasks=[...[...definitions,...rigDefs,...clipDefs].map(d=>({kind:'geometry',definition:d})),...[...imageDefs.values()].map(d=>({kind:'image',definition:d}))];let next=0;
  el('load-message').textContent='Loading native map, prop meshes and textures…';
  async function worker(){while(next<tasks.length){const task=tasks[next++],d=task.definition,buffer=await download(d.url);if(task.kind==='geometry')geometryBuffers.set(d.url,buffer);else{const bitmap=await createImageBitmap(new Blob([buffer],{type:'image/png'}),{premultiplyAlpha:'none',colorSpaceConversion:'none'});images.set(d.url,bitmap);const texture=new THREE.Texture(bitmap);texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.colorSpace=THREE.SRGBColorSpace;texture.flipY=false;texture.needsUpdate=true;textures.set(d.url,texture);}}}
  await Promise.all(Array.from({length:6},()=>worker()));
  el('load-message').textContent='Preparing native map batches and temporary render collision…';
  await new Promise(resolve=>requestAnimationFrame(resolve));
  const materials=new Map();
  for(const [id,d] of Object.entries(materialDefs)){
    const tint=d.constants?.colorTint||[1,1,1],unlit=/unlit/.test(d.technique||'');
    const options={name:d.name,map:d.diffuse?textures.get(d.diffuse.url):null,color:new THREE.Color().setRGB(...tint.slice(0,3),THREE.LinearSRGBColorSpace),side:THREE.DoubleSide};
    if(!unlit&&d.emissive){options.emissive=0xffffff;options.emissiveMap=textures.get(d.emissive.url);options.emissiveIntensity=d.constants?.emissivePara?.[0]??1.8;}
    if(/foliage|leaf|leaves|chainlink|grate|fence.*mask/i.test(d.name)){options.alphaTest=.35;const texture=options.map;if(texture&&!texture.userData.alphaPixels){const bitmap=texture.image,surface=new OffscreenCanvas(bitmap.width,bitmap.height),context=surface.getContext('2d',{willReadFrequently:true});context.drawImage(bitmap,0,0);texture.userData.alphaPixels=context.getImageData(0,0,bitmap.width,bitmap.height).data;}}
    if(/_add/.test(d.technique||'')){options.transparent=true;options.depthWrite=false;options.blending=THREE.AdditiveBlending;}
    if(/_multiply/.test(d.technique||'')){options.transparent=true;options.depthWrite=false;options.blending=THREE.MultiplyBlending;options.premultipliedAlpha=true;options.toneMapped=false;options.fog=false;}
    else if(/_blend/.test(d.technique||'')){options.transparent=true;options.depthWrite=false;}
    const material=unlit?new THREE.MeshBasicMaterial(options):new THREE.MeshLambertMaterial(options);
    if(d.technique==='w_sky')material.visible=false;
    // Native collision proxy surfaces must never appear as white geometry.
    // Keep them available to the temporary trace-based movement collider.
    if(/(?:^|\/)(?:model_)?nodraw/.test(d.name)){material.colorWrite=false;material.depthWrite=false;}
    materials.set(id,material);
  }
  let n=0;for(const d of manifest.chunks){const g=geometry(geometryBuffers.get(d.url),d),m=d.groups.map(v=>materials.get(v.material)),mesh=new THREE.Mesh(g,m);scene.add(mesh);meshes.push(mesh);trace.addMesh(mesh);if(++n%30===0)await new Promise(resolve=>requestAnimationFrame(resolve));}
  const groups=new Map();for(const instance of manifest.static){const k=`${instance.model}:${Math.floor(instance.origin[0]/1024)},${Math.floor(instance.origin[1]/1024)}`;if(!groups.has(k))groups.set(k,[]);groups.get(k).push(instance);}
  const modelGeometry=new Map();for(const [id,d] of Object.entries(manifest.models))modelGeometry.set(id,geometry(geometryBuffers.get(d.url),d));
  for(const instances of groups.values()){const id=instances[0].model,d=manifest.models[id],g=modelGeometry.get(id),m=d.groups.map(v=>materials.get(v.material)),mesh=new THREE.InstancedMesh(g,m,instances.length);instances.forEach((instance,i)=>{const transform=matrix(instance);mesh.setMatrixAt(i,transform);trace.addGeometry(g,m,transform);});mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingBox();mesh.computeBoundingSphere();scene.add(mesh);meshes.push(mesh);if(++n%60===0)await new Promise(resolve=>requestAnimationFrame(resolve));}
  indexCollision();
  // The original BC6H sky is linear HDR. Its PNG preview retains linear values;
  // treating those bytes as sRGB darkens the sky a second time.
  if(manifest.sky?.length===6){const cube=new THREE.CubeTexture(manifest.sky.map(face=>images.get(face.url)));cube.colorSpace=THREE.LinearSRGBColorSpace;cube.needsUpdate=true;scene.background=cube;scene.backgroundRotation.set(Math.PI/2,0,0);}
  movement=new SpacelandMovement(collision,manifest.spawns[0].origin);yaw=manifest.spawns[0].angles[1]*Math.PI/180;movement.step(1/120);updateCamera();
  el('load-message').textContent='Preparing original animations, sound and zombie navigation…';
  const rigGeometries=new Map(rigDefs.map(d=>[d.name,rigGeometry(geometryBuffers.get(d.url),d)])),skinMaterials=new Map([...materials].map(([id,m])=>[id,nativeSkinMaterial(m)])),clips=new Map(clipDefs.map(d=>[d.name,JSON.parse(new TextDecoder().decode(geometryBuffers.get(d.url)))]));
  await audio.load(sounds,download);
  combat=new SpacelandCombat({data:combatData,geometries:rigGeometries,materials:skinMaterials,clips,scene,camera,movement,collision,wallTrace:(o,d,r)=>collision(o,d,r,true),audio,hud:{score:updateScore,update:updateHud},gameOver:gameOver});
  await combat.prepare();
  // Native primary lights provide the colored park illumination. Reuse a small
  // nearby set instead of adding all 1,035 lights to every shader.
  lights=Array.from({length:8},()=>{const light=new THREE.PointLight(0xffffff,0,300,2);scene.add(light);return light;});updateLights();
  el('load-message').textContent='Preparing the first frame…';for(const a of combat.pool)a.root.visible=true;for(const g of combat.guns.values())g.root.visible=true;combat.card.root.visible=true;combat.knifeModel.root.visible=true;
  await renderer.compileAsync(scene,camera);await renderer.compileAsync(combat.viewScene,combat.viewCamera);
  for(const a of combat.pool)a.root.visible=false;for(const g of combat.guns.values())g.root.visible=false;combat.card.root.visible=false;combat.knifeModel.root.visible=false;renderer.render(scene,camera);scene.matrixWorldAutoUpdate=false;
  ready=true;el('progress').value=1;el('load-message').textContent='Spaceland is ready.';el('skip').disabled=false;el('skip').textContent='START GAME';
  window.spacelandTest={renderer,scene,camera,manifest,movement,collision,combat,frameTimes,meshes,pads,aimAt(p){const dx=p[0]-camera.position.x,dy=p[1]-camera.position.y,dz=p[2]-camera.position.z;yaw=Math.atan2(dy,dx);pitch=THREE.MathUtils.clamp(Math.atan2(dz,Math.hypot(dx,dy)),-1.5,1.5);updateCamera();},get ready(){return ready;},get playing(){return playing;},get paused(){return paused;},get loadedBytes(){return loadedBytes;},get totalBytes(){return totalBytes;}};
  if(el('intro').ended)enter(false);
}
function updateCamera(){if(!movement)return;const p=movement.position;camera.position.set(p[0],p[1],p[2]+60);camera.lookAt(p[0]+Math.cos(yaw)*Math.cos(pitch),p[1]+Math.sin(yaw)*Math.cos(pitch),p[2]+60+Math.sin(pitch));}
function pause(){if(!playing||paused||combat?.match.over)return;paused=true;keys.clear();mouseAim=false;pads.suppressHeld();audio.pause();el('pause').hidden=false;if(document.pointerLockElement)document.exitPointerLock();}
function enter(lock=true){if(!ready)return;el('intro').pause();el('loading').hidden=true;el('menu').hidden=true;el('pause').hidden=true;el('hud').hidden=false;playing=true;paused=false;keys.clear();pads.suppressHeld();audio.resume();combat.start();accumulator=0;last=performance.now();canvas.focus();if(lock&&pauseKeys.canCaptureMouse&&!pads.active)canvas.requestPointerLock()?.catch(()=>{});}
el('start').addEventListener('click',async()=>{await audio.unlock();if(loading){if(ready){if(combat.match.over)combat.reset();enter();}return;}loading=true;el('menu').hidden=true;el('character').disabled=true;el('loading').hidden=false;el('intro').src='/data/launch/spaceland.mp4';el('intro').volume=.5;el('intro').play().catch(()=>{});try{await load();}catch(error){console.error(error);el('load-message').textContent=error.message;el('skip').textContent='RETRY';el('skip').disabled=false;el('skip').onclick=()=>location.reload();}});
el('skip').addEventListener('click',()=>enter());el('intro').addEventListener('ended',()=>{if(ready)enter(false);});el('resume').addEventListener('click',()=>enter());el('reset').addEventListener('click',()=>{combat.reset();pitch=0;yaw=manifest.spawns[0].angles[1]*Math.PI/180;enter();});el('quit').addEventListener('click',()=>{playing=false;paused=false;keys.clear();audio.stop();combat.reset();combat.started=false;if(document.pointerLockElement)document.exitPointerLock();el('pause').hidden=true;el('game-over').hidden=true;el('hud').hidden=true;el('menu').hidden=false;el('start').textContent='START GAME';});
canvas.addEventListener('click',()=>{if(playing&&!paused)canvas.requestPointerLock()?.catch(()=>{});});
document.addEventListener('pointerlockchange',()=>{if(!document.pointerLockElement&&playing&&!paused){pauseKeys.nativePause();pause();}});
document.addEventListener('mousemove',event=>{if(document.pointerLockElement===canvas&&playing&&!paused){yaw-=event.movementX*.002;pitch=THREE.MathUtils.clamp(pitch-event.movementY*.002,-1.5,1.5);}});
canvas.addEventListener('contextmenu',event=>event.preventDefault());document.addEventListener('mousedown',event=>{if(!playing||paused||combat.match.over||document.pointerLockElement!==canvas)return;pads.useKeyboard();if(event.button===2)mouseAim=true;if(event.button===0)combat.fire(mouseAim);});document.addEventListener('mouseup',event=>{if(event.button===2)mouseAim=false;});
document.addEventListener('keydown',event=>{if(event.code==='Escape'){if(playing){event.preventDefault();if(!pauseKeys.down(event.repeat))return;if(paused)enter();else pause();}return;}if(!playing||paused||combat.match.over)return;pads.useKeyboard();if(['KeyW','KeyA','KeyS','KeyD','Space','ShiftLeft','ShiftRight','KeyV','KeyQ','KeyE','KeyR','KeyF','KeyC','Home','Digit1','Digit2'].includes(event.code)){event.preventDefault();keys.add(event.code);}if(event.repeat)return;if(event.code==='KeyV')movement.noclip=!movement.noclip;if(event.code==='KeyR')combat.match.reloadWeapon();if(event.code==='KeyF')combat.melee();if(event.code==='KeyE')combat.interact();if(event.code==='KeyC')combat.useCard();if(['Digit1','Digit2'].includes(event.code))combat.match.switchWeapon();if(event.code==='Home')movement.reset();});
document.addEventListener('keyup',event=>{keys.delete(event.code);if(event.code==='Escape')pauseKeys.up();});window.addEventListener('blur',()=>{keys.clear();pauseKeys.reset();pause();});
window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();if(combat){combat.viewCamera.aspect=camera.aspect;combat.viewCamera.updateProjectionMatrix();}renderer.setSize(innerWidth,innerHeight);});
document.addEventListener('visibilitychange',()=>{if(document.hidden){keys.clear();pause();}});
function updateLights(){if(!combatData)return;const p=camera.position,near=combatData.lights.map(d=>({d,score:Math.hypot(d.origin[0]-p.x,d.origin[1]-p.y,d.origin[2]-p.z)/d.radius})).filter(v=>v.score<2).sort((a,b)=>a.score-b.score).slice(0,lights.length);lights.forEach((light,i)=>{const d=near[i]?.d;if(!d){light.intensity=0;return;}const peak=Math.max(...d.color);light.position.fromArray(d.origin);light.color.setRGB(d.color[0]/peak,d.color[1]/peak,d.color[2]/peak,THREE.LinearSRGBColorSpace);light.intensity=peak*1.8;light.distance=d.radius;light.updateMatrixWorld(true);});}
function updateScore(amount){const popup=document.createElement('span');popup.className='points-change';popup.textContent=amount>0?'+'+amount:String(amount);el('score-popups').append(popup);setTimeout(()=>popup.remove(),900);}
function updateHud(game){const m=game.match;el('round').textContent=m.round||1;el('round').classList.toggle('between',m.phase==='intermission');el('round').style.color=game.roundFlash>0?'#fff':'#ed459e';el('points').textContent='$ '+m.points;el('ammo').textContent=m.weapon.clip+' / '+m.weapon.reserve;el('weapon').textContent=m.weapon.definition.name;el('health').value=m.health/m.maxHealth;el('damage').style.opacity=String(game.damageFlash);el('hitmarker').style.opacity=game.hitMarker>0?'1':'0';el('crosshair').style.opacity=String(1-game.aimBlend);el('crosshair').style.transform=`translate(-50%,-50%) scale(${keys.size?1.35:1})`;const buy=combat.nearWallBuy();el('prompt').textContent=buy?`${pads.active?pads.label('interact'):'E'} · M1 $500 / ammo $250`:m.reload?'RELOADING':m.phase==='intro'?game.character.name.toUpperCase():m.phase==='intermission'?`SCENE ${m.round+1} IN ${Math.ceil(m.timer)}`:'';el('help').textContent=pads.active?`${pads.label('fire')} Fire · ${pads.label('aim')} Aim · ${pads.label('interact')} Use / reload · ${pads.label('melee')} Knife · ${pads.label('equipment')} Cards`:'R reload · E use / M1 wall buy · F knife · C cards · 1 / 2 switch · Esc pause';}
function gameOver(match){keys.clear();mouseAim=false;audio.stop();el('game-over').hidden=false;el('result').textContent=`SCENE ${match.round} · ${match.kills} KILLS · ${match.headshots} HEADSHOTS`;if(document.pointerLockElement)document.exitPointerLock();}
el('restart').addEventListener('click',()=>{el('game-over').hidden=true;combat.reset();pitch=0;yaw=manifest.spawns[0].angles[1]*Math.PI/180;enter();});
function frame(now){requestAnimationFrame(frame);const delta=Math.min(.1,(now-last)/1000);last=now;pads.poll(delta);if(!playing||paused||!pads.active)controllerAimAssist.reset();if(!playing||paused||combat.match.over)return;const began=performance.now(),pad=pads.input(),aim=pads.active?pads.aiming:mouseAim,forward=pads.active?pad.forward:Number(keys.has('KeyW'))-Number(keys.has('KeyS')),right=pads.active?pad.side:Number(keys.has('KeyD'))-Number(keys.has('KeyA')),sprint=(pads.active?pad.sprint:keys.has('ShiftLeft')||keys.has('ShiftRight'))&&!aim&&!combat.match.reload&&!combat.match.melee&&!combat.currentAction;
  accumulator+=delta;while(accumulator>=1/120){movement.step(1/120,{forward,right,yaw,sprint,jump:pads.active?pad.jump:keys.has('Space'),vertical:Number(keys.has('KeyE'))-Number(keys.has('KeyQ'))});accumulator-=1/120;}updateCamera();combat.update(delta,{aim,sprint,moving:Math.abs(forward)+Math.abs(right)>.01});camera.fov=75-combat.aimBlend*20;camera.updateProjectionMatrix();lightClock+=delta;if(lightClock>.3){lightClock=0;updateLights();}for(const mesh of meshes){const sphere=mesh.boundingSphere||mesh.geometry.boundingSphere;mesh.visible=sphere.center.distanceTo(camera.position)-sphere.radius<2400;}renderer.render(scene,camera);combat.render(renderer);const cpu=performance.now()-began;frameTimes.push({frame:delta*1000,cpu});if(frameTimes.length>240)frameTimes.shift();frames++;statsTime+=delta;if(statsTime>=.5){el('mode').textContent=movement.noclip?'FREE CAMERA':'ZOMBIES IN SPACELAND';el('stats').textContent=`${Math.round(frames/statsTime)} FPS · ${cpu.toFixed(1)} ms CPU`;frames=0;statsTime=0;}}
requestAnimationFrame(frame);
