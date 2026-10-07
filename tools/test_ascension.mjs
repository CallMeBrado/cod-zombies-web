import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {BlackOpsEngine} from '../web/bo1-engine.js';
import {CollisionWorld} from '../web/collision.js';
import {AscensionRules} from '../web/bo1-ascension.js';
const read=async p=>JSON.parse(await readFile(new URL('../local-data/'+p,import.meta.url),'utf8'));
const manifest=await read('gameplay/bo1-cosmodrome/manifest.json'),presentation=await read('gameplay/bo1-cosmodrome/presentation.json');
const collision=await read('bo1-cosmodrome/web-world/zombie_cosmodrome.collision.json'),paths=await read('bo1-cosmodrome/web-world/zombie_cosmodrome.paths.json');
const g=new BlackOpsEngine(manifest,new CollisionWorld(collision,manifest.entities),paths,{},presentation,game=>new AscensionRules(game));
g.prepareSpawnPaths(await read('gameplay/bo1-cosmodrome/navigation.json'));
const r=g.mapRules,run=seconds=>{for(let i=0;i<seconds*120;i++)g.update(1/120,{});},report={};

// Data: both start zones, all windows routed, the box from include_weapon.
assert.deepEqual(manifest.map.initialZones,['centrifuge_zone','centrifuge_zone2']);
assert.equal(Object.keys(manifest.map.goals).length,32);
assert(!manifest.map.boxWeapons.includes('ak74u_zm'),'Wall weapons stay out of the box');
assert(manifest.map.boxWeapons.includes('thundergun_zm')&&manifest.map.boxWeapons.includes('python_zm'));
assert.deepEqual(manifest.playerBodies.map(b=>b.body),['c_usa_dempsey_dlc2_body','c_rus_nikolai_dlc2_body','c_jap_takeo_dlc2_body','c_ger_richtofen_dlc2_body']);
for(const name of ['zmb_lander_land','vox_ann_launch_countdown_1','mus_cosmo_underscore','zmb_phdflop_explo'])assert(manifest.sounds[name],'Sound '+name);

// new_lander_intro(): the players ride the lander down to the centrifuge.
g.newGame();g.start();g.mods={...g.mods,god:true};
run(1);assert(r.riding);assert(g.player.position[2]>700,'The intro starts in the sky');
run(9.5);assert.equal(r.lander.at,'lander_station5');assert(!r.riding);assert(Math.abs(g.player.position[2]-r.stations.lander_station5.origin[2])<20);
report.intro='sky to centrifuge in 9.5 s';
assert.match(r.prompt(r.ride,'E'),/power/);
r.use(g.interactions.find(e=>e.targetname==='use_power_switch'));run(.1);
assert.equal(r.prompt(r.ride,'E'),'No lunar lander connections','A call box must be used before riding');

// A call box sends the empty lander; riding costs 250, carries the player
// and holds spawning, and counts toward the launch.
for(const flag of ['tunnel_centrifuge_entry','base_entry_group','centrifuge2power','power_group','base_entry_2_power'])r.flags.add(flag);
r.use(g.interactions.find(e=>e.targetname==='zip_call_box'&&e.script_noteworthy==='lander_station1'));run(25);
assert.equal(r.lander.at,'lander_station1');assert(r.lander.connected);
const station=r.stations.lander_station1;g.player.position=[station.riders[0],station.riders[1],station.origin[2]];g.player.points=5000;r.lander.cooldown=0;
assert.match(r.prompt(r.ride,'E'),/Ride the lunar lander · 250/);
r.use(r.ride);run(1);assert(r.riding);assert(r.spawnPaused);assert.equal(g.player.points,4750);
run(25);assert.equal(r.lander.at,'lander_station5');assert(!r.riding);assert(!r.spawnPaused);assert(r.flags.has('lander_a_used'));
assert(g.time<r.lander.cooldown,'A ride starts the 30 s cooldown');
report.ride='base entry to centrifuge, 250 points';

// Three lander rides authorize the launch; 10 s after liftoff the Pack-a-Punch
// doors open and join the rocket zones.
const panel=g.interactions.find(e=>e.targetname==='trig_launch_rocket');
assert.match(r.prompt(panel,'E'),/authorization/);
r.flags.add('lander_b_used');r.flags.add('lander_c_used');r.landerProgress();
assert.match(r.prompt(panel,'E'),/Launch the rocket/);
r.use(panel);run(19.9);assert(!r.launched);run(.5);assert(r.launched);assert(r.flags.has('rocket_group'));
r.flags.add('base_entry_2_north_path');r.flags.add('roof_connector_dropoff');
assert(r.activeZones().has('under_rocket_zone'),'The rocket room joins the zones through the north path');
run(1.6);assert.equal(r.moverOffset({targetname:'rocket_room_bottom_door',script_vector:'0 0 -120'})[2],-120,'The bottom door slides down 120');
report.launch='authorized by three landers, doors open 10 s after liftoff';

// Risers climb out of their zone's rise structs on level._zombie_rise_anims.
g.newGame();g.start();g.mods={...g.mods,god:true};run(11);
const riser=g.spawnEntities.find(e=>e.script_string==='riser');r.flags.add('tunnel_centrifuge_entry');r.flags.add('base_entry_group');
g.player.position=r.stations.lander_station1.riders.slice();
const before=g.enemies.length;g.remaining=1;
g.enabledSpawners=()=>[riser];try{g.spawnEnemy();}finally{delete g.enabledSpawners;}
const risen=g.enemies[before];assert(risen,'A riser spawns');assert.equal(risen.stage,'rise');assert(/traverse_ground/.test(risen.riseAnim));
run(12);assert.notEqual(risen.stage,'rise','It hunts once it has risen');report.riser=risen.riseAnim;

// Stamin-Up and PhD Flopper machines.
for(const id of ['specialty_longersprint','specialty_flakjacket'])assert(g.interactions.some(e=>e.targetname==='zombie_vending'&&e.script_noteworthy===id));
r.perks.add('specialty_flakjacket');const target={id:9999,position:[g.player.position[0]+100,g.player.position[1],g.player.position[2]],health:1000,dead:false,stage:'hunt',path:[],window:g.windows[0]};
g.enemies.push(target);g.diveToNuke(g.player.position.slice());assert(target.dead,'divetonuke_explode kills within 300');
console.log('Ascension logic passed:',JSON.stringify(report));
