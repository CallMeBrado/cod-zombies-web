import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {BlackOpsEngine} from '../web/bo1-engine.js';
import {CollisionWorld} from '../web/collision.js';
import {PlayerVoice,PLAYER_VOX,weaponVoxType,CHARACTERS} from '../web/player-voice.js';
const read=async p=>JSON.parse(await readFile(new URL('../local-data/'+p,import.meta.url),'utf8'));
const manifest=await read('gameplay/bo1-kino/manifest.json'),collision=await read('bo1-kino/web-world/zombie_theater.collision.json'),paths=await read('bo1-kino/web-world/zombie_theater.paths.json'),presentation=await read('gameplay/bo1-kino/presentation.json');

// Every character has the lines the Kino triggers can ask for.
const voice=manifest.voice;assert(Object.keys(voice).length>1300,'Kino voice table');
const lines=suffix=>c=>{let n=0;while(voice[`vox_plr_${c}_${suffix}_${n}`])n++;return n;};
for(let c=0;c<4;c++){
  for(const suffix of ['level_start','kill_headshot','kill_streak','kill_close','kill_insta','kill_explo','kill_ray','kill_damaged','ammo_low','ammo_out','revive_down','box_move','perk_jugga','perk_speed','perk_doubletap','perk_revive',
    'powerup_nuke','powerup_insta','powerup_ammo','powerup_double','powerup_carp','wpck_crappy','wpck_smg','wpck_shotgun','wpck_mg','wpck_sniper','wpck_raygun','wpck_upgrade','wpck_upgrade_wait','wpck_favorite','wpck_favorite_upgrade'])
    assert(lines(suffix)(c)>0,`${CHARACTERS[c]} has ${suffix}`);
  assert(lines('nomoney')(c)>=3,`${CHARACTERS[c]} has the three forced no-money variants`);
  for(const entry of [voice[`vox_plr_${c}_level_start_0`][0]]){const bytes=await readFile(new URL('../local-data/'+entry.url.slice(6),import.meta.url));assert.equal(bytes.toString('ascii',0,4),'OggS');}
}
// weapon_type_check(): favourites, upgrades and categories.
assert.equal(weaponVoxType(0,'m16_zm'),'favorite');assert.equal(weaponVoxType(0,'rottweil72_upgraded_zm'),'favorite_upgrade');
assert.equal(weaponVoxType(1,'m16_zm'),'burstrifle');assert.equal(weaponVoxType(3,'mp40_zm'),'favorite');assert.equal(weaponVoxType(2,'thundergun_upgraded_zm'),'favorite_upgrade');
assert.equal(weaponVoxType(2,'mp5k_upgraded_zm'),'upgrade');assert.equal(weaponVoxType(1,'ray_gun_zm'),'raygun');assert.equal(weaponVoxType(1,'m1911_zm'),'pistol');

// The engine says the right line at the right moment.
const said=[],world=new CollisionWorld(collision,manifest.entities);
const g=new BlackOpsEngine(manifest,world,paths,{dialog:e=>said.push({...e,at:g.time})},presentation);g.character=2;g.newGame();g.setMod('god',true);
const run=seconds=>{for(let t=0;t<seconds;t+=1/120)g.tick(1/120,{});};
const last=()=>said.at(-1),clear=()=>said.length=0;
g.start();g.roundDue=1e9;run(4.9);assert(!said.some(e=>e.type==='intro'));run(.2);assert.equal(last().type,'intro','Level start line five seconds in');
// Kills: a long headshot always speaks (99%); a melee kill three in four; lines then wait two seconds.
const random=Math.random;Math.random=()=>0;clear();
const zombie=(dist,extra={})=>({id:900+said.length,dead:false,health:1,position:[g.player.position[0]+dist,g.player.position[1],g.player.position[2]],...extra});
g.killLineUntil=0;g.hitEnemy(zombie(600),10,true,false);assert.deepEqual([last().category,last().type],['kill','headshot']);
g.hitEnemy(zombie(30),10,false,true);assert.equal(said.filter(e=>e.category==='kill').length,1,'Kill lines wait two seconds');
run(2.1);g.hitEnemy(zombie(30),10,false,true);assert.equal(last().type,'melee');
run(2.1);g.powerup.insta_kill=g.time+30;g.hitEnemy(zombie(30),10,false,true);assert.equal(last().type,'melee_instakill');delete g.powerup.insta_kill;
run(2.1);const hurt=zombie(300,{hitPlayer:true});g.hitEnemy(hurt,10,false,false);assert(said.some(e=>e.type==='damage'),'Killing the zombie that hit you');
Math.random=()=>.999;clear();run(5.1);for(let i=0;i<8;i++)g.hitEnemy(zombie(300),10,false,false);assert.deepEqual(said.map(e=>e.type),['streak'],'Eight kills within five seconds');
Math.random=random;
// Power-ups: 3-3.5 s after the grab.
clear();g.pickup({id:1,type:'double_points',position:g.player.position.slice(),expires:g.time+30});run(2.9);assert(!said.some(e=>e.category==='powerup'));run(.7);assert.deepEqual([last().category,last().type],['powerup','double_points']);
// Refusals force their variant: perk without money 0, owned perk 1, box 2, wall gun 0, door 0.
const machine=g.interactions.find(e=>e.targetname==='zombie_vending'&&e.script_noteworthy==='specialty_quickrevive');
clear();g.player.points=0;g.mapRules.use(machine);assert.deepEqual([last().type,last().variant],['perk_deny',0]);
g.mapRules.perks.add('specialty_quickrevive');g.mapRules.use(machine);assert.deepEqual([last().type,last().variant],['perk_deny',1]);g.mapRules.perks.clear();
g.voiceEvent('denied','box');assert.deepEqual([last().type,last().variant],['no_money',2]);g.voiceEvent('denied','door');assert.deepEqual([last().type,last().variant],['door_deny',0]);
// A perk line 1.5 s after the drink.
clear();g.player.points=10000;g.mapRules.use(machine);g.time=g.gesture.due;g.updateGesture();run(1.6);assert.deepEqual([last().category,last().type],['perk','specialty_quickrevive']);
// Weapon pickups use the character's line set.
clear();g.voiceEvent('weapon','china_lake_zm');assert.equal(last().type,'favorite','Takeo\'s favourite');g.voiceEvent('weapon','spas_zm');assert.equal(last().type,'shotgun');
// Ammo: under five warns once per 20 s; empty for two seconds likewise.
clear();g.weapon.clip=2;g.weapon.reserve=0;g.cooldown=1e9;run(.6);assert.equal(last().type,'ammo_low');run(5);assert.equal(said.filter(e=>e.type==='ammo_low').length,1);
g.weapon.clip=0;run(2.6);assert.equal(last().type,'ammo_out');
// Going down (solo Quick Revive) speaks; nothing else is said while down.
clear();g.setMod('god',false);g.mapRules.perks.add('specialty_quickrevive');g.player.health=10;g.damagePlayer(50);assert.equal(last().type,'revive_down');
g.voiceEvent('weapon','spas_zm');assert.equal(said.length,1,'Silent while downed');

// The client deals each line's variants before repeating and speaks one line at a time.
const fake={context:{state:'running',currentTime:0},played:[],async playVoice(alias){this.played.push(alias);return {startAt:this.context.currentTime,duration:1};}};
const v=new PlayerVoice(fake,voice,1);
for(let i=0;i<16;i++){fake.context.currentTime+=2;await v.speak({category:'kill',type:'headshot'});}
const count=lines('kill_headshot')(1),first=fake.played.slice(0,count);assert.equal(new Set(first).size,count,'Every variant once before any repeats');
fake.played.length=0;fake.context.currentTime+=2;await v.speak({category:'general',type:'no_money',variant:2});assert.equal(fake.played[0],'vox_plr_1_nomoney_2');
await v.speak({category:'general',type:'no_money',variant:1});assert.equal(fake.played.length,1,'One player line at a time');
assert.equal(await v.speak({category:'kill',type:'tesla'}),null,'Lines Kino has no recordings for are skipped');
console.log('Player voice passed:',JSON.stringify({lines:Object.keys(voice).length,perCharacter:CHARACTERS.map((n,c)=>n+' '+Object.keys(voice).filter(a=>a.startsWith(`vox_plr_${c}_`)).length),categories:Object.keys(PLAYER_VOX)}));
