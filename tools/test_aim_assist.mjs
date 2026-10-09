import assert from 'node:assert/strict';
import {ControllerAimAssist} from '../web/controller-aim-assist.js';
import {normalizePadSettings,GamepadSettings} from '../web/gamepad.js';
const target={id:1,position:[500,0,0]},base={yaw:0,pitch:0,yawDelta:.02,pitchDelta:0,dt:1/60,origin:[0,0,42],targets:[target],visible:()=>true,active:true,enabled:true,strength:.75,ads:1,lookMagnitude:.4,moveMagnitude:0};
let a=new ControllerAimAssist(),out=a.adjust(base);assert(out.yaw>0&&out.yaw<base.yawDelta,'Reticle slows over a visible target');assert.equal(a.targetId,1);
for(const change of [{active:false},{enabled:false},{strength:0},{targets:[{...target,dead:true}]},{targets:[{...target,position:[-500,0,0]}]},{targets:[{...target,position:[2000,0,0]}]},{visible:()=>false}]){a=new ControllerAimAssist();assert.deepEqual(a.adjust({...base,...change}),{yaw:base.yawDelta,pitch:0});assert.equal(a.targetId,null);}
const offset={...target,position:[500,20,0]};a=new ControllerAimAssist();out=a.adjust({...base,targets:[offset],yawDelta:0,lookMagnitude:0,moveMagnitude:0});assert.equal(out.yaw,0,'ADS alone never snaps onto a zombie');
out=a.adjust({...base,targets:[offset],yawDelta:0,lookMagnitude:0,moveMagnitude:.5});assert(out.yaw>0&&out.yaw<.01,'Moving controller receives bounded rotational support');
a=new ControllerAimAssist();out=a.adjust({...base,lookMagnitude:1});assert(out.yaw>base.yawDelta*.85,'Full stick can turn away without a sticky lock');
const final=[];for(const fps of [30,60,120,240]){a=new ControllerAimAssist();let yaw=0;for(let i=0;i<fps*2;i++){const t=(i+1)/fps,target={id:3,position:[500,Math.tan(t*.02)*500,0]};const d=a.adjust({...base,yaw,yawDelta:0,lookMagnitude:0,moveMagnitude:.6,targets:[target],dt:1/fps});yaw+=d.yaw;}final.push(yaw);}
assert(Math.max(...final)-Math.min(...final)<.001,'Tracking is consistent from 30 to 240 FPS');
let queries=0;a=new ControllerAimAssist();for(let i=0;i<240;i++)a.adjust({...base,dt:1/240,targets:Array.from({length:32},(_,id)=>({...target,id})),visible:()=>{queries++;return false;}});assert(queries<45,'Visibility queries stay bounded rather than sweeping all zombies every frame');
assert.equal(normalizePadSettings({version:1}).aimAssist,true);assert.equal(normalizePadSettings({version:1,aimAssist:false}).aimAssist,false);assert.equal(normalizePadSettings({version:1,aimAssistStrength:99}).aimAssistStrength,1);
const storage={value:null,getItem(){return this.value;},setItem(k,v){this.value=v;}},s=new GamepadSettings(storage);s.update('aimAssist',false);s.update('aimAssistStrength',.3);const saved=new GamepadSettings(storage);assert.equal(saved.value.aimAssist,false);assert.equal(saved.value.aimAssistStrength,.3);
console.log('Controller aim assist passed: slowdown, gentle tracking, no ADS snap, dead/hidden/distant/wall exclusions, escape input, 30–240 FPS consistency, bounded visibility queries and saved settings.');
