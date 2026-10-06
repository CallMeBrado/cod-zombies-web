import {MAPS,mapById} from './maps.js';
const $=id=>document.getElementById(id);
export const SLOTS=3;
const LEGACY_KEY='waw-zombies-save-v1';
const key=(map,slot)=>`waw-zombies-save-v2:${map}:${slot}`;

// Three save slots per map in this browser's localStorage. A record holds the
// game snapshot plus a summary and thumbnail for the slot card.
export class SaveStore {
  constructor(storage,maps=MAPS){this.storage=storage;this.maps=maps;this.migrate();}
  get(map,slot){try{const save=JSON.parse(this.storage?.getItem(key(map,slot))||'null');return save?.state?save:null;}catch{return null;}}
  list(map){return Array.from({length:SLOTS},(_,slot)=>this.get(map,slot));}
  count(){return this.maps.reduce((sum,m)=>sum+this.list(m.id).filter(Boolean).length,0);}
  put(map,slot,save){
    if(!this.storage)throw new Error('unavailable');
    // A full browser quota drops the thumbnail before giving up on the save.
    try{this.storage.setItem(key(map,slot),JSON.stringify(save));}
    catch(error){if(!save.thumb)throw error;this.storage.setItem(key(map,slot),JSON.stringify({...save,thumb:null}));}
  }
  remove(map,slot){this.storage?.removeItem(key(map,slot));}
  // The single pre-slot save moves into the first free slot of its map.
  migrate(){
    try{
      const old=JSON.parse(this.storage?.getItem(LEGACY_KEY)||'null');if(!old?.state)return;
      const slot=this.list(old.map).findIndex(s=>!s);
      if(slot>=0){const s=old.state;this.put(old.map,slot,{...old,slot,thumb:null,summary:{round:s.resumeRound,points:s.player.points,kills:s.player.kills,headshots:s.player.headshots,health:Math.round(s.player.health),
        weapons:s.inventory.map(w=>w.name),perks:[],power:s.rules?s.rules.power:null,links:s.rules?s.rules.links.length:null,zombies:0,remaining:null,doors:s.opened.length,playTime:null,legacy:true}});}
      this.storage.removeItem(LEGACY_KEY);
    }catch{}
  }
}

const number=n=>Number(n||0).toLocaleString('en-US');
const duration=s=>{if(s==null)return '';const m=Math.floor(s/60),h=Math.floor(m/60);return h?`${h}h ${m%60}m`:`${m}m ${String(Math.floor(s%60)).padStart(2,'0')}s`;};
function when(time){
  const d=new Date(time),now=new Date(),day=86400000,clock=d.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
  const start=x=>new Date(x.getFullYear(),x.getMonth(),x.getDate()).getTime(),days=Math.round((start(now)-start(d))/day);
  return days===0?'Today '+clock:days===1?'Yesterday '+clock:d.toLocaleDateString([], {month:'short',day:'numeric',year:d.getFullYear()===now.getFullYear()?undefined:'numeric'})+' '+clock;
}
const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;};
const menuText=(tag,cls,text)=>{const e=el(tag,cls,text);e.dataset.menuText='';return e;};

// The SAVE GAME / LOAD GAME slot picker. Saving over a used slot, and deleting
// one, take a second click to confirm.
export class SaveSlots {
  constructor(menu,store,{currentMap,canSave,save,load,weaponName=n=>n}){
    this.menu=menu;this.store=store;this.currentMap=currentMap;this.callbacks={canSave,save,load,weaponName};this.mode='load';this.armed=null;this.justSaved=null;
  }
  async open(mode){
    this.mode=mode;this.armed=null;this.justSaved=null;this.nameValue='';this.busy=true;this.status('Loading server saves…');this.render();
    try{await this.store.refresh?.();this.status('');}catch(error){this.status(error.message,'warn');}
    finally{this.busy=false;this.render();}
  }
  status(text,tone=''){const s=$('saves-status');s.textContent=text;s.dataset.tone=tone;}
  arm(action,map,slot){
    clearTimeout(this.disarm);this.armed={action,map,slot};this.render();
    this.disarm=setTimeout(()=>{this.armed=null;this.render();},4000);
  }
  isArmed(action,map,slot){return this.armed?.action===action&&this.armed.map===map&&this.armed.slot===slot;}
  render(){
    const root=$('save-slots');root.replaceChildren();
    const saving=this.mode==='save',blocked=this.busy?'Please wait…':saving?this.callbacks.canSave():null;
    $('saves-copy').textContent=saving?(blocked||`Choose a slot for this ${mapById(this.currentMap).title} game. Zombies, the round, your points and everything on the map are kept exactly as they are now.`):
      'Shared server saves · Choose a game to continue from the moment it was saved.';
    $('saves-copy').dataset.tone=blocked?'warn':'';
    if(saving){const label=el('label','save-name-row');label.htmlFor='save-name';label.append(el('span',null,'Save name'));
      const input=el('input');input.id='save-name';input.type='text';input.maxLength=80;input.placeholder='e.g. Brad · Round 12';input.value=this.nameValue||'';input.disabled=!!this.busy;input.oninput=()=>this.nameValue=input.value;label.append(input);root.append(label);}
    const maps=saving?[this.currentMap]:[this.currentMap,...this.store.maps.map(m=>m.id).filter(id=>id!==this.currentMap)];
    for(const map of maps){
      const saves=this.store.list(map);
      if(!saving&&!saves.some(Boolean))continue;
      if(!saving)root.append(menuText('h3','save-map-heading',mapById(map).title.toUpperCase()));
      saves.forEach((save,slot)=>root.append(this.card(map,slot,save,saving,!!blocked)));
    }
    this.menu.text?.paint();
  }
  card(map,slot,save,saving,blocked){
    const item=el('div','save-slot');item.setAttribute('role','listitem');
    const armed=this.isArmed(saving?'overwrite':'delete',map,slot),fresh=this.justSaved?.map===map&&this.justSaved.slot===slot;
    item.dataset.state=fresh?'saved':armed?'armed':save?'filled':'empty';
    const main=el('button','slot-main');main.type='button';main.disabled=!!this.busy||(saving?blocked:!save);
    const thumb=el('div','slot-thumb');
    if(save?.thumb){const img=el('img');img.src=save.thumb;img.alt='';thumb.append(img);}else thumb.append(el('span','slot-thumb-empty',save?'NO PREVIEW':'EMPTY'));
    if(fresh)thumb.append(menuText('span','slot-stamp','SAVED'));
    const body=el('div','slot-body'),head=el('div','slot-head');
    head.append(menuText('span','slot-name','SLOT '+(slot+1)),el('span','slot-when',save?when(save.savedAt):''));body.append(head);
    if(save){
      const s=save.summary||{};
      if(save.name)body.append(el('div','slot-save-name',save.name));
      body.append(menuText('div','slot-round','ROUND '+(s.round??'?')));
      const stats=el('div','slot-stats');
      for(const [label,value]of [['Points',number(s.points)],['Kills',number(s.kills)],['Headshots',number(s.headshots)],
        ['Zombies',s.legacy?'Round restarts':`${s.zombies} alive${s.remaining?` · ${s.remaining} to come`:''}`],['Health',s.health!=null?s.health:'']]){
        if(value===''||value==null)continue;const stat=el('span','slot-stat');stat.append(el('b',null,label),el('span',null,String(value)));stats.append(stat);
      }
      body.append(stats);
      // Migrated saves only stored weapon ids.
      const gear=[(s.legacy?s.weapons?.map(this.callbacks.weaponName):s.weapons)?.join(' · ')];
      if(s.perks?.length)gear.push(s.perks.join(', '));
      if(s.power!=null)gear.push((s.power?'Power on':'Power off')+(s.links!=null?` · ${s.links}/${s.teleporterTotal||3} teleporters`:''));
      if(s.doors)gear.push(s.doors+' door'+(s.doors===1?'':'s')+' open');
      if(s.playTime)gear.push(duration(s.playTime)+' played');
      body.append(el('div','slot-gear',gear.filter(Boolean).join('  |  ')));
    }else body.append(el('div','slot-empty-copy',saving?'Empty slot · click to save here':'Empty slot'));
    if(armed)body.append(menuText('div','slot-confirm',saving?'CLICK AGAIN TO OVERWRITE':'CLICK DELETE AGAIN TO ERASE'));
    main.append(thumb,body);
    main.setAttribute('aria-label',`Slot ${slot+1}, `+(save?`${mapById(map).title}, round ${save.summary?.round}, ${save.summary?.points} points, saved ${when(save.savedAt)}`:'empty')+(saving?(save?'. Overwrite':'. Save here'):'. Load'));
    main.onclick=async()=>{
      if(this.busy)return;
      if(saving){
        if(save&&!armed){this.arm('overwrite',map,slot);return;}
        clearTimeout(this.disarm);this.armed=null;
        this.busy=true;this.status('Saving to the server…');this.render();
        try{const result=await this.callbacks.save(slot,this.nameValue);if(result.ok){this.justSaved={map,slot};this.status(result.message,'ok');}else{this.status(result.message,'warn');await this.store.refresh?.();}}
        catch(error){this.status(error.message,'warn');}finally{this.busy=false;this.render();}
      }else if(save){this.busy=true;this.render();try{await this.callbacks.load(map,slot);}catch(error){this.status(error.message,'warn');}finally{this.busy=false;this.render();}}
    };
    item.append(main);
    if(save&&!saving){
      const remove=menuText('button','slot-delete',this.isArmed('delete',map,slot)?'CONFIRM':'DELETE');remove.type='button';
      remove.setAttribute('aria-label',`Delete slot ${slot+1} save`);
      remove.disabled=!!this.busy;
      remove.onclick=async()=>{
        if(this.busy)return;
        if(!this.isArmed('delete',map,slot)){this.arm('delete',map,slot);return;}
        clearTimeout(this.disarm);this.armed=null;this.busy=true;this.render();
        try{await this.store.remove(map,slot);this.status(`Slot ${slot+1} deleted.`);if(!this.store.count())this.menu.show('home');}
        catch(error){this.status(error.message,'warn');try{await this.store.refresh?.();}catch{}}
        finally{this.busy=false;this.render();}
      };
      item.append(remove);
    }
    return item;
  }
}
