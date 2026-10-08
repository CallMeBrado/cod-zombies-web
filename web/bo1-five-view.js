import * as THREE from 'three';
import {model,cloneModel,shadeModel} from './assets.js';
import {PosedTrace} from './posed-trace.js';
const pos=e=>e.origin.split(/\s+/).map(Number);
export class FiveView {
  constructor(scene,map,dynamic){Object.assign(this,{scene,map,dynamic});this.poseTick=0;}
  async prepare(m){this.manifest=m;this.signs=[];
    for(const item of this.dynamic.get('defcon_sign')||[]){const signs=[];for(let i=1;i<=5;i++){const sign=cloneModel(await model('p_zom_pent_defcon_sign_0'+i));shadeModel(sign,this.map.illumination(pos(item.entity)));item.object.add(sign);signs.push(sign);}const original=item.object.children[0];original.visible=false;this.signs.push({item,signs});}
    this.movers=m.map.moving.flatMap(v=>this.dynamic.get(v.target)||[]);
    this.powerDoors=m.map.powerTargets.flatMap(t=>this.dynamic.get(t)||[]);
    this.papBlockers=m.map.papBlockers.flatMap(t=>this.dynamic.get(t)||[]);
    this.switches=m.map.defconSwitches.map(s=>({s,items:(this.dynamic.get(s.target)||[]).filter(v=>v.entity.script_noteworthy==='defcon_handle')}));
    for(const i of [...this.movers,...this.powerDoors,...this.papBlockers,...this.switches.flatMap(v=>v.items)]){i.restPosition=i.object.position.clone();i.restRotation=i.object.rotation.clone();}
    this.chests=m.entities.filter(e=>e.targetname==='treasure_chest_use').map(e=>{const lid=m.entities.find(v=>v.targetname===e.target),origin=m.entities.find(v=>v.targetname===lid.target),base=m.entities.find(v=>v.targetname===origin.target);return {target:e.target,items:[...(this.dynamic.get(e.target)||[]),...(this.dynamic.get(base?.targetname)||[])]};});
    // Moving native geometry must be traced in its current pose, rather than
    // at the original static placement baked by addRoot().
    const roots=new Set([...this.movers,...this.powerDoors,...this.papBlockers].map(i=>i.object));
    this.map.bullets.entries=this.map.bullets.entries.filter(e=>{for(let n=e.owner;n;n=n.parent)if(roots.has(n))return false;return true;});
    this.traces=[...roots].map(root=>({root,trace:new PosedTrace(root,{visibleOnly:true})}));const base=this.map.bullets.trace.bind(this.map.bullets);this.ray=new THREE.Ray();
    this.map.bullets.trace=(origin,dir,range)=>{let hit=base(origin,dir,range),limit=hit?.distance??range;this.ray.origin.fromArray(origin);this.ray.direction.fromArray(dir);for(const v of this.traces){if(!v.root.visible)continue;v.root.updateWorldMatrix(true,true);const h=v.trace.trace(this.ray,limit,this.poseTick);if(h&&h.distance<limit){limit=h.distance;hit={...h,point:origin.map((x,k)=>x+dir[k]*limit),normal:[0,0,0]};}}return hit;};
  }
  reset(){this.poseTick++;}
  update(g,cells){const r=g.mapRules;this.poseTick++;
    if(!this.unculled){this.unculled=true;for(const item of [...this.movers,...this.powerDoors,...this.papBlockers,...this.signs.map(v=>v.item)]){const holder=item.object.parent,i=cells.findIndex(c=>c.holder===holder);if(i>=0){cells.splice(i,1);holder.visible=true;}}}
    for(const {signs}of this.signs)signs.forEach((s,i)=>s.visible=i+1===r.defcon);
    for(const {s,items}of this.switches)for(const item of items){item.object.rotation.copy(item.restRotation);if(r.switches.includes(s.index))item.object.rotation.x-=Math.PI/2;}
    for(const item of this.powerDoors)item.object.visible=!r.power;
    for(const item of this.papBlockers)item.object.visible=!g.collision.disabled.has(item.entity.targetname);
    for(const chest of this.chests){const phase=g.boxes.get(chest.target)?.phase,show=g.activeBox===chest.target||g.powerup.fire_sale||['cycling','offered','teddy','closing'].includes(phase);for(const item of chest.items)item.object.visible=!!show;}
    for(const items of this.dynamic.values())for(const item of items)if(item.entity.fivePartModel!=null)item.object.visible=!r.trapParts.includes(item.entity.fivePartModel);
  }
}
