// Buried's presentation polish data: the original createfx placements
// (createoneshoteffect origins, angles and exploders) for its ambient dust,
// fog, god rays, lamp glows and barrier breaks, and the original particle
// textures the remake's effects draw with. Writes
// local-data/gameplay/bo2-buried/polish.json; the preload pack picks it up.
import {readFile,writeFile,access} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),data=path.join(root,'local-data');
const source=await readFile(path.join(data,'bo2-scripts/t6/maps/mp/createfx/zm_buried_fx.gsc'),'utf8');
const vector=text=>{
  text=text.trim();let m=text.match(/^vectorscale\(\s*\(([^)]*)\)\s*,\s*([-\d.e]+)\s*\)$/);
  if(m){const s=Number(m[2]);return m[1].split(',').map(v=>Number(v)*s);}
  m=text.match(/^\(([^)]*)\)$/);return m?m[1].split(',').map(Number):null;
};
const placements=[];let current=null;
for(const line of source.split(/\r?\n/)){
  let m=line.match(/create(?:oneshot|loop|exploder)effect\(\s*"([^"]+)"\s*\)/);
  if(m){current={fx:m[1].replace(/^fx_buried_/,'')};placements.push(current);continue;}
  if(!current)continue;
  m=line.match(/ent\.v\["(origin|angles)"\]\s*=\s*(.*);/);if(m){current[m[1]]=vector(m[2]).map(v=>Math.round(v*100)/100);continue;}
  m=line.match(/ent\.v\["exploder"\]\s*=\s*(\d+);/);if(m)current.exploder=Number(m[1]);
}
const ambient=placements.filter(p=>p.origin&&p.exploder==null),exploders=placements.filter(p=>p.origin&&p.exploder!=null);
// Particle textures by role (the zone that holds each), with the atlas grid.
const textures={
  smoke:['bo2-common','fxt_smk_light',2,1],puff:['bo2-common','fxt_smk_puff',2,1],dust:['bo2-common','fxt_debris_fine_clump',1,1],plume:['bo2-common','fxt_debris_plume_dirt',2,1],
  whisp:['bo2-common','fxt_smk_whisp',2,1],mote:['bo2-buried','fxt_env_dust_mote_atlas',2,2],spark:['bo2-common','fxt_spark_single',4,1],glow:['bo2-common','fxt_light_glow',1,1],
  star:['bo2-buried','fxt_light_flare_star',1,1],ray:['bo2-buried','fxt_light_ray_ribbon',1,1],wood:['bo2-common','fxt_debris_gib_wood',2,2],rock:['bo2-common','fxt_debris_gib_rock',2,2],
  concrete:['bo2-common','fxt_debris_gib_concrete',2,2],metal:['bo2-common','fxt_debris_gib_metal',2,2],glass:['bo2-common','fxt_debris_glass2',4,2],tracer:['bo2-buried','fxt_tracer_trail',1,1],
  energy:['bo2-buried','fxt_spark_pcloud_blue_1',1,1],
};
const out={};
for(const [role,[zone,name,cols,rows]]of Object.entries(textures)){
  const file=path.join(data,zone,'images',name+'.dds');await access(file);out[role]={url:`/data/${zone}/images/${name}.dds`,cols,rows};
}
const polish={source:'zm_buried_fx.gsc createfx',ambient,exploders,textures:out};
await writeFile(path.join(data,'gameplay/bo2-buried/polish.json'),JSON.stringify(polish));
const counts={};for(const p of ambient)counts[p.fx]=(counts[p.fx]||0)+1;
console.log('Buried polish:',ambient.length,'ambient placements,',exploders.length,'exploder placements,',Object.keys(out).length,'textures');console.log(counts);
