import {SoloGame} from './game.js';
import {nextHealth} from './rules.js';

// Testing options are isolated from normal rules and off on every new page.
export class TestingGame extends SoloGame {
  constructor(...args){super(...args);this.mods={god:false,points:false,ammo:false,grenades:false,noclip:false};}
  newGame(){super.newGame();this.applyMods();}
  applyMods(){
    if(!this.mods)return;
    if(this.mods.god){this.player.health=this.mapRules?.maxHealth||100;this.lastDamage=-100;}
    if(this.mods.points)this.player.points=999999;
    if(this.mods.ammo)for(const w of this.inventory){w.clip=w.definition.clipSize;w.reserve=w.definition.maxAmmo;}
    if(this.mods.grenades)this.player.grenades=4;
  }
  tick(dt,input){this.applyMods();super.tick(dt,input);this.applyMods();}
  damagePlayer(amount){if(!this.mods?.god)super.damagePlayer(amount);}
  spendPoints(cost){this.applyMods();const bought=super.spendPoints(cost);this.applyMods();return bought;}
  setMod(name,on){
    if(!Object.hasOwn(this.mods,name))return;this.mods[name]=!!on;
    // Leaving noclip drops the player under normal gravity from where they are.
    if(name==='noclip'&&!on){this.player.grounded=false;this.player.velocityZ=0;}
    this.applyMods();
  }
  // Noclip: fly where you look (W/A/S/D), hold jump to rise, sprint for speed.
  // No collision or gravity; the game still runs (use god mode to stay alive).
  movePlayerOverride(p,input,dt){
    if(!this.mods?.noclip)return false;
    const cp=Math.cos(this.pitch),forward=[Math.cos(this.yaw)*cp,Math.sin(this.yaw)*cp,Math.sin(this.pitch)],right=[Math.sin(this.yaw),-Math.cos(this.yaw),0];
    const v=[0,1,2].map(k=>forward[k]*(input.forward||0)+right[k]*(input.side||0)+(k===2&&input.jump?1:0)),length=Math.hypot(...v);
    const speed=(input.sprint?900:400)*(Number.isFinite(input.movementScale)?Math.max(0,Math.min(1,input.movementScale)):1);
    if(length)p.position=p.position.map((x,k)=>x+v[k]/length*speed*dt);
    p.velocityZ=0;p.grounded=false;this.sprinting=false;return true;
  }
  equipTestWeapon(name){
    if(!this.data.weapons[name]||this.pendingGrenade)return false;
    this.pendingFire=false;this.cooldown=0;this.giveWeapon(name);this.applyMods();return true;
  }
  refillAmmo(){for(const w of this.inventory){w.clip=w.definition.clipSize;w.reserve=w.definition.maxAmmo;}this.reloadEnd=0;this.emit('reloaded');}
  setRound(round){
    if(!Number.isInteger(round)||round<1||round>100||['ready','dead'].includes(this.phase))return false;
    for(const enemy of this.enemies)this.emit('removeEnemy',enemy);
    this.enemies=[];this.windows.forEach(w=>{w.traverser=null;w.attackers=[];});
    this.round=round-1;this.zombieHealth=this.vars.zombie_health_start;
    for(let r=1;r<round;r++)this.zombieHealth=nextHealth(this.zombieHealth,r,this.vars);
    this.startRound();return true;
  }
}

const $=id=>document.getElementById(id);
export class TestingMenu {
  constructor(menu,getGame){
    this.menu=menu;this.getGame=getGame;this.loaded=null;
    $('mods').onclick=()=>{this.sync();menu.show('mods');};
    for(const name of ['god','points','ammo','grenades','noclip'])$('mod-'+name).onchange=()=>{
      const g=getGame();if(!g)return;g.setMod(name,$('mod-'+name).checked);this.status('Testing option updated.');
    };
    $('mod-equip').onclick=()=>{const g=getGame();if(g)this.status(g.equipTestWeapon($('mod-weapon').value)?g.weaponName(g.weapon.name)+' equipped.':'Finish throwing the grenade first.');};
    $('mod-set-round').onclick=()=>{const g=getGame(),r=Number($('mod-round').value);if(g)this.status(g.setRound(r)?'Round '+r+' ready. Resume to play.':'Choose a whole round number from 1 to 100 during a game.');};
    $('mod-add-points').onclick=()=>{const g=getGame();if(g){g.changePoints(10000);g.applyMods();this.status('10,000 points added.');}};
    $('mod-refill-ammo').onclick=()=>{getGame()?.refillAmmo();this.status('Ammunition refilled.');};
    $('mod-refill-grenades').onclick=()=>{const g=getGame();if(g)g.player.grenades=4;this.status('Grenades refilled.');};
    $('mod-disable').onclick=()=>{const g=getGame();if(g)for(const name of Object.keys(g.mods))g.setMod(name,false);this.sync();this.status('All toggles turned off. Restart for a fresh loadout and points.');};
    this.sync();
  }
  status(text){$('mod-status').textContent=text;}
  sync(){
    const g=this.getGame();$('mods').disabled=!g;
    for(const node of $('menu-mods').querySelectorAll('input,select,button'))node.disabled=!g;
    if(!g)return;
    if(this.loaded!==g){
      $('mod-weapon').replaceChildren();
      for(const name of Object.keys(g.data.weapons)){const option=document.createElement('option');option.value=name;option.textContent=g.weaponName(name);$('mod-weapon').append(option);}
      this.loaded=g;
    }
    for(const [name,on]of Object.entries(g.mods))$('mod-'+name).checked=on;
    $('mod-weapon').value=g.weapon.name;$('mod-round').value=g.round||1;
    this.status('Esc resumes play. Toggles reset when you reload or change maps.');
  }
}
