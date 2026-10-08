import assert from 'node:assert/strict';
import {OriginalEffects} from '../web/effects.js';
const fx=new OriginalEffects({effects:{}}),particle={r:[.5,.25,.75]};
for(const out of [[1,2,3,4,5,6],new Float32Array([1,2,3,4,5,6])]){fx.velocity({velocity:[]},particle,.5,out);assert.deepEqual([...out],[0,0,0,0,0,0]);}
const out=Array(6).fill(0),sample={local:[.1,.2,.3],localAmplitude:[.2,.4,.6],world:[.4,.5,.6],worldAmplitude:[0,0,0]};
fx.velocity({velocity:[sample]},particle,.5,out);assert.deepEqual(out,[200,300.00000000000006,750,400,500,600]);
console.log('Effects velocity passed: stationary native/reconstructed emitters and animated velocity graphs');
