import {BlackOpsHud} from './bo1-hud.js';
export class BlackOps2Hud extends BlackOpsHud {
  constructor(canvas,options={}){super(canvas,{folder:options.folder||'gameplay/bo2-buried',scorebar:options.scorebar||'scorebar_zom_5',icons:{
    specialty_armorvest:'specialty_juggernaut_zombies',specialty_fastreload:'specialty_fastreload_zombies',
    specialty_rof:'specialty_doubletap_zombies',specialty_quickrevive:'specialty_quickrevive_zombies',
    specialty_longersprint:'specialty_marathon_zombies',specialty_additionalprimaryweapon:'specialty_mulekick_zombies',specialty_nomotionsensor:'specialty_vulture_zombies'}});}
  draw(game,...args){super.draw(game,...args);const r=game.mapRules,carry=r.carry;if(carry)this.text('Carrying '+(carry.weapon?game.weaponName(carry.weapon)+' chalk':carry.kind==='part'?r.equipment.name(carry.equipment)+' part':carry.kind),12,366,11);
    if(r.equipment?.held)this.text((game.events.bindingName?.('equipment')||'5')+' · '+r.equipment.name(r.equipment.held.kind),12,352,11);
    if(r.generators){this.text('GENERATORS  '+Object.entries(r.generators).map(([id,s])=>s.phase==='on'?'['+id+']':id).join('  '),12,24,11);if(r.shovel)this.text('SHOVEL'+(r.cryptOpen?'  ·  EXCAVATION OPEN':''),12,40,10);if(r.activeCapture){const s=r.generators[r.activeCapture],W=innerWidth/(innerHeight/480);this.text('GENERATOR '+r.activeCapture+'  '+Math.floor(s.progress)+'%',W/2,85,13,'center');this.ctx.fillStyle='#000a';this.ctx.fillRect(W/2-76,100,152,8);this.ctx.fillStyle='#c6dce1';this.ctx.fillRect(W/2-75,101,150*s.progress/100,6);}}
    const hold=r.hold||r.equipment?.building;
    if(hold){const W=innerWidth/(innerHeight/480),cx=W/2,progress=Math.max(0,Math.min(1,(game.time-hold.started)/(hold.due-hold.started))),ctx=this.ctx;
      ctx.fillStyle='#000a';ctx.fillRect(cx-76,304,152,8);ctx.fillStyle='#f4f4ed';ctx.fillRect(cx-75,305,150*progress,6);}}
}
