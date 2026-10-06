import assert from 'node:assert/strict';
import fs from 'node:fs';
import {SoloGame} from '../web/game.js';
import {CollisionWorld} from '../web/collision.js';
import {POWER_TARGETS} from '../web/map-rules.js';
import {powerSwitchRotation} from '../web/factory-view.js';
const read=p=>JSON.parse(fs.readFileSync(new URL('../local-data/'+p,import.meta.url)));
const manifest=read('gameplay/der-riese/manifest.json'),collision=read('der-riese/web-world/nazi_zombie_factory.collision.json'),paths=read('der-riese/web-world/nazi_zombie_factory.paths.json'),navigation=read('gameplay/der-riese/navigation.json'),powered=read('gameplay/der-riese/power-navigation.json');
assert.equal(powered.sourceStamp,navigation.sourceStamp);
const g=new SoloGame(manifest,new CollisionWorld(collision,manifest.entities),paths);
g.prepareSpawnPaths(navigation);g.preparePowerNavigation(powered);
const original=g.walkableLink.bind(g),invalidate=g.invalidateNavigation.bind(g);let checks=0,invalidations=0;
g.walkableLink=(...args)=>{checks++;return original(...args);};g.invalidateNavigation=targets=>{invalidations++;return invalidate(targets);};
g.time=12;const at=performance.now();g.mapRules.use(g.interactions.find(e=>e.targetname==='use_power_switch'));const activationMs=performance.now()-at;
assert(g.mapRules.power);assert.equal(g.mapRules.powerStartedAt,12);assert.equal(invalidations,1);assert.equal(checks,0,'Using power must use prepared routes instead of synchronous physics');
assert(POWER_TARGETS.every(t=>g.collision.disabled.has(t)&&g.opened.has(t)));
// Prepared state must match the actual native physics, not open blocked paths.
for(const [key]of powered.links){const [a,b]=key.split(',').map(Number);assert.equal(g.linkCache.get(key),original(g.nodes[a].origin,g.nodes[b].origin,true),'Powered route '+key);}
const barrier='pf2254_auto1';g.collision.disabled.add(barrier);g.invalidateNavigation([barrier]);
const dependent=powered.links.filter(([,entry])=>entry.targets.includes(barrier));assert(dependent.length);
for(const [key]of dependent){const [a,b]=key.split(',').map(Number);assert.equal(g.linkCache.get(key),original(g.nodes[a].origin,g.nodes[b].origin,true),'An open barrier selects its own prepared state');}
const lever=manifest.entities.find(e=>e.targetname==='power_switch'),angles=lever.angles.split(/\s+/).map(Number),r=Math.PI/180;
const off=powerSwitchRotation(lever.angles,false,12,12),middle=powerSwitchRotation(lever.angles,true,12.15,12),on=powerSwitchRotation(lever.angles,true,12.3,12);
assert(Math.abs(off[0]-angles[2]*r)<1e-9);assert(Math.abs(middle[0]-(angles[2]-45)*r)<1e-9);assert(Math.abs(on[0]-(angles[2]-90)*r)<1e-9);
assert.equal(on[1],off[1]);assert.equal(on[2],off[2]);
// A paused frame uses the same game time; old saves with power enabled use the
// fully raised pose, and a current snapshot carries the transition start.
assert.deepEqual(powerSwitchRotation(lever.angles,true,12.15,12),middle);
assert.deepEqual(powerSwitchRotation(lever.angles,true,0,null),on);
g.phase='round';g.time=12.15;const save=g.saveState();g.loadState(save);assert.equal(g.mapRules.powerStartedAt,12);assert.deepEqual(powerSwitchRotation(lever.angles,g.mapRules.power,g.time,g.mapRules.powerStartedAt),middle);
g.newGame();assert(!g.mapRules.power);assert.equal(g.mapRules.powerStartedAt,null);assert.equal(g.collision.disabled.size,0);
for(const [key]of powered.links)assert.equal(g.linkCache.get(key),new Map(navigation.links).get(key),'Restart restores unpowered routes');
console.log('Power switch checks passed:',JSON.stringify({activationMs:Math.round(activationMs*100)/100,activationPhysicsChecks:0,preparedLinks:powered.links.length,barrierVariants:dependent.length,rollDegrees:{off:Math.round(off[0]/r),mid:Math.round(middle[0]/r),on:Math.round(on[0]/r)}}));
