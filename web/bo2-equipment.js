const distance=(a,b)=>Math.hypot(...a.map((v,k)=>v-b[k]));
import {nextHealth} from './rules.js';

// Buried's parts may be assembled at any free bench. Equipment is an
// independent carried slot, so collecting another part keeps both guns.
export class BuriedEquipment {
  constructor(rules){this.rules=rules;this.game=rules.game;this.benches=new Map();this.placed=[];this.held=null;this.building=null;this.nextId=1;
    this.damage50=this.game.vars.zombie_health_start;for(let r=1;r<50;r++)this.damage50=nextHealth(this.damage50,r,this.game.vars);}
  name(kind){return this.game.data.equipment[kind].name;}
  prompt(e,key){
    const b=this.benches.get(e.targetname),part=this.rules.carry;
    if(b?.complete)return key+' · Take '+this.name(b.kind);
    if(this.building?.bench===e.targetname)return 'Building '+this.name(this.building.kind)+'…';
    if(part?.kind==='part'&&(!b||b.kind===part.equipment))return 'Hold '+key+' · Add '+this.name(part.equipment)+' part'+(b?' · '+b.pieces.length+'/'+this.game.data.equipment[b.kind].parts:'');
    return b?'Find '+this.name(b.kind)+' parts · '+b.pieces.length+'/'+this.game.data.equipment[b.kind].parts:'Work bench · bring a buildable part';
  }
  use(e){
    const g=this.game,b=this.benches.get(e.targetname),part=this.rules.carry;
    if(b?.complete){if(this.placed.some(x=>x.kind===b.kind)){g.message('Retrieve your placed '+this.name(b.kind)+' first');return true;}this.held={kind:b.kind,health:g.data.equipment[b.kind].health};g.message(this.name(b.kind)+' · '+(g.events.bindingName?.('equipment')||'5')+' to place');return true;}
    if(this.building||part?.kind!=='part'||b&&b.kind!==part.equipment)return true;
    // buildable_place_think(): hold use for 3 s with the builder hands.
    this.building={bench:e.targetname,kind:part.equipment,piece:part.itemId,started:g.time,due:g.time+3};g.startHoldGesture('zombie_builder');return true;
  }
  place(){
    const g=this.game;if(!this.held||g.movementBlocked||g.gesture||g.pendingGrenade||['dead','ready'].includes(g.phase))return false;
    const d=g.data.equipment[this.held.kind],p=g.player.position,dir=[Math.cos(g.yaw),Math.sin(g.yaw),0];let at,yaw=g.yaw;
    if(this.held.kind==='headchopper_zm'){
      const from=[p[0],p[1],p[2]+42],hit=g.collision.trace(from,from.map((v,k)=>v+dir[k]*100),[0,0,0],1);
      if(hit.fraction===1||Math.abs(hit.normal[2])>.35){g.message('Place the Head Chopper against a wall');return false;}
      at=hit.end.map((v,k)=>v+hit.normal[k]*2);yaw=Math.atan2(hit.normal[1],hit.normal[0]);
    }else{
      const ahead=p.map((v,k)=>v+dir[k]*65+(k===2?64:0)),floor=g.collision.trace(ahead,[ahead[0],ahead[1],ahead[2]-160],[8,8,1],1);
      if(floor.fraction===1||floor.normal[2]<.65||Math.abs(floor.end[2]-p[2])>45){g.message('Find clear, level ground to place '+d.name);return false;}at=floor.end;
      const center=[at[0],at[1],at[2]+12];if(g.collision.trace(center,center,[10,10,10],1).allSolid)return false;
    }
    const item={...this.held,id:this.nextId++,position:at,yaw,model:d.model,due:g.time+2,hits:0,attackDue:0};this.placed.push(item);this.held=null;
    g.interactions.push({targetname:'buried_equipment',equipmentId:item.id,position:at});g.emit('buriedEquipment',item);g.emit('sound',{alias:'zmb_buildable_inv_out'});return true;
  }
  pickup(e){
    const item=this.placed.find(x=>x.id===e.equipmentId);if(!item||this.held)return true;
    this.held={kind:item.kind,health:item.health};this.remove(item);this.game.emit('sound',{alias:'zmb_buildable_pickup_complete'});return true;
  }
  remove(item){this.placed=this.placed.filter(x=>x!==item);this.game.interactions=this.game.interactions.filter(e=>e.equipmentId!==item.id);this.game.emit('buriedEquipmentRemove',item.id);}
  tick(dt){
    const g=this.game,b=this.building;
    if(b&&!g.useHeld&&g.time-b.started>.1&&!g.mirror){this.building=null;g.endHoldGesture();}
    else if(b&&g.time>=b.due){g.endHoldGesture();const bench=this.benches.get(b.bench)||{kind:b.kind,pieces:[]};bench.pieces.push(b.piece);bench.complete=bench.pieces.length===g.data.equipment[b.kind].parts;this.benches.set(b.bench,bench);this.rules.carry=null;this.building=null;g.emit('sound',{alias:bench.complete?'zmb_buildable_complete':'zmb_buildable_piece_add'});g.message(bench.complete?this.name(b.kind)+' ready':'Part added · '+bench.pieces.length+'/'+g.data.equipment[b.kind].parts);}
    for(const item of this.placed){
      const d=g.data.equipment[item.kind],hunters=g.enemies.filter(e=>!e.dead&&e.kind!=='ghost'&&e.stage==='hunt');
      if(item.kind==='turbine')item.health-=dt; // power radius 335, native battery health 1200
      if(g.time>=item.attackDue&&hunters.some(e=>distance(e.position,item.position)<58)){item.health-=100;item.attackDue=g.time+1.1;}
      if(item.health<=0){this.remove(item);g.emit('sound',{alias:'wpn_zmb_electrap_stop',position:item.position});continue;}
      if(g.time<item.due)continue;
      const forward=[Math.cos(item.yaw),Math.sin(item.yaw),0],inside=e=>{const v=e.position.map((x,k)=>x-item.position[k]),r=Math.hypot(v[0],v[1]);return Math.abs(v[2])<90&&r>0&&(v[0]*forward[0]+v[1]*forward[1])/r>.6;};
      if(item.kind==='subwoofer_zm'){
        if(!this.placed.some(x=>x.kind==='turbine'&&distance(x.position,item.position)<335))continue;
        const targets=hunters.filter(e=>distance(e.position,item.position)<1200&&inside(e));
        for(const e of targets){const a=[...item.position];a[2]+=35;const z=[...e.position];z[2]+=35;if(g.collision.trace(a,z,[0,0,0],1).fraction<.99)continue;g.hitEnemy(e,this.damage50,false,false);}
        item.health--;item.due=g.time+2;g.emit('shake',{position:item.position,amplitude:3,duration:.2,radius:600});g.emit('sound',{alias:'zmb_subwoofer_layer1',position:item.position});
      }else if(item.kind==='headchopper_zm'){
        for(const e of hunters.filter(e=>distance(e.position,item.position)<100&&inside(e)))g.hitEnemy(e,this.damage50,true,false);item.due=g.time+1;
      }else if(item.kind==='springpad_zm'){
        const targets=hunters.filter(e=>distance(e.position,item.position)<72),player=distance(g.player.position,item.position)<58;
        if(!targets.length&&!player)continue;for(const e of targets){e.killDirection=[forward[0]*500,forward[1]*500,300];g.hitEnemy(e,e.health,false,false);item.hits++;}
        if(player){g.equipmentFlight={velocity:[forward[0]*600,forward[1]*600,450]};g.player.velocityZ=450;g.player.grounded=false;}
        item.due=g.time+3;g.emit('buriedEquipmentLaunch',item);g.emit('sound',{alias:'zmb_highrise_launcher_launch',position:item.position});if(item.hits>=28)this.remove(item);
      }
    }
  }
  powered(at){return this.rules.power||this.placed.some(x=>x.kind==='turbine'&&distance(at,x.position)<335);}
  saveState(){return {benches:[...this.benches],placed:this.placed,held:this.held,nextId:this.nextId};}
  loadState(s={}){this.benches=new Map(s.benches||[]);this.placed=(s.placed||[]).map(x=>({...x}));this.held=s.held||null;this.nextId=s.nextId||1;this.game.interactions=this.game.interactions.filter(e=>!e.equipmentId);for(const x of this.placed){this.game.interactions.push({targetname:'buried_equipment',equipmentId:x.id,position:x.position});this.game.emit('buriedEquipment',x);}}
}
