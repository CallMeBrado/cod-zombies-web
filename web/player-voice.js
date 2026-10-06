// Black Ops player dialog, ported from maps/_zombiemode_audio.gsc.
// level.plr_vox maps a category/type to an alias suffix; a line is
// vox_plr_<character>_<suffix>_<variant>. Character numbers follow
// player.entity_num: 0 Dempsey, 1 Nikolai, 2 Takeo, 3 Richtofen.
export const CHARACTERS=['Dempsey','Nikolai','Takeo','Richtofen'];
// zombie_theater: player_set_viewmodel()
export const CHARACTER_ARMS=['viewmodel_usa_pow_arms','viewmodel_rus_prisoner_arms','viewmodel_vtn_nva_standard_arms','viewmodel_usa_hazmat_arms'];

export const PLAYER_VOX={
  general:{crawl_spawn:'spawn_crawl',dog_spawn:'spawn_dog',quad_spawn:'spawn_quad',ammo_low:'ammo_low',ammo_out:'ammo_out',door_deny:'nomoney',perk_deny:'nomoney',
    intro:'level_start',shoot_arm:'shoot_limb',box_move:'box_move',no_money:'nomoney',oh_shit:'ohshit',revive_down:'revive_down',revive_up:'revive_up',crawl_hit:'crawler_hit',sigh:'sigh'},
  perk:{specialty_armorvest:'perk_jugga',specialty_quickrevive:'perk_revive',specialty_fastreload:'perk_speed',specialty_rof:'perk_doubletap',specialty_longersprint:'perk_stamin',specialty_flakjacket:'perk_phdflopper'},
  powerup:{nuke:'powerup_nuke',insta_kill:'powerup_insta',full_ammo:'powerup_ammo',double_points:'powerup_double',carpenter:'powerup_carp',firesale:'powerup_firesale'},
  kill:{melee:'kill_melee',melee_instakill:'kill_insta',weapon_instakill:'kill_insta',closekill:'kill_close',damage:'kill_damaged',streak:'kill_streak',headshot:'kill_headshot',
    explosive:'kill_explo',flame:'kill_flame',raygun:'kill_ray',bullet:'kill_streak',tesla:'kill_tesla',monkey:'kill_monkey',thundergun:'kill_thunder',crawler:'kill_crawler',hellhound:'kill_hellhound',quad:'kill_quad'},
  weapon_pickup:{pistol:'wpck_crappy',smg:'wpck_smg',dualwield:'wpck_dual',shotgun:'wpck_shotgun',rifle:'wpck_sniper',burstrifle:'wpck_mg',assault:'wpck_mg',sniper:'wpck_sniper',mg:'wpck_mg',
    launcher:'wpck_launcher',grenade:'wpck_grenade',bowie:'wpck_bowie',raygun:'wpck_raygun',monkey:'wpck_monkey',tesla:'wpck_tesla',thunder:'wpck_thunder',crossbow:'wpck_launcher',
    upgrade:'wpck_upgrade',upgrade_wait:'wpck_upgrade_wait',favorite:'wpck_favorite',favorite_upgrade:'wpck_favorite_upgrade'},
};

// _zombiemode_weapons.gsc add_zombie_weapon(): each weapon's weaponVO type.
const WEAPON_VOX={m1911_zm:'pistol',python_zm:'pistol',cz75_zm:'pistol',ak74u_zm:'smg',mp5k_zm:'smg',mp40_zm:'smg',mpl_zm:'smg',pm63_zm:'smg',spectre_zm:'smg',cz75dw_zm:'dualwield',
  ithaca_zm:'shotgun',spas_zm:'shotgun',rottweil72_zm:'shotgun',hs10_zm:'shotgun',m14_zm:'rifle',m16_zm:'burstrifle',g11_lps_zm:'burstrifle',famas_zm:'burstrifle',
  aug_acog_zm:'assault',galil_zm:'assault',commando_zm:'assault',fnfal_zm:'burstrifle',dragunov_zm:'sniper',l96a1_zm:'sniper',rpk_zm:'mg',hk21_zm:'mg',frag_grenade_zm:'grenade',
  claymore_zm:'grenade',m72_law_zm:'launcher',china_lake_zm:'launcher',zombie_cymbal_monkey:'monkey',ray_gun_zm:'raygun',tesla_gun_zm:'tesla',thundergun_zm:'thunder',crossbow_explosive_zm:'crossbow'};
// weapon_type_check(): each character's favourite weapon and favourite upgrade.
const FAVORITES=[['m16_zm','rottweil72_upgraded_zm'],['fnfal_zm','hk21_upgraded_zm'],['china_lake_zm','thundergun_upgraded_zm'],['mp40_zm','crossbow_explosive_upgraded_zm']];
export function weaponVoxType(character,weapon){
  const [favorite,upgrade]=FAVORITES[character]||[];
  if(weapon===favorite)return 'favorite';if(weapon===upgrade)return 'favorite_upgrade';
  if(weapon.includes('upgraded'))return 'upgrade';
  return WEAPON_VOX[weapon]||'pistol';
}
// get_mod_chance(): percentage chance of a kill line for each kind of kill.
export const KILL_CHANCE={melee:75,melee_instakill:99,weapon_instakill:10,explosive:60,flame:60,raygun:75,headshot:99,crawler:30,quad:30,closekill:15,bullet:10,default:1};

// Plays the lines for one player. Variants are dealt from a shuffled pool and
// only one player line plays at a time (level.player_is_speaking), with a
// quarter second after each line before the next.
export class PlayerVoice {
  constructor(audio,table,character){this.audio=audio;this.table=table||{};this.character=character;this.pools=new Map();this.busyUntil=0;this.pending=false;}
  variants(suffix){
    const prefix=`vox_plr_${this.character}_${suffix}_`;let count=0;while(this.table[prefix+count])count++;return count;
  }
  async speak({category,type,variant}){
    const suffix=PLAYER_VOX[category]?.[type];if(!suffix)return null;
    const count=this.variants(suffix);if(!count)return null;
    const context=this.audio.context;if(!context||context.state!=='running'||this.pending||context.currentTime<this.busyUntil)return null;
    let pick=variant;
    if(pick===undefined||pick>=count){
      let pool=this.pools.get(suffix);if(!pool?.length){pool=[...Array(count).keys()];this.pools.set(suffix,pool);}
      pick=pool.splice(Math.floor(Math.random()*pool.length),1)[0];
    }
    const alias=`vox_plr_${this.character}_${suffix}_${pick}`;
    this.pending=true;
    try{
      const record=await this.audio.playVoice(alias,this.table[alias]);
      if(record)this.busyUntil=record.startAt+record.duration+.25;return record?alias:null;
    }finally{this.pending=false;}
  }
}
