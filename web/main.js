import {OriginsView} from './bo2-origins-view.js';
import {MobView} from './bo2-mob-view.js';
import {MobEngine} from './bo2-mob-engine.js';
import {attachWeaponModels} from './weapon-attachments.js';
import {OriginsEngine} from './bo2-origins-engine.js';
import * as THREE from 'three';
import { get,loadMap,model,cloneModel,originalAnimation,OriginalAudio,shadeModel,applyHideTags,weaponHeat } from './assets.js';
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
import {ControllerAimAssist} from './controller-aim-assist.js';
import {ControllerPanel,ControllerMenu,ControllerHud} from './gamepad-ui.js';
import {PauseMenu} from './pause-menu.js';
import {GrenadeView} from './grenade-view.js';
import {selectedMap,MAPS,BO1_MAPS,BO2_MAPS} from './maps.js';
import {ZombiesLobby} from './lobby.js';
import {LobbyPresence} from './lobby-presence.js';
import {NetSession} from './net-session.js';
import {Coop} from './coop.js';
import {RemotePlayers} from './remote-players.js';
import {StepSmoothing} from './step-smoothing.js';
import {SaveSlots} from './save-slots.js';
import {PERKS} from './map-rules.js';
import {powerSwitchRotation} from './factory-view.js';
import {PauseKeys} from './pause-keys.js';
import {BlackOpsEngine} from './bo1-engine.js';
import {CallOfDeadEngine} from './bo1-coast.js';
import {CoastView} from './bo1-coast-view.js';
import {MoonEngine} from './bo1-moon.js';
import {FiveEngine} from './bo1-five.js';
import {FiveView} from './bo1-five-view.js';
import {MoonView} from './bo1-moon-view.js';
import {ShangriEngine} from './bo1-shangri.js';
import {ShangriView} from './bo1-shangri-view.js';
import {BlackOpsHud} from './bo1-hud.js';
import {BlackOps2Engine,BO2_CHARACTERS,BO2_ARMS,BO2_PERKS} from './bo2-engine.js';
import {BlackOps2Hud} from './bo2-hud.js';
import {BuriedView} from './bo2-view.js';
import {BuriedPolish} from './buried-polish.js';
import {polishLight,applyProbe} from './polish-light.js';
import {NuketownView} from './bo2-nuketown-view.js';
import {TranzitView} from './bo2-tranzit-view.js';
import {TownView} from './bo2-town-view.js';
import {TownEngine} from './bo2-town-engine.js';
import {DieRiseView} from './bo2-die-rise-view.js';
import {ServerSaveStore} from './server-saves.js';
import {LaunchScreen} from './launch-screen.js';
import {PlayerVoice,CHARACTERS,CHARACTER_ARMS} from './player-voice.js';
import {PlayerBody} from './player-body.js';
import {DiveAudio,contactSurfaceName} from './dive-audio.js';
import {divePresentation} from './player-movement.js';
import {configureDive,predictedDive} from './dive-config.js';
import {HurtEffect} from './hurt-effect.js';
import {ZombieVox,ZOMBIE_VOX} from './zombie-vox.js';
import {GameOverSequence} from './game-over.js';
import {AscensionRules} from './bo1-ascension.js';
import {VerrucktRules} from './waw-verruckt.js';
import {VerrucktView} from './waw-verruckt-view.js';
import {ShiNoNumaGame} from './waw-shi-no-numa.js';
import {ShiNoNumaView} from './waw-shi-no-numa-view.js';
import {MenuAudio} from './menu-audio.js';
import {Bo1Frontend} from './bo1-frontend.js';
import {Bo2Menu} from './bo2-menu.js';
const mapChoice=selectedMap();
const bo2=mapChoice.game==='black-ops-2',blackOps=bo2||mapChoice.game==='black-ops';
// The original overlay_low_health and hit_direction art (BO2's hit_direction_zm is additive).
const hurtArcs=document.createElement('canvas');hurtArcs.id='hurt-arcs';hurtArcs.setAttribute('aria-hidden','true');document.getElementById('blood').after(hurtArcs);
const hurt=new HurtEffect({overlay:document.getElementById('blood'),canvas:hurtArcs,view:document.getElementById('viewport'),hudBase:blackOps?`/data/${mapChoice.data}/hud/`:'/data/gameplay/hud/',arc:bo2?'hit_direction_zm':'hit_direction',additive:bo2});
const characterNames=mapChoice.characterNames||(bo2?BO2_CHARACTERS:CHARACTERS),characterArms=mapChoice.characterArms||(bo2?BO2_ARMS:CHARACTER_ARMS);
// Black Ops solo plays a random one of the four characters (player_set_viewmodel);
// ?character=0-3 picks one. A save keeps its character.
const characterParam=new URLSearchParams(location.search).get('character');
let polish=null,polishBottle=null,muzzleObject=null,muzzleTag=null;const muzzleView=new THREE.Vector3(),muzzleWorld=new THREE.Vector3();
let zombieVox=null,gameOver=null,gameOverStats=null,lastHitFrom=null,throe=null,throeLoad=null;
let character=blackOps?(/^[0-3]$/.test(characterParam||'')?Number(characterParam):Math.floor(Math.random()*4)):0,voice=null;

const $=id=>document.getElementById(id);
const canvas=$('viewport'),scene=new THREE.Scene();scene.background=new THREE.Color(0x10171c);scene.fog=new THREE.FogExp2(0x26313a,.00022);
if(bo2){scene.background.set(0x17120e);scene.fog.color.set(0x322719);scene.fog.density=.00013;}
// Buried's polish: a touch more distance haze in the cavern's dusty brown.
if(polishLight.enabled){scene.fog.color.set(0x2c2218);scene.fog.density=.000165;}
scene.add(new THREE.AmbientLight(0xa8bac9,.2));
let storage;try{storage=localStorage;}catch{}
const settings=new GameSettings(storage),gamepadSettings=new GamepadSettings(storage);
const saves=new ServerSaveStore(storage,bo2?BO2_MAPS:blackOps?BO1_MAPS:MAPS);
const worldFov=value=>THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(THREE.MathUtils.degToRad(value)/2)*.75));
let baseFov=worldFov(settings.value.fov);
const camera=new THREE.PerspectiveCamera(baseFov,innerWidth/innerHeight,1,18000);camera.up.set(0,0,1);
const renderer=new THREE.WebGLRenderer({canvas,antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.info.autoReset=false;renderer.setPixelRatio(Math.min(devicePixelRatio,1.5)*settings.value.renderScale/100);
const viewScene=new THREE.Scene();
const viewCamera=new THREE.PerspectiveCamera(worldFov(65),innerWidth/innerHeight,.1,300);
const hud=new (bo2?BlackOps2Hud:blackOps?BlackOpsHud:OriginalHud)($('hud-art'),blackOps?{folder:mapChoice.data}:undefined),raycaster=new THREE.Raycaster(),combatEffects=new CombatEffects(scene),blood=new BloodEffects(scene);
const visuals=new Map(),dynamic=new Map(),dropVisuals=new Map();
const state={ready:false,mode:'menu',inputMode:'idle',yaw:Math.PI,pitch:0,loading:'idle',fps:0,error:null};
const launch=new LaunchScreen(mapChoice,()=>settings.value.volume);
let gameLoading,launchAudioContext;
let game,audio,map,weaponView,grenadeView,actors,effects,presentation;
let playerBody,diveAudio,diveThirdPerson=false,buriedView;
// Online co-op: the relay session, the co-op rules and the other players' bodies.
let session=null,coop=null,remotePlayers=null,coopEnded=false,hiddenStep=performance.now();
// The view glides over steps (stairs, ledges, low props) instead of popping.
const stepView=new StepSmoothing();let stepOffset=0;
const dropTemplates=new Map(),boxTemplates=new Map(),boxVisuals=new Map(),bursts=[];
let hudDue=0,domDue=0;const frameSamples=[];
let frameTime=performance.now(),fpsTime=frameTime,frames=0,kickPitch=0,kickYaw=0,damageFlash=0,exertDue=0,hitTime=0,noticeDue=0,aimBlend=0,paused=true,lastLight=0;
let deathFxTime=0,frameMsTotal=0;
const loops=new Map();let papView=null,shake=null,verrucktView=null,coastView=null,shiView=null,moonView=null,shangriView=null,fiveView=null;const cellObjects=[];let cellMask=null;
const pauseKeys=new PauseKeys();
const controls=new GameInput(settings,action=>{
  if(action==='pause'){menu('Paused',mapChoice.title);return;}
  ({crouch:()=>game.changeStance('crouch'),prone:()=>game.changeStance('prone'),reload:()=>game.reload(),melee:()=>game.melee(),use:()=>game.use(),grenade:()=>game.throwGrenade(true),nextWeapon:()=>game.switchWeapon(),alternateWeapon:()=>game.alternateWeapon?.(),equipment:()=>game.placeEquipment?.(),fire:()=>game.fire(),lookLeft:()=>state.yaw+=.08,lookRight:()=>state.yaw-=.08,lookUp:()=>state.pitch=Math.min(1.45,state.pitch+.06),lookDown:()=>state.pitch=Math.max(-1.45,state.pitch-.06)})[action]?.();
},action=>{if(action==='grenade'&&state.mode==='playing')game.releaseGrenade();});
const mouse=new MouseControls(canvas,document,{mode:()=>({playing:state.mode==='playing',inputMode:state.inputMode,aiming:controls.toggledAim||settings.value.aimMode==='hold'&&settings.value.bindings.aim.some(t=>t&&!t.startsWith('Mouse')&&controls.tokens.has(t))}),buttons:b=>settings.mouseActions(b),fire:()=>game.fire()});
let controllerPanel,controllerMenu,controllerHud;
const controllerAimAssist=new ControllerAimAssist(),assistPoint=new THREE.Vector3();
function controllerLook(yawDelta,pitchDelta,stick={}){
  if(state.mode!=='playing'||!game)return;
  const p=game.player.position,origin=[p[0],p[1],p[2]+game.viewHeight];
  const adjusted=controllerAimAssist.adjust({yaw:state.yaw,pitch:state.pitch,yawDelta,pitchDelta,...stick,origin,targets:game.enemies,ads:aimBlend,
    active:gamepads.active&&!game.sprinting&&!game.dive&&!game.gesture&&!game.pendingGrenade&&!game.mapRules?.afterlife&&!coop?.down&&!coop?.dead,
    enabled:gamepadSettings.value.aimAssist,strength:gamepadSettings.value.aimAssistStrength,
    pointFor:e=>{const v=visuals.get(e.id);if(!v?.root.visible)return null;v.assistSpine??=v.root.getObjectByName('j_spineupper');const point=v.assistSpine?.getWorldPosition(assistPoint).toArray();return point&&point[2]>e.position[2]+12?point:null;},
    visible:(from,to)=>{if(!map)return false;const d=to.map((v,k)=>v-from[k]),range=Math.hypot(...d);return !map.bullets.trace(from,d.map(v=>v/range),Math.max(0,range-8));}});
  state.yaw+=adjusted.yaw;state.pitch=THREE.MathUtils.clamp(state.pitch+adjusted.pitch,-1.45,1.45);cameraPose();
}
const gamepads=new GamepadControls(gamepadSettings,{
  mode:()=>state.mode,focused:()=>!document.hidden&&document.hasFocus(),aimBlend:()=>aimBlend,
  action:action=>{if(state.mode!=='playing'||!game)return;if(action==='pause'){menu('Paused',mapChoice.title);return;}if(action==='interact'){if(game.nearInteraction()||game.nearWindow()||game.nearGrenade())game.use();else game.reload();return;}({stance:()=>game.stanceButton(),fire:()=>game.fire(),melee:()=>game.melee(),grenade:()=>game.throwGrenade(true),nextWeapon:()=>game.switchWeapon(),alternateWeapon:()=>game.alternateWeapon?.(),equipment:()=>game.placeEquipment?.()})[action]?.();},
  release:(action,cancel=false)=>{if(action==='grenade'&&state.mode==='playing')game?.releaseGrenade();if(action==='stance')game?.releaseStance(cancel||state.mode!=='playing');},
  look:controllerLook,
  menu:action=>controllerMenu?.handle(action),capture:()=>!!controllerPanel?.capturing,rawCapture:(token,pad)=>controllerPanel?.finish(token,pad),
  changed:owner=>{const previous=state.activeInput||'keyboard';state.activeInput=owner;if(owner==='controller'){if(previous==='keyboard'&&state.mode==='playing'&&game?.pendingGrenade?.cooking)game.releaseGrenade();controls.reset();mouse.reset();state.inputMode='controller';state.controllerUnlockAt=performance.now();if(document.pointerLockElement===canvas)document.exitPointerLock();}else if(state.inputMode==='controller')state.inputMode=document.pointerLockElement===canvas?'locked':'idle';controllerHud?.sync();controllerPanel?.sync();inputHint();},
  devicesChanged:()=>controllerPanel?.sync(),disconnect:()=>{if(state.mode==='playing')menu('Paused','Controller disconnected. Reconnect it or use mouse and keyboard.');}
});
const pauseMenu=new PauseMenu(settings,{openSaves:mode=>saveSlots.open(mode),saveCount:()=>saves.count(),resume:enterPlay,restart:()=>coop?leaveCoop():startGame(),quit:()=>{if(coop){leaveCoop();return;}game.newGame();resetVisuals();presence.setStatus('lobby');menu(mapChoice.title,'Solo Zombies');}});
// Leaving a co-op game returns this player to the lobby; the others play on.
function leaveCoop(){teardownCoop();game.newGame();resetVisuals();presence.setStatus('lobby');menu(mapChoice.title,'Solo Zombies');pauseMenu.setContext('start');lobbyMode=null;if(presence.state)syncLobbyStart(presence.state);}
controllerPanel=new ControllerPanel(gamepadSettings,gamepads,pauseMenu);controllerMenu=new ControllerMenu(pauseMenu,{mode:()=>state.mode,launch,notice:text=>{$('message').textContent=text;notice(text);}});controllerHud=new ControllerHud(gamepads);controllerHud.sync();
const lobby=new ZombiesLobby(pauseMenu);
// Black Ops rows name each player's character; World at War rows are numbered.
lobby.nameFor=(player,mine)=>blackOps?characterNames[player.character??(mine?character:0)].toUpperCase():'PLAYER '+(player.slot+1);
// Players on this server who open the same map share its pre-game lobby.
// Black Ops characters are unique per lobby: before the map loads, take the
// character the lobby assigns. Starting a game is still a solo game.
// Only the host starts: everyone in the lobby loads, then all go in together.
let matchGo=null,lobbyMode=null;
const presence=new LobbyPresence(mapChoice.id,{character:blackOps?character:null,invite:new URL(location.href).searchParams.get('lobby'),
  onChange:shared=>{const me=shared.players.find(p=>p.id===shared.you);if(blackOps&&me&&me.character!==character&&!gameLoading){character=me.character;presence.character=character;}lobby.setShared(shared);syncLobbyStart(shared);},
  onFull:full=>{$('message').textContent=`That lobby already has ${full.max} players. You can still play solo.`;},
  onStart:match=>{if(!['loading','starting','playing'].includes(state.mode))startGame(null,match);},
  onGo:()=>matchGo?.resolve()});
// Co-op is opt-in: join another player's lobby from the list, leave it, or
// share an invite link to this one (?lobby=).
lobby.onJoin=id=>presence.move(id).then(error=>{if(error)$('message').textContent=error;});
lobby.onLeave=()=>presence.move(null).then(error=>{if(error)$('message').textContent=error;});
lobby.onInvite=()=>{
  if(!presence.lobbyId)return;const url=new URL(location.href);url.searchParams.set('map',mapChoice.id);url.searchParams.set('lobby',presence.lobbyId);
  const done=copied=>{$('message').textContent=(copied?'Invite link copied: ':'Invite link: ')+url.href+(/^(localhost|127\.|\[::1\])/.test(location.hostname)?' (friends on your network need this computer\'s network address instead of localhost)':'');};
  navigator.clipboard?.writeText(url.href).then(()=>done(true),()=>done(false))??done(false);
};
function syncLobbyStart(shared){
  const others=shared.players.length>1,waiting=shared.match&&!shared.match.go&&shared.match.players.includes(shared.you);
  if(waiting&&matchGo?.loaded)launch.waiting(`Map ready · waiting for players (${shared.match.loaded.length}/${shared.match.players.length})`);
  // Never wait on a match that went ahead (or ended) without this player.
  else if(matchGo?.loaded)matchGo.resolve();
  if(pauseMenu.context!=='start'||['loading','starting','playing'].includes(state.mode))return;
  const label=!others||presence.isHost?'START GAME':'WAITING FOR HOST';if($('play').textContent!==label)pauseMenu.setText('play',label);
  const mode=!others?'solo':presence.isHost?'host':'guest';if(mode===lobbyMode)return;lobbyMode=mode;
  $('message').textContent=mode==='host'?'You are the host. Start Game when everyone is here; all players load in together.':mode==='guest'?'Waiting for the host to start the game.':'Choose your map, then Start Game. Assets load with the original loading movie.';
}
const saveSlots=new SaveSlots(pauseMenu,saves,{currentMap:mapChoice.id,canSave:saveBlocked,save:saveGame,load:loadSlot,weaponName:n=>game?game.weaponName(n):n});
const testingMenu=new TestingMenu(pauseMenu,()=>state.ready?game:null);
canvas.setAttribute('aria-label',mapChoice.title+' Zombies game');document.title=(bo2?'Black Ops II':blackOps?'Black Ops':'WaW')+' Zombies - '+mapChoice.title;
settings.subscribe(value=>{baseFov=worldFov(value.fov);renderer.setPixelRatio(Math.min(devicePixelRatio,1.5)*value.renderScale/100);renderer.setSize(innerWidth,innerHeight);if(audio)audio.volume=value.volume;controls.reset();mouse.reset();inputHint();});
const nodePos=e=>e.origin.split(/\s+/).map(Number);

function notice(text){$('notice').textContent=text;noticeDue=performance.now()+3500;}
function cameraPose() {
  if(gameOver?.pose(camera))return;
  if(remotePlayers)remotePlayers.watched=null;
  if(coop?.dead&&session){const id=[...coop.remotes.keys()].find(id=>{const s=session.sample(id);return s&&!s.dead;}),s=id&&session.sample(id);if(remotePlayers)remotePlayers.watched=id||null;
    if(s){camera.up.set(0,0,1);camera.position.set(s.p[0],s.p[1],s.p[2]+(s.stance==='prone'||s.down?11:s.stance==='crouch'?40:60));camera.lookAt(camera.position.clone().add(new THREE.Vector3(Math.cos(s.yaw)*Math.cos(s.pitch),Math.sin(s.yaw)*Math.cos(s.pitch),Math.sin(s.pitch))));return;}}
  const p=game?game.renderPosition(game.player):[0,424,17],d=game?divePresentation(game,game.time-1/120+game.accumulator):null;
  camera.up.set(0,0,1);camera.position.set(p[0],p[1],p[2]+(game?.viewHeight??60)+(d?.cameraOffsetUnits||0)+stepOffset);
  let yaw=state.yaw+kickYaw,pitch=THREE.MathUtils.clamp(state.pitch+kickPitch+(d?.cameraPitchRadians||0),-1.45,1.45);
  if(game?.dive||game?.diveRecovery){const turn=Math.atan2(Math.sin(yaw-d.yaw),Math.cos(yaw-d.yaw)),limit=d.config.lookYawLimitDegrees*Math.PI/180;yaw=d.yaw+THREE.MathUtils.clamp(turn,-limit,limit);pitch=THREE.MathUtils.clamp(pitch,-d.config.lookPitchLimitDegrees*Math.PI/180,d.config.lookPitchLimitDegrees*Math.PI/180);}
  if(diveThirdPerson&&game){camera.position.set(p[0]-Math.cos(d.yaw)*140,p[1]-Math.sin(d.yaw)*140,p[2]+70);camera.lookAt(p[0],p[1],p[2]+20);}
  else{camera.lookAt(camera.position.clone().add(new THREE.Vector3(Math.cos(yaw)*Math.cos(pitch),Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch))));if(d?.cameraRollRadians)camera.rotateZ(d.cameraRollRadians);}
  game?.aim(yaw,pitch);
}
function menu(title,description,button='Resume game') {
  paused=true;state.mode='menu';controls.reset();mouse.reset();gamepads.suppressHeld();controllerPanel.cancel();document.body.classList.remove('playing');
  if(!coop)audio?.suspend();
  $('menu-copy').textContent=game&&game.phase!=='ready'?'Round '+(game.round||1)+' · '+game.player.kills+' kills':description;
  pauseMenu.setContext(game&&game.phase!=='ready'?'pause':'start');
  if(state.inputMode==='locked')state.lockLostAt=performance.now();state.inputMode='idle';
  if(document.pointerLockElement)document.exitPointerLock();
}
// Three named server slots per map. A save snapshots the whole session.
function saveBlocked(){if(coop)return 'Co-op games cannot be saved.';return game?.dive||game?.diveRecovery?'Finish the dive and weapon recovery before saving.':game?.canSave()?null:'Finish drinking, collect your Pack-a-Punch weapon or throw your grenade, then save.';}
function slotSummary(){
  const g=game,r=g.mapRules;
  return {round:g.round,phase:g.phase,points:g.player.points,kills:g.player.kills,headshots:g.player.headshots,health:Math.round(g.player.health),
    weapons:g.inventory.map(w=>g.weaponName(w.name)),perks:r?[...r.perks].map(p=>(bo2?BO2_PERKS:PERKS)[p]?.name||p):[],power:r?r.power:null,links:r?(blackOps?Number(r.teleporterLinked):r.links.size):null,teleporterTotal:bo2?0:blackOps?1:3,
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
// The lobby's player row names the character (Black Ops).
function showCharacter(){lobby.renderPlayers();}
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
async function startGame(slot=null,match=null){
  if(['loading','starting'].includes(state.mode))return;
  if(!match&&(pauseMenu.context==='start'||coopEnded)&&presence.others.length){
    // A shared lobby starts only from the host's Start, and as a new game.
    if(slot!==null){$('message').textContent='Saves can be loaded when you are alone in the lobby.';return;}
    if(presence.isHost)presence.start().then(result=>{if(typeof result==='string')$('message').textContent=result;});
    return;
  }
  if(match){let resolve;matchGo={id:match.id,loaded:false,promise:new Promise(r=>resolve=r)};matchGo.resolve=resolve;}else matchGo=null;
  paused=true;state.mode='loading';state.error=null;controls.reset();mouse.reset();document.body.classList.remove('playing');presence.setStatus('loading');
  const movieFinished=launch.begin({hold:!!match});
  try{
    // Unlock game audio on this click, before the movie/download await points.
    launchAudioContext??=new AudioContext();launchAudioContext.resume().catch(console.warn);
    let save;
    if(slot!==null){await saves.refresh();save=saves.get(mapChoice.id,slot);if(!save)throw new Error('This save slot is now empty.');}
    if(blackOps&&/^[0-3]$/.test(String(save?.state.character))&&save.state.character!==character){
      // The arms rigs are built for one character; reopen the save as its own.
      if(state.ready){const url=new URL(location.href);url.searchParams.set('load',String(slot+1));url.searchParams.set('character',String(save.state.character));location.assign(url.href);return;}
      character=save.state.character;presence.setCharacter(character);showCharacter();
    }
    if(!state.ready){gameLoading??=init();await gameLoading;}
    teardownCoop();
    if(save){game.loadState(save.state);state.yaw=save.state.yaw;state.pitch=save.state.pitch;cameraPose();}
    else{game.newGame();resetVisuals();if(mapChoice.id==='moon'){state.yaw=game.mapRules.spawnYaw;state.pitch=0;cameraPose();}}
    if(match)setupCoop(match);
    const url=new URL(location.href);url.searchParams.delete('load');history.replaceState(null,'',url.href);
    launch.ready();
    if(match){
      // Hold on the loading screen until every player in the match has loaded.
      matchGo.loaded=true;launch.waiting('Map ready · waiting for players…');await presence.loaded(match.id);await matchGo.promise;launch.release();
    }
    await movieFinished;await enterPlay(!!match);
  }catch(error){console.error(error);state.error=error.message;launch.fail(error);}
}
// Co-op: this browser joins the match's relay as host or guest.
function setupCoop(match){
  const shared=presence.state,me=shared?.players.find(p=>p.id===shared.you);if(!shared||!me)return;
  const host=match.host===shared.you;
  session=new NetSession(mapChoice.id,shared.you,{state:()=>coop?.state(),snapshot:host?()=>coop?.snapshot():null,
    onEvent:(from,msg)=>coop?.handle(from,msg),onSnapshot:(snap,now)=>coop?.receive(snap,now),
    onHostLost:()=>{if(coop&&!coop.over){notice('The host left the game.');coop.gameOver({});}}});
  coop=new Coop(game,session,{host,localId:shared.you,slot:me.slot??0,character:blackOps?character:null});coopEnded=false;
  remotePlayers=new RemotePlayers(scene,{definitions:game.data.playerBodies||null,illumination:p=>map.illumination(p),weapons:game.data.weapons,audio,animations:game.data.playerAnimations||[]});
  const spawn=coop.spawnPoint();game.player.position=spawn.slice();game.player.previousPosition=spawn.slice();const yaw=coop.spawnYaw();if(yaw!==null){state.yaw=yaw;cameraPose();}
  session.start();
}
function teardownCoop(){
  session?.stop();remotePlayers?.dispose();
  if(coop&&game){for(const key of ['damagePlayer','changeStance','use','tickEnemy','pickup','startRound','updateCarpenter','emit'])delete game[key];game.coop=null;game.mirror=false;}
  session=null;coop=null;remotePlayers=null;
}
async function enterPlay(fromMatch=false) {
  if(state.mode==='starting')return;
  paused=true;state.mode='starting';$('play').disabled=true;controls.reset();mouse.reset();canvas.focus();
  const soundReady=audio.start();
  controllerPanel.cancel();gamepads.suppressHeld();if(gamepads.active){state.inputMode='controller';inputHint();}else requestMouse('resume');
  try{
    // A match can begin without a click in this tab, before the browser allows
    // sound; play on silently and resume sound on the first click or key.
    if(fromMatch)await Promise.race([soundReady,audio.preload()]);else await soundReady;paused=false;state.mode='playing';document.body.classList.add('playing');game.start();presence.setStatus('playing');
    if(game.pendingGrenade?.cooking&&!settings.held('grenade',controls.tokens)&&!gamepads.grenadeHeld)game.releaseGrenade();
  }catch(error){console.error(error);state.error=error.message;menu('Unable to start audio',error.message,'Try again');}
  finally{$('play').disabled=false;}
}
// end_game(): the downed player falls, GAME OVER fades in with the
// game-over music, and the intermission cameras tour the map before the
// end-of-game menu. Any key or click after the first second skips ahead.
const GAME_OVER_MUSIC=bo2||blackOps?'mus_zombie_game_over':'mx_game_over';
function startGameOver(stats){
  if(gameOver?.active||state.mode==='dead')return;
  gameOverStats=stats;state.mode='gameover';paused=true;controls.reset();mouse.reset();document.body.classList.remove('playing');document.body.classList.add('game-over');
  gameOver??=new GameOverSequence({entities:game.entities,game:blackOps?'black-ops':'waw'});
  gameOver.start({round:stats.round,eye:camera.position.toArray(),yaw:state.yaw,pitch:state.pitch,eyeAbove:game.viewHeight??60,fall:bo2?buriedFall():null});
  // takeallweapons(): the gun goes at once; Buried loads the death throe
  // hands now so they are ready to reach out when the fall lands.
  throe=null;if(bo2){audio?.play('zmb_player_death_fall',1);const d=game.data.gestures?.death_throe;
    if(d)throeLoad=weaponView.load({name:d.name,definition:d,clip:1},map.illumination(game.player.position)).then(()=>d).catch(error=>{console.error(error);return null;});}
  if(document.pointerLockElement)document.exitPointerLock();
}
// zm_buried fall_down(): pushed 40-63 units along the killing hit (clipped
// by playerphysicstrace), landing with the eye 10 above the floor.
function buriedFall(){
  const p=game.player.position,hull=game.playerHull;let dir=[1,0];
  if(lastHitFrom){const dx=p[0]-lastHitFrom[0],dy=p[1]-lastHitFrom[1],length=Math.hypot(dx,dy);if(length>.01)dir=[dx/length,dy/length];}
  const speed=40+Math.floor(Math.random()*12)+Math.floor(Math.random()*12),center=[p[0],p[1],p[2]+hull[2]];
  const land=game.collision.trace(center,[center[0]+dir[0]*speed,center[1]+dir[1]*speed,center[2]],hull).end;
  return {to:[land[0],land[1],p[2]+10],roll:Math.random()*10-5,bounce:8+Math.floor(Math.random()*4),back:[dir[0]*speed*.1,dir[1]*speed*.1]};
}
function gameOverEvent(event){
  // Once landed, the death_throe_zm hands reach out, then idle.
  if(event==='throe')throeLoad?.then(d=>{if(!d||!gameOver?.active)return;throe={definition:d,at:gameOver.time,idle:false};weaponView.play(d.raiseAnim,.6,false,true);});
  if(event==='start'){
    // The zombies left standing stop where they are.
    for(const e of game.enemies)if(!e.dead&&!e.attack){e.gait='ai_zombie_idle_v1';e.attacking=false;}
    // Black Ops switches to the game_over music state (SILENCE beneath it);
    // Der Riese sets its end_of_game music state.
    if(blackOps||mapChoice.id==='der-riese'){audio?.stopSession(true);audio?.play(GAME_OVER_MUSIC,1);}
  }
  // Nacht plays end_of_game a second after GAME OVER appears.
  if(event==='music'&&!blackOps&&mapChoice.id!=='der-riese'){audio?.stopSession(true);audio?.play(GAME_OVER_MUSIC,1);}
  // intermission(): players get their health back, ending the red overlay.
  if(event==='intermission')hurt.reset();
  // zombie_game_over_death(): one at a time, each zombie loses its head.
  if(event==='gib'){const e=game.enemies.find(x=>!x.dead&&x.kind!=='ghost');if(e){e.dead=true;e.deathHeadshot=true;e.deathTime=game.time;e.killDirection=[Math.random()-.5,Math.random()-.5,.2];game.emit('kill',e);}}
  if(event==='end')finishGameOver();
}
function finishGameOver(){if(!gameOver?.active)return;gameOver.stop();throe=null;document.body.classList.remove('game-over');death(gameOverStats);}
addEventListener('keydown',e=>{if(!gameOver?.active)return;e.stopImmediatePropagation();if(!e.repeat&&gameOver.time>1)finishGameOver();});
addEventListener('pointerdown',e=>{if(!gameOver?.active)return;e.stopImmediatePropagation();e.preventDefault();if(gameOver.time>1)finishGameOver();},true);
function death(stats) {
  state.mode='dead';paused=true;controls.reset();mouse.reset();presence.setStatus('lobby');if(coop){coopEnded=true;session?.stop();}
  audio?.stopSession(true);deathFxTime=0;grenadeView?.reset();
  $('menu-copy').textContent=`Reached round ${stats.round} · ${stats.kills} kills · ${game.player.headshots} headshots · ${stats.points} points. Take another run at ${mapChoice.title}.`;
  pauseMenu.setContext(coopEnded?'start':'dead');document.body.classList.remove('playing');
  if(coopEnded){lobbyMode=null;if(presence.state)syncLobbyStart(presence.state);}
  if(document.pointerLockElement)document.exitPointerLock();
}
async function loadGun(weapon) {
  if(!weaponView||!game)return;await Promise.all([weaponView.load(weapon,map.illumination(game.player.position)),playerBody?.weapon(weapon)]);
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
      if(at&&!bo2&&/zombie_treasure_box|p6_anim_zm_magic_box/.test(item.entity.model||''))item.object.visible=item.object.position.distanceTo(new THREE.Vector3(...at))<150;
      if(item.entity.targetname==='teleporter_link_cable_on')item.object.visible=game.mapRules.teleporterLinked;
      if(item.entity.targetname==='teleporter_link_cable_off')item.object.visible=!game.mapRules.teleporterLinked;
    }
  }
}
// Map entities the rules move (Ascension's lander, rocket and blast doors):
// drawn at their placement plus the rules' offset, outside portal culling.
function updateMovers(){
  const rules=game.mapRules;if(!rules?.moverOffset)return;
  for(const target of rules.moverTargets)for(const item of dynamic.get(target)||[]){
    const offset=rules.moverOffset(item.entity);if(!offset)continue;
    if(!item.base){item.base=item.object.position.clone();const holder=item.object.parent,i=cellObjects.findIndex(c=>c.holder===holder);if(i>=0){cellObjects.splice(i,1);holder.visible=true;}}
    item.object.position.set(item.base.x+offset[0],item.base.y+offset[1],item.base.z+offset[2]);
  }
}
function open(e) {
  const targets=!game?.mapRules&&e.target.includes('upstairs')?['upstairs_blocker','upstairs_blocker2']:[e.target];
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
    if(entity.closedAnim){const clip=await originalAnimation(entity.closedAnim,object,false),mixer=new THREE.AnimationMixer(object);const action=mixer.clipAction(clip);action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();mixer.setTime(clip.duration);
      // T6 board clips place each board by root motion (board 1 high, 6 low).
      if(clip.userData.rootEnd)object.position.fromArray(clip.userData.rootEnd);}
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
    // Entities without a targetname are found by "#<script_noteworthy>" or
    // "@<script_linkname>" (Verrückt's box rubble and trap levers).
    const key=entity.targetname||(entity.script_noteworthy&&'#'+entity.script_noteworthy)||(entity.script_linkname&&'@'+entity.script_linkname);
    if(key){if(!dynamic.has(key))dynamic.set(key,[]);dynamic.get(key).push({object:group,entity});}
  }
}
function resetVisuals() {
  actors?.reset();
  for(const item of dynamic.values())for(const v of item)v.object.visible=true;
  for(const v of dropVisuals.values()){effects.dispose(v.glow);scene.remove(v.root);}dropVisuals.clear();
  for(const b of boxVisuals.values()){b.weaponRoot.visible=false;b.glow.visible=false;b.lid.object.quaternion.copy(b.closed);}
  for(const burst of bursts)effects.dispose(burst.root);bursts.length=0;
  combatEffects.reset();blood.reset();
  buriedView?.reset();polish?.reset();polishBottle=null;
  coastView?.reset();
  moonView?.reset();
  shangriView?.reset();
  fiveView?.reset();
  shiView?.reset();
  deathFxTime=0;
  grenadeView?.reset();
  state.yaw=game?.mapRules?.spawnYaw??(game?.data.map?Number(game.entities.find(e=>e.targetname==='initial_spawn_points').angles.split(' ')[1])*Math.PI/180:Math.PI);state.pitch=0;factoryVisuals();kickPitch=0;kickYaw=0;damageFlash=0;hurt.reset();zombieVox?.reset();gameOver?.stop();throe=null;lastHitFrom=null;document.body.classList.remove('game-over');controls.reset();aimBlend=0;mouse.reset();lastLight=-1;cameraPose();
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
  const shotStarted=performance.now();
  if(coop)coop.shots++;
  const d=game.weapon.definition,prefix=aimBlend>.8?'ads':'hip';
  const range=(a,b)=>a+(b-a)*Math.random();
  // Kick values are impulses; the view settles between shots.
  kickPitch+=THREE.MathUtils.degToRad(range(d[prefix+'ViewKickPitchMin'],d[prefix+'ViewKickPitchMax'])*.028);
  kickYaw+=THREE.MathUtils.degToRad(range(d[prefix+'ViewKickYawMin'],d[prefix+'ViewKickYawMax'])*.015);
  weaponView.shot(aimBlend);
  if(polish&&!game.weapon.name.startsWith('slowgun')){const m=muzzlePosition();polish.muzzle(m?m.toArray():camera.position.toArray(),game.time,d);}
  const bloodied=new Set();
  for(const r of ray.rays||[ray]){
    if(r.hits?.length){for(const hit of r.hits)if(hit.applied&&!bloodied.has(hit.enemy)){bloodied.add(hit.enemy);blood.burst(r.origin.map((v,i)=>v+r.dir[i]*hit.distance),r.dir,game.time);if(polish)actors.flinch(hit.enemy,hit.head,r.dir);}continue;}
    if(!r.hit&&!r.wall)continue;
    if(polish){if(r.wall)polish.impact(r,game.time);}else combatEffects.impact(r,game.time);
  }
  state.weaponShotMs=performance.now()-shotStarted;
}
// The viewmodel's tag_flash is drawn by the view camera; the same point on
// screen at the same eye distance, seen through the world camera.
function muzzlePosition(){
  if(!weaponView?.object||!weaponView.root?.visible)return null;
  if(muzzleObject!==weaponView.object){muzzleObject=weaponView.object;muzzleTag=muzzleObject.getObjectByName('tag_flash');}
  if(!muzzleTag)return null;weaponView.root.updateWorldMatrix(true,true);muzzleTag.getWorldPosition(muzzleView);
  const distance=-muzzleView.z;if(distance<=.1)return null;muzzleView.project(viewCamera);
  const tanY=Math.tan(THREE.MathUtils.degToRad(camera.fov)/2),tanX=tanY*camera.aspect;
  return muzzleWorld.set(muzzleView.x*tanX*distance,muzzleView.y*tanY*distance,-distance).applyMatrix4(camera.matrixWorld);
}
function makeDrop(drop) {
  if(!drop.restored){drop.spawned=game.time;drop.expires=game.time+26.5;}
  const v=createPickupView(drop,dropTemplates.get(drop.type),effects,drop.spawned??game.time);scene.add(v.root);dropVisuals.set(drop,v);if(!drop.restored)audio.play('spawn_powerup');
}
function pickupVisual(drop){
  polish?.pickup(drop,game.time);
  const root=effects.create('misc/fx_zombie_powerup_grab',game.time);root.position.fromArray(drop.position);root.position.z+=40;scene.add(root);bursts.push({root,due:game.time+1});
}
function updateDrop(drop,v){
  v.root.position.fromArray(drop.position);v.root.position.z+=40;
  updatePickupView(drop,v,game.time,effects);
}
async function prepareBox(manifest){
  for(const [name,d]of Object.entries(manifest.weapons)){const object=cloneModel(await model(d.worldModel));applyHideTags(object,d.hideTags);if(d.originsElement)await attachWeaponModels(object,d,'World');shadeModel(object,[.7,.7,.7]);boxTemplates.set(name,object);}
  for(const e of manifest.entities.filter(e=>e.targetname==='treasure_chest_use')){
    // Buried's box lid, leave and arrive play the zbarrier's own clips (BuriedView).
    if(bo2){const item=dynamic.get(e.target)?.[0];if(!item)throw new Error('Buried mystery box missing.');const v=createBoxView({object:new THREE.Object3D(),entity:item.entity},item.entity,boxTemplates,effects,180);scene.add(v.weaponRoot,v.glow);boxVisuals.set(e.target,v);continue;}
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
      if(game.gesture?.key!==e.key)return;
      if(game.gesture.phase==='raise')weaponView.play(e.anim||d.firstRaiseAnim,Math.max(.1,game.gesture.due-game.time),false,true);
      else if(game.gesture.phase==='hold')weaponView.play(d.idleAnim,0,true);
    }).catch(console.error);
  }else if(e.phase==='hold'){if(weaponView.weapon?.name===e.definition.name)weaponView.play(e.definition.idleAnim,0,true);}
  else if(e.phase==='drop')weaponView.play(e.definition.dropAnim,e.duration,false,true);
  else loadGun(game.weapon).then(()=>{const raise=game.weapon.definition.raiseAnim;if(raise)weaponView.play(raise,e.duration);}).catch(console.error);
}
function updateAudio(){
  if(!audio||!game)return;
  const forward=[Math.cos(state.yaw)*Math.cos(state.pitch),Math.sin(state.yaw)*Math.cos(state.pitch),Math.sin(state.pitch)];
  audio.listen(camera.position.toArray(),forward);
  // Machine loops (rollers hum, take-it timer) live at the machine; restart
  // one if the audio session cut it (death, resume).
  if(audio.context?.state==='running'&&game.phase!=='dead')for(const l of loops.values())if(audio.sounds[l.spec.alias]&&(!l.record||l.record.ended))l.record=audio.play(l.spec.alias,1,{...l.spec,loop:true});
  for(const l of loops.values())if(l.spec.followBus&&game.mapRules.bus){l.spec.position=game.mapRules.bus.position;l.record?.setPosition(l.spec.position);}
}
async function init() {
  const began=performance.now();
  const progress=text=>{state.loading=text;launch.update(launch.element('progress').value,text);};
  const prepared=async(n,text)=>{launch.prepared(n,text);state.loading=text;await new Promise(requestAnimationFrame);};
  await preloadAssets(progress,info=>launch.downloaded(info));await prepared(0,'Preparing downloaded assets…');
  const [manifest,collision,paths,recovered,navigation,powerNavigation,gateNavigation]=await Promise.all([get('/data/'+mapChoice.data+'/manifest.json',true),get('/data/'+mapChoice.zone+'/web-world/'+mapChoice.asset+'.collision.json',true),get('/data/'+mapChoice.zone+'/web-world/'+mapChoice.asset+'.paths.json',true),get('/data/'+mapChoice.data+'/presentation.json',true),get('/data/'+mapChoice.data+'/navigation.json',true),mapChoice.id==='der-riese'?get('/data/'+mapChoice.data+'/power-navigation.json',true).catch(()=>null):null,blackOps&&!bo2?null:get('/data/'+mapChoice.data+'/gate-navigation.json',true).catch(()=>null)]);presentation=recovered;
  map=await loadMap(scene,progress);
  await prepared(1,'Preparing original map objects…');await dynamicAssets(manifest.entities);
  await prepared(2,'Preparing original weapons and Zombies…');
  if(blackOps)for(const d of [...Object.values(manifest.weapons),...Object.values(manifest.gestures||{}),manifest.grenade])if(!d.mobGhostHands)d.handsModel=characterArms[character];
  audio=new OriginalAudio(manifest.sounds,launchAudioContext);zombieVox=new ZombieVox(audio,ZOMBIE_VOX[bo2?'black-ops-2':blackOps?'black-ops':mapChoice.id==='der-riese'?'der-riese':'nacht']);voice=blackOps?new PlayerVoice(audio,manifest.voice,character):null;audio.volume=settings.value.volume;weaponView=new WeaponView(viewScene,audio);effects=new OriginalEffects(presentation);weaponView.effects=effects;actors=new ZombieActors(scene,map,presentation);actors.onNote=(enemy,alias)=>{if(!paused)zombieVox?.note(enemy,alias,game.time);};actors.active=visuals;
  if(blackOps){diveAudio=new DiveAudio(audio,manifest.diveAudio);playerBody=new PlayerBody(scene,p=>map.illumination(p),manifest.playerBodies,character);await playerBody.prepare();}
  if(bo2){buriedView=new (mapChoice.id==='town'?TownView:mapChoice.id==='mob-of-the-dead'?MobView:mapChoice.id==='origins'?OriginsView:mapChoice.id==='tranzit'?TranzitView:mapChoice.id==='nuketown'?NuketownView:mapChoice.id==='die-rise'?DieRiseView:BuriedView)(scene,map,dynamic,effects);await buriedView.prepare(manifest,presentation);}
  if(polishLight.enabled){
    // Buried's lighting and effects polish (tools/prepare_buried_polish.mjs).
    polish=new BuriedPolish({scene,camera,map,collision:null,settings,audio,emitShake:e=>{if(!game)return;if(!shake||game.time>=shake.until||e.amplitude>shake.amplitude)shake={until:game.time+e.duration,amplitude:e.amplitude};}});
    let data=null;try{data=await get('/data/'+mapChoice.data+'/polish.json',true);}catch(error){console.warn('Buried polish data unavailable; run node tools/prepare_buried_polish.mjs.',error.message);}
    await polish.prepare(manifest,data);
  }
  grenadeView=new GrenadeView(viewScene,manifest.grenade);
  progress('Preparing original pickups, knife, box and actor rigs…');
  await Promise.all([hud.load(),effects.prepare(),actors.prepare(),blood.prepare(presentation.gore),grenadeView.prepare(map.illumination([0,424,1])),weaponView.prepare({...manifest.weapons,...Object.fromEntries(Object.values(manifest.gestures||{}).map(d=>[d.name,d]))},map.illumination([0,424,1])),
    ...Object.entries(presentation.powerups).map(async([type,name])=>{const object=cloneModel(await model(name));shadeModel(object,[.9,.9,.9]);dropTemplates.set(type,object);})]);
  await prepared(3,'Preparing mystery box and grenade effects…');
  if(mapChoice.id==='moon')await weaponView.prepare(Object.fromEntries(Object.entries(manifest.weapons).map(([n,d])=>[n,{...d,handsModel:'viewmodel_zom_pressure_suit_arms',rigVariant:'pes'}])),map.illumination([0,424,1]));
  if(mapChoice.id==='call-of-the-dead')await weaponView.prepareMeleeUpgrade(manifest.map.meleeUpgrade);
  weaponView.prepareCombat();
  await prepareBox(manifest);preparePap(manifest);verrucktView=mapChoice.id==='verruckt'?new VerrucktView(scene,dynamic,manifest.entities,p=>map.illumination(p)):null;
  if(mapChoice.id==='shi-no-numa'){shiView=new ShiNoNumaView(scene,map,dynamic,manifest);await shiView.prepare();}
  if(mapChoice.id==='call-of-the-dead'){coastView=new CoastView(scene,map,dynamic);await coastView.prepare(manifest,presentation);}
  if(mapChoice.id==='moon'){moonView=new MoonView(scene,map,dynamic);await moonView.prepare(manifest,presentation);}
  if(mapChoice.id==='shangri-la'){shangriView=new ShangriView(scene,map,dynamic,effects);await shangriView.prepare(manifest,presentation);}
  if(mapChoice.id==='five'){fiveView=new FiveView(scene,map,dynamic);await fiveView.prepare(manifest,presentation);}
  const projectile=cloneModel(await model(manifest.grenade.projectileModel));shadeModel(projectile,[.5,.5,.5]);combatEffects.prepareGrenades(projectile,effects);
  await prepared(4,'Preparing map collision, navigation and audio…');
  game=new (mapChoice.id==='town'?TownEngine:mapChoice.id==='mob-of-the-dead'?MobEngine:mapChoice.id==='five'?FiveEngine:mapChoice.id==='origins'?OriginsEngine:mapChoice.id==='shangri-la'?ShangriEngine:mapChoice.id==='moon'?MoonEngine:mapChoice.id==='shi-no-numa'?ShiNoNumaGame:mapChoice.id==='call-of-the-dead'?CallOfDeadEngine:bo2?BlackOps2Engine:blackOps?BlackOpsEngine:TestingGame)(manifest,new CollisionWorld(collision,manifest.entities),paths,{
    templeView:({delta})=>{state.yaw+=delta;},
    templeDropCycle:drop=>{const v=dropVisuals.get(drop),template=dropTemplates.get(drop.type);if(v&&template){v.object.clear();v.object.add(cloneModel(template));}},
    originsTeleport:e=>{state.yaw=e.yaw;state.pitch=0;cameraPose();},
    moonTeleport:e=>{state.yaw=e.yaw;state.pitch=0;cameraPose();},
    dialog:e=>voice?.speak(e).catch(console.warn),
    platformTurn:e=>{state.yaw+=e.delta;},buriedItem:e=>buriedView?.item(e),chalkDust:target=>buriedView?.chalkDust(target,game.time),
    shiProjectile:p=>shiView?.projectile(p),shiProjectileRemove:id=>shiView?.removeProjectile(id),shiImpact:e=>shiView?.impact({...e,time:game.time}),
    buriedEquipment:e=>buriedView?.place(e),buriedEquipmentRemove:id=>buriedView?.remove(id),buriedEquipmentLaunch:e=>buriedView?.launch(e),
    buriedProjectile:e=>buriedView?.projectile(e),buriedProjectileRemove:id=>buriedView?.removeProjectile(id),projectileImpact:r=>{if(polish){if(r.wall)polish.impact(r,game.time);}else combatEffects.impact(r,game.time);if(r.hit)blood.burst(r.end,r.dir,game.time,r.hit.head);},arthurBarricade:target=>polish?.barricadeBreak(target,game,dynamic,game.time),
    coastProjectile:e=>coastView?.projectile(e),coastProjectileRemove:id=>coastView?.removeProjectile(id),fiveTeleport:e=>{state.yaw=e.yaw;},
    dive:e=>weaponView.dive(e),
    diveEvent:e=>diveAudio?.handle(e),contactSurface:(p,n)=>contactSurfaceName(map.bullets.trace([p[0]+n[0]*4,p[1]+n[1]*4,p[2]+6],[0,0,-1],24)),
    bindingName:keyName,controllerPrompts:()=>gamepads.active,
    message:notice,spawn:e=>{spawnVisual(e);zombieVox?.spawn(e,game.time);},
    zombieAttack:e=>zombieVox?.attack(e,game.time),
    kill:e=>{polish?.kill(e,game.time,game);zombieVox?.death(e,game.time);const direction=e.killDirection||e.position.map((v,i)=>v-game.player.position[i]);if(actors.kill(e,direction)&&e.deathHeadshot){const fragment=actors.active.get(e.id).headFragment;if(fragment?.active){blood.burst(fragment.p.toArray(),direction,game.time,true);if(presentation.gore?.headSound)audio.play(presentation.gore.headSound,1,{position:fragment.p.toArray()});}}},removeEnemy:e=>actors.release(e.id),reset:()=>{stepView.reset();stepOffset=0;resetVisuals();diveAudio?.reset();audio.stopSession();loops.clear();},weapon:w=>loadGun(w).catch(console.error),barrier,open,power:factoryVisuals,teleport:()=>{state.yaw=3*Math.PI/2;state.pitch=0;cameraPose();},
    traceShot:(origin,dir,range)=>{const began=performance.now(),ray=map.bullets.shot(origin,dir,range,traceEnemy);state.traceShotMs=performance.now()-began;state.maxTraceShotMs=Math.max(state.maxTraceShotMs||0,state.traceShotMs);return coop&&session?coop.blockShot(ray,origin,dir,id=>session.sample(id)):ray;},traceEnemy,shot,reload:event=>weaponView.reload(event),hit:()=>{hitTime=performance.now()+130;},melee:event=>weaponView.melee(event),meleeImpact:e=>blood.burst(e.position,e.direction,game.time),meleeAim:e=>{state.yaw=e.yaw-kickYaw;state.pitch=e.pitch-kickPitch;},damage:e=>{if(typeof e==='number')e={amount:e};lastHitFrom=e.from||null;hurt.hit({from:e.from,health:e.health??game.player.health,max:e.max??(game.mapRules?.maxHealth||100)},game.time,game.player.position);
      // Being swiped jolts the view; BO1 and BO2 play evt_player_swiped
      // (and BO2 the character's pain exert, at most every 1.5-3 s).
      if(e.from){kickPitch+=THREE.MathUtils.degToRad(-1.5-Math.random());kickYaw+=THREE.MathUtils.degToRad((Math.random()-.5)*2);
        if(blackOps)audio.play('evt_player_swiped',1);
        if(bo2&&game.time>=exertDue){exertDue=game.time+1.5+Math.random()*1.5;audio.play('vox_plr_'+character+'_exert_pain_medium_'+Math.floor(Math.random()*4),1);}}},death:startGameOver,
    sound:s=>audio.play(s.alias,s.volume??1,{position:s.position,near:s.near,far:s.far,exclusive:s.exclusive}),gesture,
    loop:spec=>{if(!loops.has(spec.id))loops.set(spec.id,{spec,record:null});},
    // Weapon switch: hold the old gun's putaway, then draw the new gun.
    weaponSwitch:e=>{if(e.phase==='drop')weaponView.play(e.anim,e.duration,false,true);else loadGun(e.weapon).then(()=>weaponView.play(e.anim,e.duration)).catch(console.error);},
    effect:e=>{const root=effects.create(e.name,game.time);root.position.fromArray(e.position);if(e.yaw)root.rotation.z=e.yaw;scene.add(root);bursts.push({root,due:game.time+e.duration});},
    // Earthquake(): strength falls off with distance from the source.
    shake:e=>{const d=camera.position.distanceTo(new THREE.Vector3(...e.position));if(d<e.radius)shake={until:game.time+e.duration,amplitude:e.amplitude*(1-d/e.radius)};},stopLoop:({id})=>{loops.get(id)?.record?.stop(.05);loops.delete(id);},sessionStart:()=>audio.startSession(),drop:makeDrop,pickup:pickupVisual,
    grenadePrepare:s=>{weaponView.offhand();grenadeView.start(s);},grenade:g=>combatEffects.grenade(g),
    explosion:g=>{combatEffects.explosion(g,game.time,g.weapon?game.data.weapons[g.weapon]?.projExplosionEffect:null);}
  },presentation,...(mapChoice.id==='ascension'?[g=>new AscensionRules(g)]:mapChoice.id==='verruckt'?[g=>new VerrucktRules(g)]:[]));
  if(blackOps)game.character=character;
  actors.collision=game.collision;if(polish){polish.collision=game.collision;polish.prepareGhosts(actors);}blood.trace=(origin,dir,range)=>map.bullets.trace(origin,dir,range);factoryVisuals();await loadGun(game.weapon);progress('Preparing spawn routes, sounds and GPU shaders…');game.prepareSpawnPaths(navigation);if(!blackOps||bo2){game.preparePowerNavigation(powerNavigation?.sourceStamp===navigation.sourceStamp?powerNavigation:null);game.useGateNavigation(gateNavigation?.sourceStamp===navigation.sourceStamp?gateNavigation:null);}await audio.preload();resetVisuals();cameraPose();
  await prepared(5,'Compiling graphics…');
  const warmScene=new THREE.Scene();warmScene.fog=scene.fog;warmScene.add(...actors.warmObjects(),...dropTemplates.values());
  const warmFx=effects.create('misc/fx_zombie_powerup_on',0);warmScene.add(warmFx);
  for(const v of boxVisuals.values())for(const object of v.choices.values())object.visible=true;
  await Promise.all([renderer.compileAsync(scene,camera),renderer.compileAsync(warmScene,camera),renderer.compileAsync(viewScene,viewCamera)]);
  for(const v of boxVisuals.values())for(const object of v.choices.values())object.visible=false;
  warmScene.remove(actors.warmObject());effects.dispose(warmFx);await prepared(6,'Uploading textures and character rigs…');await map.uploadTextures(renderer);
  // Shader compilation alone does not allocate skinning textures or geometry
  // buffers. Draw every prepared rig offscreen before the first spawn/switch.
  const gpuWarmScene=new THREE.Scene(),rigs=[...actors.pool.map(v=>v.root),...[...actors.variantPools.values()].flatMap(pool=>pool.map(v=>v.root)),...weaponView.rigs.values(),grenadeView.root,...combatEffects.grenades.map(v=>v.mesh),...combatEffects.explosions.map(v=>v.root),...blood.warmObjects(),...(playerBody?.warmObjects()||[])].map(v=>v.root||v),restore=[];
  for(const root of rigs){restore.push({root,parent:root.parent});gpuWarmScene.add(root);root.traverse(n=>{restore.push({node:n,visible:n.visible,culled:n.frustumCulled});n.visible=true;if(n.isMesh)n.frustumCulled=false;});}
  const warmTarget=new THREE.WebGLRenderTarget(64,64);
  await renderer.compileAsync(gpuWarmScene,viewCamera);renderer.setRenderTarget(warmTarget);renderer.render(gpuWarmScene,viewCamera);renderer.setRenderTarget(null);warmTarget.dispose();
  for(const item of restore)if(item.node){item.node.visible=item.visible;item.node.frustumCulled=item.culled;}else{gpuWarmScene.remove(item.root);item.parent?.add(item.root);}
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
  $('prompt').textContent=game.prompt();$('reload').textContent=game.mapRules?.afterlife?'':game.reloadEnd?'RELOADING':game.weapon.clip===0?keyName('reload')+' · RELOAD':'';
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
  const frameGapMs=Math.max(0,time-frameTime),dt=Math.min(frameGapMs/1000,.1);frameTime=time;state.frameGapMs=frameGapMs;
  gamepads.poll(dt);controllerHud.update(game,state.mode==='playing');
  if(state.mode!=='playing'||!gamepads.active)controllerAimAssist.reset();
  if(!state.ready||state.mode==='loading'){requestAnimationFrame(frame);return;}
  if(gameOver?.active)for(const event of gameOver.update(dt))gameOverEvent(event);
  if(!paused)mouse.update(time);
  if(!paused){kickPitch*=Math.exp(-dt*11);kickYaw*=Math.exp(-dt*11);if(shake&&game&&game.time<shake.until){const jolt=shake.amplitude*.04*Math.sqrt(Math.min(1,dt*60));kickPitch+=(Math.random()-.5)*jolt;kickYaw+=(Math.random()-.5)*jolt;}}cameraPose();if(game)game.ads=aimBlend;
  // Aiming ends a sprint at once; the sights rise while the player slows.
  const aimHeld=(gamepads.active?gamepads.aiming:controls.aiming)&&!game?.movementBlocked&&!game?.pendingGrenade&&!game?.gesture&&!game?.switching;
  if(aimHeld&&gamepads.active)gamepads.sprinting=false;
  const playing=!!game&&!paused&&state.mode==='playing';
  let frameInput=playing?input():{};if(coop?.down)frameInput={...frameInput,sprint:false,jump:false};if(coop?.dead)frameInput={};
  if(playing||coop&&!coop.over&&!['ready','dead'].includes(game?.phase)&&['menu','playing'].includes(state.mode)){game.update(dt,aimHeld&&playing?{...frameInput,sprint:false}:frameInput);}
  if(coop){coop.update();coop.updateRevive(playing&&!!frameInput.use,dt);remotePlayers?.update(coop,session,dt,game.time);}
  if(game)stepOffset=stepView.update(game.player,paused&&!coop?0:dt);
  hiddenStep=performance.now();
  if(gamepads.active&&game?.player.stance!=='stand')gamepads.sprinting=false;
  const adsTime=(aimHeld?game?.weapon.definition.adsTransInTime:game?.weapon.definition.adsTransOutTime)||.25;
  if(!paused)aimBlend=THREE.MathUtils.clamp(aimBlend+(aimHeld&&!game?.reloadEnd?1:-1)*dt/adsTime,0,1);
  const adsFov=THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(THREE.MathUtils.degToRad(game?.weapon.definition.adsZoomFov||60)/2)*.75));
  const fov=baseFov+(adsFov-baseFov)*aimBlend;
  if(Math.abs(camera.fov-fov)>.01){camera.fov=fov;camera.updateProjectionMatrix();}cameraPose();
  for(const v of visuals.values()) {
    if(v.enemy.dead&&game.time-v.enemy.deathTime>5){actors.release(v.enemy.id);continue;}
    actors.updateOne(v,paused&&!gameOver?.active?0:dt,game.renderPosition(v.enemy),game.renderAngle?.(v.enemy));
  }
  if(game&&!paused&&state.mode==='playing')zombieVox?.update(game.time,game,game.yaw);
  for(const [drop,v]of dropVisuals){if(drop.used||game.time>drop.expires){effects.dispose(v.glow);scene.remove(v.root);dropVisuals.delete(drop);}else updateDrop(drop,v);}
  if(game&&state.ready){factoryVisuals();updateMovers();updateBoxes();verrucktView?.update(game,cellObjects);shiView?.update(game,cellObjects);coastView?.update(game,cellObjects);moonView?.update(game,cellObjects);shangriView?.update(game,cellObjects);fiveView?.update(game,cellObjects);updatePap();updateAudio();}
  for(let i=bursts.length-1;i>=0;i--){const b=bursts[i];if(game.time>=b.due){effects.dispose(b.root);bursts.splice(i,1);}else effects.update(b.root,game.time);}
  if(game?.phase==='dead')deathFxTime+=dt;
  if(game){combatEffects.update(game.time+deathFxTime,Math.min(1,game.accumulator*120));blood.update(game.time+deathFxTime);}
  if(throe&&gameOver?.active&&!throe.idle&&gameOver.time>throe.at+.6){throe.idle=true;weaponView.play(throe.definition.idleAnim,0,true);}
  const showWeapon=(!gameOver?.active&&(state.mode==='playing'||pauseMenu.context==='pause')||!!throe&&gameOver?.active&&gameOver.time<3)&&!diveThirdPerson,offhand=grenadeView&&game?grenadeView.update(game.time,showWeapon):0;
  // The Paralyzer's glow lines shift from cold to hot with its heat.
  if(game){const slowgun=game.weapon.name.startsWith('slowgun');weaponHeat.value=slowgun?game.paralyzerHeat/115:0;if(weaponView)weaponView.dialValue=slowgun?game.paralyzerHeat:null;}
  if(weaponView?.root&&game){weaponView.root.visible=showWeapon&&offhand<.999;weaponView.update(paused&&!gameOver?.active?0:dt,{ads:aimBlend,moving:game.moving,sprinting:game.sprinting,stance:game.player.stance,time:game.time,reloading:!!game.reloadEnd,offhand});}
  if(game)playerBody?.update(game,state.mode==='playing'||pauseMenu.context==='pause');
  if(game&&game.time>lastLight+.3){lastLight=game.time;
    if(polish&&map.lightProbe){const p=game.player.position,probe=map.lightProbe([p[0],p[1],p[2]+50]),dir=new THREE.Vector3(...probe.direction).transformDirection(camera.matrixWorldInverse).toArray(),materials=[];
      weaponView?.object?.traverse(n=>{if(n.isMesh)materials.push(...[n.material].flat());});applyProbe(materials,probe,{scale:1.5,dir,floor:.09});}
    else{const color=map.illumination(game.player.position);weaponView?.object?.traverse(n=>{if(n.isMesh&&n.material.color&&!n.material.userData.fixedLight)n.material.color.setRGB(...color.map(v=>Math.max(.09,v*1.5)));});}
    for(const v of visuals.values())actors.light(v);
  }
  if(game)hurt.update(game.time+deathFxTime,{health:game.player.health,max:game.mapRules?.maxHealth||100,viewYaw:game.yaw});
  if(game&&state.ready)buriedView?.update(game,paused?0:dt,cellObjects);
  if(polish&&game&&state.ready){
    const now=game.time+deathFxTime,step=paused&&!gameOver?.active?0:dt,a=game.mapRules?.arthur;
    if(weaponView)weaponView.vibration=game.flight&&game.paralyzerFiring?1:0;
    polish.paralyzer(game,showWeapon?muzzlePosition():null,step,now);
    polish.paralyzedBodies(game,visuals,now,step);
    if(a&&buriedView?.object){polish.arthurFeet(buriedView.object,a,now,game);
      // The jug leaves his hand at "hitground": it shatters there.
      if(polishBottle==='booze'&&a.prop!=='booze'&&a.state==='drink'){const jug=buriedView.props?.booze;if(jug)polish.bottleBreak(jug.getWorldPosition(new THREE.Vector3()).toArray(),now);}polishBottle=a.prop;}
    const feet=[];for(const v of visuals.values())if(v.root.visible&&!v.enemy.dead&&v.enemy.kind!=='ghost'&&v.enemy.stage!=='rise')feet.push({position:game.renderPosition(v.enemy),radius:15});
    if(a&&buriedView?.root&&buriedView.object?.visible!==false)feet.push({position:buriedView.root.position.toArray(),radius:24});
    polish.shadows(feet);polish.update(game,step,now,{visibleCells:map.visibleCells,buriedView,drops:dropVisuals.keys()});
  }
  map?.updateVisibility(camera);applyCellCulling();
  const renderStarted=performance.now();renderer.info.reset();renderer.autoClear=true;renderer.render(scene,camera);if(weaponView?.root?.visible||grenadeView?.root?.visible){renderer.autoClear=false;renderer.clearDepth();renderer.render(viewScene,viewCamera);}state.renderFrameMs=performance.now()-renderStarted;
  if(game&&state.mode==='playing'&&time>=hudDue){
    if(coop){const names=blackOps?characterNames.map(n=>n.toUpperCase()):null,target=coop.reviveTarget();
      game.coopHud={rows:coop.scoreboard(names),markers:(remotePlayers?.markers(camera,innerWidth,innerHeight)||[]).map(m=>({...m,name:coop.nameOf(m.id,names),color:coop.scoreboard(names).find(r=>r.id===m.id)?.color})),
        down:coop.down?Math.max(0,Math.ceil(coop.down.bleedout-game.time)):null,dead:coop.dead,revive:target?{name:coop.nameOf(target.id,names),progress:coop.revive?.id===target.id?coop.revive.progress:0,key:keyName('use')}:null};}
    else game.coopHud=null;
    hud.draw(game,aimBlend,time<hitTime,camera.fov);hudDue=time+1000/60;}
  if(state.ready&&state.mode==='playing'){frameSamples.push({dt:frameGapMs,cpu:performance.now()-began,trace:state.traceShotMs||0,weapon:state.weaponShotMs||0,render:state.renderFrameMs});if(frameSamples.length>600)frameSamples.shift();}
  // Frame counter: FPS and mean CPU frame time, refreshed twice a second.
  frames++;frameMsTotal+=performance.now()-began;
  if(time-fpsTime>500){state.fps=Math.round(frames*1000/(time-fpsTime));$('position').textContent=state.fps+' FPS';
    const counter=$('fps-counter');counter.classList.toggle('on',settings.value.showFps);if(settings.value.showFps)counter.textContent=state.fps+' FPS\n'+(frameMsTotal/frames).toFixed(1)+' ms CPU';
    frames=0;frameMsTotal=0;fpsTime=time;}
  if(time>=domDue){updateHud();domDue=time+100;}
  requestAnimationFrame(frame);
}
window.wawPreview={state,camera,renderer,scene,applyCellCulling,get weaponView(){return weaponView;},get verrucktView(){return verrucktView;},get frontend(){return frontend;},get bo2Menu(){return bo2Menu;},get menuAudio(){return menuAudio;},get audio(){return audio;},get voice(){return voice;},get game(){return game;},get map(){return map;},get polish(){return polish;},get buriedView(){return buriedView;},get visuals(){return visuals;},diagnostics:()=>({state,launch:launch.diagnostics(),...game?.snapshot(),settings:settings.value,map:mapChoice.id,mapRules:game?.mapRules&&{power:game.mapRules.power,links:[...game.mapRules.links],perks:[...game.mapRules.perks],zones:[...game.mapRules.activeZones()]},menu:{view:pauseMenu.view,context:pauseMenu.context,capturing:pauseMenu.capture},controls:{tokens:[...controls.tokens],input:input(),aiming:gamepads.active?gamepads.aiming:controls.aiming,controller:gamepads.diagnostics(),aimAssist:controllerAimAssist.diagnostics()},originalExecutableRunning:false,originalGscInterpreter:false,
  dive:{telemetry:game?.lastDive,phase:game?.dive?.phase||'ready',weaponRecovering:!!game?.diveRecovery,audio:diveAudio?.diagnostics(),body:playerBody?.diagnostics()},
  textures:map?.textures(),bakedLightmaps:map?.lightmapCount,renderedEnemies:visuals.size,retainedEnemies:game?.enemies.length,combatEffects:combatEffects.diagnostics(),gore:blood.diagnostics(),audioBuffers:audio?.buffers.size,audio:audio?.diagnostics(),
  weaponAnimation:weaponView?.current?.getClip().name,knifeVisible:weaponView?.knife?.visible,sprintBlend:weaponView?.sprintBlend,preparedWeapons:weaponView?.rigs.size,preparedActors:actors?.pool.length,
  grenadeView:grenadeView?.diagnostics(),grenades:game?.grenades.map(g=>({position:g.position,velocity:g.velocity,due:g.due,resting:g.resting,held:!!g.held})),pendingGrenade:game?.pendingGrenade,
  performance:{drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,staticBatches:map?.staticBatches,staticPlacements:map?.staticPlacements,
    frames:frameSamples.length,p95FrameMs:frameSamples.map(s=>s.dt).sort((a,b)=>a-b)[Math.floor(frameSamples.length*.95)],p95CpuMs:frameSamples.map(s=>s.cpu).sort((a,b)=>a-b)[Math.floor(frameSamples.length*.95)],slowFrames:frameSamples.filter(s=>s.dt>25),maxCpuMs:Math.max(0,...frameSamples.map(s=>s.cpu))},
  pickups:[...dropVisuals].map(([drop,v])=>({type:drop.type,model:presentation.powerups[drop.type],visible:v.root.visible})),boxes:game&&[...game.boxes.values()].map(b=>({phase:b.phase,weapon:b.weapon,cycles:b.index})),
  actorAnimations:[...visuals.values()].map(v=>({id:v.enemy.id,stage:v.enemy.stage,animation:v.current,position:v.enemy.position})),ads:aimBlend,
  muzzle:weaponView?.object?.getObjectByName('tag_flash')?.getWorldPosition(new THREE.Vector3()).toArray(),weaponTag:weaponView?.object?.getObjectByName('tag_weapon')?.getWorldPosition(new THREE.Vector3()).toArray(),
  illumination:game&&map?.illumination(game.player.position),aimPoints:[...visuals.values()].filter(v=>!v.enemy.dead).map(v=>({id:v.enemy.id,torso:v.root.getObjectByName('j_spineupper')?.getWorldPosition(new THREE.Vector3()).toArray(),head:v.root.getObjectByName('j_head')?.getWorldPosition(new THREE.Vector3()).toArray()}))})};
Object.assign(window.wawPreview,{
  configureDive:patch=>game?{settings:configureDive(game,patch),predicted:predictedDive(game.diveConfig)}:null,
  diveTelemetry:()=>({report:game?.lastDive,phase:game?.dive?.phase||'ready',weaponRecovering:!!game?.diveRecovery,config:game?.diveConfig,predicted:game&&predictedDive(game.diveConfig),audio:diveAudio?.diagnostics(),body:playerBody?.diagnostics()}),
  setDiveThirdPerson:on=>{diveThirdPerson=!!on;playerBody?.setThirdPerson(diveThirdPerson);cameraPose();return diveThirdPerson;}
});
if(bo2)window.bo2Preview=window.wawPreview;else if(blackOps)window.bo1Preview=window.wawPreview;
// The original menu sounds and lobby music; Black Ops' lobby sits in the
// frontend's interrogation room.
const inLobby=()=>document.body.dataset.menuContext==='start'&&!['loading','starting','playing'].includes(state.mode);
const menuAudio=new MenuAudio(bo2?'bo2':blackOps?'bo1':'waw',{volume:()=>settings.value.volume});menuAudio.attach($('overlay'));
setInterval(()=>menuAudio.music(state.lobbyReady&&inLobby()&&!document.hidden),250);
const frontend=blackOps&&!bo2&&mapChoice.engine!=='dead-ops'?new Bo1Frontend({visible:inLobby}):null;
if(frontend)menuAudio.ready.then(menu=>menu?.world&&frontend.load(menu)).catch(error=>console.warn('Black Ops frontend unavailable:',error));
// Black Ops II: the zombies menu's space backdrop and location globe. The
// map panel shows whichever location the globe is turned to, playable or not.
function showBo2Location(info){
  pauseMenu.setText('selected-map-title',info.title);
  const description=$('map-description');let where=document.querySelector('.bo2-location');
  if(!where){where=document.createElement('span');where.className='bo2-location';description.before(where);}
  where.textContent=info.location||'';where.hidden=!info.location;
  description.textContent=info.description;
  if(!info.playable){const note=document.createElement('span');note.className='bo2-unavailable';note.textContent='NOT AVAILABLE IN THIS BUILD';description.append(note);}
  pauseMenu.text?.paint();
}
let bo2Menu=null;
if(bo2)menuAudio.ready.then(menu=>{if(menu?.art?.globe_map_zm)bo2Menu=new Bo2Menu(menu,{maps:BO2_MAPS,sounds:menuAudio,visible:inLobby,onChoose:map=>lobby.choose(map),onShow:showBo2Location});}).catch(error=>console.warn('Black Ops II menu unavailable:',error));
async function bootLobby(){
  // Only menu artwork, fonts and the save catalogue are needed before Start.
  saves.prepare().then(()=>{$('resume-save').hidden=pauseMenu.context==='pause'||!saves.count();}).catch(error=>{state.savesError=error.message;});
  if(!blackOps){await hud.loadFont();await pauseMenu.prepare(hud);}
  pauseMenu.setContext('start');lobby.ready();presence.connect();state.lobbyReady=true;
  const load=Number(new URLSearchParams(location.search).get('load'));
  $('message').textContent=load>=1&&load<=3?'Start Game to continue saved slot '+load+'.':'Choose your map, then Start Game. Assets load with the original loading movie.';
  $('stats').textContent=mapChoice.title+' · Ready to launch';$('play').disabled=false;
}
setInterval(()=>{if(!document.hidden||!coop||!game||coop.over)return;const now=performance.now(),elapsed=Math.min(1,(now-hiddenStep)/1000);hiddenStep=now;for(let t=elapsed;t>1e-3;t-=.1)game.update(Math.min(.1,t),{});coop.update();},100);
for(const type of ['pointerdown','keydown'])document.addEventListener(type,()=>{if(audio?.context?.state==='suspended'&&state.mode==='playing')audio.context.resume().catch(()=>{});},true);
cameraPose();requestAnimationFrame(frame);bootLobby().catch(error=>{console.warn(error);state.lobbyReady=true;pauseMenu.setContext('start');presence.connect();$('message').textContent='Start Game to load '+mapChoice.title+'.';$('play').disabled=false;});
