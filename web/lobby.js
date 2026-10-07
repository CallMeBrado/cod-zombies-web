import {MAPS,BO1_MAPS,BO2_MAPS,selectedMap} from './maps.js';
const $=id=>document.getElementById(id);
export class ZombiesLobby {
  constructor(menu){
    this.menu=menu;this.current=selectedMap();this.selection=this.current;this.shared=null;this.localStatus='LOADING';
    // Co-op is opt-in: join another player's lobby, leave it, or share an invite.
    this.onJoin=()=>{};this.onLeave=()=>{};this.onInvite=()=>{};
    this.nameFor=(player,mine)=>'PLAYER '+(player.slot+1);
    for(const map of this.current.game==='black-ops-2'?BO2_MAPS:this.current.game==='black-ops'?BO1_MAPS:MAPS){
      const button=document.createElement('button');button.type='button';button.dataset.menuText='';button.dataset.map=map.id;button.textContent=map.title.toUpperCase();
      button.onclick=()=>this.choose(map);$('map-list').append(button);
    }
    $('select-map').onclick=()=>{this.choose(this.current);menu.show('maps');};
    $('map-accept').onclick=()=>{
      if(this.selection.id===this.current.id){menu.show('home');return;}
      const url=new URL(location.href);url.searchParams.set('map',this.selection.id);location.assign(url.href);
    };
    this.render();
  }
  choose(map){this.selection=map;this.render();}
  render(){
    this.menu.setText('menu-title',this.current.title.toUpperCase());
    this.menu.setText('selected-map-title',this.selection.title.toUpperCase());
    $('map-description').textContent=this.selection.description;
    for(const [id,map]of [['lobby-preview',this.current],['map-preview',this.selection]]){$(id).src='/data/'+(map.game?map.data:'gameplay')+'/hud/'+map.image+'.png';$(id).alt=map.title;}
    for(const button of $('map-list').children)button.setAttribute('aria-selected',String(button.dataset.map===this.selection.id));
    this.menu.setText('map-accept','SELECT MAP');this.menu.text?.paint();
  }
  ready(){this.localStatus='READY';this.renderPlayers();}
  // This browser's lobby (LobbyPresence): just this player unless they joined
  // someone, or chose to share theirs; the other open lobbies on this map.
  setShared(state){this.shared=state;this.renderPlayers();}
  renderPlayers(){
    const box=$('lobby-players'),state=this.shared,you=state?.you??'local',players=state?.players.length?state.players:[{id:'local',slot:0,character:null,status:'lobby'}];
    // The lobby checks in twice a second; rebuild only on a change, so a JOIN
    // button is not replaced under the pointer mid-click.
    const signature=JSON.stringify([you,state?.host,state?.lobby,this.localStatus,players.map(p=>[p.id,p.slot,p.status]),(state?.open||[]).map(l=>[l.id,l.players,l.host,l.joinable,l.playing]),document.body.dataset.menuContext]);
    if(signature===this.signature)return;this.signature=signature;
    const rows=players.map(p=>{
      const mine=p.id===you,row=document.createElement('div'),name=document.createElement('span'),status=document.createElement('span');
      row.className='lobby-player-row'+(mine?' you':'');name.dataset.menuText='';status.dataset.menuText='';status.className='lobby-status';
      name.textContent=this.nameFor(p,mine)+(players.length>1&&p.id===state?.host?' · HOST':'');
      if(mine)status.id='lobby-player-status';status.textContent=mine?this.localStatus||'LOADING':STATUS[p.status]||'';
      row.append(name,status);return row;
    });
    // Other players' lobbies on this map, each with JOIN; LEAVE and INVITE
    // once this lobby is shared.
    // The other lobbies are listed while you are on your own (leave first to switch).
    const open=players.length>1?[]:(state?.open||[]).filter(l=>l.joinable||l.playing),extra=[];
    const button=(text,action,className='lobby-action')=>{const b=document.createElement('button');b.type='button';b.className=className;b.dataset.menuText='';b.textContent=text;b.onclick=action;return b;};
    if(players.length>1)extra.push(button('LEAVE LOBBY',()=>this.onLeave()));
    if(state?.lobby)extra.push(button(players.length>1?'COPY INVITE LINK':'INVITE A FRIEND',()=>this.onInvite()));
    if(open.length){
      const heading=document.createElement('div');heading.className='lobby-players-heading lobby-open-heading';heading.dataset.menuText='';heading.textContent='OTHER LOBBIES';extra.push(heading);
      for(const l of open){
        const row=document.createElement('div'),name=document.createElement('span');row.className='lobby-player-row lobby-open';name.dataset.menuText='';
        name.textContent=`PLAYER ${l.host+1} · ${l.players}/${l.max}`;row.append(name);
        if(l.joinable)row.append(button('JOIN',()=>this.onJoin(l.id),'lobby-join'));else{const s=document.createElement('span');s.className='lobby-status';s.dataset.menuText='';s.textContent='IN GAME';row.append(s);}
        extra.push(row);
      }
    }
    box.replaceChildren(box.querySelector('.lobby-players-heading'),...rows,...extra);
    if(document.body.dataset.menuContext==='start')$('menu-copy').textContent=players.length>1?`Lobby · ${players.length} of ${state.max} players`:'Solo Zombies';
    this.menu.text?.paint();
  }
}
const STATUS={lobby:'READY',loading:'LOADING',waiting:'WAITING',playing:'IN GAME'};
