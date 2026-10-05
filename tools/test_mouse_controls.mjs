import assert from 'node:assert/strict';
import {MouseControls} from '../web/mouse-controls.js';
const button=(target,type,number)=>{const event=new Event(type,{cancelable:true});Object.defineProperty(event,'button',{value:number});target.dispatchEvent(event);};
const create=inputMode=>{const canvas=new EventTarget(),document=new EventTarget();let shots=0,time=0,playing=true;const mouse=new MouseControls(canvas,document,{mode:()=>({playing,inputMode}),fire:()=>shots++,now:()=>time});return {canvas,document,mouse,down:n=>button(canvas,'mousedown',n),up:n=>button(document,'mouseup',n),get shots(){return shots;},tick:t=>{time=t;mouse.update(t);},pause:()=>{playing=false;mouse.reset();}};};
for(const mode of ['locked','drag'])for(const order of [[2,0],[0,2]]){
  const t=create(mode);t.down(order[0]);t.down(order[1]);assert(t.mouse.right&&t.mouse.firing);assert.equal(t.shots,1,'Both button orders must fire exactly once');
  t.mouse.move(10,0);assert(t.mouse.firing,'Moving while aiming must continue firing');
  t.up(0);assert(!t.mouse.firing&&t.mouse.right,'Release fire while continuing to aim');t.up(2);assert(!t.mouse.right);assert.equal(t.shots,1);
  const reversed=create(mode);reversed.down(order[0]);reversed.down(order[1]);reversed.up(2);assert(!reversed.mouse.right);assert.equal(reversed.mouse.firing,mode==='locked','Releasing aim preserves locked-mode fire');reversed.up(0);assert(!reversed.mouse.firing);assert.equal(reversed.shots,1);
}
let t=create('drag');t.down(0);t.mouse.move(8,0);t.tick(250);t.up(0);assert.equal(t.shots,0,'Drag look must not shoot');
t=create('drag');t.down(0);t.up(0);assert.equal(t.shots,1,'Quick click shoots');
t=create('drag');t.down(0);t.tick(180);t.tick(300);t.up(0);assert.equal(t.shots,1,'Held click starts fire without duplicate release shot');
t=create('locked');t.down(0);t.down(2);t.up(1);assert(t.mouse.firing&&t.mouse.right,'Middle button must not release aim/fire');t.pause();assert(!t.mouse.firing&&!t.mouse.right);t.down(0);assert.equal(t.shots,1,'Menu input must not shoot');
console.log('Mouse controls passed: both aim/fire orders, independent releases, drag look, held fire and pause reset.');
