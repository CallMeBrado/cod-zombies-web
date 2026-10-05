// Regression coverage for the reported spawn fall and missing original intro cues.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {CollisionWorld} from '../web/collision.js';
import {SoloGame} from '../web/game.js';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read=p=>JSON.parse(fs.readFileSync(path.join(root,'local-data',p),'utf8'));
const manifest=read('gameplay/manifest.json'),collision=read('nacht/web-world/nazi_zombie_prototype.collision.json'),paths=read('nacht/web-world/nazi_zombie_prototype.paths.json');
const world=new CollisionWorld(collision,manifest.entities);
const navigation=read('gameplay/navigation.json');
const spawns=manifest.entities.filter(e=>e.targetname==='initial_spawn_points').map(e=>e.origin.split(/\s+/).map(Number));
const report={spawnChecks:[],audio:[],contactChecks:[],firefoxTiming:[]};
const create=spawn=>{const game=new SoloGame(manifest,world,paths);game.prepareSpawnPaths(navigation);game.spawn=spawn.slice();game.newGame();game.start();return game;};
for(const spawn of spawns) {
  const floor=world.move(spawn,[0,0,-96]);assert(floor.grounded,'An original spawn must have a walkable floor.');
  for(const hz of [20,30,60,75,120,144,165,240,360,1000]) {
    const game=create(spawn);
    for(let frame=0;frame<hz*3;frame++) {
      game.update(1/hz,{});
      assert(game.player.position[2]>=floor.position[2]-.031,`Spawn ${spawn} fell below its floor at ${hz} FPS.`);
    }
    assert(game.player.grounded);assert.equal(game.player.health,100);
    assert.equal(game.physicsTicks,360,'Three seconds must always simulate 360 physics ticks.');
    // Jump and settle again; the fix must preserve both directions of motion.
    let highest=game.player.position[2];
    for(let frame=0;frame<hz*2;frame++){game.update(1/hz,{jump:frame===0});highest=Math.max(highest,game.player.position[2]);}
    assert(highest>floor.position[2]+20,'Jump must leave the ground.');
    assert(game.player.grounded);assert(Math.abs(game.player.position[2]-floor.position[2])<=.031);
    report.spawnChecks.push({spawn,hz,floorZ:game.player.position[2],jumpHeight:highest-floor.position[2]});
  }
  let seed=42;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const game=create(spawn);
  while(game.time<4){game.update(.001+random()*.049,{});assert(game.player.position[2]>=floor.position[2]-.031,'Uneven frame times must not fall through the floor.');}
  assert(game.player.grounded);report.spawnChecks.push({spawn,hz:'variable',floorZ:game.player.position[2]});
  const touching=[spawn[0],spawn[1],floor.position[2]-.03];
  const down=world.move(touching,[0,0,-800/(240*240)]);
  assert(down.grounded);assert(down.position[2]>=touching[2]-1e-12,'Exact floor contact must never allow a downward clear sweep.');
  const up=world.move(touching,[0,0,5]);assert(up.position[2]>touching[2]+4.9,'Starting on a floor must still allow leaving it.');
  const walk=world.step(touching,[3,0,-800/(240*240)]);assert(walk.position[0]>touching[0]+2.9);assert(walk.position[2]>=touching[2]-.001);
  report.contactChecks.push({spawn,touchingZ:touching[2],downZ:down.position[2],upZ:up.position[2],walkingZ:walk.position[2]});
  for(const precisionMs of [2,8,100]){
    const game=create(spawn);let last=0;
    for(let frame=1;frame<=720;frame++){
      const timestamp=Math.round(frame/240*1000/precisionMs)*precisionMs/1000;
      game.update(timestamp-last,{});last=timestamp;
      assert(game.player.position[2]>=floor.position[2]-.031);
    }
    assert.equal(game.physicsTicks,360);assert(game.player.grounded);assert.equal(game.player.health,100);
    const before=game.player.position.slice();game.update(0,{jump:true});game.update(-.002,{});game.update(NaN,{});
    assert.deepEqual(game.player.position,before);game.update(1/120,{});assert(game.player.position[2]>before[2],'A jump queued on a duplicate timestamp must not be lost.');
    report.firefoxTiming.push({spawn,renderHz:240,precisionMs,physicsTicks:360,floorZ:before[2],queuedJump:true});
  }
}
let starts=0;const cues=[];
const game=new SoloGame(manifest,world,paths,{sessionStart:()=>starts++,sound:s=>cues.push(s.alias)});
game.prepareSpawnPaths(navigation);
game.start();game.start();for(let frame=0;frame<180;frame++)game.update(1/60,{});
assert.equal(starts,1,'Resuming must not replay the splash sound.');assert(cues.includes('chalk'),'Round one must play its original chalk cue.');
game.newGame();game.start();assert.equal(starts,2,'A fresh game must replay the intro.');
for(const alias of ['mx_splash_screen','mx_zombie_wave_1','chalk','round_over','amb_spooky_2d']) {
  const entries=manifest.sounds[alias];assert(entries?.length,`Missing sound alias ${alias}.`);
  for(const entry of entries) {
    const file=path.join(root,'local-data',entry.url.slice('/data/'.length));const buffer=fs.readFileSync(file);
    assert.equal(buffer.toString('ascii',0,4),'RIFF');assert.equal(buffer.toString('ascii',8,12),'WAVE');
    assert.equal(buffer.readUInt16LE(20),1,`${alias} must be converted to PCM for browser decoding.`);assert(buffer.length>44);
    report.audio.push({alias,url:entry.url,bytes:buffer.length});
  }
}
fs.writeFileSync(path.join(root,'local-data/startup-verification.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({originalSpawns:spawns.length,physicsChecks:report.spawnChecks.length,exactFloorChecks:report.contactChecks.length,firefoxTimingChecks:report.firefoxTiming.length,originalAudioFiles:report.audio.length,sessionRestart:true}));
