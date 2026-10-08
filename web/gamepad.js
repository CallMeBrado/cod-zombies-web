export const GAMEPAD_SETTINGS_KEY='cod-zombies-gamepad-settings-v1';
export const PAD_ACTIONS=[['fire','Fire'],['aim','Aim'],['interact','Use / rebuild / reload'],['jump','Stand / jump'],['stance','Crouch / prone / dive'],['sprint','Sprint'],['melee','Knife'],['grenade','Grenade / cook'],['nextWeapon','Switch weapon'],['alternateWeapon','Weapon mode'],['equipment','Equipment / P.E.S.'],['pause','Pause / resume'],['confirm','Menu select'],['back','Menu back']];
export const DEFAULT_PAD_MAPPING={ready:true,bindings:{fire:'Button7',aim:'Button6',interact:'Button2',jump:'Button0',stance:'Button1',sprint:'Button10',melee:'Button11',grenade:'Button5',nextWeapon:'Button3',alternateWeapon:'Button14',equipment:'Button12',pause:'Button9',confirm:'Button0',back:'Button1'},axes:{moveX:'Axis0+',moveY:'Axis1+',lookX:'Axis2+',lookY:'Axis3+'},rest:[]};
const UNKNOWN_MAPPING={...DEFAULT_PAD_MAPPING,ready:false};
export const DEFAULT_PAD_SETTINGS={version:1,enabled:true,sensitivity:5,adsSensitivity:.5,moveDeadzone:.16,lookDeadzone:.12,invertY:false,aimMode:'hold',promptStyle:'auto',mappings:{}};
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),finite=(x,f=0)=>Number.isFinite(x)?x:f;
export const padKey=pad=>'pad:'+String(pad.id||'Unknown controller').slice(0,240);
export const validPadBinding=token=>typeof token==='string'&&/^(Button([0-9]|[12][0-9]|3[01])|Axis([0-9]|1[0-5])[+-])$/.test(token);
const axisBinding=token=>typeof token==='string'&&/^Axis([0-9]|1[0-5])[+-]$/.test(token);
export function normalizePadSettings(saved){
  const out=structuredClone(DEFAULT_PAD_SETTINGS);if(saved?.version!==1)return out;
  for(const [key,min,max]of [['sensitivity',1,10],['adsSensitivity',.1,1.5],['moveDeadzone',.02,.45],['lookDeadzone',.02,.45]])if(Number.isFinite(saved[key]))out[key]=clamp(saved[key],min,max);
  out.enabled=saved.enabled!==false;out.invertY=saved.invertY===true;out.aimMode=saved.aimMode==='toggle'?'toggle':'hold';out.promptStyle=['auto','xbox','playstation','nintendo','generic'].includes(saved.promptStyle)?saved.promptStyle:'auto';
  for(const [key,value]of Object.entries(saved.mappings||{}).slice(-8)){
    if(!key.startsWith('pad:')||key.length>244||!value||typeof value!=='object')continue;
    const mapping=structuredClone(DEFAULT_PAD_MAPPING);mapping.ready=value.ready===true;
    for(const [action]of PAD_ACTIONS)if(value.bindings&&Object.hasOwn(value.bindings,action))mapping.bindings[action]=validPadBinding(value.bindings[action])?value.bindings[action]:null;
    for(const added of ['stance','equipment','alternateWeapon'])if(!Object.hasOwn(value.bindings||{},added)&&PAD_ACTIONS.some(([a])=>![added,'confirm','back'].includes(a)&&mapping.bindings[a]===mapping.bindings[added]))mapping.bindings[added]=null;
    for(const action of Object.keys(mapping.axes))if(value.axes&&Object.hasOwn(value.axes,action))mapping.axes[action]=axisBinding(value.axes[action])?value.axes[action]:null;
    mapping.rest=Array.isArray(value.rest)?value.rest.slice(0,16).map(x=>clamp(finite(x),-1,1)):[];out.mappings[key]=mapping;
  }return out;
}
export class GamepadSettings {
  constructor(storage){this.storage=storage;this.listeners=new Set();try{this.value=normalizePadSettings(JSON.parse(storage?.getItem(GAMEPAD_SETTINGS_KEY)));}catch{this.value=structuredClone(DEFAULT_PAD_SETTINGS);}}
  subscribe(listener){this.listeners.add(listener);return ()=>this.listeners.delete(listener);}
  changed(){this.value=normalizePadSettings(this.value);try{this.storage?.setItem(GAMEPAD_SETTINGS_KEY,JSON.stringify(this.value));this.saved=!!this.storage;}catch{this.saved=false;}for(const listener of this.listeners)listener(this.value);}
  update(key,value){if(!Object.hasOwn(DEFAULT_PAD_SETTINGS,key)||['version','mappings'].includes(key))return;this.value[key]=value;this.changed();}
  mapping(pad){return this.value.mappings[padKey(pad)]||(pad.mapping==='standard'?DEFAULT_PAD_MAPPING:UNKNOWN_MAPPING);}
  configure(pad,changes={}){const key=padKey(pad),mapping=structuredClone(this.mapping(pad));Object.assign(mapping,changes);mapping.rest=Array.from(pad.axes||[],x=>clamp(finite(x),-1,1));this.value.mappings[key]=mapping;this.changed();}
  bind(pad,action,token){if(!PAD_ACTIONS.some(([a])=>a===action)||token!==null&&!validPadBinding(token))return;const bindings={...this.mapping(pad).bindings};if(token)for(const [other]of PAD_ACTIONS){const menu=a=>['confirm','back'].includes(a);if(other!==action&&bindings[other]===token&&(menu(other)===menu(action)||other==='pause'||action==='pause'))bindings[other]=null;}bindings[action]=token;this.configure(pad,{bindings});}
  setAxis(pad,action,token){if(!Object.hasOwn(DEFAULT_PAD_MAPPING.axes,action)||token!==null&&!axisBinding(token))return;this.configure(pad,{axes:{...this.mapping(pad).axes,[action]:token}});}
  reset(pad){delete this.value.mappings[padKey(pad)];this.changed();}
}

export function controllerFamily(id){
  const name=String(id||'').toLowerCase();
  if(/dualshock|dualsense|playstation|\bps[345]\b|sony|054c/.test(name))return 'playstation';
  if(/xbox|xinput|microsoft|045e|backbone/.test(name))return 'xbox';
  if(/nintendo|switch|joy-?con|057e/.test(name))return 'nintendo';
  if(/wireless controller/.test(name))return 'playstation';return 'generic';
}
export function padButtonLabel(token,style='generic'){
  if(!token)return 'UNBOUND';if(token.startsWith('Axis'))return 'AXIS '+(Number(token.slice(4,-1))+1)+token.at(-1);
  const index=Number(token.slice(6)),common={4:'LB',5:'RB',6:'LT',7:'RT',8:'BACK',9:'MENU',10:'LS',11:'RS',12:'↑',13:'↓',14:'←',15:'→',16:'HOME'};
  if(style==='generic')return 'B'+(index+1);
  if(style==='playstation')return ({0:'CROSS',1:'CIRCLE',2:'SQUARE',3:'TRIANGLE',4:'L1',5:'R1',6:'L2',7:'R2',8:'SHARE',9:'OPTIONS',10:'L3',11:'R3',16:'PS',17:'TOUCHPAD'})[index]||common[index]||'B'+(index+1);
  return (style==='nintendo'?{0:'B',1:'A',2:'Y',3:'X',4:'L',5:'R',6:'ZL',7:'ZR',8:'−',9:'+',10:'LS',11:'RS'}:{0:'A',1:'B',2:'X',3:'Y'})[index]||common[index]||'B'+(index+1);
}
export function radialStick(x,y,deadzone){
  x=clamp(finite(x),-1,1);y=clamp(finite(y),-1,1);const length=Math.hypot(x,y);if(length<=deadzone)return {x:0,y:0,magnitude:0};
  const magnitude=clamp((length-deadzone)/(1-deadzone),0,1);return {x:x/length*magnitude,y:y/length*magnitude,magnitude};
}
const rawButton=(pad,index)=>{const b=pad.buttons?.[index];return clamp(finite(typeof b==='number'?b:b?.value,b?.pressed?1:0),0,1);};
const rawAxis=(pad,index)=>clamp(finite(pad.axes?.[index]),-1,1);
const stickAxis=(pad,token)=>token?rawAxis(pad,Number(token.slice(4,-1)))*(token.endsWith('-')?-1:1):0;
const bindingValue=(pad,token,mapping)=>{
  if(!token)return 0;if(token.startsWith('Button'))return rawButton(pad,Number(token.slice(6)));
  const index=Number(token.slice(4,-1)),sign=token.endsWith('-')?-1:1,rest=finite(mapping.rest[index]);return clamp((rawAxis(pad,index)-rest)*sign/Math.max(.1,1-rest*sign),0,1);
};
const neutral=()=>({forward:0,side:0,movementScale:0,sprint:false,jump:false,use:false,fire:false});

// Poll fresh API snapshots every frame. Button edges are retained across menu
// transitions, so holding Start cannot resume and immediately pause again.
export class GamepadControls {
  constructor(settings,{getGamepads=()=>globalThis.navigator?.getGamepads?.()||[],supported=typeof globalThis.navigator?.getGamepads==='function',mode=()=> 'menu',focused=()=>!globalThis.document?.hidden,aimBlend=()=>0,action=()=>{},release=()=>{},look=()=>{},menu=()=>{},changed=()=>{},devicesChanged=()=>{},disconnect=()=>{},capture=()=>false,rawCapture=()=>{}}={}){
    Object.assign(this,{settings,getGamepads,supported,mode,focused,aimBlend,action,release,look,menu,changed,devicesChanged,disconnect,capture,rawCapture});this.records=new Map();this.owner='keyboard';this.activeIndex=null;this.devices=[];this.state=neutral();this.aiming=false;this.toggledAim=false;this.sprinting=false;this.lastMenuDirection=null;this.repeatDue=0;this.clock=0;this.error=null;
    const signature=()=>JSON.stringify({enabled:settings.value.enabled,aimMode:settings.value.aimMode,mappings:settings.value.mappings});this.settingsSignature=signature();
    settings.subscribe(()=>{const next=signature();if(next!==this.settingsSignature)this.suppressHeld();this.settingsSignature=next;if(!settings.value.enabled)this.useKeyboard();this.changed(this.owner);});
  }
  get current(){return this.devices.find(p=>p.index===this.activeIndex)||this.devices[0]||null;}
  get active(){return this.owner==='controller'&&this.settings.value.enabled&&!!this.current&&this.settings.mapping(this.current).ready;}
  get style(){const p=this.current,setting=this.settings.value.promptStyle;return setting!=='auto'?setting:p?.mapping==='standard'?controllerFamily(p.id):'generic';}
  label(action){const p=this.current;if(!p)return '';const mapped=['use','reload'].includes(action)?'interact':action;return padButtonLabel(this.settings.mapping(p).bindings[mapped],this.style);}
  token(action){const p=this.current;return p?this.settings.mapping(p).bindings[action]:null;}
  useKeyboard(){if(this.owner==='keyboard')return;this.suppressHeld();this.owner='keyboard';this.changed('keyboard');}
  activate(pad){if(this.activeIndex!==pad.index){if(this.grenadeHeld)this.release('grenade');if(this.stanceHeld)this.release('stance',true);this.grenadeHeld=false;this.stanceHeld=false;this.activeIndex=pad.index;this.toggledAim=false;this.sprinting=false;this.state=neutral();this.changed(this.owner);}if(this.owner!=='controller'){this.owner='controller';this.changed('controller');}}
  disconnected(index){if(!this.records.has(index))return;this.records.delete(index);if(index===this.activeIndex){const used=this.owner==='controller';this.suppressHeld();this.activeIndex=null;this.owner='keyboard';this.changed('keyboard');if(used)this.disconnect();}}
  suppressHeld(){
    if(this.state.use||this.state.fire||this.aiming||this.state.sprint)this.state=neutral();
    if(this.grenadeHeld)this.release('grenade');this.grenadeHeld=false;this.toggledAim=false;this.aiming=false;this.sprinting=false;this.state=neutral();this.lastMenuDirection=null;
    if(this.stanceHeld)this.release('stance',true);this.stanceHeld=false;
    for(const r of this.records.values()){r.blocked=new Set(Object.entries(r.down).filter(([,held])=>held).map(([a])=>a));r.waitForSticks=true;r.waitForMenuNeutral=true;}
  }
  input(){return this.active?this.state:neutral();}
  poll(dt){
    dt=Math.max(0,Math.min(.1,finite(dt)));this.clock+=dt;let pads=[];
    try{pads=Array.from(this.getGamepads()||[]).filter(p=>p&&p.connected!==false);this.error=null;}catch(error){this.error=error.name||'Unavailable';}
    const signature=pads.map(p=>p.index+':'+padKey(p)+':'+p.mapping).join('|'),previous=this.devices.map(p=>p.index+':'+padKey(p)+':'+p.mapping).join('|');this.devices=pads;
    if(signature!==previous)this.devicesChanged(pads);
    for(const [index,r]of this.records)if(!pads.some(p=>p.index===index&&padKey(p)===r.key)){
      this.disconnected(index);
    }
    this.state=neutral();if(!this.focused()){this.suppressHeld();this.wasFocused=false;return;}if(this.wasFocused===false){this.records.clear();this.suppressHeld();}this.wasFocused=true;
    for(const pad of pads){
      const mapping=this.settings.mapping(pad),values=Object.fromEntries(PAD_ACTIONS.map(([a])=>[a,bindingValue(pad,mapping.bindings[a],mapping)])),capturing=this.capture();
      let r=this.records.get(pad.index),fresh=!r||r.key!==padKey(pad);
      if(fresh){r={key:padKey(pad),down:{},buttons:[],axes:[],blocked:new Set(),waitForSticks:false,waitForMenuNeutral:true};this.records.set(pad.index,r);}
      const down=Object.fromEntries(PAD_ACTIONS.map(([a])=>[a,values[a]>(r.down[a] ? .2 : .35)])),pressed=[],released=[];
      for(const [a]of PAD_ACTIONS){if(down[a]&&!r.down[a])pressed.push(a);if(!down[a]&&r.down[a]&&!r.blocked.has(a))released.push(a);if(!down[a])r.blocked.delete(a);}
      let activity=false;const rawPressed=[];
      for(let i=0;i<(pad.buttons?.length||0);i++){const v=rawButton(pad,i);if(v>.5&&(r.buttons[i]||0)<=.5){rawPressed.push('Button'+i);activity=true;}}
      if(capturing&&!r.capturing)r.captureAxes=r.axes.slice();r.capturing=capturing;
      const usedAxes=new Set([...Object.values(mapping.axes),...Object.values(mapping.bindings)].filter(axisBinding).map(t=>Number(t.slice(4,-1))));
      for(let i=0;i<(pad.axes?.length||0);i++){const v=rawAxis(pad,i),diff=v-finite(r.axes[i],v);if(usedAxes.has(i)&&Math.abs(diff)>.025&&Math.abs(v)>Math.min(this.settings.value.moveDeadzone,this.settings.value.lookDeadzone)+.04)activity=true;
        const captureDiff=v-finite(r.captureAxes?.[i],v);if(capturing&&Math.abs(captureDiff)>.5)rawPressed.push('Axis'+i+(captureDiff<0?'-':'+'));}
      if(pressed.length)activity=true;
      if(fresh){for(const a of pressed)r.blocked.add(a);pressed.length=0;released.length=0;rawPressed.length=0;activity=Object.values(down).some(Boolean);}
      r.buttons=Array.from(pad.buttons||[],(_,i)=>rawButton(pad,i));r.axes=Array.from(pad.axes||[],(_,i)=>rawAxis(pad,i));r.down=down;
      if(capturing){if(rawPressed.length)this.rawCapture(rawPressed[0],pad);continue;}
      if(!this.settings.value.enabled||!mapping.ready)continue;
      const left=radialStick(stickAxis(pad,mapping.axes.moveX),stickAxis(pad,mapping.axes.moveY),this.settings.value.moveDeadzone),right=radialStick(stickAxis(pad,mapping.axes.lookX),stickAxis(pad,mapping.axes.lookY),this.settings.value.lookDeadzone);
      // A slowly moved stick also counts when it first leaves the deadzone.
      // A stick left held after a mouse/key handoff cannot steal input back.
      const sticksActive=!!(left.magnitude||right.magnitude);if(!fresh&&sticksActive&&!r.sticksActive)activity=true;r.sticksActive=sticksActive;
      if(r.waitForSticks&&!left.magnitude&&!right.magnitude)r.waitForSticks=false;
      const dpadNeutral=[12,13,14,15].every(i=>rawButton(pad,i)<.5);if(r.waitForMenuNeutral&&dpadNeutral&&!left.magnitude)r.waitForMenuNeutral=false;
      if(activity)this.activate(pad);if(this.activeIndex!==pad.index||this.owner!=='controller')continue;
      const mode=this.mode(),held=a=>down[a]&&!r.blocked.has(a),edges=pressed.filter(a=>!r.blocked.has(a));
      if(mode==='playing'){
        if(edges.includes('aim')&&this.settings.value.aimMode==='toggle')this.toggledAim=!this.toggledAim;this.aiming=this.settings.value.aimMode==='toggle'?this.toggledAim:held('aim');
        if(edges.includes('sprint'))this.sprinting=!this.sprinting;const forward=-left.y;if(forward<.15||held('fire')||this.aiming)this.sprinting=false;
        const move=r.waitForSticks?{x:0,y:0,magnitude:0}:left;
        this.onSticks?.(move,r.waitForSticks?{x:0,y:0,magnitude:0}:right);
        this.state={forward:-move.y,side:move.x,movementScale:move.magnitude,sprint:this.sprinting,jump:edges.includes('jump'),use:held('interact'),fire:held('fire')};
        if(right.magnitude&&!r.waitForSticks){const curve=Math.pow(right.magnitude,1.6)/right.magnitude,speed=this.settings.value.sensitivity*.65*(1+this.aimBlend()*(this.settings.value.adsSensitivity-1));this.look(-right.x*curve*speed*Math.min(.1,dt),-right.y*curve*speed*Math.min(.1,dt)*(this.settings.value.invertY?-1:1));}
        for(const a of ['pause','fire','interact','melee','grenade','nextWeapon','stance','equipment','alternateWeapon'])if(edges.includes(a)){this.action(a);if(this.mode()!==mode)break;}
        if(released.includes('grenade')&&this.grenadeHeld)this.release('grenade');this.grenadeHeld=held('grenade');
        if(released.includes('stance')&&this.stanceHeld)this.release('stance');this.stanceHeld=held('stance');
      }else{
        this.aiming=false;this.sprinting=false;this.grenadeHeld=false;this.stanceHeld=false;
        for(const a of ['pause','confirm','back'])if(edges.includes(a)){this.menu(a);if(this.mode()!==mode)break;}
        if(this.mode()!==mode)continue;
        const direction=r.waitForMenuNeutral?null:rawButton(pad,12)>.5?'up':rawButton(pad,13)>.5?'down':rawButton(pad,14)>.5?'left':rawButton(pad,15)>.5?'right':left.magnitude>.55?(Math.abs(left.y)>=Math.abs(left.x)?left.y<0?'up':'down':left.x<0?'left':'right'):null;
        if(direction&&(direction!==this.lastMenuDirection||this.clock>=this.repeatDue)){this.menu(direction);this.repeatDue=this.clock+(direction===this.lastMenuDirection ? .12 : .35);}this.lastMenuDirection=direction;
        if(!fresh){if(rawPressed.includes('Button4'))this.menu('previousTab');if(rawPressed.includes('Button5'))this.menu('nextTab');}
      }
    }
  }
  diagnostics(){return {active:this.active,owner:this.owner,style:this.style,connected:this.devices.length,mapping:this.current?.mapping||null,configured:this.current?this.settings.mapping(this.current).ready:false,supported:this.supported,error:this.error};}
}
