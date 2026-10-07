// This browser's pre-game lobby on this server (tools/lobby-api.mjs). Each
// browser starts in its own lobby; it joins another player's open lobby (or
// an invite link's ?lobby=) only when asked. The browser checks in about
// twice a second; leaving the page (or going quiet for a while) leaves it.
export class LobbyPresence {
  constructor(map,{character=null,invite=null,onChange=()=>{},onFull=()=>{},onStart=()=>{},onGo=()=>{}}={}){
    Object.assign(this,{map,character,invite,onChange,onFull,onStart,onGo});
    this.state=null;this.id=null;this.lastId=null;this.status='lobby';this.timer=null;this.full=false;this.matchId=null;this.goId=null;this.loadedMatch=null;this.sent=0;this.accepted=0;
  }
  connect(){
    if(this.timer!==null||typeof fetch==='undefined')return this;this.timer=0;
    addEventListener('pagehide',()=>this.leave());
    this.loop();return this;
  }
  async loop(){
    try{if(this.id)await this.push({});else await this.join();}catch{}
    // In a game the lobby only needs to know this player is still here.
    this.timer=setTimeout(()=>this.loop(),this.full?3000:this.status==='playing'?2000:500);
  }
  // Replies can arrive out of order; each carries the order it was sent in.
  async request(path,body){
    const order=++this.sent,response=await fetch(`/api/lobby/${this.map}/${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store'});
    return {status:response.status,value:response.status===204?null:await response.json(),order};
  }
  async join(){
    // A browser the server dropped (busy or throttled) rejoins as itself.
    const {status,value,order}=await this.request('join',{character:this.character,id:this.lastId,status:this.status,lobby:this.invite});
    // A full invited lobby: tell the player once, then use one's own lobby.
    if(status===409){if(!this.full){this.full=true;this.onFull(value);}this.invite=null;return;}
    this.invite=null;
    if(status!==200)return;
    this.full=false;this.id=this.lastId=value.you;this.accept(value,order);
    if(this.loadedMatch)await this.push({});
  }
  async push(patch){
    if(!this.id)return null;
    // Until the match goes, every check-in repeats that this map has loaded.
    if(this.loadedMatch&&this.goId!==this.loadedMatch)patch={loaded:this.loadedMatch,...patch};
    const {status,value,order}=await this.request(this.id,patch);
    if(status===404){this.id=null;return null;}
    if(status===200)this.accept(value,order);return value;
  }
  accept(state,order=Infinity){
    if(order<this.accepted)return;this.accepted=order;
    this.state=state;this.onChange(state);
    const match=state.match;if(!match?.players.includes(state.you))return;
    if(match.id!==this.matchId){this.matchId=match.id;this.status='loading';this.onStart(match);}
    if(match.go&&this.goId!==match.id){this.goId=match.id;this.onGo(match);}
  }
  get you(){return this.state?.players.find(p=>p.id===this.state.you)||null;}
  get others(){return this.state?this.state.players.filter(p=>p.id!==this.state.you):[];}
  get isHost(){return !!this.state&&this.state.host===this.state.you;}
  setStatus(status){if(this.status===status)return;this.status=status;this.push({status}).catch(()=>{});}
  setCharacter(character){this.character=character;this.push({character}).catch(()=>{});}
  // Join another player's open lobby, or (null) go back to one's own.
  async move(lobby){if(!this.id)return 'Not connected to the lobby service.';const {status,value,order}=await this.request(this.id+'/move',{lobby});if(status===200){this.accept(value,order);return null;}return value?.error||'Could not join that lobby.';}
  get lobbyId(){return this.state?.lobby||null;}
  // Host only: everyone in the lobby starts loading the map.
  async start(){if(!this.id)return null;const {status,value,order}=await this.request(this.id+'/start',{});if(status===200)this.accept(value,order);return status===200?value:value?.error;}
  loaded(matchId){this.status='waiting';this.loadedMatch=matchId;return this.push({status:'waiting'}).catch(()=>null);}
  leave(){if(!this.id)return;const url=`/api/lobby/${this.map}/${this.id}/leave`;this.id=null;this.lastId=null;try{navigator.sendBeacon?.(url,new Blob(['{}'],{type:'application/json'}))||fetch(url,{method:'POST',keepalive:true,body:'{}'});}catch{}}
}
