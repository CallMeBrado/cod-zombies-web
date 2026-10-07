import {BuriedView} from './bo2-view.js';
// The shared T6 box/projectile/wall-buy presentation, plus Nuketown's
// authored perk flight paths, population sign and doomsday clock.
export class NuketownView extends BuriedView {
  update(game,dt,cellObjects=[]){
    super.update(game,dt);const r=game.mapRules;
    for(const items of this.dynamic.values())for(const v of items){
      const id=v.entity.nuketownMachine;if(!id)continue;
      if(!v.nuketownUnculled){v.nuketownUnculled=true;const holder=v.object.parent,index=cellObjects.findIndex(c=>c.holder===holder);if(index>=0)cellObjects.splice(index,1);holder.visible=true;}
      v.object.visible=r.arrived.has(id)||r.flight?.id===id;
      if(v.object.visible){const p=r.machinePosition(id),a=(v.entity.angles||'0 0 0').split(/\s+/).map(Number);
        v.object.position.set(...p);v.object.rotation.set(a[2]*Math.PI/180,-a[0]*Math.PI/180,a[1]*Math.PI/180,'ZYX');}
    }
    const kills=(100-r.population)%100;
    const angles={counter_ones:(1-kills%10)*36,counter_tens:(1-Math.ceil(kills/10))*36,clock_min_hand:-90*r.clock};
    for(const [target,angle]of Object.entries(angles))for(const item of this.dynamic.get(target)||[]){
      item.nuketownRest??=item.object.rotation.clone();item.object.rotation.copy(item.nuketownRest);item.object.rotation.x+=angle*Math.PI/180;}
  }
}
