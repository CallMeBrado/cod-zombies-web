import {MAPS,selectedMap} from './maps.js';
const $=id=>document.getElementById(id);
export class ZombiesLobby {
  constructor(menu){
    this.menu=menu;this.current=selectedMap();this.selection=this.current;
    for(const map of MAPS){
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
    for(const [id,map]of [['lobby-preview',this.current],['map-preview',this.selection]]){$(id).src='/data/gameplay/hud/'+map.image+'.png';$(id).alt=map.title;}
    for(const button of $('map-list').children)button.setAttribute('aria-selected',String(button.dataset.map===this.selection.id));
    this.menu.setText('map-accept',this.selection.id===this.current.id?'SELECT MAP':'LOAD MAP');this.menu.text?.paint();
  }
  ready(){this.menu.setText('lobby-player-status','READY');}
}
