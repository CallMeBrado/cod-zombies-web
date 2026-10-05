import assert from 'node:assert/strict';
import fs from 'node:fs';
import {SoloGame} from '../web/game.js';
import {CollisionWorld} from '../web/collision.js';
const read=name=>JSON.parse(fs.readFileSync(new URL('../local-data/'+name,import.meta.url)));
const manifest=read('gameplay/manifest.json'),presentation=read('gameplay/presentation.json'),collision=read('nacht/web-world/nazi_zombie_prototype.collision.json'),paths=read('nacht/web-world/nazi_zombie_prototype.paths.json');
const navigation=read('gameplay/navigation.json');
const create=events=>{const game=new SoloGame(manifest,new CollisionWorld(collision,manifest.entities),paths,events,presentation);game.prepareSpawnPaths(navigation);return game;};
const advance=(game,seconds,input={})=>{for(let i=0;i<Math.round(seconds*240);i++)game.update(1/240,input);};
const report={};
let game=create();game.start();game.roundDue=1e6;game.spawnEnemy();let enemy=game.enemies[0],window=game.windows[0];
Object.assign(enemy,{window,position:window.outside.slice(),previousPosition:window.outside.slice(),stage:'barrier',path:[]});
const removals=[],heights=[];let priorBoards=6,enteredAt=null;
for(let i=0;i<40*240&&enemy.stage!=='hunt';i++){
  game.update(1/240,{});
  if(window.boards<priorBoards){assert(enemy.tear?.removed,'Board removal must follow the original notetrack');removals.push(game.time);priorBoards=window.boards;}
  if(enemy.stage==='enter'||enemy.stage==='traverse'){assert.equal(window.boards,0);enteredAt??=game.time;game.rebuild(window);assert.equal(window.boards,0,'Boards cannot appear across an occupied vault');}
  if(enemy.stage==='traverse')heights.push(enemy.position[2]);
}
assert.equal(removals.length,6);assert.equal(enemy.stage,'hunt');assert(heights.length>200,'The original vault must be a full animated traversal');assert(Math.max(...heights)>window.entry[2]+5,'Original root motion must lift the zombie over the sill');assert(Math.abs(enemy.position[2]-window.entry[2])<.1);
report.barrier={removals,enteredAt,traverse:enemy.traverseAnim,peakHeight:Math.max(...heights),landing:enemy.position};

game=create();assert.equal(game.spawnRoutes.size,12);game.path=()=>{throw new Error('A prepared spawn must not run pathfinding during play');};game.start();game.spawnEnemy();assert(game.enemies[0].path.length);game.newGame();game.start();game.spawnEnemy();assert(game.enemies[0].path.length,'Prepared outside routes survive restart');report.preparedSpawns={windows:12,restart:true};
game=create();game.start();const p=game.player.position;enemy={id:1,position:[p[0]+40,p[1],p[2]],previousPosition:[p[0]+40,p[1],p[2]],health:150,stage:'hunt',age:0,spawnTime:0,speed:0,path:[],attackDue:99,navDue:99,angle:Math.PI,dead:false};game.enemies=[enemy];game.aim(0,0);game.melee();advance(game,.04);assert.equal(enemy.health,150);advance(game,.03);assert(enemy.dead);assert.equal(game.player.kills,1);report.knife={hitAt:game.time,points:game.player.points};
game=create();game.start();game.roundDue=1e6;const boxEntity=game.interactions.find(e=>e.targetname==='treasure_chest_use'),boxPosition=boxEntity.origin.split(/\s+/).map(Number);game.player.position=[boxPosition[0],boxPosition[1],boxPosition[2]-35];game.player.previousPosition=game.player.position.slice();game.player.points=5000;
game.use();const box=game.boxes.get(boxEntity.target);assert.equal(box.phase,'cycling');assert.equal(game.weapon.name,'zombie_colt');assert.equal(game.player.points,4050);game.use();assert.equal(game.player.points,4050);advance(game,3.92);assert.equal(box.phase,'offered');assert.equal(box.index,40);assert.equal(game.weapon.name,'zombie_colt');const offered=box.weapon;game.use();assert.equal(game.weapon.name,offered);assert.equal(box.phase,'closing');assert.equal(game.player.points,4050);advance(game,3.01);assert.equal(box.phase,'closed');game.use();advance(game,16);assert.equal(box.phase,'closing');assert.equal(game.weapon.name,offered);advance(game,3.01);assert.equal(box.phase,'closed');report.box={cycles:40,offerAfter:3.9,offered,timeout:true,points:game.player.points};
game=create();game.start();advance(game,.1,{forward:1,sprint:true});assert(game.sprinting);advance(game,.1,{side:1,sprint:true});assert(!game.sprinting);game.ads=1;advance(game,.1,{forward:1,sprint:true});assert(!game.sprinting);report.sprint={forwardOnly:true,adsCancels:true};
for(const name of Object.values(presentation.powerups))assert(fs.existsSync(new URL('../local-data/nacht/model_export/'+name+'_lod0.glb',import.meta.url)));
assert.equal(manifest.weapons.zombie_colt.knifeModel,'viewmodel_usa_kbar_knife');assert.equal(manifest.sounds.music_box.length,1);report.originalAssets={models:4,knife:true,boxMusic:true,fx:4};
fs.writeFileSync(new URL('../local-data/fidelity-gameplay-verification.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
