import * as THREE from 'three';
import { get,loadMap,model,cloneModel,originalAnimation,OriginalAudio,shadeModel } from './assets.js';
import { CollisionWorld } from './collision.js';
import {TestingGame,TestingMenu} from './testing.js';
import { WeaponView } from './weapon-view.js';
import { OriginalHud } from './hud.js';
import {preloadAssets,preloadState} from './preload.js';
import {ZombieActors} from './actors.js';
import {OriginalEffects} from './effects.js';
import {createPickupView,updatePickupView,createBoxView,updateBoxView} from './presentation-view.js';
import {MouseControls} from './mouse-controls.js';
import {CombatEffects} from './combat-effects.js';
import {GameSettings,GameInput,bindingName} from './settings.js';
import {PauseMenu} from './pause-menu.js';
import {GrenadeView} from './grenade-view.js';
import {selectedMap} from './maps.js';
import {ZombiesLobby} from './lobby.js';
const mapChoice=selectedMap();

const $=id=>document.getElementById(id);
const canvas=$('viewport'),scene=new THREE.Scene();scene.background=new THREE.Color(0x10171c);scene.fog=new THREE.FogExp2(0x26313a,.00022);
scene.add(new THREE.AmbientLight(0xa8bac9,.2));
let storage;try{storage=localStorage;}catch{}
const settings=new GameSettings(storage);
const worldFov=value=>THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(THREE.MathUtils.degToRad(value)/2)*.75));
let baseFov=worldFov(settings.value.fov);
const camera=new THREE.PerspectiveCamera(baseFov,innerWidth/innerHeight,1,18000);camera.up.set(0,0,1);
const renderer=new THREE.WebGLRenderer({canvas,antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.info.autoReset=false;renderer.setPixelRatio(Math.min(devicePixelRatio,1.5)*settings.value.renderScale/100);
const viewScene=new THREE.Scene();
const viewCamera=new THREE.PerspectiveCamera(worldFov(65),innerWidth/innerHeight,.1,300);
const hud=new OriginalHud($('hud-art')),raycaster=new THREE.Raycaster(),combatEffects=new CombatEffects(scene);
const visuals=new Map(),dynamic=new Map(),dropVisuals=new Map();
const state={ready:false,mode:'menu',inputMode:'idle',yaw:Math.PI,pitch:0,loading:'map',fps:0,error:null};
let game,audio,map,weaponView,grenadeView,actors,effects,presentation;
const dropTemplates=new Map(),boxTemplates=new Map(),boxVisuals=new Map(),bursts=[];
let hudDue=0,domDue=0;const frameSamples=[];
let frameTime=performance.now(),fpsTime=frameTime,frames=0,kickPitch=0,kickYaw=0,damageFlash=0,hitTime=0,noticeDue=0,aimBlend=0,paused=true,lastLight=0;
let deathFxTime=0,frameMsTotal=0;
const loops=new Map();let papView=null,shake=null;
const controls=new GameInput(settings,action=>{
  if(action==='pause'){menu('Paused',mapChoice.title);return;}
  ({reload:()=>game.reload(),melee:()=>{if(controls.aiming)openMods();else game.melee();},use:()=>game.use(),grenade:()=>game.throwGrenade(true),nextWeapon:()=>game.switchWeapon(),fire:()=>game.fire(),lookLeft:()=>state.yaw+=.08,lookRight:()=>state.yaw-=.08,lookUp:()=>state.pitch=Math.min(1.45,state.pitch+.06),lookDown:()=>state.pitch=Math.max(-1.45,state.pitch-.06)})[action]?.();
},action=>{if(action==='grenade'&&state.mode==='playing')game.releaseGrenade();});
const mouse=new MouseControls(canvas,document,{mode:()=>({playing:state.mode==='playing',inputMode:state.inputMode,aiming:controls.toggledAim||settings.value.aimMode==='hold'&&settings.value.bindings.aim.some(t=>t&&!t.startsWith('Mouse')&&controls.tokens.has(t))}),buttons:b=>settings.mouseActions(b),fire:()=>game.fire()});
const pauseMenu=new PauseMenu(settings,{save:saveGame,resumeSave,savedGame,resume:enterPlay,restart:()=>{game.newGame();resetVisuals();enterPlay();},quit:()=>{game.newGame();resetVisuals();menu(mapChoice.title,'Solo Zombies');}});
const lobby=new ZombiesLobby(pauseMenu);
const testingMenu=new TestingMenu(pauseMenu,()=>state.ready?game:null);
canvas.setAttribute('aria-label',mapChoice.title+' Zombies game');document.title='WaW Zombies - '+mapChoice.title;
settings.subscribe(value=>{baseFov=worldFov(value.fov);renderer.setPixelRatio(Math.min(devicePixelRatio,1.5)*value.renderScale/100);renderer.setSize(innerWidth,innerHeight);if(audio)audio.volume=value.volume;controls.reset();mouse.reset();inputHint();});
const nodePos=e=>e.origin.split(/\s+/).map(Number);

function notice(text){$('notice').textContent=text;noticeDue=performance.now()+3500;}
function cameraPose() {
  const p=game?game.renderPosition(game.player):[0,424,17];camera.position.set(p[0],p[1],p[2]+60);
  const yaw=state.yaw+kickYaw,pitch=THREE.MathUtils.clamp(state.pitch+kickPitch,-1.45,1.45);
  camera.lookAt(camera.position.clone().add(new THREE.Vector3(Math.cos(yaw)*Math.cos(pitch),Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch))));
  game?.aim(yaw,pitch);
}
function menu(title,description,button='Resume game') {
  paused=true;state.mode='menu';controls.reset();mouse.reset();document.body.classList.remove('playing');
  audio?.suspend();
  $('menu-copy').textContent=game&&game.phase!=='ready'?'Round '+(game.round||1)+' · '+game.player.kills+' kills':description;
  pauseMenu.setContext(game&&game.phase!=='ready'?'pause':'start');
  if(document.pointerLockElement)document.exitPointerLock();
}
// One save slot per browser (localStorage), shared by both maps.
function saveKey(){return 'waw-zombies-save-v1';}
function savedGame(){try{const save=JSON.parse(storage?.getItem(saveKey())||'null');return save?.state?.version===1?save:null;}catch{return null;}}
function saveSummary(save=savedGame()){return save?`Saved game: ${save.title}, round ${save.state.resumeRound}.`:'';}
function saveGame(){
  if(!game?.canSave()){$('message').textContent='Finish drinking, collect your Pack-a-Punch weapon or throw your grenade, then save.';return;}
  const state=game.saveState(),save={map:mapChoice.id,title:mapChoice.title,savedAt:Date.now(),state};
  try{if(!storage)throw new Error('unavailable');storage.setItem(saveKey(),JSON.stringify(save));$('message').textContent='Game saved. '+saveSummary(save)+' Resume it from the main menu.';}
  catch{$('message').textContent='This browser blocked saving the game.';}
}
function resumeSave(){
  const save=savedGame();if(!save||!state.ready||state.mode==='starting')return;
  if(save.map!==mapChoice.id){const url=new URL(location.href);url.searchParams.set('map',save.map);location.assign(url.href);return;}
  // Synchronous from the click, so enterPlay can still capture the mouse.
  game.loadState(save.state);state.yaw=save.state.yaw;state.pitch=save.state.pitch;cameraPose();enterPlay();
}
function keyName(action){return bindingName(settings.value.bindings[action].find(Boolean));}
function openMods(){if(state.mode!=='playing')return;menu('Paused',mapChoice.title);testingMenu.sync();pauseMenu.show('mods');}
function inputHint(){const fire=settings.value.bindings.fire.filter(Boolean).map(bindingName).join(' / ')||'UNBOUND';$('input-mode').textContent=(state.inputMode==='locked'?'Mouse to look':state.inputMode==='drag'?(state.lockUnsupported?'Drag to look':'Click to capture mouse'):'Mouse capture where supported')+' · '+fire+' fire';}
function enableDrag(){if(state.mode==='menu'||state.mode==='dead')return;state.inputMode='drag';canvas.focus();inputHint();}
// Browsers refuse capture requested from Esc (closing the mods/pause menu) and
// briefly after the cursor was released. Only a refused click well after that
// means capture is unavailable (embedded previews); then drag-to-look stays.
function requestMouse(source){state.lockSource=source;try{const result=canvas.requestPointerLock();if(result?.catch)result.catch(lockRefused);}catch{lockRefused();}}
function lockRefused(){if(state.lockSource==='click'&&performance.now()-(state.lockLostAt||-Infinity)>1500)state.lockUnsupported=true;enableDrag();}
async function enterPlay() {
  if(state.mode==='starting')return;
  paused=true;state.mode='starting';$('play').disabled=true;controls.reset();mouse.reset();canvas.focus();
  const soundReady=audio.start();
  requestMouse('resume');
  try{
    await soundReady;paused=false;state.mode='playing';document.body.classList.add('playing');game.start();
    if(game.pendingGrenade?.cooking&&!settings.held('grenade',controls.tokens))game.releaseGrenade();
  }catch(error){console.error(error);state.error=error.message;menu('Unable to start audio',error.message,'Try again');}
  finally{$('play').disabled=false;}
}
function death(stats) {
  state.mode='dead';paused=true;controls.reset();mouse.reset();
  audio?.stopSession(true);deathFxTime=0;grenadeView?.reset();
  $('menu-copy').textContent=`Reached round ${stats.round} · ${stats.kills} kills · ${game.player.headshots} headshots · ${stats.points} points. Take another run at ${mapChoice.title}.`;
  pauseMenu.setContext('dead');document.body.classList.remove('playing');
  if(document.pointerLockElement)document.exitPointerLock();
}
async function loadGun(weapon) {
  if(!weaponView||!game)return;await weaponView.load(weapon,map.illumination(game.player.position));
}
function spawnVisual(enemy){actors.acquire(enemy);}
function barrier(w) {
  const meshes=dynamic.get(w.target)||[];let board=0;
  for(const item of meshes)if(item.entity.script_noteworthy!=='clip')item.object.visible=board++<w.boards;
}
function factoryVisuals(){
  if(mapChoice.id!=='der-riese')return;const powered=!!game?.mapRules?.power;
  for(const [target,angle]of [['wnuen_bridge',Math.PI/2],['warehouse_bridge',-Math.PI/2]])for(const item of dynamic.get(target)||[])item.object.rotation.y=powered?0:angle;
  for(const item of dynamic.get('power_switch')||[])item.object.rotation.y=powered?0:-Math.PI/2;
}
function open(e) {
  const targets=e.target.includes('upstairs')?['upstairs_blocker','upstairs_blocker2']:[e.target];
  for(const target of targets)for(const item of dynamic.get(target)||[])item.object.visible=false;
}
async function dynamicAssets(entities) {
  for(const entity of entities) {
    if(entity.script_noteworthy==='clip')continue;
    let object;
    if(entity.classname==='script_brushmodel'&&entity.model?.startsWith('*'))object=map.brushMeshes.get(Number(entity.model.slice(1)));
    else if(entity.classname==='script_model')try{object=cloneModel(await model(entity.model));}catch(e){console.warn(e.message);}
    if(!object)continue;
    const group=new THREE.Group();group.position.fromArray(nodePos(entity));
    if(entity.classname==='script_model')shadeModel(object,map.illumination(nodePos(entity)));
    const angles=(entity.angles||'0 0 0').split(/\s+/).map(x=>Number(x)*Math.PI/180);group.rotation.set(angles[2],-angles[0],angles[1],'ZYX');group.add(object);scene.add(group);
    if(entity.targetname){if(!dynamic.has(entity.targetname))dynamic.set(entity.targetname,[]);dynamic.get(entity.targetname).push({object:group,entity});}
  }
}
function resetVisuals() {
  actors?.reset();
  for(const item of dynamic.values())for(const v of item)v.object.visible=true;
  for(const v of dropVisuals.values()){effects.dispose(v.glow);scene.remove(v.root);}dropVisuals.clear();
  for(const b of boxVisuals.values()){b.weaponRoot.visible=false;b.glow.visible=false;b.lid.object.quaternion.copy(b.closed);}
  for(const burst of bursts)effects.dispose(burst.root);bursts.length=0;
  combatEffects.reset();
  deathFxTime=0;
  grenadeView?.reset();
  state.yaw=game?.data.map?Number(game.entities.find(e=>e.targetname==='initial_spawn_points').angles.split(' ')[1])*Math.PI/180:Math.PI;state.pitch=0;factoryVisuals();kickPitch=0;kickYaw=0;damageFlash=0;controls.reset();aimBlend=0;mouse.reset();lastLight=-1;cameraPose();
}
function traceEnemy(origin,direction,max) {
  raycaster.set(new THREE.Vector3(...origin),new THREE.Vector3(...direction));raycaster.far=max;
  let best=null;
  for(const v of visuals.values()) {
    if(v.enemy.dead)continue;
    const p=v.enemy.position,center=new THREE.Vector3(p[0],p[1],p[2]+38);
    if(raycaster.ray.distanceSqToPoint(center)>96*96||center.clone().sub(raycaster.ray.origin).dot(raycaster.ray.direction)>max+96)continue;
    if(v.traceTick!==game.physicsTicks){v.root.position.fromArray(p);v.root.rotation.z=v.enemy.angle;v.root.updateMatrixWorld(true);
      v.traceTick=game.physicsTicks;
    }
    const hit=v.trace.trace(raycaster.ray,best?.distance||max,game.physicsTicks);
    if(hit&&(!best||hit.distance<best.distance))best={enemy:v.enemy,head:!!hit.object.userData.zombieHead,distance:hit.distance};
  }
  return best;
}
function shot(ray) {
  const d=game.weapon.definition,prefix=aimBlend>.8?'ads':'hip';
  const range=(a,b)=>a+(b-a)*Math.random();
  // Kick values are impulses; the view settles between shots.
  kickPitch+=THREE.MathUtils.degToRad(range(d[prefix+'ViewKickPitchMin'],d[prefix+'ViewKickPitchMax'])*.028);
  kickYaw+=THREE.MathUtils.degToRad(range(d[prefix+'ViewKickYawMin'],d[prefix+'ViewKickYawMax'])*.015);
  weaponView.shot(aimBlend);
  for(const r of ray.rays||[ray]){
    if(!r.hit&&!r.wall)continue;
    combatEffects.impact(r,game.time);
  }
}
function makeDrop(drop) {
  drop.spawned=game.time;drop.expires=game.time+26.5;
  const v=createPickupView(drop,dropTemplates.get(drop.type),effects,game.time);scene.add(v.root);dropVisuals.set(drop,v);audio.play('spawn_powerup');
}
function pickupVisual(drop){
  const root=effects.create('misc/fx_zombie_powerup_grab',game.time);root.position.fromArray(drop.position);root.position.z+=40;scene.add(root);bursts.push({root,due:game.time+1});
}
function updateDrop(drop,v){
  updatePickupView(drop,v,game.time,effects);
}
async function prepareBox(manifest){
  for(const [name,d]of Object.entries(manifest.weapons)){const object=cloneModel(await model(d.worldModel));shadeModel(object,[.7,.7,.7]);boxTemplates.set(name,object);}
  for(const e of manifest.entities.filter(e=>e.targetname==='treasure_chest_use')){
    const lid=dynamic.get(e.target)?.[0],origin=manifest.entities.find(x=>x.targetname===lid?.entity.target);if(!lid||!origin)throw new Error('Original mystery box lid/spawn missing.');
    const v=createBoxView(lid,origin,boxTemplates,effects);scene.add(v.weaponRoot,v.glow);boxVisuals.set(e.target,v);
  }
}
function updateBoxes(){
  for(const [target,v]of boxVisuals)updateBoxView(v,game.boxes.get(target),game.time,presentation.box,effects);
}
function preparePap(manifest){
  const trigger=manifest.entities.find(e=>e.targetname==='zombie_vending_upgrade');if(!trigger)return;
  const machine=manifest.entities.find(e=>e.targetname===trigger.target),flag=machine?.target&&dynamic.get(machine.target)?.[0];
  const root=new THREE.Group();root.visible=false;scene.add(root);
  papView={root,models:new Map(),flag,flagPitch:flag?Number((flag.entity.angles||'0 0 0').split(/\s+/)[0]):0};
}
// third_person_weapon_upgrade: the gun turns side-on (angles+90, where angles
// is already the machine yaw+90) over 0.35 s, rolls
// in (0.5-1.0 s, gone at 0.85 s), the upgraded gun rolls out at 3.85 s, then
// slides back in over the 15 s timeout. The "please wait" flag flips meanwhile.
function updatePap(){
  if(!papView)return;const pap=game.mapRules?.pap,v=papView;
  const smooth=(x,a,b)=>THREE.MathUtils.smoothstep(x,a,b),lerp=(a,b,t)=>a.map((x,i)=>x+(b[i]-x)*t);
  let flip=0,name=null,at=null,yaw=0;
  if(pap){
    const t=game.time-pap.started,r=THREE.MathUtils.degToRad(pap.yaw),interact=[pap.origin[0]-Math.cos(r)*25,pap.origin[1]-Math.sin(r)*25,pap.origin[2]];
    flip=t<3.85?smooth(t,.5,.75):1-smooth(t,3.85,4.1);
    if(t<.85){name=pap.weapon;at=lerp(interact,pap.origin,THREE.MathUtils.clamp((t-.5)/.5,0,1));
      const turn=THREE.MathUtils.clamp(t/.35,0,1),delta=((pap.yaw+90-pap.playerYaw)%360+540)%360-180;yaw=pap.playerYaw+delta*turn;}
    else if(t>=3.85){name=pap.upgraded;yaw=pap.yaw+90;
      at=pap.phase==='ready'?lerp(interact,pap.origin,THREE.MathUtils.clamp((game.time-pap.readyAt)/15,0,1)):lerp(pap.origin,interact,THREE.MathUtils.clamp((t-3.85)/.5,0,1));}
  }
  if(v.flag)v.flag.object.rotation.y=-THREE.MathUtils.degToRad(v.flagPitch+179*flip);
  if(name&&!v.models.has(name)&&boxTemplates.has(name)){const object=cloneModel(boxTemplates.get(name));v.root.add(object);v.models.set(name,object);}
  v.root.visible=!!(name&&at);for(const [key,object]of v.models)object.visible=key===name;
  if(at){v.root.position.fromArray(at);v.root.rotation.set(0,0,THREE.MathUtils.degToRad(yaw));}
}
// perk_give_bottle_* / knuckle crack: show the viewmodel-only rig for its
// raise (drink) and drop, then raise the gun the player returns to.
function gesture(e){
  if(e.phase==='raise'){
    const d=e.definition;
    weaponView.load({name:d.name,definition:d,clip:1},map.illumination(game.player.position)).then(()=>{
      if(game.gesture?.key===e.key&&game.gesture.phase==='raise')weaponView.play(d.firstRaiseAnim,Math.max(.1,game.gesture.due-game.time),false,true);
    }).catch(console.error);
  }else if(e.phase==='drop')weaponView.play(e.definition.dropAnim,e.duration,false,true);
  else loadGun(game.weapon).then(()=>{const raise=game.weapon.definition.raiseAnim;if(raise)weaponView.play(raise,e.duration);}).catch(console.error);
}
function updateAudio(){
  if(!audio||!game)return;
  const forward=[Math.cos(state.yaw)*Math.cos(state.pitch),Math.sin(state.yaw)*Math.cos(state.pitch),Math.sin(state.pitch)];
  audio.listen(camera.position.toArray(),forward);
  // Machine loops (rollers hum, take-it timer) live at the machine; restart
  // one if the audio session cut it (death, resume).
  if(audio.context?.state==='running'&&game.phase!=='dead')for(const l of loops.values())if(audio.sounds[l.spec.alias]&&(!l.record||l.record.ended))l.record=audio.play(l.spec.alias,1,{...l.spec,loop:true});
}
async function init() {
  const began=performance.now();
  const progress=text=>{$('message').textContent=text;state.loading=text;};
  await preloadAssets(progress);
  const [manifest,collision,paths,recovered,navigation]=await Promise.all([get('/data/'+mapChoice.data+'/manifest.json',true),get('/data/'+mapChoice.zone+'/web-world/'+mapChoice.asset+'.collision.json',true),get('/data/'+mapChoice.zone+'/web-world/'+mapChoice.asset+'.paths.json',true),get('/data/'+mapChoice.data+'/presentation.json',true),get('/data/'+mapChoice.data+'/navigation.json',true)]);presentation=recovered;
  map=await loadMap(scene,progress);progress('Loading original weapons and Zombies…');await dynamicAssets(manifest.entities);
  audio=new OriginalAudio(manifest.sounds);audio.volume=settings.value.volume;weaponView=new WeaponView(viewScene,audio);effects=new OriginalEffects(presentation);actors=new ZombieActors(scene,map,presentation);actors.active=visuals;
  grenadeView=new GrenadeView(viewScene,manifest.grenade);
  progress('Preparing original pickups, knife, box and actor rigs…');
  await Promise.all([hud.load(),effects.prepare(),actors.prepare(),grenadeView.prepare(map.illumination([0,424,1])),weaponView.prepare({...manifest.weapons,...Object.fromEntries(Object.values(manifest.gestures||{}).map(d=>[d.name,d]))},map.illumination([0,424,1])),
    ...Object.entries(presentation.powerups).map(async([type,name])=>{const object=cloneModel(await model(name));shadeModel(object,[.9,.9,.9]);dropTemplates.set(type,object);})]);
  await prepareBox(manifest);preparePap(manifest);
  const projectile=cloneModel(await model(manifest.grenade.projectileModel));shadeModel(projectile,[.5,.5,.5]);combatEffects.prepareGrenades(projectile,effects);
  game=new TestingGame(manifest,new CollisionWorld(collision,manifest.entities),paths,{
    bindingName:keyName,
    message:notice,spawn:spawnVisual,
    removeEnemy:e=>actors.release(e.id),reset:()=>{resetVisuals();audio.stopSession();loops.clear();},weapon:w=>loadGun(w).catch(console.error),barrier,open,power:factoryVisuals,teleport:()=>{state.yaw=3*Math.PI/2;state.pitch=0;cameraPose();},
    traceEnemy,shot,reload:event=>weaponView.reload(event),hit:()=>{hitTime=performance.now()+130;},melee:event=>weaponView.melee(event),damage:()=>{damageFlash=1;},death,
    sound:s=>audio.play(s.alias,s.volume??1,{position:s.position,near:s.near,far:s.far,exclusive:s.exclusive}),gesture,
    loop:spec=>{if(!loops.has(spec.id))loops.set(spec.id,{spec,record:null});},
    effect:e=>{const root=effects.create(e.name,game.time);root.position.fromArray(e.position);scene.add(root);bursts.push({root,due:game.time+e.duration});},
    // Earthquake(): strength falls off with distance from the source.
    shake:e=>{const d=camera.position.distanceTo(new THREE.Vector3(...e.position));if(d<e.radius)shake={until:game.time+e.duration,amplitude:e.amplitude*(1-d/e.radius)};},stopLoop:({id})=>{loops.get(id)?.record?.stop(.05);loops.delete(id);},sessionStart:()=>audio.startSession(),drop:makeDrop,pickup:pickupVisual,
    grenadePrepare:s=>{weaponView.offhand();grenadeView.start(s);},grenade:g=>combatEffects.grenade(g),
    explosion:g=>{combatEffects.explosion(g,game.time);}
  },presentation);
  factoryVisuals();await loadGun(game.weapon);progress('Preparing spawn routes, sounds and GPU shaders…');game.prepareSpawnPaths(navigation);await audio.preload();resetVisuals();cameraPose();
  const warmScene=new THREE.Scene();warmScene.fog=scene.fog;warmScene.add(actors.warmObject(),...dropTemplates.values());
  const warmFx=effects.create('misc/fx_zombie_powerup_on',0);warmScene.add(warmFx);
  for(const v of boxVisuals.values())for(const object of v.choices.values())object.visible=true;
  await Promise.all([renderer.compileAsync(scene,camera),renderer.compileAsync(warmScene,camera),renderer.compileAsync(viewScene,viewCamera)]);
  for(const v of boxVisuals.values())for(const object of v.choices.values())object.visible=false;
  warmScene.remove(actors.warmObject());effects.dispose(warmFx);await map.uploadTextures(renderer);
  // Shader compilation alone does not allocate skinning textures or geometry
  // buffers. Draw every prepared rig offscreen before the first spawn/switch.
  const gpuWarmScene=new THREE.Scene(),rigs=[...actors.pool.map(v=>v.root),...weaponView.rigs.values(),grenadeView.root,...combatEffects.grenades.map(v=>v.mesh),...combatEffects.explosions.map(v=>v.root)].map(v=>v.root||v),restore=[];
  for(const root of rigs){restore.push({root,parent:root.parent,visible:root.visible});root.visible=true;gpuWarmScene.add(root);root.traverse(n=>{if(n.isMesh){restore.push({mesh:n,culled:n.frustumCulled});n.frustumCulled=false;}});}
  const warmTarget=new THREE.WebGLRenderTarget(64,64);
  await renderer.compileAsync(gpuWarmScene,viewCamera);renderer.setRenderTarget(warmTarget);renderer.render(gpuWarmScene,viewCamera);renderer.setRenderTarget(null);warmTarget.dispose();
  for(const item of restore)if(item.mesh)item.mesh.frustumCulled=item.culled;else{gpuWarmScene.remove(item.root);item.root.visible=item.visible;item.parent?.add(item.root);}
  await pauseMenu.prepare(hud);state.ready=true;lobby.ready();testingMenu.sync();state.loading='complete';$('play').disabled=false;pauseMenu.setContext('start');
  $('message').textContent='Map loaded and ready. Restarting keeps it loaded. '+saveSummary();$('stats').textContent=mapChoice.title+' ready · Build '+document.documentElement.dataset.build.slice(0,8);state.build=document.documentElement.dataset.build;state.preload=preloadState;state.readyMs=performance.now()-began;updateHud();
}
$('play').addEventListener('click',()=>{if(!state.ready)return;if(game.phase==='dead'){game.newGame();resetVisuals();}enterPlay();});
document.addEventListener('pointerlockchange',()=>{
  if(document.pointerLockElement===canvas){state.inputMode='locked';state.lockUnsupported=false;canvas.focus();inputHint();}
  else if(state.inputMode==='locked'){state.inputMode='idle';state.lockLostAt=performance.now();if(state.mode==='playing')menu('Paused','Your session is paused. Resume when you’re ready.');}
});
document.addEventListener('pointerlockerror',lockRefused);
// Capture phase runs before the fire/aim handlers: an uncaptured click
// recaptures the mouse instead of firing.
canvas.addEventListener('mousedown',event=>{
  if(state.mode!=='playing'||document.pointerLockElement===canvas||state.lockUnsupported)return;
  event.preventDefault();event.stopImmediatePropagation();requestMouse('click');
},{capture:true});
document.addEventListener('mousemove',event=>{
  if(state.mode!=='playing'||(state.inputMode!=='locked'&&!(state.inputMode==='drag'&&mouse.dragging)))return;
  mouse.move(event.movementX,event.movementY);
  const sensitivity=.0025*(settings.value.sensitivity/5)*(1+aimBlend*(settings.value.adsSensitivity-1));state.yaw-=event.movementX*sensitivity;state.pitch=THREE.MathUtils.clamp(state.pitch-event.movementY*sensitivity*(settings.value.invertY?-1:1),-1.45,1.45);cameraPose();
});
const code=e=>e.code||(e.key.length===1?'Key'+e.key.toUpperCase():e.key);
addEventListener('keydown',event=>{
  const key=code(event);if(key==='Escape'){event.preventDefault();if(event.repeat)return;if(state.mode==='playing')menu('Paused',mapChoice.title);else if(state.ready&&state.mode!=='starting')pauseMenu.back();return;}
  if(state.mode!=='playing')return;event.preventDefault();controls.press(key,event.repeat);
  if(state.mode==='playing'&&!event.repeat&&settings.actions(key).some(a=>['forward','backward','left','right'].includes(a)))game.update(1/60,input());cameraPose();
});
addEventListener('keyup',event=>controls.release(code(event)));
canvas.addEventListener('mousedown',event=>{if(state.mode==='playing'){event.preventDefault();controls.press('Mouse'+event.button);}});
document.addEventListener('mouseup',event=>controls.release('Mouse'+event.button));
canvas.addEventListener('auxclick',event=>event.preventDefault());
canvas.addEventListener('wheel',event=>{if(state.mode!=='playing')return;event.preventDefault();const token=event.deltaY<0?'WheelUp':'WheelDown';controls.press(token);controls.release(token);},{passive:false});
addEventListener('blur',()=>{controls.reset();mouse.reset();if(state.mode==='playing')menu('Paused',mapChoice.title);});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&state.mode==='playing')menu('Paused','Your session is paused. Resume when you’re ready.');});
addEventListener('resize',()=>{for(const c of [camera,viewCamera]){c.aspect=innerWidth/innerHeight;c.updateProjectionMatrix();}renderer.setSize(innerWidth,innerHeight);});
function input(){return controls.input(mouse.firing);}
function updateHud() {
  if(!game)return;
  $('round').textContent=game.round||1;$('points').textContent=game.player.points.toLocaleString();$('ammo').textContent=game.weapon.clip;$('reserve').textContent=game.weapon.reserve;$('weapon').textContent=game.weaponName(game.weapon.name);
  $('health').textContent=Math.ceil(game.player.health);$('health-bar').style.width=(game.player.health/(game.mapRules?.maxHealth||100)*100)+'%';$('grenades').textContent=game.player.grenades;$('kills').textContent=game.player.kills;
  const alive=game.enemies.filter(e=>!e.dead).length;$('wave').textContent=game.phase==='between'?'Next round · '+Math.ceil(game.roundDue-game.time)+'s':`${alive+game.remaining} remaining`;
  $('prompt').textContent=game.prompt();$('reload').textContent=game.reloadEnd?'RELOADING':game.weapon.clip===0?keyName('reload')+' · RELOAD':'';
  $('powerups').textContent=Object.keys(game.powerup).map(k=>k.replaceAll('_',' ')+' '+Math.ceil(game.powerup[k]-game.time)+'s').join(' · ');
  $('notice').style.opacity=performance.now()<noticeDue?'1':'0';
}
function frame(time) {
  const began=performance.now();
  const dt=Math.max(0,Math.min((time-frameTime)/1000,.1));frameTime=time;
  if(!paused)mouse.update(time);
  if(!paused){kickPitch*=Math.exp(-dt*11);kickYaw*=Math.exp(-dt*11);if(shake&&game&&game.time<shake.until){kickPitch+=(Math.random()-.5)*shake.amplitude*.04;kickYaw+=(Math.random()-.5)*shake.amplitude*.04;}}cameraPose();if(game)game.ads=aimBlend;
  if(game&&!paused&&state.mode==='playing')game.update(dt,input());
  const aimHeld=controls.aiming&&!game?.pendingGrenade&&!game?.gesture;
  const adsTime=(aimHeld?game?.weapon.definition.adsTransInTime:game?.weapon.definition.adsTransOutTime)||.25;
  if(!paused)aimBlend=THREE.MathUtils.clamp(aimBlend+(aimHeld&&!game?.reloadEnd?1:-1)*dt/adsTime,0,1);
  const adsFov=THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(THREE.MathUtils.degToRad(game?.weapon.definition.adsZoomFov||60)/2)*.75));
  const fov=baseFov+(adsFov-baseFov)*aimBlend;
  if(Math.abs(camera.fov-fov)>.01){camera.fov=fov;camera.updateProjectionMatrix();}cameraPose();
  for(const v of visuals.values()) {
    if(v.enemy.dead&&game.time-v.enemy.deathTime>5){actors.release(v.enemy.id);continue;}
    actors.updateOne(v,paused?0:dt,game.renderPosition(v.enemy));
  }
  for(const [drop,v]of dropVisuals){if(drop.used||game.time>drop.expires){effects.dispose(v.glow);scene.remove(v.root);dropVisuals.delete(drop);}else updateDrop(drop,v);}
  if(game&&state.ready){updateBoxes();updatePap();updateAudio();}
  for(let i=bursts.length-1;i>=0;i--){const b=bursts[i];if(game.time>=b.due){effects.dispose(b.root);bursts.splice(i,1);}else effects.update(b.root,game.time);}
  if(game?.phase==='dead')deathFxTime+=dt;
  if(game)combatEffects.update(game.time+deathFxTime,Math.min(1,game.accumulator*120));
  const showWeapon=state.mode==='playing'||pauseMenu.context==='pause',offhand=grenadeView&&game?grenadeView.update(game.time,showWeapon):0;
  if(weaponView?.root&&game){weaponView.root.visible=showWeapon&&offhand<.999;weaponView.update(paused?0:dt,{ads:aimBlend,moving:game.moving,sprinting:game.sprinting,time:game.time,reloading:!!game.reloadEnd,offhand});}
  if(game&&game.time>lastLight+.3){lastLight=game.time;
    const color=map.illumination(game.player.position);weaponView?.object?.traverse(n=>{if(n.isMesh&&!n.material.userData.fixedLight)n.material.color.setRGB(...color.map(v=>Math.max(.09,v*1.5)));});
    for(const v of visuals.values())actors.light(v);
  }
  damageFlash=Math.max(0,damageFlash-dt*.75);$('blood').style.opacity=String(damageFlash*.65+(game&&game.player.health<40 ? .25 : 0));
  map?.updateVisibility(camera);renderer.info.reset();renderer.autoClear=true;renderer.render(scene,camera);if(weaponView?.root?.visible||grenadeView?.root?.visible){renderer.autoClear=false;renderer.clearDepth();renderer.render(viewScene,viewCamera);}
  if(game&&state.mode==='playing'&&time>=hudDue){hud.draw(game,aimBlend,time<hitTime,camera.fov);hudDue=time+1000/60;}
  if(state.ready&&state.mode==='playing'){frameSamples.push({dt:dt*1000,cpu:performance.now()-began});if(frameSamples.length>600)frameSamples.shift();}
  // Frame counter: FPS and mean CPU frame time, refreshed twice a second.
  frames++;frameMsTotal+=performance.now()-began;
  if(time-fpsTime>500){state.fps=Math.round(frames*1000/(time-fpsTime));$('position').textContent=state.fps+' FPS';
    const counter=$('fps-counter');counter.classList.toggle('on',settings.value.showFps);if(settings.value.showFps)counter.textContent=state.fps+' FPS\n'+(frameMsTotal/frames).toFixed(1)+' ms CPU';
    frames=0;frameMsTotal=0;fpsTime=time;}
  if(time>=domDue){updateHud();domDue=time+100;}
  requestAnimationFrame(frame);
}
window.wawPreview={state,camera,renderer,scene,get game(){return game;},diagnostics:()=>({state,...game?.snapshot(),settings:settings.value,map:mapChoice.id,mapRules:game?.mapRules&&{power:game.mapRules.power,links:[...game.mapRules.links],perks:[...game.mapRules.perks],zones:[...game.mapRules.activeZones()]},menu:{view:pauseMenu.view,context:pauseMenu.context,capturing:pauseMenu.capture},controls:{tokens:[...controls.tokens],input:input(),aiming:controls.aiming},originalExecutableRunning:false,originalGscInterpreter:false,
  textures:map?.textures(),bakedLightmaps:map?.lightmapCount,renderedEnemies:visuals.size,retainedEnemies:game?.enemies.length,combatEffects:combatEffects.diagnostics(),audioBuffers:audio?.buffers.size,audio:audio?.diagnostics(),
  weaponAnimation:weaponView?.current?.getClip().name,knifeVisible:weaponView?.knife?.visible,sprintBlend:weaponView?.sprintBlend,preparedWeapons:weaponView?.rigs.size,preparedActors:actors?.pool.length,
  grenadeView:grenadeView?.diagnostics(),grenades:game?.grenades.map(g=>({position:g.position,velocity:g.velocity,due:g.due,resting:g.resting,held:!!g.held})),pendingGrenade:game?.pendingGrenade,
  performance:{drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,staticBatches:map?.staticBatches,staticPlacements:map?.staticPlacements,
    frames:frameSamples.length,p95FrameMs:frameSamples.map(s=>s.dt).sort((a,b)=>a-b)[Math.floor(frameSamples.length*.95)],p95CpuMs:frameSamples.map(s=>s.cpu).sort((a,b)=>a-b)[Math.floor(frameSamples.length*.95)],slowFrames:frameSamples.filter(s=>s.dt>25),maxCpuMs:Math.max(0,...frameSamples.map(s=>s.cpu))},
  pickups:[...dropVisuals].map(([drop,v])=>({type:drop.type,model:presentation.powerups[drop.type],visible:v.root.visible})),boxes:game&&[...game.boxes.values()].map(b=>({phase:b.phase,weapon:b.weapon,cycles:b.index})),
  actorAnimations:[...visuals.values()].map(v=>({id:v.enemy.id,stage:v.enemy.stage,animation:v.current,position:v.enemy.position})),ads:aimBlend,
  muzzle:weaponView?.object?.getObjectByName('tag_flash')?.getWorldPosition(new THREE.Vector3()).toArray(),weaponTag:weaponView?.object?.getObjectByName('tag_weapon')?.getWorldPosition(new THREE.Vector3()).toArray(),
  illumination:game&&map?.illumination(game.player.position),aimPoints:[...visuals.values()].filter(v=>!v.enemy.dead).map(v=>({id:v.enemy.id,torso:v.root.getObjectByName('j_spineupper')?.getWorldPosition(new THREE.Vector3()).toArray(),head:v.root.getObjectByName('j_head')?.getWorldPosition(new THREE.Vector3()).toArray()}))})};
cameraPose();requestAnimationFrame(frame);init().catch(error=>{console.error(error);state.error=error.message;$('message').textContent=error.message;$('play').textContent='Unable to start';document.body.classList.add('error');});
