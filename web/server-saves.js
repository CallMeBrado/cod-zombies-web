import {SaveStore,SLOTS} from './save-slots.js';

// The server is canonical; the small in-memory catalogue makes slot rendering
// synchronous. Refresh it whenever the picker opens and before loading a save.
export class ServerSaveStore {
  constructor(storage,maps,fetcher=globalThis.fetch.bind(globalThis)){this.storage=storage;this.maps=maps;this.fetcher=fetcher;this.catalogue=new Map();this.legacy=new SaveStore(storage,maps);this.ready=false;}
  key(map,slot){return map+':'+slot;}
  get(map,slot){return this.catalogue.get(this.key(map,slot))||null;}
  list(map){return Array.from({length:SLOTS},(_,slot)=>this.get(map,slot));}
  count(){return this.maps.reduce((sum,m)=>sum+this.list(m.id).filter(Boolean).length,0);}
  async request(url,options={}){
    const response=await this.fetcher(url,{cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(10000),...options});
    let value;try{value=await response.json();}catch{throw new Error('The save server returned an invalid response.');}
    if(!response.ok)throw Object.assign(new Error(value.error||'Unable to contact the save server.'),{status:response.status});return value;
  }
  async refresh(){const {saves}=await this.request('/api/saves');if(!Array.isArray(saves))throw new Error('Invalid server save catalogue.');this.catalogue=new Map(saves.map(s=>[this.key(s.map,s.slot),s]));this.ready=true;}
  async prepare(){
    await this.refresh();
    for(const map of this.maps)for(let slot=0;slot<SLOTS;slot++){
      const old=this.legacy.get(map.id,slot),marker='zombies-server-import:'+this.key(map.id,slot);
      if(!old||this.get(map.id,slot))continue;
      let imported;try{imported=this.storage?.getItem(marker);}catch{}
      if(imported===String(old.savedAt))continue;
      try{await this.put(map.id,slot,{...old,name:old.name||'Imported · Round '+old.summary?.round});try{this.storage?.setItem(marker,String(old.savedAt));}catch{}}
      catch(e){if(e.status!==409)throw e;await this.refresh();}
    }
  }
  async put(map,slot,save){
    const {save:saved}=await this.request(`/api/saves/${map}/${slot}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:this.get(map,slot)?.revision??null,save})});
    this.catalogue.set(this.key(map,slot),saved);return saved;
  }
  async remove(map,slot){await this.request(`/api/saves/${map}/${slot}`,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:this.get(map,slot)?.revision??null})});this.catalogue.delete(this.key(map,slot));}
}
