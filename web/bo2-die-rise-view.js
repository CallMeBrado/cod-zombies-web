import * as THREE from 'three';
import {BuriedView} from './bo2-view.js';
// The shared T6 box/projectile/wall-buy presentation, plus Die Rise's perk
// machines riding their elevator cars, the buildable parts, the key and
// the power lever (electric_switch: rotateroll -90).
export class DieRiseView extends BuriedView {
  update(game,dt,cellObjects=[]){
    super.update(game,dt);const r=game.mapRules;
    for(const items of this.dynamic.values())for(const v of items){
      const e=v.entity;
      if(e.riseMachine){
        // The cars move outside portal culling; so do their machines.
        if(!v.riseUnculled){v.riseUnculled=true;const holder=v.object.parent,index=cellObjects.findIndex(c=>c.holder===holder);if(index>=0)cellObjects.splice(index,1);holder.visible=true;}
        const pose=r.machinePose(e.riseMachine);v.object.visible=!!pose;if(!pose)continue;
        const a=pose.angles.split(/\s+/).map(Number);v.object.position.set(...pose.position);v.object.rotation.set(a[2]*Math.PI/180,-a[0]*Math.PI/180,a[1]*Math.PI/180,'ZYX');
      }
      if(e.risePart||e.riseKey)v.object.visible=r.visible(e);
      if(e.targetname==='die_rise_power_lever'){
        v.riseRest??=v.object.quaternion.clone();const turn=r.power?Math.min(1,(game.time-(r.powerStartedAt??game.time))/.3):0;
        v.object.quaternion.copy(v.riseRest).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),-turn*Math.PI/2));
      }
    }
  }
}
