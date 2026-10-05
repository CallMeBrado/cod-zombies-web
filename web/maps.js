export const MAPS=Object.freeze([
  {id:'nacht',title:'Nacht der Untoten',zone:'nacht',asset:'nazi_zombie_prototype',data:'gameplay',image:'loadscreen_zombie1',description:'You drove them deep into the heart of the Reich. You thought they were dead. You were wrong.'},
  {id:'der-riese',title:'Der Riese',zone:'der-riese',asset:'nazi_zombie_factory',data:'gameplay/der-riese',image:'loadscreen_zombie_factory',description:'The Giant is rising. Battle the undead at the secret research facility. Restore power and link the teleporters to unlock Pack-a-Punch.'}
]);
export function mapById(id){return MAPS.find(map=>map.id===id)||MAPS[0];}
export function selectedMap(){return mapById(typeof location==='undefined'?'nacht':new URLSearchParams(location.search).get('map'));}
