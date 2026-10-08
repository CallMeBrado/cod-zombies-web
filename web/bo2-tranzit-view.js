import * as THREE from 'three';
import {BuriedView} from './bo2-view.js';
import {model,cloneModel,originalAnimation,restRelative,shadeModel} from './assets.js';
import {PosedTrace} from './posed-trace.js';

export class TranzitView extends BuriedView {
  async prepare(manifest,presentation){
    await super.prepare(manifest,presentation);this.busRoot=new THREE.Group();this.busObject=cloneModel(await model(manifest.map.bus.model));this.busRoot.add(this.busObject);this.scene.add(this.busRoot);
    shadeModel(this.busObject,[.5,.5,.5]);this.busRoot.position.fromArray(manifest.map.bus.route[0].position);this.busRoot.position.z+=manifest.map.bus.originZOffset;
    this.busRoot.rotation.z=(manifest.map.bus.route[0].yaw||0)*Math.PI/180;
    const driver=cloneModel(await model(manifest.map.bus.driver));shadeModel(driver,[.4,.4,.4]);driver.position.set(327,36.5,37.75);driver.rotation.z=Math.PI/2;this.busRoot.add(driver);
    this.driverMixer=new THREE.AnimationMixer(driver);this.driverMixer.clipAction(restRelative(await originalAnimation('ai_zombie_bus_driver_idle',driver,false),driver)).play();
    this.doors=[];for(const name of ['door_front_jnt','door_rear_jnt']){const bone=this.busObject.getObjectByName(name);if(bone)this.doors.push({bone,closed:bone.quaternion.clone()});}
    this.busAttachments=new Map();
    for(const [kind,tag]of [['cattlecatcher','tag_plow_attach'],['bushatch','tag_hatch_pristine'],['busladder','tag_ladder_attach']]){
      const object=cloneModel(await model(manifest.equipment[kind].model));shadeModel(object,[.5,.5,.5]);object.visible=false;(this.busObject.getObjectByName(tag)||this.busObject).add(object);this.busAttachments.set(kind,object);}
    // Trace the current bus pose so its opening doors and window gaps match
    // the picture, rather than retaining the closed-door bind-pose triangles.
    this.busTrace=new PosedTrace(this.busRoot,{visibleOnly:true});this.busPoseTick=0;this.shotRay=new THREE.Ray();this.openAmount=0;
    // Thin broken glass, vent screens and chalk admit a round; they must not
    // turn a visibly open window into an opaque hit-detection rectangle.
    this.busTrace.meshes=this.busTrace.meshes.filter(({mesh})=>!(Array.isArray(mesh.material)?mesh.material:[mesh.material]).every(m=>/glass|chalk|corrugated_metal_holes|zombie_vent/.test(m.name)));
    const trace=this.map.bullets.trace.bind(this.map.bullets);
    this.map.bullets.trace=(origin,direction,max=16000)=>{if(![...origin,...direction,max].every(Number.isFinite))return null;
      const wall=trace(origin,direction,max);this.shotRay.origin.fromArray(origin);this.shotRay.direction.fromArray(direction).normalize();
      const hit=this.busTrace.trace(this.shotRay,wall?.distance??max,this.busPoseTick);
      return hit?{...hit,point:this.shotRay.at(hit.distance,new THREE.Vector3()).toArray(),normal:[0,0,0]}:wall;};
  }
  reset(){super.reset();}
  update(game,dt){
    super.update(game,dt);const r=game.mapRules,b=r.bus;
    this.busRoot.position.fromArray(b.position);this.busRoot.rotation.z=b.yaw;this.driverMixer.update(dt);
    this.openAmount+=(Number(b.doors)-this.openAmount)*Math.min(1,dt*8);
    for(const d of this.doors)d.bone.quaternion.copy(d.closed).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),-this.openAmount*Math.PI/2));
    for(const [kind,object]of this.busAttachments)object.visible=r.built.has(kind);
    this.busRoot.updateWorldMatrix(true,true);this.busRoot.traverse(n=>{if(n.isSkinnedMesh)n.skeleton.update();});this.busPoseTick++;
    for(const items of this.dynamic.values())for(const v of items){
      if(v.entity.tranzitPart)v.object.visible=r.visible(v.entity);
      if(v.entity.tranzitBuilt)v.object.visible=r.built.has(v.entity.tranzitBuilt);
      if(v.entity.targetname==='tranzit_machine_specialty_weapupgrade')v.object.visible=r.built.has('pap');
      if(v.entity.targetname==='powerswitch_p6_zm_buildable_pswitch_lever'){
        v.basePowerRotation??=v.object.quaternion.clone();v.object.quaternion.copy(v.basePowerRotation).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),r.power?-Math.PI/2:0));}
    }
    // Green Run's fog is heavier between settlements. Keep near objects
    // readable indoors while hiding the distant native streaming scenery.
    this.scene.fog.color.setRGB(.22,.25,.24);this.scene.fog.density=r.inFog?.00115:.00038;
    this.scene.background.setRGB(.16,.18,.17);
  }
}
