import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {SoloGame} from '../web/game.js';
import {CollisionWorld} from '../web/collision.js';
import {OriginalEffects} from '../web/effects.js';
import {CombatEffects} from '../web/combat-effects.js';
import {OriginalAudio} from '../web/assets.js';
const read=p=>JSON.parse(fs.readFileSync(new URL('../local-data/'+p,import.meta.url))),manifest=read('gameplay/manifest.json'),collision=read('nacht/web-world/nazi_zombie_prototype.collision.json'),paths=read('nacht/web-world/nazi_zombie_prototype.paths.json'),presentation=read('gameplay/presentation.json');
const events=[],game=new SoloGame(manifest,new CollisionWorld(collision,manifest.entities),paths,{grenadePrepare:s=>events.push({type:'prepare',time:game.time,sequence:{...s}}),grenade:g=>events.push({type:'release',time:game.time,grenade:g}),explosion:g=>events.push({type:'explode',time:game.time,grenade:g}),sound:s=>events.push({type:'sound',...s})},presentation);
const advance=seconds=>{for(let i=0;i<Math.round(seconds*240);i++)game.update(1/240,{});};
game.start();game.roundDue=1e6;assert(game.throwGrenade());assert.equal(game.player.grenades,3);assert.equal(game.grenades.length,0);assert.equal(game.throwGrenade(),false);assert.equal(game.fire(),false);
advance(.7);assert.equal(game.grenades.length,0,'Projectile must wait for the original throw release');assert(events.some(e=>e.alias==='grenade_pull_pin'));
advance(.1);assert.equal(game.grenades.length,1);const grenade=game.grenades[0];assert(Math.abs(events.find(e=>e.type==='release').time-.75)<1e-8);assert.equal(grenade.due,4.15);assert(events.some(e=>e.alias==='foley_throw'));
advance(.6);assert.equal(game.pendingGrenade,null);assert(game.fire(),'Weapon returns after the offhand sequence');
// Observe real native map collisions through the full fuse, at 240 render FPS.
while(game.time+1e-8<grenade.due&&game.phase!=='dead'){advance(1/120);assert(grenade.position[2]>-100,'Grenade fell through the native floor');}
assert.equal(events.filter(e=>e.type==='explode').length,1);assert.equal(game.grenades.length,0);assert(events.some(e=>e.alias==='grenade_bounce_concrete'));assert(events.some(e=>e.alias==='grenade_explode'));assert(events.some(e=>e.alias==='grenade_explode_bass'));
game.newGame();game.start();assert.equal(game.pendingGrenade,null);assert.equal(game.grenades.length,0);game.player.grenades=0;assert.equal(game.throwGrenade(),false);
// The native crate blocks blast damage between opposite faces within the radius.
const crate=game.collision.staticSurfaces.find(b=>b.model?.includes('crate')&&b.maxs[2]-b.mins[2]>35&&b.maxs[0]-b.mins[0]<100),center=crate.mins.map((x,i)=>(x+crate.maxs[i])/2),from=[crate.mins[0]-20,center[1],center[2]],target=[crate.maxs[0]+20,center[1],center[2]-35];
game.enemies=[{id:100,health:1000,position:target,dead:false}];game.player.position=[3000,3000,0];game.grenades=[{position:from,previousPosition:from.slice(),velocity:[0,0,0],resting:true,due:0}];game.updateGrenades(1/120);assert.equal(game.enemies[0].health,1000,'A solid native crate must shield blast damage');
game.enemies=[{id:101,health:1000,position:[0,424,1],dead:false}];game.grenades=[{position:[-40,424,3],previousPosition:[-40,424,3],velocity:[0,0,0],resting:true,due:0}];game.updateGrenades(1/120);assert(game.enemies[0].health<1000&&game.enemies[0].health>manifest.grenade.explosionInnerDamage,'Exposed target receives blast damage');
game.newGame();game.start();game.enemies=[{id:102,health:150,position:[-20,424,1],dead:false}];game.grenades=[{position:[-40,424,3],previousPosition:[-40,424,3],velocity:[0,0,0],resting:true,due:0}];game.updateGrenades(1/120);assert(game.enemies[0].dead);assert.equal(game.player.kills,1);assert(game.player.points>manifest.variables.zombie_score_start);assert.equal(game.player.health,0,'Close self blasts must damage the player');
// Repeated native particle blasts reuse all geometry/material allocations.
const effects=new OriginalEffects(presentation);for(const effect of Object.values(presentation.effects))for(const e of effect.elements)for(const url of e.textures)effects.templates.set(url+'|'+(e.blending||'additive'),new THREE.ShaderMaterial());
const scene=new THREE.Scene(),combat=new CombatEffects(scene),template=new THREE.Group();template.add(new THREE.Mesh(new THREE.BoxGeometry(2,2,4),new THREE.MeshBasicMaterial()));combat.prepareGrenades(template,effects);
const resources=()=>{const g=new Set(),m=new Set();scene.traverse(n=>{if(n.isMesh){g.add(n.geometry);m.add(n.material);}});return {g,m};},before=resources();
for(let i=0;i<1000;i++){const g={position:[0,0,3]};combat.grenade(g);combat.explosion(g,i);g.exploded=true;combat.update(i+20);if(i%10===0)combat.reset();}
const after=resources();assert.deepEqual(after,before);assert.equal(combat.diagnostics().activeGrenades,0);assert.equal(combat.diagnostics().activeExplosions,0);
for(const alias of ['grenade_pull_pin','foley_throw','grenade_bounce_concrete','grenade_explode','grenade_explode_bass']){assert(manifest.sounds[alias]?.length);for(const s of manifest.sounds[alias])assert(fs.statSync(new URL('../local-data/'+s.url.slice(6),import.meta.url)).size>44);}
const audio=new OriginalAudio(manifest.sounds);audio.context={currentTime:10};let stopped=0;
const source=(loop,startAt)=>({loop,startAt,node:{stop(){stopped++;},disconnect(){}},gain:{disconnect(){}}}),boom=source(false,9),music=source(true,0),scheduled=source(false,11);audio.sources=new Set([boom,music,scheduled]);audio.stopSession(true);assert.deepEqual([...audio.sources],[boom],'A current grenade boom must finish after player death');assert.equal(stopped,2);audio.stopSession();assert.equal(audio.sources.size,0);
const report={releaseAt:.75,fuseDue:4.15,crateShieldsDamage:true,nativeFloor:true,poolCycles:1000,combat:combat.diagnostics()};fs.writeFileSync(new URL('../local-data/grenade-verification.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
