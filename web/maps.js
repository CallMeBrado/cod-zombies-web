export const MAPS=Object.freeze([
  {id:'nacht',title:'Nacht der Untoten',zone:'nacht',asset:'nazi_zombie_prototype',data:'gameplay',image:'loadscreen_zombie1',description:'You drove them deep into the heart of the Reich. You thought they were dead. You were wrong.'},
  {id:'der-riese',title:'Der Riese',zone:'der-riese',asset:'nazi_zombie_factory',data:'gameplay/der-riese',image:'loadscreen_zombie_factory',description:'The Giant is rising. Battle the undead at the secret research facility. Restore power and link the teleporters to unlock Pack-a-Punch.'}
]);
export const BO1_MAPS=Object.freeze([{id:'kino',game:'black-ops',title:'Kino der Toten',zone:'bo1-kino',asset:'zombie_theater',data:'gameplay/bo1-kino',image:'loadscreen_zombie_theater',assetZones:['bo1-kino','bo1-common','bo1-base','bo1-english','bo1-ui'],description:'Battle the undead in an abandoned theater. Restore power, link the teleporter and reach Pack-a-Punch in the projection room.'}]);
export function mapById(id){return [...MAPS,...BO1_MAPS].find(map=>map.id===id)||MAPS[0];}
export function selectedMap(){return typeof location!=='undefined'&&location.pathname.startsWith('/black-ops')?BO1_MAPS[0]:MAPS.find(m=>m.id===(typeof location==='undefined'?'nacht':new URLSearchParams(location.search).get('map')))||MAPS[0];}
