import assert from 'node:assert/strict';
import {PauseKeys} from '../web/pause-keys.js';
import {PauseMenu} from '../web/pause-menu.js';
let time=1000;const keys=new PauseKeys(()=>time);
let resumes=0,captures=0;
// Use the real pause menu's home/back handler. Holding Escape must resume
// exactly once without reacquiring a mouse lock the browser would release.
const menu=Object.create(PauseMenu.prototype);
Object.assign(menu,{capture:null,view:'home',context:'pause',callbacks:{resume:()=>{resumes++;if(keys.canCaptureMouse)captures++;}}});
assert(keys.down());menu.back();assert.equal(resumes,1);assert.equal(captures,0);
assert(!keys.down(true));assert(!keys.down(false),'Duplicate keydowns cannot toggle again');assert.equal(resumes,1);
keys.up();assert(keys.canCaptureMouse);assert(keys.down(),'A second distinct Escape press works');keys.up();
menu.back();assert.equal(captures,1,'A mouse/button resume can capture the mouse normally');
// Browsers may release pointer lock before delivering the Escape keydown.
// That gesture already paused the game: its remaining keydown is consumed.
keys.nativePause();time+=16;assert(!keys.down());keys.up();
assert(keys.down(),'The next Escape press resumes immediately after keyup');keys.up();
// Browsers that swallow the unlock keydown still deliver its keyup.
keys.nativePause();keys.up();assert(keys.down());keys.up();
// A late Escape press after unrelated loss of mouse capture still works.
keys.nativePause();time+=200;assert(keys.down());keys.up();
// Losing focus while holding Escape must not leave the input latched.
assert(keys.down());keys.reset();assert(keys.canCaptureMouse);assert(keys.down());keys.up();
let cancelled=0;menu.capture={};menu.cancelCapture=()=>{cancelled++;menu.capture=null;};menu.back();assert.equal(cancelled,1);assert.equal(resumes,2,'Cancelling a key binding does not resume');
menu.view='options';menu.show=view=>menu.view=view;menu.back();assert.equal(menu.view,'home');assert.equal(resumes,2,'Options go back to the pause menu');
console.log('Pause input checks passed: one Escape toggle, held/duplicate events, both browser unlock orders, button resume, focus reset and submenu/back behavior.');
