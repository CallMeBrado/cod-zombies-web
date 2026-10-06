import {ACTIONS,bindingName,validBinding} from './settings.js';
import {MenuText} from './menu-text.js';
const $=id=>document.getElementById(id);
export class PauseMenu {
 constructor(settings,callbacks){
  this.settings=settings;this.callbacks=callbacks;this.view='home';this.capture=null;this.context='start';this.tabs=['controls','controller','mouse','audio','video'];
  $('options').onclick=()=>this.show('options');$('menu-back').onclick=()=>this.back();$('quit').onclick=()=>this.confirm('quit');$('restart').onclick=()=>this.confirm('restart');
  $('save-game').onclick=()=>this.openSaves('save');$('resume-save').onclick=()=>this.openSaves('load');
  $('confirm-no').onclick=()=>this.show('home');$('confirm-yes').onclick=()=>{const action=this.confirmAction;this.show('home');callbacks[action]();};
  $('reset-controls').onclick=()=>{settings.resetControls();this.setStatus('Controls restored to defaults.');};
  for(const tab of this.tabs){$('tab-'+tab).onclick=()=>this.selectTab(tab);$('tab-'+tab).onkeydown=e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();const i=this.tabs.indexOf(tab),next=this.tabs[(i+(e.key==='ArrowRight'?1:this.tabs.length-1))%this.tabs.length];this.selectTab(next);$('tab-'+next).focus();}};}
  for(const key of ['sensitivity','adsSensitivity','volume','fov','renderScale'])$(key).oninput=()=>settings.update(key,Number($(key).value));
  $('invertY').onchange=()=>settings.update('invertY',$('invertY').checked);$('showFps').onchange=()=>settings.update('showFps',$('showFps').checked);$('aimMode').onchange=()=>settings.update('aimMode',$('aimMode').value);
  $('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{this.setStatus('Fullscreen is unavailable in this browser.');}};
  this.rows=new Map();let group='';for(const [action,label,category]of ACTIONS){
   if(category!==group){const heading=document.createElement('h3');heading.dataset.menuText='';heading.textContent=category.toUpperCase();$('binding-list').append(heading);group=category;}
   const row=document.createElement('div');row.className='binding-row';const title=document.createElement('span');title.dataset.menuText='';title.textContent=label;row.append(title);
   const buttons=[0,1].map(slot=>{const button=document.createElement('button');button.className='binding-button';button.type='button';button.dataset.menuText='';button.onclick=()=>this.startCapture(action,slot);row.append(button);return button;});this.rows.set(action,buttons);$('binding-list').append(row);
  }
  // Capture before gameplay input and before the clicked control consumes a key.
  document.addEventListener('keydown',e=>this.captureKey(e),true);
  document.addEventListener('mousedown',e=>{if(this.capture){e.preventDefault();e.stopImmediatePropagation();this.skipClick=e.button===0;this.finishCapture('Mouse'+e.button);}},true);
  document.addEventListener('click',e=>{if(this.skipClick){this.skipClick=false;e.preventDefault();e.stopImmediatePropagation();}},true);
  document.addEventListener('wheel',e=>{if(this.capture){e.preventDefault();e.stopImmediatePropagation();this.finishCapture(e.deltaY<0?'WheelUp':'WheelDown');}}, {capture:true,passive:false});
  $('overlay').addEventListener('contextmenu',e=>{if(this.capture||this.view==='options')e.preventDefault();});
  $('overlay').addEventListener('pointerover',e=>this.paintButton(e));$('overlay').addEventListener('pointerout',e=>this.paintButton(e));$('overlay').addEventListener('focusin',e=>this.paintButton(e));$('overlay').addEventListener('focusout',e=>this.paintButton(e));
  document.addEventListener('fullscreenchange',()=>this.sync());settings.subscribe(()=>this.sync());addEventListener('resize',()=>this.text?.paint());
  this.sync();this.selectTab('controls');
 }
 async prepare(font){this.text=new MenuText($('overlay'),font);await this.text.prepare();this.sync();}
 paintButton(e){const button=e.target.closest('button,a');if(button&&this.text)requestAnimationFrame(()=>{for(const label of button.matches('[data-menu-text]')?[button]:button.querySelectorAll('[data-menu-text]'))this.text.draw(label);});}
 setText(id,value){if(this.text)this.text.set($(id),value);else $(id).textContent=value;}
 sync(){const v=this.settings.value;
  for(const key of ['sensitivity','adsSensitivity','volume','fov','renderScale']){$(key).value=v[key];$(key+'-value').textContent=key==='adsSensitivity'?v[key].toFixed(2)+'×':key==='volume'?Math.round(v[key]*100)+'%':key==='renderScale'?v[key]+'%':v[key];}
  $('invertY').checked=v.invertY;$('showFps').checked=v.showFps;$('aimMode').value=v.aimMode;
  for(const [action,buttons]of this.rows)buttons.forEach((button,slot)=>{const active=this.capture?.action===action&&this.capture.slot===slot,value=active?'PRESS A KEY':bindingName(v.bindings[action][slot]);if(this.text)this.text.set(button,value);else button.textContent=value;button.setAttribute('aria-label',ACTIONS.find(a=>a[0]===action)[1]+', '+(slot?'secondary':'primary')+', '+value);button.classList.toggle('capturing',active);});
  this.setText('fullscreen',document.fullscreenElement?'EXIT FULLSCREEN':'FULLSCREEN');this.text?.paint();
 }
 setStatus(message){$('settings-status').textContent=message+(this.settings.saved===false?' Settings could not be saved in this browser.':'');}
 startCapture(action,slot){this.capture={action,slot};this.sync();this.setStatus('Press a key, mouse button or mouse wheel. Esc cancels; Backspace clears.');}
 captureKey(e){if(!this.capture)return;e.preventDefault();e.stopImmediatePropagation();if(e.repeat)return;if(e.code==='Escape'){this.cancelCapture();return;}if(['Backspace','Delete'].includes(e.code)){this.finishCapture(null);return;}if(validBinding(e.code))this.finishCapture(e.code);else this.setStatus('That key cannot be bound. Press another key or Esc to cancel.');}
 cancelCapture(){this.capture=null;this.sync();this.setStatus('Binding unchanged.');}
 finishCapture(token){if(!this.capture)return;const {action,slot}=this.capture,conflicts=this.settings.bind(action,slot,token);this.capture=null;this.sync();this.setStatus((token?bindingName(token)+' assigned.':'Binding cleared.')+(conflicts.length?' Removed from '+conflicts.map(a=>ACTIONS.find(x=>x[0]===a)[1]).join(', ')+'.':''));this.rows.get(action)[slot].focus();}
 selectTab(tab){this.activeTab=tab;for(const name of this.tabs){$('tab-'+name).setAttribute('aria-selected',String(name===tab));$('tab-'+name).tabIndex=name===tab?0:-1;$('settings-'+name).hidden=name!==tab;}this.capture=null;this.sync();this.setStatus('Settings save automatically in this browser.');}
 show(view){this.capture=null;this.view=view;document.body.dataset.menuView=view;$('menu-home').hidden=view!=='home';$('menu-options').hidden=view!=='options';$('menu-confirm').hidden=view!=='confirm';$('menu-maps').hidden=view!=='maps';$('menu-mods').hidden=view!=='mods';$('menu-saves').hidden=view!=='saves';$('menu-back').hidden=view==='home';this.setText('screen-title',view==='saves'?(this.savesMode==='save'?'SAVE GAME':'LOAD GAME'):view==='mods'?'MOD MENU':view==='maps'?'SELECT MAP':view==='options'?'OPTIONS':view==='confirm'?'CONFIRM':this.context==='pause'?'PAUSED':this.context==='dead'?'GAME OVER':['black-ops','black-ops-2'].includes(document.body.dataset.game)?'ZOMBIES':'NAZI ZOMBIES');this.text?.paint();if(view==='saves')$('save-slots').querySelector('.slot-main:not(:disabled)')?.focus();else if(view==='mods')$('mod-god').focus();else if(view==='options')$('tab-'+this.activeTab).focus();else if(view==='confirm')$('confirm-no').focus();else if(view==='maps')$('map-list').querySelector('[aria-selected=true]')?.focus();else if(this.context==='pause')$('play').focus();}
 setContext(context){this.context=context;document.body.dataset.menuContext=context;this.setText('play',context==='pause'?'RESUME GAME':context==='dead'?'PLAY AGAIN':'START GAME');$('select-map').hidden=context!=='start';$('mods').hidden=context!=='pause';$('restart').hidden=context!=='pause';$('quit').hidden=context==='start';
  $('save-game').hidden=context!=='pause';$('resume-save').hidden=context==='pause'||!this.callbacks.saveCount?.();$('game-library').hidden=context!=='start';this.show('home');}
 openSaves(mode){this.savesMode=mode;this.callbacks.openSaves?.(mode);this.show('saves');}
 confirm(action){this.confirmAction=action;this.setText('confirm-title',action==='restart'?'RESTART LEVEL?':'QUIT TO MAIN MENU?');$('confirm-copy').textContent='Your current Zombies game will end.';this.setText('confirm-yes',action==='restart'?'RESTART LEVEL':'QUIT');this.show('confirm');}
 back(){if(this.capture){this.cancelCapture();return;}if(this.view==='mods'&&this.context==='pause'){this.show('home');this.callbacks.resume();return;}if(this.view!=='home'){this.show('home');return;}if(this.context==='pause')this.callbacks.resume();}
}
