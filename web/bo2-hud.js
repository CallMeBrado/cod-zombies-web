import {BlackOpsHud} from './bo1-hud.js';
export class BlackOps2Hud extends BlackOpsHud {
  constructor(canvas){super(canvas,{folder:'gameplay/bo2-buried',scorebar:'scorebar_zom_5',icons:{
    specialty_armorvest:'specialty_juggernaut_zombies',specialty_fastreload:'specialty_fastreload_zombies',
    specialty_rof:'specialty_doubletap_zombies',specialty_quickrevive:'specialty_quickrevive_zombies',
    specialty_longersprint:'specialty_marathon_zombies',specialty_additionalprimaryweapon:'specialty_mulekick_zombies',specialty_nomotionsensor:'specialty_vulture_zombies'}});}
  draw(game,...args){super.draw(game,...args);const r=game.mapRules,carry=r.carry;if(carry)this.text('Carrying '+(carry.weapon?game.weaponName(carry.weapon)+' chalk':carry.kind==='part'?r.equipment.name(carry.equipment)+' part':carry.kind),12,366,11);
    if(r.equipment.held)this.text((game.events.bindingName?.('equipment')||'5')+' · '+r.equipment.name(r.equipment.held.kind),12,352,11);}
}
