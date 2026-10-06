import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {SoloGame} from '../web/game.js';
import {BlackOpsEngine} from '../web/bo1-engine.js';
import {CollisionWorld} from '../web/collision.js';
import {STANCES,DIVE} from '../web/player-movement.js';
import {GameSettings,GameInput,normalizeSettings} from '../web/settings.js';
import {GamepadSettings,GamepadControls,normalizePadSettings} from '../web/gamepad.js';
import {WeaponView} from '../web/weapon-view.js';
import {MAPS,BO1_MAPS} from '../web/maps.js';
const read=async p=>JSON.parse(await readFile(new URL('../local-data/'+p,import.meta.url),'utf8'));
const box=(mins,maxs)=>({mins,maxs,contents:1,planes:[]});
const floor=extra=>new CollisionWorld({models:[{brushes:[]}],brushes:[box([-10000,-10000,-128],[10000,10000,0]),...extra]},[]);
const close=(a,b)=>assert(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const results=[];
for(const map of [...MAPS,...BO1_MAPS]){
  const m=await read(map.data+'/manifest.json'),native=new CollisionWorld(await read(map.zone+'/web-world/'+map.asset+'.collision.json'),m.entities),events=[];
  const g=new (map.game==='black-ops'?BlackOpsEngine:SoloGame)(m,native,await read(map.zone+'/web-world/'+map.asset+'.paths.json'),{dive:e=>events.push(e)},await read(map.data+'/presentation.json'));
  const reset=(extra=[])=>{g.collision=native;g.newGame();g.start();g.roundDue=Infinity;g.ambientDue=Infinity;g.collision=floor(extra);g.player.position=[0,0,0];g.player.previousPosition=[0,0,0];g.player.grounded=true;g.aim(0,0);events.length=0;};
  const run=(seconds,hz=120,input={})=>{for(let i=0;i<Math.round(seconds*hz);i++)g.update(1/hz,input);};
  for(const hz of [30,60,120,240]){
    reset();assert(g.changeStance('crouch'));run(1,hz,{forward:1});close(g.player.position[0],190*STANCES.crouch.speed*g.weapon.definition.moveSpeedScale);close(g.viewHeight,40);assert(g.player.grounded);close(g.rayHits().origin[2],40);
    reset();assert(g.changeStance('prone'));run(1,hz,{forward:1});close(g.player.position[0],190*STANCES.prone.speed*g.weapon.definition.moveSpeedScale);close(g.viewHeight,11);close(g.rayHits().origin[2],11);assert(!g.fire(),'Crawling cannot fire');run(.1,hz);assert(g.fire(),'A settled prone player can fire');
    reset();g.changeStance('crouch');run(.5,hz,{jump:true});assert.equal(g.player.stance,'stand');assert(g.player.grounded,'Stand/Jump stands up without jumping on the same held press');run(.1,hz);run(.1,hz,{jump:true});assert(g.player.position[2]>0,'A new Jump press jumps once standing');
    results.push({map:map.id,hz,stanceSpeeds:true,viewAndShotHeight:true,standThenJump:true});
  }
  // Standing hull stops at low cover; crouching fits, but cannot rise inside it.
  reset([box([50,-100,55],[300,100,100])]);run(1,120,{forward:1});assert(g.player.position[0]<37);g.changeStance('crouch');run(1,120,{forward:1});assert(g.player.position[0]>100);assert(!g.changeStance('crouch'));assert.equal(g.player.stance,'crouch');assert(g.viewHeight<55);run(1.5,120,{side:1});assert(g.changeStance('crouch'));assert.equal(g.player.stance,'stand');
  reset([box([50,-100,35],[300,100,100])]);g.changeStance('prone');run(3,120,{forward:1});assert(g.player.position[0]>65);assert(!g.changeStance('crouch'));assert(!g.changeStance('prone'));assert.equal(g.player.stance,'prone');
  const saved=g.saveState();g.collision=native;g.loadState(saved);assert.equal(g.player.stance,'prone');close(g.viewHeight,11);g.newGame();assert.equal(g.player.stance,'stand');close(g.viewHeight,60);delete saved.player.stance;g.loadState(saved);assert.equal(g.player.stance,'stand','Older saves default to standing');
  for(const hz of [30,60,120,240]){g.collision=native;g.newGame();g.start();g.roundDue=Infinity;const z=g.player.position[2];g.changeStance('crouch');run(.5,hz);assert(g.player.grounded);assert(Math.abs(g.player.position[2]-z)<2);g.changeStance('prone');run(.5,hz);assert(g.player.grounded,'Native '+map.id+' floor supports prone at '+hz+' FPS');assert(Math.abs(g.player.position[2]-z)<2);}
  // A quick controller tap crouches; a held button goes prone; cancelling a
  // hold for input/focus loss must not change stance after the menu opens.
  reset();g.stanceButton();run(.1);g.releaseStance();assert.equal(g.player.stance,'crouch');run(.2);g.stanceButton();run(.31);assert.equal(g.player.stance,'prone');g.releaseStance();assert.equal(g.player.stance,'prone');reset();g.stanceButton();run(.1);g.releaseStance(true);run(.4);assert.equal(g.player.stance,'stand');
  if(map.game==='black-ops'){
    let end;
    for(const hz of [30,60,120,240]){
      reset();run(.4,hz,{forward:1,sprint:true});assert(g.sprinting);assert(g.changeStance('prone'));assert(g.dive);assert.equal(g.player.stance,'prone');assert(!g.fire());assert(!g.melee());assert(!g.throwGrenade());assert(!g.canSave());assert.equal(events[0].phase,'in');
      let apex=0;for(let i=0;i<2*hz;i++){g.update(1/hz,{forward:1,sprint:true,fire:true});apex=Math.max(apex,g.player.position[2]);}assert(Math.abs(apex*.0254-.45)<.01);assert.equal(g.dive,null);assert(g.player.grounded);assert.equal(g.player.stance,'prone','Holding sprint through the dive does not stand back up');assert.deepEqual(events.map(e=>e.phase),['in','loop','out']);assert.equal(g.shots,0,'Dive cannot shoot or buffer a shot');
      if(end)close(g.player.position[0],end);else end=g.player.position[0];results.push({map:map.id,hz,diveEnd:Math.round(end*100)/100});
    }
    reset([box([200,-100,0],[215,100,400])]);run(.4,120,{forward:1,sprint:true});g.changeStance('prone');run(2);assert(g.player.position[0]<186,'Dive cannot clip through walls');assert(g.player.grounded);assert.equal(g.dive,null);
    reset([box([-300,-100,100],[1000,100,140])]);run(.4,120,{forward:1,sprint:true});g.changeStance('prone');let highest=0;for(let i=0;i<240;i++){g.update(1/120,{});highest=Math.max(highest,g.player.position[2]+30);}assert(highest<101,'Dive hits low ceilings instead of passing through them');assert(g.player.grounded);
    reset();run(.1,120,{forward:1,sprint:true});g.changeStance('prone');assert(!g.dive,'The native 250 ms sprint requirement is enforced');assert.equal(g.player.stance,'prone');
    reset();g.stanceButton();run(DIVE.stanceHold+.01);g.releaseStance();assert(!g.dive,'Holding prone at walking speed does not dive');
    reset();run(.5,120,{forward:1,sprint:true});g.stanceButton();run(DIVE.hold+.01,120,{forward:1,sprint:true});assert(g.dive,'Controller uses the native 200 ms sprint/stance hold');
    reset();run(1/120,120,{forward:1,sprint:true});g.stanceButton();const heldAt=g.time;run(.2,120,{forward:1,sprint:true});assert.equal(g.player.stance,'stand','A held stance request waits for sprint eligibility');assert(!g.dive);run(.06,120,{forward:1,sprint:true});assert(g.dive,'Concurrent sprint and stance timers qualify without an extra delay');assert(g.dive.started-heldAt<.27);assert.equal(g.lastDive.launchEvents,1);
    // Actual native empty/loaded weapon dive clips are selected.
    const d=g.weapon.definition,view={weapon:g.weapon,clips:new Map(Object.values(d).filter(v=>typeof v==='string').map(v=>[v,true])),play:(...args)=>events.push({clip:args[0],loop:args[2]})};for(const phase of ['in','loop','out']){WeaponView.prototype.dive.call(view,{phase});assert.equal(events.at(-1).clip,d['dtp'+phase[0].toUpperCase()+phase.slice(1)+'Anim']);}view.weapon={...g.weapon,clip:0};WeaponView.prototype.dive.call(view,{phase:'in'});assert.equal(events.at(-1).clip,d.dtpInEmptyAnim);
  }else{reset();run(.5,120,{forward:1,sprint:true});g.changeStance('prone');assert(!g.dive,'WaW never dolphin dives');assert.equal(g.player.stance,'prone');}
}
// New bindings preserve existing user choices in older saved profiles.
const old={version:1,bindings:{fire:['KeyC',null],use:['ControlLeft',null]}};const settings=normalizeSettings(old);assert.equal(settings.bindings.fire[0],'KeyC');assert.equal(settings.bindings.crouch[0],null);assert.equal(settings.bindings.use[0],'ControlLeft');assert.equal(settings.bindings.prone[0],null);
const actions=[],keys=new GameInput(new GameSettings(),a=>actions.push(a));keys.press('KeyC');keys.press('KeyC',true);keys.press('ControlLeft');assert.deepEqual(actions,['crouch','prone']);
const oldPad=normalizePadSettings({version:1,mappings:{'pad:custom':{ready:true,bindings:{jump:'Button1'}}}});assert.equal(oldPad.mappings['pad:custom'].bindings.jump,'Button1');assert.equal(oldPad.mappings['pad:custom'].bindings.stance,null);
const pad={id:'Xbox',index:0,connected:true,mapping:'standard',axes:[0,0,0,0],buttons:Array.from({length:18},()=>({value:0}))},events=[];let mode='playing';const gp=new GamepadControls(new GamepadSettings(),{getGamepads:()=>[pad],mode:()=>mode,action:a=>events.push(a),release:(a,cancel)=>events.push([a,!!cancel])});gp.poll(1/120);pad.buttons[1].value=1;gp.poll(1/120);assert.deepEqual(events,['stance']);pad.buttons[1].value=0;gp.poll(1/120);assert.deepEqual(events,['stance',['stance',false]]);pad.buttons[1].value=1;gp.poll(1/120);gp.useKeyboard();assert.deepEqual(events.at(-1),['stance',true]);mode='menu';pad.buttons[1].value=0;gp.poll(1/120);assert.equal(gp.stanceHeld,false);
console.log('Player movement passed:',JSON.stringify({runs:results,lowCover:true,saveCompatibility:true,tapHoldAndCancel:true,rebindingMigration:true,nativeDiveClips:true}));
