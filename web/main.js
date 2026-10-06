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
import {BloodEffects} from './gore.js';
import {GameSettings,GameInput,bindingName} from './settings.js';
import {GamepadSettings,GamepadControls} from './gamepad.js';
import {ControllerPanel,ControllerMenu,ControllerHud} from './gamepad-ui.js';
import {PauseMenu} from './pause-menu.js';
import {GrenadeView} from './grenade-view.js';
import {selectedMap,MAPS,BO1_MAPS} from './maps.js';
import {ZombiesLobby} from './lobby.js';
import {SaveSlots} from './save-slots.js';
import {PERKS} from './map-rules.js';
import {powerSwitchRotation} from './factory-view.js';
import {PauseKeys} from './pause-keys.js';
import {BlackOpsEngine} from './bo1-engine.js';
import {BlackOpsHud} from './bo1-hud.js';
import {ServerSaveStore} from './server-saves.js';
import {LaunchScreen} from './launch-screen.js';
const mapChoice=selectedMap();
const blackOps=mapChoice.game==='black-ops';

const $=id=>document.getElementById(id);
const canvas=$('viewport'),scene=new THREE.Scene();scene.background=new THREE.Color(0x10171c);scene.fog=new THREE.FogExp2(0x26313a,.00022);
scene.add(new THREE.AmbientLight(0xa8bac9,.2));
let storage;try{storage=localStorage;}catch{}
const settings=new GameSettings(storage),gamepadSettings=new GamepadSettings(storage);
const saves=new ServerSaveStore(storage,blackOps?BO1_MAPS:MAPS);
const worldFov=value=>THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(THREE.MathUtils.degToRad(value)/2)*.75));
let baseFov=worldFov(settings.value.fov);
const camera=new THREE.PerspectiveCamera(baseFov,innerWidth/innerHeight,1,18000);camera.up.set(0,0,1);
const renderer=new THREE.WebGLRenderer({canvas,antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.info.autoReset=false;renderer.setPixelRatio(Math.min(devicePixelRatio,1.5)*settings.value.renderScale/100);
const viewScene=new THREE.Scene();
const viewCamera=new THREE.PerspectiveCamera(worldFov(65),innerWidth/innerHeight,.1,300);
const hud=new (blackOps?BlackOpsHud:OriginalHud)($('hud-art')),raycaster=new THREE.Raycaster(),combatEffects=new CombatEffects(scene),blood=new BloodEffects(scene);
const visuals=new Map(),dynamic=new Map(),dropVisuals=new Map();
const state={ready:false,mode:'menu',inputMode:'idle',yaw:Math.PI,pitch:0,loading:'idle',fps:0,error:null};
const launch=new LaunchScreen(mapChoice,()=>settings.value.volume);
let gameLoading,launchAudioContext;
let game,audio,map,weaponView,grenadeView,actors,effects,presentation;
const dropTemplates=new Map(),boxTemplates=new Map(),boxVisuals=new Map(),bursts=[];
let hudDue=0,domDue=0;const frameSamples=[];
let frameTime=performance.now(),fpsTime=frameTime,frames=0,kickPitch=0,kickYaw=0,damageFlash=0,hitTime=0,noticeDue=0,aimBlend=0,paused=true,lastLight=0;
let deathFxTime=0,frameMsTotal=0;
const loops=new Map();let papView=null,shake=null;const cellObjects=[];let cellMask=null;
const pauseKeys=new PauseKeys();
const controls=new GameInput(settings,action=>{
  if(action==='pause'){menu('Paused',mapChoice.title);return;}
  ({reload:()=>game.reload(),melee:()=>game.melee(),use:()=>game.use(),grenade:()=>game.throwGrenade(true),nextWeapon:()=>game.switchWeapon(),fire:()=>game.fire(),lookLeft:()=>state.yaw+=.08,lookRight:()=>state.yaw-=.08,lookUp:()=>state.pitch=Math.min(1.45,state.pitch+.06),lookDown:()=>state.pitch=Math.max(-1.45,state.pitch-.06)})[action]?.();
},action=>{if(action==='grenade'&&state.mode==='playing')game.releaseGrenade();});
const mouse=new MouseControls(canvas,document,{mode:()=>({playing:state.mode==='playing',inputMode:state.inputMode,aiming:controls.toggledAim||settings.value.aimMode==='hold'&&settings.value.bindings.aim.some(t=>t&&!t.startsWith('Mouse')&&controls.tokens.has(t))}),buttons:b=>settings.mouseActions(b),fire:()=>game.fire()});
let controllerPanel,controllerMenu,controllerHud;
const gamepads=new GamepadControls(gamepadSettings,{
  mode:()=>state.mode,focused:()=>!document.hidden&&document.hasFocus(),aimBlend:()=>aimBlend,
  action:action=>{if(state.mode!=='playing'||!game)return;if(action==='pause'){menu('Paused',mapChoice.title);return;}if(action==='interact'){if(game.nearInteraction()||game.nearWindow()||game.nearGrenade())game.use();else game.reload();return;}({fire:()=>game.fire(),melee:()=>game.melee(),grenade:()=>game.throwGrenade(true),nextWeapon:()=>game.switchWeapon()})[action]?.();},
  release:action=>{if(action==='grenade'&&state.mode==='playing')game?.releaseGrenade();},
  look:(yaw,pitch)=>{if(state.mode!=='playing')return;state.yaw+=yaw;state.pitch=THREE.MathUtils.clamp(state.pitch+pitch,-1.45,1.45);cameraPose();},
  menu:action=>controllerMenu?.handle(action),capture:()=>!!controllerPanel?.capturing,rawCapture:(token,pad)=>controllerPanel?.finish(token,pad),
  changed:owner=>{const previous=state.activeInput||'keyboard';state.activeInput=owner;if(owner==='controller'){if(previous==='keyboard'&&state.mode==='playing'&&game?.pendingGrenade?.cooking)game.releaseGrenade();controls.reset();mouse.reset();state.inputMode='controller';state.controllerUnlockAt=performance.now();if(document.pointerLockElement===canvas)document.exitPointerLock();}else if(state.inputMode==='controller')state.inputMode=document.pointerLockElement===canvas?'locked':'idle';controllerHud?.sync();controllerPanel?.sync();inputHint();},
  devicesChanged:()=>controllerPanel?.sync(),disconnect:()=>{if(state.mode==='playing')menu('Paused','Controller disconnected. Reconnect it or use mouse and keyboard.');}
});
const pauseMenu=new PauseMenu(settings,{openSaves:mode=>saveSlots.open(mode),saveCount:()=>saves.count(),resume:enterPlay,restart:()=>startGame(),quit:()=>{game.newGame();resetVisuals();menu(mapChoice.title,'Solo Zombies');}});
controllerPanel=new ControllerPanel(gamepadSettings,gamepads,pauseMenu);controllerMenu=new ControllerMenu(pauseMenu,{mode:()=>state.mode,launch,notice:text=>{$('message').textContent=text;notice(text);}});controllerHud=new ControllerHud(gamepads);controllerHud.sync();
const lobby=new ZombiesLobby(pauseMenu);
const saveSlots=new SaveSlots(pauseMenu,saves,{currentMap:mapChoice.id,canSave:saveBlocked,save:saveGame,load:loadSlot,weaponName:n=>game?game.weaponName(n):n});
const testingMenu=new TestingMenu(pauseMenu,()=>state.ready?game:null);
canvas.setAttribute('aria-label',mapChoice.title+' Zombies game');document.title=(blackOps?'Black Ops':'WaW')+' Zombies - '+mapChoice.title;
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
  paused=true;state.mode='menu';controls.reset();mouse.reset();gamepads.suppressHeld();controllerPanel.cancel();document.body.classList.remove('playing');
  audio?.suspend();
  $('menu-copy').textContent=game&&game.phase!=='ready'?'Round '+(game.round||1)+' · '+game.player.kills+' kills':description;
  pauseMenu.setContext(game&&game.phase!=='ready'?'pause':'start');
  if(state.inputMode==='locked')state.lockLostAt=performance.now();state.inputMode='idle';
  if(document.pointerLockElement)document.exitPointerLock();
}
// Three named server slots per map. A save snapshots the whole session.
function saveBlocked(){return game?.canSave()?null:'Finish drinking, collect your Pack-a-Punch weapon or throw your grenade, then save.';}
function slotSummary(){
  const g=game,r=g.mapRules;
  return {round:g.round,phase:g.phase,points:g.player.points,kills:g.player.kills,headshots:g.player.headshots,health:Math.round(g.player.health),
    weapons:g.inventory.map(w=>g.weaponName(w.name)),perks:r?[...r.perks].map(p=>PERKS[p]?.name||p):[],power:r?r.power:null,links:r?(blackOps?Number(r.teleporterLinked):r.links.size):null,teleporterTotal:blackOps?1:3,
    zombies:g.enemies.filter(e=>!e.dead).length,remaining:g.phase==='round'?g.remaining:0,doors:[...g.opened].filter(t=>g.interactions.some(e=>e.target===t)).length,playTime:Math.round(g.elapsed)};
}
// The slot card's picture: the current view, drawn now (the drawing buffer is
// not preserved between frames) and cropped to 16:9.
function captureThumb(){
  try{
    map?.updateVisibility(camera);renderer.autoClear=true;renderer.render(scene,camera);
    if(weaponView?.root?.visible){renderer.autoClear=false;renderer.clearDepth();renderer.render(viewScene,viewCamera);renderer.autoClear=true;}
    const src=renderer.domElement,c=document.createElement('canvas');c.width=256;c.height=144;
    const scale=Math.max(c.width/src.width,c.height/src.height),sw=c.width/scale,sh=c.height/scale;
    c.getContext('2d').drawImage(src,(src.width-sw)/2,(src.height-sh)/2,sw,sh,0,0,c.width,c.height);return c.toDataURL('image/jpeg',.72);
  }catch{return null;}
}
async function saveGame(slot,name){
  const blocked=saveBlocked();if(blocked)return {ok:false,message:blocked};
  const summary=slotSummary(),save={map:mapChoice.id,title:mapChoice.title,name:name?.trim()||'Round '+summary.round,slot,savedAt:Date.now(),summary,thumb:captureThumb(),state:game.saveState()};
  try{await saves.put(mapChoice.id,slot,save);}catch(error){return {ok:false,message:error.message||'Unable to save to the server. Your game is still paused.'};}
  const detail=`Slot ${slot+1} · ${mapChoice.title} · Round ${summary.round} · ${summary.points.toLocaleString('en-US')} points`;
  saveToast(detail);$('message').textContent='Game saved to slot '+(slot+1)+'. Load it from the main menu.';
  return {ok:true,message:`Saved to slot ${slot+1}. ${summary.zombies} zombie${summary.zombies===1?'':'s'} and the whole map were kept as they are.`};
}
let toastTimer=0;
function saveToast(detail){
  const toast=$('save-toast');$('save-toast-detail').textContent=detail;pauseMenu.text?.draw($('save-toast-title'));
  toast.classList.remove('show');void toast.offsetWidth;toast.classList.add('show');
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.classList.remove('show'),3600);
}
async function loadSlot(map,slot){
  if(map===mapChoice.id)return startGame(slot);
  const mode=state.mode;await saves.refresh();if(state.mode!==mode)return;
  const save=saves.get(map,slot);if(!save||state.mode==='starting'||state.mode==='loading')return;
  const url=new URL(location.href);url.searchParams.set('map',map);url.searchParams.set('load',String(slot+1));location.assign(url.href);
}
function keyName(action){return gamepads.active?gamepads.label(action):bindingName(settings.value.bindings[action].find(Boolean));}
function inputHint(){if(gamepads.active){$('input-mode').textContent='Controller · '+gamepads.label('fire')+' fire · '+gamepads.label('aim')+' aim';return;}const fire=settings.value.bindings.fire.filter(Boolean).map(bindingName).join(' / ')||'UNBOUND';$('input-mode').textContent=(state.inputMode==='locked'?'Mouse to look':state.inputMode==='drag'?(state.lockUnsupported?'Drag to look':'Click to capture mouse'):'Mouse capture where supported')+' · '+fire+' fire';}
function enableDrag(){if(state.mode==='menu'||state.mode==='dead')return;state.inputMode='drag';canvas.focus();inputHint();}
// Escape resumes without capturing the mouse while the key is held. A later
// click recaptures it; temporary browser refusals do not reopen the pause menu.
function requestMouse(source){if(!pauseKeys.canCaptureMouse){enableDrag();return;}state.lockSource=source;try{const result=canvas.requestPointerLock();if(result?.catch)result.catch(lockRefused);}catch{lockRefused();}}
function lockRefused(){if(state.lockSource==='click'&&performance.now()-(state.lockLostAt||-Infinity)>1500)state.lockUnsupported=true;enableDrag();}
async function startGame(slot=null){
  if(['loading','starting'].includes(state.mode))return;
  paused=true;state.mode='loading';state.error=null;controls.reset();mouse.reset();document.body.classList.remove('playing');
  const movieFinished=launch.begin();
  try{
    // Unlock game audio on this click, before the movie/download await points.
    launchAudioContext??=new AudioContext();launchAudioContext.resume().catch(console.warn);
    let save;
    if(slot!==null){await saves.refresh();save=saves.get(mapChoice.id,slot);if(!save)throw new Error('This save slot is now empty.');}
    if(!state.ready){gameLoading??=init();await gameLoading;}
    if(save){game.loadState(save.state);state.yaw=save.state.yaw;state.pitch=save.state.pitch;cameraPose();}
    else{game.newGame();resetVisuals();}
    const url=new URL(location.href);url.searchParams.delete('load');history.replaceState(null,'',url.href);
    launch.ready();await movieFinished;await enterPlay();
  }catch(error){console.error(error);state.error=error.message;launch.fail(error);}
}
async function enterPlay() {
  if(state.mode==='starting')return;
  paused=true;state.mode='starting';$('play').disabled=true;controls.reset();mouse.reset();canvas.focus();
  const soundReady=audio.start();
  controllerPanel.cancel();gamepads.suppressHeld();if(gamepads.active){state.inputMode='controller';inputHint();}else requestMouse('resume');
  try{
    await soundReady;paused=false;state.mode='playing';document.body.classList.add('playing');game.start();
    if(game.pendingGrenade?.cooking&&!settings.held('grenade',controls.tokens)&&!gamepads.grenadeHeld)game.releaseGrenade();
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
  if(mapChoice.id!=='der-riese'&&!blackOps)return;const powered=!!game?.mapRules?.power;
  for(const [target,angle]of [['wnuen_bridge',Math.PI/2],['warehouse_bridge',-Math.PI/2]])for(const item of dynamic.get(target)||[])item.object.rotation.y=powered?0:angle;
  for(const item of dynamic.get('power_switch')||[])item.object.rotation.set(...powerSwitchRotation(item.entity.angles,powered,game?.time||0,game?.mapRules?.powerStartedAt),'ZYX');
  if(blackOps&&game){
    const active=game.entities.find(e=>e.targetname===game.data.map.initialBox),at=active&&nodePos(active);
    for(const items of dynamic.values())for(const item of items){
      if(game.opened.has(item.entity.targetname))item.object.visible=false;
      if(at&&/zombie_treasure_box/.test(item.entity.model||''))item.object.visible=item.object.position.distanceTo(new THREE.Vector3(...at))<150;
      if(item.entity.targetname==='teleporter_link_cable_on')item.object.visible=game.mapRules.teleporterLinked;
      if(item.entity.targetname==='teleporter_link_cable_off')item.object.visible=!game.mapRules.teleporterLinked;
    }
  }
}
function open(e) {
  const targets=e.target.includes('upstairs')?['upstairs_blocker','upstairs_blocker2']:[e.target];
  for(const target of targets)for(const item of dynamic.get(target)||[])item.object.visible=false;
}
async function dynamicAssets(entities) {
  const boardTargets=new Set(entities.filter(e=>e.targetname==='exterior_goal').map(e=>e.target));
  for(const entity of entities) {
    if(entity.script_noteworthy==='clip')continue;
    let object;
    if(entity.classname==='script_brushmodel'&&entity.model?.startsWith('*'))object=map.brushMeshes.get(Number(entity.model.slice(1)));
    else if(entity.classname==='script_model')try{object=cloneModel(await model(entity.model));}catch(e){console.warn(e.message);}
    if(!object)continue;
    const group=new THREE.Group();group.position.fromArray(nodePos(entity));
    if(entity.classname==='script_model')shadeModel(object,map.illumination(nodePos(entity)));
    const angles=(entity.angles||'0 0 0').split(/\s+/).map(x=>Number(x)*Math.PI/180);group.rotation.set(angles[2],-angles[0],angles[1],'ZYX');group.add(object);
    // A holder carries portal culling, separate from the game's own show/hide
    // of the entity (doors, boards, box lids): visible if a cell it touches is.
    const holder=new THREE.Group();holder.add(group);scene.add(holder);holder.updateMatrixWorld(true);
    const box=new THREE.Box3().setFromObject(group),cells=new Set();
    if(!box.isEmpty()&&map.cellCount)for(let i=0;i<9;i++){const p=i<8?[i&1?box.max.x:box.min.x,i&2?box.max.y:box.min.y,i&4?box.max.z:box.min.z]:box.getCenter(new THREE.Vector3()).toArray();const c=map.cellFor(p);if(c>=0)cells.add(c);}
    if(cells.size)cellObjects.push({holder,cells:[...cells]});
    map.bullets.addRoot(group,{penetrable:boardTargets.has(entity.targetname)});
    if(entity.targetname){if(!dynamic.has(entity.targetname))dynamic.set(entity.targetname,[]);dynamic.get(entity.targetname).push({object:group,entity});}
  }
}
function resetVisuals() {
  actors?.reset();
  for(const item of dynamic.values())for(const v of item)v.object.visible=true;
  for(const v of dropVisuals.values()){effects.dispose(v.glow);scene.remove(v.root);}dropVisuals.clear();
  for(const b of boxVisuals.values()){b.weaponRoot.visible=false;b.glow.visible=false;b.lid.object.quaternion.copy(b.closed);}
  for(const burst of bursts)effects.dispose(burst.root);bursts.length=0;
  combatEffects.reset();blood.reset();
  deathFxTime=0;
  grenadeView?.reset();
  state.yaw=game?.data.map?Number(game.entities.find(e=>e.targetname==='initial_spawn_points').angles.split(' ')[1])*Math.PI/180:Math.PI;state.pitch=0;factoryVisuals();kickPitch=0;kickYaw=0;damageFlash=0;controls.reset();aimBlend=0;mouse.reset();lastLight=-1;cameraPose();
}
function traceEnemy(origin,direction,max,all=false) {
  raycaster.set(new THREE.Vector3(...origin),new THREE.Vector3(...direction));raycaster.far=max;
  let best=null;const hits=[];
  for(const v of visuals.values()) {
    if(v.enemy.dead)continue;
    const p=v.enemy.position,center=new THREE.Vector3(p[0],p[1],p[2]+38);
    if(raycaster.ray.distanceSqToPoint(center)>96*96||center.clone().sub(raycaster.ray.origin).dot(raycaster.ray.direction)>max+96)continue;
    if(v.traceTick!==game.physicsTicks){v.root.position.fromArray(p);v.root.rotation.z=v.enemy.angle;v.root.updateMatrixWorld(true);
      v.traceTick=game.physicsTicks;
    }
    const hit=v.trace.trace(raycaster.ray,all?max:best?.distance||max,game.physicsTicks);
    if(hit){const entry={enemy:v.enemy,head:hit.head??!!hit.object.userData.zombieHead,distance:hit.distance};hits.push(entry);if(!best||hit.distance<best.distance)best=entry;}
  }
  return all?hits.sort((a,b)=>a.distance-b.distance):best;
}
function shot(ray) {
  const d=game.weapon.definition,prefix=aimBlend>.8?'ads':'hip';
  const range=(a,b)=>a+(b-a)*Math.random();
  // Kick values are impulses; the view settles between shots.
  kickPitch+=THREE.MathUtils.degToRad(range(d[prefix+'ViewKickPitchMin'],d[prefix+'ViewKickPitchMax'])*.028);
  kickYaw+=THREE.MathUtils.degToRad(range(d[prefix+'ViewKickYawMin'],d[prefix+'ViewKickYawMax'])*.015);
  weaponView.shot(aimBlend);
  const bloodied=new Set();
  for(const r of ray.rays||[ray]){
    if(r.hits?.length){for(const hit of r.hits)if(hit.applied&&!bloodied.has(hit.enemy)){bloodied.add(hit.enemy);blood.burst(r.origin.map((v,i)=>v+r.dir[i]*hit.distance),r.dir,game.time);}continue;}
    if(!r.hit&&!r.wall)continue;
    combatEffects.impact(r,game.time);
  }
}
function makeDrop(drop) {
  if(!drop.restored){drop.spawned=game.time;drop.expires=game.time+26.5;}
  const v=createPickupView(drop,dropTemplates.get(drop.type),effects,drop.spawned??game.time);scene.add(v.root);dropVisuals.set(drop,v);if(!drop.restored)audio.play('spawn_powerup');
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
  // Each box location keeps every weapon model for the cycling animation;
  // skip their transform updates while that location shows nothing.
  for(const [target,v]of boxVisuals){updateBoxView(v,game.boxes.get(target),game.time,presentation.box,effects);v.weaponRoot.matrixWorldAutoUpdate=v.weaponRoot.visible;}
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
  const progress=text=>{state.loading=text;launch.update(launch.element('progress').value,text);};
  const prepared=async(n,text)=>{launch.prepared(n,text);state.loading=text;await new Promise(requestAnimationFrame);};
  await preloadAssets(progress,info=>launch.downloaded(info));await prepared(0,'Preparing downloaded assets…');
  const [manifest,collision,paths,recovered,navigation,powerNavigation,gateNavigation]=await Promise.all([get('/data/'+mapChoice.data+'/manifest.json',true),get('/data/'+mapChoice.zone+'/web-world/'+mapChoice.asset+'.collision.json',true),get('/data/'+mapChoice.zone+'/web-world/'+mapChoice.asset+'.paths.json',true),get('/data/'+mapChoice.data+'/presentation.json',true),get('/data/'+mapChoice.data+'/navigation.json',true),mapChoice.id==='der-riese'?get('/data/'+mapChoice.data+'/power-navigation.json',true).catch(()=>null):null,blackOps?null:get('/data/'+mapChoice.data+'/gate-navigation.json',true).catch(()=>null)]);presentation=recovered;
  map=await loadMap(scene,progress);await prepared(1,'Preparing original map objects…');await dynamicAssets(manifest.entities);
  await prepared(2,'Preparing original weapons and Zombies…');
  audio=new OriginalAudio(manifest.sounds,launchAudioContext);audio.volume=settings.value.volume;weaponView=new WeaponView(viewScene,audio);effects=new OriginalEffects(presentation);actors=new ZombieActors(scene,map,presentation);actors.active=visuals;
  grenadeView=new GrenadeView(viewScene,manifest.grenade);
  progress('Preparing original pickups, knife, box and actor rigs…');
  await Promise.all([hud.load(),effects.prepare(),actors.prepare(),blood.prepare(presentation.gore),grenadeView.prepare(map.illumination([0,424,1])),weaponView.prepare({...manifest.weapons,...Object.fromEntries(Object.values(manifest.gestures||{}).map(d=>[d.name,d]))},map.illumination([0,424,1])),
    ...Object.entries(presentation.powerups).map(async([type,name])=>{const object=cloneModel(await model(name));shadeModel(object,[.9,.9,.9]);dropTemplates.set(type,object);})]);
  await prepared(3,'Preparing mystery box and grenade effects…');
  await prepareBox(manifest);preparePap(manifest);
  const projectile=cloneModel(await model(manifest.grenade.projectileModel));shadeModel(projectile,[.5,.5,.5]);combatEffects.prepareGrenades(projectile,effects);
  await prepared(4,'Preparing map collision, navigation and audio…');
  game=new (blackOps?BlackOpsEngine:TestingGame)(manifest,new CollisionWorld(collision,manifest.entities),paths,{
    bindingName:keyName,controllerPrompts:()=>gamepads.active,
    message:notice,spawn:spawnVisual,
    kill:e=>{const direction=e.position.map((v,i)=>v-game.player.position[i]);if(actors.kill(e,direction)&&e.deathHeadshot){const fragment=actors.active.get(e.id).headFragment;if(fragment?.active){blood.burst(fragment.p.toArray(),direction,game.time,true);if(presentation.gore?.headSound)audio.play(presentation.gore.headSound,1,{position:fragment.p.toArray()});}}},removeEnemy:e=>actors.release(e.id),reset:()=>{resetVisuals();audio.stopSession();loops.clear();},weapon:w=>loadGun(w).catch(console.error),barrier,open,power:factoryVisuals,teleport:()=>{state.yaw=3*Math.PI/2;state.pitch=0;cameraPose();},
    traceShot:(origin,dir,range)=>map.bullets.shot(origin,dir,range,traceEnemy),traceEnemy,shot,reload:event=>weaponView.reload(event),hit:()=>{hitTime=performance.now()+130;},melee:event=>weaponView.melee(event),meleeImpact:e=>blood.burst(e.position,e.direction,game.time),meleeAim:e=>{state.yaw=e.yaw-kickYaw;state.pitch=e.pitch-kickPitch;},damage:()=>{damageFlash=1;},death,
    sound:s=>audio.play(s.alias,s.volume??1,{position:s.position,near:s.near,far:s.far,exclusive:s.exclusive}),gesture,
    loop:spec=>{if(!loops.has(spec.id))loops.set(spec.id,{spec,record:null});},
    // Weapon switch: hold the old gun's putaway, then draw the new gun.
    weaponSwitch:e=>{if(e.phase==='drop')weaponView.play(e.anim,e.duration,false,true);else loadGun(e.weapon).then(()=>weaponView.play(e.anim,e.duration)).catch(console.error);},
    effect:e=>{const root=effects.create(e.name,game.time);root.position.fromArray(e.position);scene.add(root);bursts.push({root,due:game.time+e.duration});},
    // Earthquake(): strength falls off with distance from the source.
    shake:e=>{const d=camera.position.distanceTo(new THREE.Vector3(...e.position));if(d<e.radius)shake={until:game.time+e.duration,amplitude:e.amplitude*(1-d/e.radius)};},stopLoop:({id})=>{loops.get(id)?.record?.stop(.05);loops.delete(id);},sessionStart:()=>audio.startSession(),drop:makeDrop,pickup:pickupVisual,
    grenadePrepare:s=>{weaponView.offhand();grenadeView.start(s);},grenade:g=>combatEffects.grenade(g),
    explosion:g=>{combatEffects.explosion(g,game.time);}
  },presentation);
  actors.collision=game.collision;blood.trace=(origin,dir,range)=>map.bullets.trace(origin,dir,range);factoryVisuals();await loadGun(game.weapon);progress('Preparing spawn routes, sounds and GPU shaders…');game.prepareSpawnPaths(navigation);if(!blackOps){game.preparePowerNavigation(powerNavigation?.sourceStamp===navigation.sourceStamp?powerNavigation:null);game.useGateNavigation(gateNavigation?.sourceStamp===navigation.sourceStamp?gateNavigation:null);}await audio.preload();resetVisuals();cameraPose();
  await prepared(5,'Compiling graphics…');
  const warmScene=new THREE.Scene();warmScene.fog=scene.fog;warmScene.add(actors.warmObject(),...dropTemplates.values());
  const warmFx=effects.create('misc/fx_zombie_powerup_on',0);warmScene.add(warmFx);
  for(const v of boxVisuals.values())for(const object of v.choices.values())object.visible=true;
  await Promise.all([renderer.compileAsync(scene,camera),renderer.compileAsync(warmScene,camera),renderer.compileAsync(viewScene,viewCamera)]);
  for(const v of boxVisuals.values())for(const object of v.choices.values())object.visible=false;
  warmScene.remove(actors.warmObject());effects.dispose(warmFx);await prepared(6,'Uploading textures and character rigs…');await map.uploadTextures(renderer);
  // Shader compilation alone does not allocate skinning textures or geometry
  // buffers. Draw every prepared rig offscreen before the first spawn/switch.
  const gpuWarmScene=new THREE.Scene(),rigs=[...actors.pool.map(v=>v.root),...weaponView.rigs.values(),grenadeView.root,...combatEffects.grenades.map(v=>v.mesh),...combatEffects.explosions.map(v=>v.root),...blood.warmObjects()].map(v=>v.root||v),restore=[];
  for(const root of rigs){restore.push({root,parent:root.parent,visible:root.visible});root.visible=true;gpuWarmScene.add(root);root.traverse(n=>{if(n.isMesh){restore.push({mesh:n,culled:n.frustumCulled});n.frustumCulled=false;}});}
  const warmTarget=new THREE.WebGLRenderTarget(64,64);
  await renderer.compileAsync(gpuWarmScene,viewCamera);renderer.setRenderTarget(warmTarget);renderer.render(gpuWarmScene,viewCamera);renderer.setRenderTarget(null);warmTarget.dispose();
  for(const item of restore)if(item.mesh)item.mesh.frustumCulled=item.culled;else{gpuWarmScene.remove(item.root);item.root.visible=item.visible;item.parent?.add(item.root);}
  await prepared(7,'Finishing map graphics…');
  // Draw every map object once offscreen (culling off, hidden props shown) so
  // its textures and buffers upload while loading. Otherwise each upload is a
  // 20-70 ms hitch the first time the player looks toward that object.
  const warmStarted=performance.now(),sceneRestore=[];
  scene.traverse(n=>{sceneRestore.push({n,visible:n.visible,culled:n.frustumCulled,count:n.isInstancedMesh?n.count:undefined});n.visible=true;n.frustumCulled=false;if(n.isInstancedMesh)n.count=n.instanceMatrix.count;});
  await renderer.compileAsync(scene,camera);const sceneTarget=new THREE.WebGLRenderTarget(64,64);
  renderer.setRenderTarget(sceneTarget);renderer.render(scene,camera);renderer.setRenderTarget(null);sceneTarget.dispose();
  for(const s of sceneRestore){s.n.visible=s.visible;s.n.frustumCulled=s.culled;if(s.count!==undefined)s.n.count=s.count;}
  state.sceneWarmMs=Math.round(performance.now()-warmStarted);
  await prepared(8,'Map ready');state.ready=true;lobby.ready();testingMenu.sync();state.loading='complete';
  $('stats').textContent=mapChoice.title+' ready · Build '+document.documentElement.dataset.build.slice(0,8);state.build=document.documentElement.dataset.build;state.preload=preloadState;state.readyMs=performance.now()-began;updateHud();
}
$('play').addEventListener('click',()=>{if(pauseMenu.context==='pause')enterPlay();else{const load=Number(new URLSearchParams(location.search).get('load'));startGame(load>=1&&load<=3?load-1:null);}});
document.addEventListener('pointerlockchange',()=>{
  if(document.pointerLockElement===canvas){state.inputMode='locked';state.lockUnsupported=false;canvas.focus();inputHint();}
  else if(state.inputMode==='locked'){state.inputMode='idle';state.lockLostAt=performance.now();if(state.mode==='playing'){pauseKeys.nativePause();menu('Paused','Your session is paused. Resume when you’re ready.');}}
});
document.addEventListener('pointerlockerror',lockRefused);
// Capture phase runs before the fire/aim handlers: an uncaptured click
// recaptures the mouse instead of firing.
canvas.addEventListener('mousedown',event=>{
  gamepads.useKeyboard();
  if(state.mode!=='playing'||document.pointerLockElement===canvas||state.lockUnsupported)return;
  event.preventDefault();event.stopImmediatePropagation();requestMouse('click');
},{capture:true});
document.addEventListener('mousemove',event=>{
  if(gamepads.active&&performance.now()-(state.controllerUnlockAt||0)<250)return;
  if(event.movementX||event.movementY)gamepads.useKeyboard();
  if(state.mode!=='playing'||(state.inputMode!=='locked'&&!(state.inputMode==='drag'&&mouse.dragging)))return;
  mouse.move(event.movementX,event.movementY);
  const sensitivity=.0025*(settings.value.sensitivity/5)*(1+aimBlend*(settings.value.adsSensitivity-1));state.yaw-=event.movementX*sensitivity;state.pitch=THREE.MathUtils.clamp(state.pitch-event.movementY*sensitivity*(settings.value.invertY?-1:1),-1.45,1.45);cameraPose();
});
const code=e=>e.code||(e.key.length===1?'Key'+e.key.toUpperCase():e.key);
addEventListener('keydown',event=>{
  gamepads.useKeyboard();
  if(state.mode==='loading'){if(event.code==='Escape')event.preventDefault();return;}
  const key=code(event);if(key==='Escape'){event.preventDefault();if(!pauseKeys.down(event.repeat))return;if(state.mode==='playing')menu('Paused',mapChoice.title);else if((state.lobbyReady||state.ready)&&state.mode!=='starting')pauseMenu.back();return;}
  if(state.mode!=='playing')return;event.preventDefault();controls.press(key,event.repeat);
  if(state.mode==='playing'&&!event.repeat&&settings.actions(key).some(a=>['forward','backward','left','right'].includes(a)))game.update(1/60,input());cameraPose();
});
addEventListener('keyup',event=>{const key=code(event);if(key==='Escape')pauseKeys.up();controls.release(key);});
canvas.addEventListener('mousedown',event=>{if(state.mode==='playing'){event.preventDefault();controls.press('Mouse'+event.button);}});
document.addEventListener('mouseup',event=>controls.release('Mouse'+event.button));
canvas.addEventListener('auxclick',event=>event.preventDefault());
canvas.addEventListener('wheel',event=>{gamepads.useKeyboard();if(state.mode!=='playing')return;event.preventDefault();const token=event.deltaY<0?'WheelUp':'WheelDown';controls.press(token);controls.release(token);},{passive:false});
addEventListener('gamepaddisconnected',event=>gamepads.disconnected(event.gamepad.index));
document.addEventListener('mousedown',()=>gamepads.useKeyboard(),true);
addEventListener('blur',()=>{gamepads.suppressHeld();pauseKeys.reset();controls.reset();mouse.reset();if(state.mode==='playing')menu('Paused',mapChoice.title);});
document.addEventListener('visibilitychange',()=>{if(document.hidden){gamepads.suppressHeld();pauseKeys.reset();if(state.mode==='playing')menu('Paused','Your session is paused. Resume when you’re ready.');}});
addEventListener('resize',()=>{for(const c of [camera,viewCamera]){c.aspect=innerWidth/innerHeight;c.updateProjectionMatrix();}renderer.setSize(innerWidth,innerHeight);});
function input(){return gamepads.active?gamepads.input():controls.input(mouse.firing);}
function updateHud() {
  if(!game)return;
  $('round').textContent=game.round||1;$('points').textContent=game.player.points.toLocaleString();$('ammo').textContent=game.weapon.clip;$('reserve').textContent=game.weapon.reserve;$('weapon').textContent=game.weaponName(game.weapon.name);
  $('health').textContent=Math.ceil(game.player.health);$('health-bar').style.width=(game.player.health/(game.mapRules?.maxHealth||100)*100)+'%';$('grenades').textContent=game.player.grenades;$('kills').textContent=game.player.kills;
  const alive=game.enemies.filter(e=>!e.dead).length;$('wave').textContent=game.phase==='between'?'Next round · '+Math.ceil(game.roundDue-game.time)+'s':`${alive+game.remaining} remaining`;
  $('prompt').textContent=game.prompt();$('reload').textContent=game.reloadEnd?'RELOADING':game.weapon.clip===0?keyName('reload')+' · RELOAD':'';
  $('powerups').textContent=Object.keys(game.powerup).map(k=>k.replaceAll('_',' ')+' '+Math.ceil(game.powerup[k]-game.time)+'s').join(' · ');
  $('notice').style.opacity=performance.now()<noticeDue?'1':'0';
}
// Portal culling for map entities (when the visible cells change) and for
// zombies (each frame, from the cell their body is in).
function applyCellCulling(){
  const cellsNow=map?.visibleCells||null;
  if(cellsNow!==cellMask){cellMask=cellsNow;for(const o of cellObjects){o.holder.visible=!cellsNow||o.cells.some(c=>cellsNow[c]);o.holder.matrixWorldAutoUpdate=o.holder.visible;}}
  for(const v of visuals.values()){const p=v.enemy.position,c=cellsNow?map.cellFor([p[0],p[1],p[2]+40]):-1;v.root.visible=c<0||!!cellsNow[c];}
}
function frame(time) {
  const began=performance.now();
  const dt=Math.max(0,Math.min((time-frameTime)/1000,.1));frameTime=time;
  gamepads.poll(dt);controllerHud.update(game,state.mode==='playing');
  if(!state.ready||state.mode==='loading'){requestAnimationFrame(frame);return;}
  if(!paused)mouse.update(time);
  if(!paused){kickPitch*=Math.exp(-dt*11);kickYaw*=Math.exp(-dt*11);if(shake&&game&&game.time<shake.until){kickPitch+=(Math.random()-.5)*shake.amplitude*.04;kickYaw+=(Math.random()-.5)*shake.amplitude*.04;}}cameraPose();if(game)game.ads=aimBlend;
  if(game&&!paused&&state.mode==='playing')game.update(dt,input());
  const aimHeld=(gamepads.active?gamepads.aiming:controls.aiming)&&!game?.pendingGrenade&&!game?.gesture&&!game?.switching;
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
  if(game&&state.ready){factoryVisuals();updateBoxes();updatePap();updateAudio();}
  for(let i=bursts.length-1;i>=0;i--){const b=bursts[i];if(game.time>=b.due){effects.dispose(b.root);bursts.splice(i,1);}else effects.update(b.root,game.time);}
  if(game?.phase==='dead')deathFxTime+=dt;
  if(game){combatEffects.update(game.time+deathFxTime,Math.min(1,game.accumulator*120));blood.update(game.time+deathFxTime);}
  const showWeapon=state.mode==='playing'||pauseMenu.context==='pause',offhand=grenadeView&&game?grenadeView.update(game.time,showWeapon):0;
  if(weaponView?.root&&game){weaponView.root.visible=showWeapon&&offhand<.999;weaponView.update(paused?0:dt,{ads:aimBlend,moving:game.moving,sprinting:game.sprinting,time:game.time,reloading:!!game.reloadEnd,offhand});}
  if(game&&game.time>lastLight+.3){lastLight=game.time;
    const color=map.illumination(game.player.position);weaponView?.object?.traverse(n=>{if(n.isMesh&&!n.material.userData.fixedLight)n.material.color.setRGB(...color.map(v=>Math.max(.09,v*1.5)));});
    for(const v of visuals.values())actors.light(v);
  }
  damageFlash=Math.max(0,damageFlash-dt*.75);$('blood').style.opacity=String(damageFlash*.65+(game&&game.player.health<40 ? .25 : 0));
  map?.updateVisibility(camera);applyCellCulling();
  renderer.info.reset();renderer.autoClear=true;renderer.render(scene,camera);if(weaponView?.root?.visible||grenadeView?.root?.visible){renderer.autoClear=false;renderer.clearDepth();renderer.render(viewScene,viewCamera);}
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
window.wawPreview={state,camera,renderer,scene,applyCellCulling,get game(){return game;},get map(){return map;},diagnostics:()=>({state,launch:launch.diagnostics(),...game?.snapshot(),settings:settings.value,map:mapChoice.id,mapRules:game?.mapRules&&{power:game.mapRules.power,links:[...game.mapRules.links],perks:[...game.mapRules.perks],zones:[...game.mapRules.activeZones()]},menu:{view:pauseMenu.view,context:pauseMenu.context,capturing:pauseMenu.capture},controls:{tokens:[...controls.tokens],input:input(),aiming:gamepads.active?gamepads.aiming:controls.aiming,controller:gamepads.diagnostics()},originalExecutableRunning:false,originalGscInterpreter:false,
  textures:map?.textures(),bakedLightmaps:map?.lightmapCount,renderedEnemies:visuals.size,retainedEnemies:game?.enemies.length,combatEffects:combatEffects.diagnostics(),gore:blood.diagnostics(),audioBuffers:audio?.buffers.size,audio:audio?.diagnostics(),
  weaponAnimation:weaponView?.current?.getClip().name,knifeVisible:weaponView?.knife?.visible,sprintBlend:weaponView?.sprintBlend,preparedWeapons:weaponView?.rigs.size,preparedActors:actors?.pool.length,
  grenadeView:grenadeView?.diagnostics(),grenades:game?.grenades.map(g=>({position:g.position,velocity:g.velocity,due:g.due,resting:g.resting,held:!!g.held})),pendingGrenade:game?.pendingGrenade,
  performance:{drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,staticBatches:map?.staticBatches,staticPlacements:map?.staticPlacements,
    frames:frameSamples.length,p95FrameMs:frameSamples.map(s=>s.dt).sort((a,b)=>a-b)[Math.floor(frameSamples.length*.95)],p95CpuMs:frameSamples.map(s=>s.cpu).sort((a,b)=>a-b)[Math.floor(frameSamples.length*.95)],slowFrames:frameSamples.filter(s=>s.dt>25),maxCpuMs:Math.max(0,...frameSamples.map(s=>s.cpu))},
  pickups:[...dropVisuals].map(([drop,v])=>({type:drop.type,model:presentation.powerups[drop.type],visible:v.root.visible})),boxes:game&&[...game.boxes.values()].map(b=>({phase:b.phase,weapon:b.weapon,cycles:b.index})),
  actorAnimations:[...visuals.values()].map(v=>({id:v.enemy.id,stage:v.enemy.stage,animation:v.current,position:v.enemy.position})),ads:aimBlend,
  muzzle:weaponView?.object?.getObjectByName('tag_flash')?.getWorldPosition(new THREE.Vector3()).toArray(),weaponTag:weaponView?.object?.getObjectByName('tag_weapon')?.getWorldPosition(new THREE.Vector3()).toArray(),
  illumination:game&&map?.illumination(game.player.position),aimPoints:[...visuals.values()].filter(v=>!v.enemy.dead).map(v=>({id:v.enemy.id,torso:v.root.getObjectByName('j_spineupper')?.getWorldPosition(new THREE.Vector3()).toArray(),head:v.root.getObjectByName('j_head')?.getWorldPosition(new THREE.Vector3()).toArray()}))})};
if(blackOps)window.bo1Preview=window.wawPreview;
async function bootLobby(){
  // Only menu artwork, fonts and the save catalogue are needed before Start.
  saves.prepare().then(()=>{$('resume-save').hidden=pauseMenu.context==='pause'||!saves.count();}).catch(error=>{state.savesError=error.message;});
  if(!blackOps){await hud.loadFont();await pauseMenu.prepare(hud);}
  pauseMenu.setContext('start');lobby.ready();state.lobbyReady=true;
  const load=Number(new URLSearchParams(location.search).get('load'));
  $('message').textContent=load>=1&&load<=3?'Start Game to continue saved slot '+load+'.':'Choose your map, then Start Game. Assets load with the original loading movie.';
  $('stats').textContent=mapChoice.title+' · Ready to launch';$('play').disabled=false;
}
cameraPose();requestAnimationFrame(frame);bootLobby().catch(error=>{console.warn(error);state.lobbyReady=true;pauseMenu.setContext('start');$('message').textContent='Start Game to load '+mapChoice.title+'.';$('play').disabled=false;});
