// Integration checks use the actual exported Nacht collision, entities, and paths.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {CollisionWorld} from '../web/collision.js';
import {SoloGame} from '../web/game.js';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const manifest=read('local-data/gameplay/manifest.json'),collision=read('local-data/nacht/web-world/nazi_zombie_prototype.collision.json'),paths=read('local-data/nacht/web-world/nazi_zombie_prototype.paths.json');
let seed=17;Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const navigation=read('local-data/gameplay/navigation.json');
const create=()=>{const game=new SoloGame(manifest,new CollisionWorld(collision,manifest.entities),paths);game.prepareSpawnPaths(navigation);return game;};
const result={};
let game=create();game.start();
for(let i=0;i<300;i++)game.update(1/60,{forward:1});
assert(game.player.position[0]>-240&&game.player.position[0]<-180,'Player must stop at the original west wall');
assert(game.player.position[2]>0&&game.player.position[2]<3,'Player must stand on the original floor');
result.collision={wallX:game.player.position[0],floorZ:game.player.position[2]};
game=create();game.start();
for(let i=0;i<12000&&game.phase!=='dead';i++)game.update(1/60,{});
assert.equal(game.phase,'dead','An idle player must be reached and killed by entering zombies');
assert.equal(game.player.health,0);result.deathAt=game.time;
game.newGame();assert.equal(game.player.health,100);assert.deepEqual([game.weapon.clip,game.weapon.reserve],[8,32]);assert.equal(game.enemies.length,0);assert.equal(game.round,0);
result.restart=true;
game.start();
// Walk to the original Kar98k wall purchase, using normal physics and interaction.
for(let i=0;i<400;i++) {
  const [x,y]=game.player.position;const target=[-155,242];
  if(Math.hypot(x-target[0],y-target[1])<4)break;
  game.aim(Math.atan2(target[1]-y,target[0]-x),0);game.update(1/60,{forward:1});
}
assert.match(game.prompt(),/Kar98k/);game.use();assert.equal(game.weapon.name,'kar98k');assert.equal(game.player.points,300);result.purchase=true;
// Play through real waves: normal ray hits, cooldown, ammunition, reload, and melee.
game.ads=1;
for(let i=0;i<36000&&game.phase!=='dead'&&game.round<3;i++) {
  const origin=[game.player.position[0],game.player.position[1],game.player.position[2]+60];
  const enemies=game.enemies.filter(e=>!e.dead).sort((a,b)=>Math.hypot(a.position[0]-origin[0],a.position[1]-origin[1])-Math.hypot(b.position[0]-origin[0],b.position[1]-origin[1]));
  for(const enemy of enemies) {
    const delta=[enemy.position[0]-origin[0],enemy.position[1]-origin[1],enemy.position[2]+65-origin[2]];
    game.aim(Math.atan2(delta[1],delta[0]),Math.atan2(delta[2],Math.hypot(delta[0],delta[1])));
    if(game.rayHit().hit){game.fire();break;}
  }
  if(!game.weapon.clip)game.reload();
  if(game.weapon.reserve<5&&game.player.points>=100)game.use();
  game.update(1/60,{});
}
assert(game.round>=3,'Original rounds 1 and 2 must complete with live combat');
assert(game.player.kills>=13);assert(game.shots>=13&&game.hits>=13);assert(game.player.health>0);
result.combat={round:game.round,kills:game.player.kills,shots:game.shots,hits:game.hits,health:game.player.health,points:game.player.points,time:game.time};
fs.writeFileSync(path.join(root,'local-data/gameplay-verification.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
