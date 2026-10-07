// Verrückt's scripted props: the moving mystery box (bear, lift, rubble), the
// power lever, the two electric-trap levers and the power-opened divider.
import * as THREE from 'three';
import {model,cloneModel,shadeModel} from './assets.js';

const vec=s=>String(s||'0 0 0').trim().split(/\s+/).map(Number);
const rad=THREE.MathUtils.degToRad;

export class VerrucktView {
  constructor(scene,dynamic,entities,illumination){
    this.scene=scene;this.dynamic=dynamic;this.entities=entities;this.illumination=illumination;
    const find=name=>entities.find(e=>e.targetname===name);
    // get_chest_pieces(): trigger -> lid -> origin -> box; "<noteworthy>_rubble".
    this.chests=entities.filter(e=>e.targetname==='treasure_chest_use').map(trigger=>{
      const lid=find(trigger.target),origin=lid&&find(lid.target),base=origin&&find(origin.target);
      const items=[...(dynamic.get(trigger.target)||[]),...(base?dynamic.get(base.targetname)||[]:[])];
      return {target:trigger.target,note:trigger.script_noteworthy,items,rubble:dynamic.get('#'+trigger.script_noteworthy+'_rubble')||[],
        origin:vec(origin?.origin),yaw:vec(origin?.angles)[1]};
    });
    this.lever=dynamic.get('master_switch')||[];
    // electric_trap_move_switch(): lever "4" (north) pitches -180, the other +180.
    this.trapLevers=entities.filter(e=>e.targetname==='gas_access').map(trap=>({trap,sign:trap.script_linkto==='4'?-1:1,
      items:dynamic.get('@'+trap.script_linkto)||[]}));
    const door=entities.find(e=>e.script_noteworthy==='electric_door');
    this.divider=door?(dynamic.get(door.target)||[]).filter(item=>item.entity.script_vector):[];
    this.dividerTarget=door?.target;
    for(const item of [...this.chests.flatMap(c=>c.items),...this.lever,...this.trapLevers.flatMap(t=>t.items),...this.divider]){
      item.restPosition=item.object.position.clone();item.restRotation=item.object.rotation.clone();
    }
    this.teddy=null;
    model('zombie_teddybear').then(template=>{const bear=cloneModel(template);bear.visible=false;scene.add(bear);this.teddy=bear;}).catch(()=>{});
  }
  update(game,cellObjects){
    const t=game.time,rules=game.mapRules;
    // Moving props leave portal culling (their cell can change as they move).
    if(!this.unculled){this.unculled=true;
      for(const item of [...this.chests.flatMap(c=>[...c.items,...c.rubble]),...this.lever,...this.trapLevers.flatMap(x=>x.items),...this.divider]){
        const holder=item.object.parent,i=cellObjects.findIndex(c=>c.holder===holder);if(i>=0){cellObjects.splice(i,1);holder.visible=true;}
      }}
    let bear=null;
    for(const c of this.chests){
      const box=game.boxes.get(c.target),active=game.activeBox===c.target;let shown=active,lift=0,shake=0;
      if(box?.phase==='teddy'){shown=true;const s=t-box.offeredAt-3.5;bear={c,rise:s<=0?0:s<3?.5*(200/3)*s*s:300+200*(s-3)};}
      if(box?.phase==='leaving'){const s=t-box.started;shown=s<5;lift=50*Math.min(1,s/5);shake=Math.sin(s*Math.PI*4)*rad(10)*Math.min(1,s/.5);}
      if(box?.phase==='arriving')shown=t-box.started>=.5;
      for(const item of c.items){
        item.object.visible=shown;item.object.position.copy(item.restPosition);item.object.position.z+=lift;
        // The lid's own open/close (updateBoxView) is left alone unless the box shakes.
        if(box?.phase==='leaving'){item.shaking=true;item.object.rotation.copy(item.restRotation);item.object.rotation.x+=shake;}
        else if(item.shaking){item.shaking=false;item.object.rotation.copy(item.restRotation);}
      }
      for(const item of c.rubble)item.object.visible=!shown;
    }
    if(this.teddy){
      this.teddy.visible=!!bear;
      if(bear){this.teddy.position.set(bear.c.origin[0],bear.c.origin[1],bear.c.origin[2]+40+bear.rise);this.teddy.rotation.set(0,0,rad(bear.c.yaw+90));
        if(!this.teddy.userData.shaded){this.teddy.userData.shaded=true;shadeModel(this.teddy,this.illumination(bear.c.origin));}}
    }
    // master_switch rotateroll(-90, 0.3).
    const flip=rules?.switched?Math.min(1,(t-rules.powerStartedAt)/.3):0;
    for(const item of this.lever){item.object.rotation.copy(item.restRotation);item.object.rotation.x+=rad(-90)*flip;}
    for(const lever of this.trapLevers){
      const state=rules?.traps?.find(x=>x.trigger.target===lever.trap.target)?.state;
      // Over 0.5 s on use; back over 0.5 s once the trap is available again.
      const down=state?Math.min(1,(t-(state.live-.5))/.5):0;
      for(const item of lever.items){item.object.rotation.copy(item.restRotation);item.object.rotation.y-=rad(180*lever.sign)*down;}
    }
    // open_bottom_doors(): each divider slides by its script_vector over 1 s.
    const opened=this.dividerTarget&&game.opened.has(this.dividerTarget),since=opened?t-(rules?.dividerOpenedAt??t):0;
    for(const item of this.divider){
      const p=opened?THREE.MathUtils.smootherstep(Math.min(1,since),0,1):0,v=vec(item.entity.script_vector);
      item.object.visible=true;item.object.position.set(item.restPosition.x+v[0]*p,item.restPosition.y+v[1]*p,item.restPosition.z+v[2]*p);
    }
  }
}
