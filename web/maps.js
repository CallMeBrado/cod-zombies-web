export const MAPS=Object.freeze([
  {id:'nacht',title:'Nacht der Untoten',zone:'nacht',asset:'nazi_zombie_prototype',data:'gameplay',image:'loadscreen_zombie1',description:'You drove them deep into the heart of the Reich. You thought they were dead. You were wrong.'},
  {id:'verruckt',title:'Verrückt',zone:'verruckt',asset:'nazi_zombie_asylum',data:'gameplay/verruckt',image:'loadscreen_zombie_asylum',assetZones:['verruckt-patch','verruckt','common','nacht'],description:'Fight through a haunted asylum split in two. Restore power to reunite the halves, buy the first perks and use the electric traps.'},
  {id:'der-riese',title:'Der Riese',zone:'der-riese',asset:'nazi_zombie_factory',data:'gameplay/der-riese',image:'loadscreen_zombie_factory',description:'The Giant is rising. Battle the undead at the secret research facility. Restore power and link the teleporters to unlock Pack-a-Punch.'}
]);
export const BO1_MAPS=Object.freeze([
  {id:'kino',game:'black-ops',title:'Kino der Toten',zone:'bo1-kino',asset:'zombie_theater',data:'gameplay/bo1-kino',image:'loadscreen_zombie_theater',assetZones:['bo1-kino','bo1-common','bo1-base','bo1-english','bo1-ui','bo1-frontend'],description:'Battle the undead in an abandoned theater. Restore power, link the teleporter and reach Pack-a-Punch in the projection room.'},
  {id:'ascension',game:'black-ops',title:'Ascension',zone:'bo1-cosmodrome',asset:'zombie_cosmodrome',data:'gameplay/bo1-cosmodrome',image:'loadscreen_zombie_cosmodrome',assetZones:['bo1-cosmodrome-patch','bo1-cosmodrome','bo1-common','bo1-base','bo1-cosmodrome-english','bo1-english','bo1-ui','bo1-frontend'],description:'A Soviet cosmodrome overrun by the dead. Restore power, ride the lunar landers and reach Pack-a-Punch beneath the rocket.'},
  {id:'dead-ops',game:'black-ops',engine:'dead-ops',title:'Dead Ops Arcade',zone:'bo1-doa',asset:'zombietron',data:'gameplay/bo1-doa',image:'loadscreen_zombietron',assetZones:['bo1-doa-patch','bo1-doa','bo1-doa-english','bo1-doa-common','bo1-common','bo1-base','bo1-ui'],description:'The original overhead arcade arenas. Fight waves of zombies, collect treasure and weapons, use speed boosts and nukes, and confront the Cosmic Silverback.'}
]);
export const BO2_MAPS=Object.freeze([{id:'buried',game:'black-ops-2',title:'Buried',zone:'bo2-buried',asset:'zm_buried',data:'gameplay/bo2-buried',image:'loadscreen_buried_zclassic_processing',assetZones:['bo2-patch','bo2-classic','bo2-buried','bo2-base','bo2-common','bo2-english','bo2-dlc','bo2-menu','bo2-ui-base','bo2-ui'],description:'An old mining town lies buried beneath the surface. Descend into the darkness, restore power and survive the undead.'}]);
export const ALL_MAPS=Object.freeze([...MAPS,...BO1_MAPS,...BO2_MAPS]);
export function mapById(id){return ALL_MAPS.find(map=>map.id===id)||MAPS[0];}
export function selectedMap(){
  if(typeof location!=='undefined'){
    if(location.pathname.startsWith('/black-ops-2'))return BO2_MAPS[0];
    if(location.pathname.startsWith('/black-ops'))return BO1_MAPS.find(m=>m.id===new URLSearchParams(location.search).get('map'))||BO1_MAPS[0];
  }
  return MAPS.find(m=>m.id===(typeof location==='undefined'?'nacht':new URLSearchParams(location.search).get('map')))||MAPS[0];
}
