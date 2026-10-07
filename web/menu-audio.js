// The original menu sounds for each game's zombies menu (tools/prepare_menus.py):
// a sound when the pointer or keyboard focus moves onto an option, another
// when one is chosen, a back sound, and the menu music in the lobby.
//   World at War  mouse_over / mouse_click, music_mainmenu
//   Black Ops     uin_navigation_over / _click / _backout, mus_zmb_mainmenu
//   Black Ops II  cac_main_nav / cac_submenu_edit_sel / cac_cmn_backout,
//                 mus_mp_frontend, and the location globe's own sounds
const OPTION='button,a[href],[role=tab],[role=option],select,input[type=checkbox],input[type=range]';
const BACK=/^(back|map-back|options-back|menu-back)$|back$/i;

export class MenuAudio {
  constructor(game,{volume=()=>1}={}){
    this.game=game;this.volume=volume;this.context=null;this.buffers=new Map();this.data=null;this.musicSource=null;this.musicWanted=false;this.lastHover=null;this.hoverAt=0;
    this.ready=fetch(`/data/gameplay/menus/${game}/menu.json`,{cache:'no-store'}).then(r=>r.ok?r.json():null).then(d=>{this.data=d;return d;}).catch(()=>null);
    // Browsers start audio only after a click or key press.
    const unlock=()=>{this.unlock();};addEventListener('pointerdown',unlock,{capture:true});addEventListener('keydown',unlock,{capture:true});
  }
  get sounds(){return this.data?.sounds||{};}
  unlock(){
    if(!this.context){try{this.context=new AudioContext();this.gain=this.context.createGain();this.gain.connect(this.context.destination);}catch{return;}}
    if(this.context.state==='suspended')this.context.resume().catch(()=>{});
    this.gain.gain.value=this.volume();
    if(this.musicWanted&&!this.musicSource)this.startMusic();
  }
  async buffer(role){
    const sound=this.sounds[role];if(!sound||!this.context)return null;
    if(!this.buffers.has(role))this.buffers.set(role,fetch(sound.url).then(r=>r.arrayBuffer()).then(b=>this.context.decodeAudioData(b)).catch(()=>null));
    return this.buffers.get(role);
  }
  async play(role,{volume=1}={}){
    await this.ready;if(!this.context||this.context.state!=='running'||!this.sounds[role])return;
    const buffer=await this.buffer(role);if(!buffer)return;
    const source=this.context.createBufferSource(),gain=this.context.createGain();source.buffer=buffer;
    gain.gain.value=(this.sounds[role].volume??1)*volume;source.connect(gain);gain.connect(this.gain);this.gain.gain.value=this.volume();source.start();
  }
  // Hover on pointer entry or keyboard focus, click on activation; Back
  // buttons and Escape play the back sound. Disabled options stay silent.
  attach(root){
    const option=e=>{const el=e.target.closest?.(OPTION);return el&&root.contains(el)&&!el.disabled&&el.getAttribute('aria-disabled')!=='true'&&el.offsetParent!==null?el:null;};
    const hover=el=>{if(!el||el===this.lastHover)return;this.lastHover=el;const now=performance.now();if(now-this.hoverAt<40)return;this.hoverAt=now;this.play(this.sounds.submenu&&el.closest('#map-list,.settings-tabs')?'submenu':'hover');};
    root.addEventListener('pointerover',e=>hover(option(e)));
    root.addEventListener('pointerout',e=>{if(e.target.closest?.(OPTION)===this.lastHover&&!root.contains(e.relatedTarget?.closest?.(OPTION)??null))this.lastHover=null;});
    root.addEventListener('focusin',e=>{if(e.target.matches?.(':focus-visible'))hover(option(e));});
    root.addEventListener('click',e=>{const el=option(e);if(!el||el.matches('input[type=range]'))return;this.lastHover=el;
      if(el.dataset.menuSound==='none')return;
      this.play(BACK.test(el.id||'')||el.dataset.menuSound==='back'?'back':el.dataset.menuSound||'click');},{capture:true});
    root.addEventListener('change',e=>{if(e.target.matches?.('input[type=range],select'))this.play('hover');});
    addEventListener('keydown',e=>{if(e.key==='Escape'&&getComputedStyle(root).display!=='none'&&root.offsetParent!==null)this.play('back');});
  }
  // The lobby's music loops until a game starts loading.
  music(on){
    if(on===this.musicWanted)return;this.musicWanted=on;
    if(!on){this.stopMusic();return;}
    if(this.context?.state==='running'&&!this.musicSource)this.startMusic();
  }
  async startMusic(){
    await this.ready;if(!this.musicWanted||this.musicSource||!this.sounds.music||!this.context)return;
    const marker={};this.musicSource=marker;
    const buffer=await this.buffer('music');if(!buffer||this.musicSource!==marker||!this.musicWanted){if(this.musicSource===marker)this.musicSource=null;return;}
    const source=this.context.createBufferSource(),gain=this.context.createGain();source.buffer=buffer;source.loop=true;
    gain.gain.setValueAtTime(0,this.context.currentTime);gain.gain.linearRampToValueAtTime(this.sounds.music.volume??1,this.context.currentTime+1.5);
    source.connect(gain);gain.connect(this.gain);source.start();this.musicSource={source,gain};
  }
  stopMusic(){
    const m=this.musicSource;this.musicSource=null;if(!m?.source||!this.context)return;
    const t=this.context.currentTime;m.gain.gain.cancelScheduledValues(t);m.gain.gain.setValueAtTime(m.gain.gain.value,t);m.gain.gain.linearRampToValueAtTime(0,t+.6);m.source.stop(t+.65);
  }
}
