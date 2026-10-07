import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {SoloGame} from '../web/game.js';
import {CollisionWorld} from '../web/collision.js';
import {VerrucktRules} from '../web/waw-verruckt.js';
const read=async p=>JSON.parse(await readFile(new URL('../local-data/'+p,import.meta.url),'utf8'));
const manifest=await read('gameplay/verruckt/manifest.json'),presentation=await read('gameplay/verruckt/presentation.json');
const collision=await read('verruckt/web-world/nazi_zombie_asylum.collision.json'),paths=await read('verruckt/web-world/nazi_zombie_asylum.paths.json');
const g=new SoloGame(manifest,new CollisionWorld(collision,manifest.entities),paths,{},presentation,game=>new VerrucktRules(game));
g.prepareSpawnPaths(await read('gameplay/verruckt/navigation.json'));
const r=g.mapRules,run=seconds=>{for(let i=0;i<seconds*120;i++)g.update(1/120,{});},report={};
let seed=91;Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const stand=e=>{const p=e.position||e.origin.split(' ').map(Number);g.player.position=[p[0],p[1],p[2]-35];g.player.previousPosition=g.player.position.slice();};
const interaction=f=>g.interactions.find(f);

// Data: 20 windows (three 15-chunk stone walls), 32 rise spots, five chests.
assert.equal(g.windows.length,20);
assert.deepEqual(g.windows.filter(w=>w.maxBoards===15).map(w=>w.target).sort(),['north_wall_break','upper_wall_chunk','upper_wall_chunk2']);
assert.equal(manifest.map.riseSpots.length,32);assert.equal(Object.keys(manifest.map.chests).length,5);
for(const name of ['ai_zombie_traverse_ground_v1_walk','ai_zombie_walk_v9','ai_zombie_sprint_v5','ai_zombie_run_attack_v1'])assert(presentation.animations[name],'Animation '+name);
for(const name of ['break_stone','box_poof','elec_loop','zombie_arc','laugh_child'])assert(manifest.sounds[name],'Sound '+name);

// spawn_point_override(): solo starts at the first marker of a random side.
const sides=new Set();
for(let i=0;i<8;i++){g.newGame();sides.add(r.side);const marker=r.sides[r.side][0].origin.split(' ').map(Number);assert(Math.hypot(g.player.position[0]-marker[0],g.player.position[1]-marker[1])<1);}
assert.deepEqual([...sides].sort(),['north','south']);report.sides=[...sides];

// Rounds 1 and 2 hold six zombies solo.
g.newGame();g.start();g.mods={...g.mods,god:true};run(3);assert.equal(g.round,1);assert.equal(g.remaining+g.enemies.length,6);
assert.equal(r.roundCount(3,1),null);

// manage_zone(): only the initial (riser) spawners at first; risers climb out
// of the courtyard and head for a window.
const occupiedGroups=manifest.map.zones.filter(z=>z.spawners&&r.occupied(z)).map(z=>z.spawners);
assert.deepEqual([...new Set(r.enabledSpawners().map(e=>e.targetname))].sort(),['zombie_spawner_init',...occupiedGroups].sort(),'The start set plus the occupied volume spawners');
report.startGroups=occupiedGroups;
const before=g.enemies.length;g.remaining=40;let risen=null;
for(let i=0;i<20&&!risen;i++){g.spawnEnemy();risen=g.enemies.slice(before).find(e=>e.stage==='rise');}
assert(risen,'A riser spawns');assert(/traverse_ground/.test(risen.riseAnim));
assert(manifest.map.riseSpots.some(s=>Math.hypot(s[0]-risen.position[0],s[1]-risen.position[1])<1),'Risers use the zombie_rise structs');
run(risen.riseUntil-g.time+.1);assert.equal(risen.stage,'approach');assert(risen.path.length,'A risen zombie walks to its window');
report.riser=risen.riseAnim;
const windows=new Set(r.windows().map(w=>w.target));
assert(!windows.has('auto112')&&!windows.has('auto233'),'Door goals start off');

// Doors: the north door adds its spawners and both north_lower_door goals.
g.player.points=50000;
const north=interaction(e=>e.script_flag==='north_door1');stand(north);g.use();assert(g.opened.has('auto50'));
assert(r.enabledSpawners().some(e=>e.targetname==='zombie_spawner_north_door'));
r.zoneDue=0;run(1.1);
const zone=manifest.map.zones.find(z=>z.name==='north_spawners');
report.northZone=r.occupied(zone);

// Power: perks and the middle divider 6 s after the lever.
const power=interaction(e=>e.targetname==='use_power_switch');assert.equal(power.nativeTargetname,'use_master_switch');
const electric=interaction(e=>e.script_noteworthy==='electric_door');assert(!g.opened.has(electric.target));
stand(power);assert.match(g.prompt(),/power/i);g.use();assert(r.switched);assert(!r.power,'Perks wait for the current');
run(6);assert(!r.power);run(.5);assert(r.power);assert(g.opened.has(electric.target),'The divider opens with the perks');
assert(!r.enabledSpawners().some(e=>e.targetname==='auto202'),'open_bottom_doors adds no spawners');
report.power='lever, perks and divider at 6.3 s';

// Electric traps: 1000 points after the lever swings; zombies in the current
// die without points; 25 s on, 25 s off.
const trap=r.traps[0],lever=trap.trigger;stand(lever);
const points=g.player.points;assert.match(g.prompt(),/electric trap · 1000/);g.use();run(.6);assert.equal(g.player.points,points-1000);
const h=trap.hulls[0],center=h.mins.map((v,k)=>(v+h.maxs[k])/2);
const victim={id:9999,position:[center[0],center[1],h.mins[2]+1],health:5000,dead:false,stage:'hunt',path:[],window:g.windows[0],age:0,speed:0,gait:'ai_zombie_walk_v1'};
g.enemies.push(victim);const kills=g.player.kills;run(1.5);assert(victim.dead,'The current kills a zombie');assert.equal(g.player.kills,kills);assert.equal(g.player.points,points-1000);
run(24);assert.match(g.prompt(),/unavailable/);run(26);assert.match(g.prompt(),/electric trap · 1000/);
report.trap='1000 points, 25 s on, 25 s off';

// The box: chest_accessed+3 percent from the fifth use, and it only moves to
// opened areas (magic_box_limit_location_init).
assert.equal(g.activeBox,'magic_box_lid_0');
const options=new Set();for(let i=0;i<200;i++)options.add(r.nextBox('magic_box_lid_0'));
assert.deepEqual([...options].sort(),['magic_box_lid_1','magic_box_lid_4'],'Hallway opens with north_door1; opened_chest is always available');
g.boxUses=0;let jokers=0;for(let i=0;i<1000;i++)jokers+=r.boxJoker();assert(jokers<30,'Almost never before the fifth use');
g.boxUses=20;jokers=0;for(let i=0;i<1000;i++)jokers+=r.boxJoker();assert(jokers>200&&jokers<280,'24% at the 21st use');
report.box='moves within opened areas';
console.log('Verrückt logic passed:',JSON.stringify(report));
