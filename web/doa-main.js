import * as THREE from 'three';
import {get,loadMap,OriginalAudio} from './assets.js';
import {preloadAssets,preloadState} from './preload.js';
import {CollisionWorld} from './collision.js';
import {DeadOpsEngine,DOA_WEAPON_LABELS} from './doa-engine.js';
import {DeadOpsView} from './doa-view.js';
import {OriginalEffects} from './effects.js';
import {BloodEffects} from './gore.js';
import {ZombieVox,ZOMBIE_VOX} from './zombie-vox.js';
import {selectedMap,BO1_MAPS,mapById} from './maps.js';
import {GameSettings,GameInput,bindingName} from './settings.js';
import {PauseMenu} from './pause-menu.js';
import {ZombiesLobby} from './lobby.js';
import {LaunchScreen} from './launch-screen.js';
import {ServerSaveStore} from './server-saves.js';
import {SaveSlots} from './save-slots.js';
import {GamepadSettings,GamepadControls} from './gamepad.js';
import {ControllerPanel,ControllerMenu} from './gamepad-ui.js';
const $=id=>document.getElementById(id),choice=selectedMap(),canvas=$('viewport');
document.body.dataset.engine='dead-ops';canvas.setAttribute('aria-label','Dead Ops Arcade overhead game');
const settings=new GameSettings(localStorage),padSettings=new GamepadSettings(localStorage),saves=new ServerSaveStore(localStorage,BO1_MAPS);
let game,map,view,audio,music,blood,zombieVox,loadPromise,audioContext,mode='menu',last=performance.now(),mouse={x:innerWidth/2,y:innerHeight/2},noticeUntil=0,flash=0,pendingSave=null,padAim=null,padMove={x:0,y:0};
const scene=new THREE.Scene();scene.background=new THREE.Color(0x14262b);
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance',preserveDrawingBuffer:true});renderer.outputColorSpace=THREE.SRGBColorSpace;
const camera=new THREE.OrthographicCamera(-900,900,700,-700,1,5000);camera.up.set(0,1,0);
const menu=new PauseMenu(settings,{resume:resume,restart:()=>start(false),quit:()=>{game?.newGame();showMenu('start');},saveCount:()=>saves.count(),openSaves:which=>slots.open(which)});
const lobby=new ZombiesLobby(menu),launch=new LaunchScreen(choice,()=>settings.value.volume);
const input=new GameInput(settings,action=>{if(mode!=='playing')return;if(action==='pause')pause();else if(action==='grenade')game.nuke();});
let controllerPanel,controllerMenu;
const pads=new GamepadControls(padSettings,{mode:()=>mode,action:action=>{if(mode!=='playing')return;if(action==='pause')pause();else if(action==='grenade')game.nuke();},menu:action=>{
  if(mode!=='fate'){controllerMenu?.handle(action);return;}const buttons=[...fateMenu.querySelectorAll('button')],index=buttons.indexOf(document.activeElement);
  if(action==='confirm')buttons[Math.max(0,index)].click();else if(['up','down','left','right'].includes(action))buttons[(Math.max(0,index)+(action==='up'||action==='left'?buttons.length-1:1))%buttons.length].focus();},
  capture:()=>!!controllerPanel?.capturing,rawCapture:(token,pad)=>controllerPanel?.finish(token,pad),devicesChanged:()=>controllerPanel?.sync(),changed:()=>{input.reset();controllerPanel?.sync();},disconnect:()=>{if(mode==='playing')pause();}});
pads.onSticks=(left,right)=>{padMove={x:left.x,y:-left.y};padAim=right.magnitude>.12?{angle:Math.atan2(-right.y,right.x),fire:true}:null;};
controllerPanel=new ControllerPanel(padSettings,pads,menu);controllerMenu=new ControllerMenu(menu,{mode:()=>mode,launch,notice:message});
const hud=document.createElement('div');hud.id='doa-hud';hud.innerHTML=`<div class="doa-score"><strong id="doa-score">00000000</strong><div class="doa-lives"><img src="/data/${choice.data}/hud/zom_icon_player_life.png" alt="Lives"><span id="doa-lives">3</span><img src="/data/${choice.data}/hud/hud_zombie_bomb.png" alt="Nukes"><span id="doa-bombs">1</span><img src="/data/${choice.data}/hud/hud_lightning_bolt.png" alt="Boosts"><span id="doa-boosts">2</span></div><span id="doa-multiplier">×1</span><div class="doa-meter"><span id="doa-prize"></span></div></div><div class="doa-round"><strong id="doa-round">ROUND 1</strong><span id="doa-arena">ISLAND</span></div><div id="doa-notice"></div><div class="doa-controls" id="doa-controls"></div><div class="doa-weapon"><span id="doa-weapon">M60</span><div class="doa-meter"><span id="doa-weapon-time"></span></div></div>`;document.body.append(hud);
const flashElement=document.createElement('div');flashElement.className='doa-flash';document.body.append(flashElement);
const fateMenu=document.createElement('section');fateMenu.id='doa-fate';fateMenu.hidden=true;fateMenu.innerHTML='<h2>ROOM OF FATE</h2><p>Choose your blessing</p>'+[['fire','FIREPOWER — PERMANENT MINIGUN'],['feet','FURIOUS FEET — SPEED & BOOSTS'],['fortune','FORTUNE — DOUBLE TREASURE'],['friendship','FRIENDSHIP — CHICKEN COMPANION']].map(([id,label])=>`<button data-fate="${id}">${label}</button>`).join('');document.body.append(fateMenu);
fateMenu.onclick=e=>{const fate=e.target.closest('[data-fate]')?.dataset.fate;if(fate&&game.chooseFate(fate)){fateMenu.hidden=true;resume();}};
function thumbnail(){const image=document.createElement('canvas'),scale=Math.min(480/canvas.width,270/canvas.height);image.width=Math.max(1,Math.round(canvas.width*scale));image.height=Math.max(1,Math.round(canvas.height*scale));image.getContext('2d').drawImage(canvas,0,0,image.width,image.height);return image.toDataURL('image/jpeg',.65);}
const slots=new SaveSlots(menu,saves,{currentMap:choice.id,canSave:()=>!game||!['round','exit','fate'].includes(game.phase)?'Start a game before saving.':null,weaponName:n=>DOA_WEAPON_LABELS[n]||n,
  save:async(slot,name)=>{try{const state=game.saveState(),p=game.player;await saves.put(choice.id,slot,{map:choice.id,slot,title:choice.title,name,state,thumb:thumbnail(),summary:{round:game.round,points:p.points,kills:p.kills,headshots:0,health:p.health,weapons:[game.weapon],perks:game.fate?[game.fate]:[],zombies:game.enemies.filter(e=>!e.dead).length,remaining:game.remaining,doors:0,playTime:game.time}});return {ok:true,message:'Saved to the server. Continue this game from any device.'};}catch(error){return {ok:false,message:error.message};}},
  load:async(mapId,slot)=>{if(mapId!==choice.id){const target=mapById(mapId);location.assign('/black-ops/?map='+target.id+'&load='+slot);return;}await saves.refresh();pendingSave=saves.get(mapId,slot);if(!pendingSave)throw new Error('This save slot is empty.');await start(true);}});
$('mods').onclick=()=>menu.show('mods');$('mods').disabled=false;
for(const [id,key,label]of [['mod-god','god','God mode'],['mod-points','points','Unlimited score'],['mod-ammo','permanentWeapon','Permanent weapon pickup'],['mod-grenades','resources','Unlimited nukes / boosts']]){
  $(id).parentElement.querySelector('span').textContent=label;$(id).onchange=()=>{if(game)game.mods[key]=$(id).checked;};
}
$('mod-noclip').parentElement.hidden=true;
for(const [name,label]of Object.entries(DOA_WEAPON_LABELS)){const option=document.createElement('option');option.value=name;option.textContent=label;$('mod-weapon').append(option);}
$('mod-equip').onclick=()=>{if(game)game.pickup({kind:$('mod-weapon').value});};$('mod-set-round').onclick=()=>{game?.setRound($('mod-round').value);};
$('mod-add-points').onclick=()=>game?.addPoints(10000);$('mod-refill-ammo').onclick=()=>{if(game){game.weaponRemaining=10;game.weaponDuration=10;}};$('mod-refill-grenades').onclick=()=>{if(game){game.player.bombs=9;game.player.boosters=9;}};
$('mod-disable').onclick=()=>{if(game)game.mods={god:false};for(const id of ['mod-god','mod-points','mod-ammo','mod-grenades'])$(id).checked=false;};
for(const [action,label]of [['jump','Speed boost'],['sprint','Speed boost'],['grenade','Drop nuke'],['fire','Shoot']])menu.rows.get(action)[0].parentElement.querySelector('span').textContent=label;
for(const action of ['crouch','prone','aim','aimToggle','reload','melee','nextWeapon','equipment','use','lookLeft','lookRight','lookUp','lookDown'])menu.rows.get(action)[0].parentElement.hidden=true;
function message(text){$('doa-notice').textContent=text;noticeUntil=(game?.time||0)+4;}
function showMenu(context='pause'){mode='menu';input.reset();pads.suppressHeld();document.body.classList.remove('playing');menu.setContext(context);audio?.suspend();}
function pause(){if(mode==='playing')showMenu();}
function resume(){if(!game||game.phase==='dead')return;menu.show('home');mode='playing';input.reset();pads.suppressHeld();document.body.classList.add('playing');audio?.context?.resume().catch(console.warn);}
function resize(){const scale=settings.value.renderScale/100;renderer.setPixelRatio(Math.min(devicePixelRatio,2)*scale);renderer.setSize(innerWidth,innerHeight,false);poseCamera();}
function poseCamera(){const arena=game?.arena;if(!arena)return;const width=arena.bounds.maxs[0]-arena.bounds.mins[0]+120,height=arena.bounds.maxs[1]-arena.bounds.mins[1]+120,aspect=innerWidth/innerHeight,half=Math.max(height/2,width/aspect/2);camera.left=-half*aspect;camera.right=half*aspect;camera.top=half;camera.bottom=-half;camera.position.set(arena.center[0],arena.center[1]-180,arena.center[2]+1800);camera.lookAt(arena.center[0],arena.center[1],arena.center[2]);camera.updateProjectionMatrix();camera.updateMatrixWorld(true);}
async function prepare(){
  await preloadAssets(text=>launch.update(launch.element('progress').value,text),info=>launch.downloaded(info));launch.prepared(0,'Reading Dead Ops Arcade data…');
  const [manifest,collision,navigation,presentation]=await Promise.all([get('/data/'+choice.data+'/manifest.json',true),get('/data/'+choice.zone+'/web-world/zombietron.collision.json',true),get('/data/'+choice.data+'/navigation.json',true),get('/data/'+choice.data+'/presentation.json',true)]);
  map=await loadMap(scene,text=>launch.update(72,text));launch.prepared(2,'Preparing original arcade actors and pickups…');
  const effects=new OriginalEffects(presentation);await effects.prepare();blood=new BloodEffects(scene);await blood.prepare(presentation.gore);view=new DeadOpsView(scene,map,manifest,effects);await view.prepare();launch.prepared(4,'Preparing original music and weapon sounds…');
  audio=new OriginalAudio(manifest.sounds,audioContext,['mus_zmbtron_island']);audio.volume=settings.value.volume;await audio.preload();
  zombieVox=new ZombieVox(audio,ZOMBIE_VOX['black-ops']);
  game=new DeadOpsEngine(manifest,new CollisionWorld(collision,manifest.entities),navigation,{reset:()=>{view.reset();blood.reset();zombieVox?.reset();},arena:arena=>{view.arena(arena);poseCamera();music?.stop();music=audio.play('mus_zmbtron_'+arena.id,.6,{loop:true});},sound:alias=>audio.play(alias,1,{limit:3}),message,
    hit:e=>blood.burst([e.position[0],e.position[1],e.position[2]+35],[Math.cos(game.player.angle),Math.sin(game.player.angle),.2],game.time),
    kill:e=>{view.kill(e);zombieVox.death(e,game.time);},blast:b=>{view.blast(b,game.time);if(b.nuke)flash=.85;},playerDeath:()=>{flash=.35;},
    shot:e=>{const d=manifest.weapons[e.weapon];audio.play(d.fireSoundPlayer||d.fireSound,.7,{limit:3});},
    death:stats=>{mode='menu';document.body.classList.remove('playing');menu.setContext('dead');$('menu-copy').textContent=`Survived ${stats.round} rounds · ${stats.kills} kills · ${stats.points.toLocaleString()} points`;audio.stopSession();audio.play('mus_zmbtron_end');},
    fate:()=>{mode='fate';fateMenu.hidden=false;fateMenu.querySelector('button').focus();}});
  poseCamera();view.update(game,0);launch.prepared(6,'Uploading original map textures…');
  blood.trace=(position,direction,range)=>{const end=position.map((v,k)=>v+direction[k]*range),hit=game.collision.trace(position,end,[0,0,0],1);return hit.fraction<1?{distance:range*hit.fraction,normal:hit.normal}:null;};
  await renderer.compileAsync(scene,camera);map.uploadTextures?.(renderer);launch.prepared(8,'Dead Ops Arcade ready');
}
async function start(load=false){
  if(mode==='loading')return;
  if(!game){mode='loading';$('play').disabled=true;audioContext??=new AudioContext();audioContext.resume().catch(console.warn);const complete=launch.begin();
    try{loadPromise??=prepare();await loadPromise;launch.ready();await complete;}catch(error){console.error(error);launch.fail(error);mode='menu';loadPromise=null;$('play').disabled=false;return;}
  }
  await audio.start();audio.stopSession();if(load&&pendingSave){game.loadState(pendingSave.state);pendingSave=null;}else{game.newGame();game.start();}
  if(!music||music.ended)music=audio.play('mus_zmbtron_'+game.arena.id,.6,{loop:true});$('play').disabled=false;if(game.phase==='fate'){mode='fate';fateMenu.hidden=false;}else resume();
}
$('play').onclick=()=>menu.context==='pause'?resume():start();
settings.subscribe(()=>{if(audio)audio.volume=settings.value.volume;resize();});addEventListener('resize',resize);
addEventListener('keydown',e=>{
  if(menu.capture||controllerPanel.capturing||['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName))return;
  if(e.code==='Escape'){e.preventDefault();if(e.repeat)return;if(mode==='playing')pause();else if(mode==='menu')menu.back();else if(mode==='loading'&&!launch.element('skip').disabled)launch.element('skip').click();return;}
  if(mode==='playing'){e.preventDefault();pads.useKeyboard();input.press(e.code,e.repeat);if(!e.repeat&&settings.actions(e.code).some(a=>a==='jump'||a==='sprint'))game.boost();}
});addEventListener('keyup',e=>input.release(e.code));
canvas.addEventListener('pointermove',e=>{mouse={x:e.clientX,y:e.clientY};pads.useKeyboard();});canvas.addEventListener('pointerdown',e=>{if(mode==='playing'){e.preventDefault();pads.useKeyboard();input.press('Mouse'+e.button);}});addEventListener('pointerup',e=>input.release('Mouse'+e.button));canvas.addEventListener('contextmenu',e=>e.preventDefault());
addEventListener('blur',()=>{input.reset();if(mode==='playing')pause();});document.addEventListener('visibilitychange',()=>{if(document.hidden&&mode==='playing')pause();});
const raycaster=new THREE.Raycaster(),mouseVector=new THREE.Vector2(),plane=new THREE.Plane(new THREE.Vector3(0,0,1),0),aimPoint=new THREE.Vector3();
function aim(){mouseVector.set(mouse.x/innerWidth*2-1,1-mouse.y/innerHeight*2);raycaster.setFromCamera(mouseVector,camera);plane.constant=-game.player.position[2];if(raycaster.ray.intersectPlane(plane,aimPoint))return Math.atan2(aimPoint.y-game.player.position[1],aimPoint.x-game.player.position[0]);return game.player.angle;}
let hudDue=0,fpsAt=last,frames=0;
function frame(now){const dt=Math.min(.1,(now-last)/1000);last=now;pads.poll(dt);
  if(game&&mode==='playing'){
    const keyboard=input.input(),pad=pads.input();if(pads.active&&pad.jump)game.boost();const heldFire=settings.held('fire',input.tokens);
    game.update(dt,pads.active?{x:padMove.x,y:padMove.y,angle:padAim?.angle??game.player.angle,fire:!!padAim||pad.fire}:{x:keyboard.side,y:keyboard.forward,angle:aim(),fire:heldFire});
    audio.listen([game.player.position[0],game.player.position[1],game.player.position[2]+60],[Math.cos(game.player.angle),Math.sin(game.player.angle),0]);zombieVox.update(game.time,game,game.player.angle);
  }
  if(game){blood?.update(game.time);view.update(game,mode==='playing'?dt:0);map.updateVisibility(camera);renderer.render(scene,camera);if(mode==='playing'&&now>=hudDue){hudDue=now+50;const p=game.player;$('doa-score').textContent=String(p.points).padStart(8,'0');$('doa-lives').textContent=p.lives;$('doa-bombs').textContent=p.bombs;$('doa-boosts').textContent=p.boosters;$('doa-multiplier').textContent='×'+game.multiplier;$('doa-prize').style.width=game.prizeBar+'%';$('doa-round').textContent='ROUND '+game.round;$('doa-arena').textContent=game.arena.id.toUpperCase();$('doa-weapon').textContent=DOA_WEAPON_LABELS[game.weapon];$('doa-weapon-time').style.width=(game.weaponRemaining?Math.min(100,game.weaponRemaining/game.weaponDuration*100):100)+'%';$('doa-controls').textContent=pads.active?`LEFT STICK MOVE · RIGHT STICK SHOOT · ${pads.label('jump')} BOOST · ${pads.label('grenade')} NUKE · ${pads.label('pause')} PAUSE`:`WASD MOVE · MOUSE AIM / FIRE · ${bindingName(settings.value.bindings.jump[0])} BOOST · ${bindingName(settings.value.bindings.grenade[0])} NUKE · ESC PAUSE`;if(game.time>noticeUntil)$('doa-notice').textContent='';}
  }
  flash=Math.max(0,flash-dt*2);flashElement.style.opacity=flash;
  frames++;if(now-fpsAt>500){$('fps-counter').hidden=!settings.value.showFps;$('fps-counter').textContent=Math.round(frames*1000/(now-fpsAt))+' FPS';frames=0;fpsAt=now;}requestAnimationFrame(frame);
}
showMenu('start');menu.setText('play','START GAME');$('play').disabled=false;$('message').textContent='Ready · Assets load when you start the game';$('menu-copy').textContent='Solo Arcade · WASD to move, mouse to aim and fire. Space boosts; G drops a nuke.';
saves.prepare().then(async()=>{menu.setContext('start');const slot=new URLSearchParams(location.search).get('load');if(/^[0-2]$/.test(slot||'')){pendingSave=saves.get(choice.id,Number(slot));if(pendingSave){menu.setText('play','CONTINUE SAVED GAME');$('play').onclick=()=>start(true);}}}).catch(error=>{$('message').textContent=error.message;});
globalThis.zombiesDoa={get game(){return game;},get renderer(){return renderer;},get mode(){return mode;},get view(){return view;},get map(){return map;},diagnostics:()=>({mode,engine:game?.engine,round:game?.round,arena:game?.arena.id,phase:game?.phase,lives:game?.player.lives,enemies:game?.enemies.filter(e=>!e.dead).length,shots:game?.shots.length,pickups:game?.drops.length,preload:preloadState,render:{memory:renderer.info.memory,calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,programs:renderer.info.programs.length},music:audio?.diagnostics()})};
resize();requestAnimationFrame(frame);
