import assert from 'node:assert/strict';
import fs from 'node:fs';
import {CollisionWorld} from '../web/collision.js';
import {SoloGame} from '../web/game.js';
const read=p=>JSON.parse(fs.readFileSync(new URL('../local-data/'+p,import.meta.url)));
const m=read('gameplay/manifest.json');
const g=new SoloGame(m,new CollisionWorld(read('nacht/web-world/nazi_zombie_prototype.collision.json'),m.entities),read('nacht/web-world/nazi_zombie_prototype.paths.json'),{},read('gameplay/presentation.json'));
g.newGame();g.start();g.roundDue=1e9;
const events=[];g.events.weaponSwitch=e=>events.push(e);
const run=seconds=>{for(let t=0;t<seconds;t+=1/120)g.tick(1/120,{});};
const colt=g.weapon.definition,second=Object.keys(g.data.weapons).find(n=>n!=='zombie_colt'&&!n.endsWith('_upgraded')),d=g.data.weapons[second];
// SwitchToWeapon on purchase: Colt putaway, then the new gun's first raise.
g.giveWeapon(second);assert.equal(g.weapon.name,second);
assert.equal(events[0].phase,'drop');assert.equal(events[0].anim,colt.dropAnim);assert.equal(events[0].duration,colt.dropTime);
assert.equal(g.fire(),false,'No firing while switching');g.reload();assert.equal(g.reloadEnd,0,'No reloading while switching');
run(colt.dropTime+.02);
assert.equal(events[1].phase,'raise');assert.equal(events[1].anim,d.firstRaiseAnim||d.raiseAnim);assert.equal(events[1].duration,d.firstRaiseTime||d.raiseTime);
assert(g.switching,'Still drawing the new gun');run((d.firstRaiseTime||d.raiseTime)+.02);assert.equal(g.switching,null);
g.cooldown=0;assert.equal(g.fire(),true,'Firing works once the gun is up');
// Switching back to the Colt uses its normal pullout (it was already drawn).
run(1);events.length=0;g.switchWeapon();g.switchWeapon();assert.equal(events.length,1,'A second switch press mid-switch is ignored');
run(d.dropTime+.02);assert.equal(g.weapon.name,'zombie_colt');assert.equal(events[1].anim,colt.raiseAnim);assert.equal(events[1].duration,colt.raiseTime);
run(colt.raiseTime+.02);assert.equal(g.switching,null);
// An empty gun uses its empty putaway.
g.weapon.clip=0;events.length=0;g.switchWeapon();assert.equal(events[0].anim,colt.emptyDropAnim||colt.dropAnim);assert.equal(events[0].duration,colt.emptyDropTime||colt.dropTime);
console.log('Weapon switch passed:',JSON.stringify({drop:[colt.dropAnim,colt.dropTime],firstRaise:[d.firstRaiseAnim,d.firstRaiseTime],raise:[colt.raiseAnim,colt.raiseTime]}));
