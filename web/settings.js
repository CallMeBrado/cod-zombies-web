export const SETTINGS_KEY='waw-zombies-settings-v1';
export const ACTIONS=[
 ['forward','Forward','Movement'],['backward','Back','Movement'],['left','Move left','Movement'],['right','Move right','Movement'],['sprint','Sprint','Movement'],['jump','Stand / jump','Movement'],['crouch','Toggle crouch','Movement'],['prone','Prone / BO1 dive','Movement'],
 ['fire','Attack','Combat'],['aim','Aim down sight','Combat'],['aimToggle','Toggle aim','Combat'],['reload','Reload','Combat'],['melee','Melee attack','Combat'],['grenade','Throw / cook grenade','Combat'],['nextWeapon','Switch weapon','Combat'],
 ['use','Use / rebuild / throw back','Other'],['pause','Pause game','Other'],['lookLeft','Look left','Other'],['lookRight','Look right','Other'],['lookUp','Look up','Other'],['lookDown','Look down','Other']
];
export const DEFAULT_SETTINGS={version:1,sensitivity:5,adsSensitivity:.5,invertY:false,aimMode:'hold',volume:.5,fov:65,renderScale:100,showFps:true,bindings:{
 forward:['KeyW',null],backward:['KeyS',null],left:['KeyA',null],right:['KeyD',null],sprint:['ShiftLeft','ShiftRight'],jump:['Space',null],crouch:['KeyC',null],prone:['ControlLeft','ControlRight'],fire:['Mouse0','KeyF'],aim:['Mouse2',null],aimToggle:['KeyX',null],reload:['KeyR',null],melee:['KeyV',null],grenade:['KeyG',null],nextWeapon:['KeyQ','WheelDown'],use:['KeyE',null],pause:['Escape',null],lookLeft:['ArrowLeft',null],lookRight:['ArrowRight',null],lookUp:['ArrowUp',null],lookDown:['ArrowDown',null]
}};
const defaults=()=>structuredClone(DEFAULT_SETTINGS);
export function validBinding(token){return typeof token==='string'&&/^(Key[A-Z]|Digit[0-9]|Numpad[0-9]|F([1-9]|1[0-2])|Shift(Left|Right)|Control(Left|Right)|Alt(Left|Right)|Arrow(Left|Right|Up|Down)|Space|Tab|Enter|Escape|Backspace|Delete|Insert|Home|End|PageUp|PageDown|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|Minus|Equal|Backquote|Mouse[0-4]|WheelUp|WheelDown)$/.test(token);}
export function bindingName(token){if(!token)return 'UNBOUND';if(token.startsWith('Key'))return token.slice(3);if(token.startsWith('Digit'))return token.slice(5);if(token.startsWith('Numpad'))return 'NUM '+token.slice(6);return ({Mouse0:'MOUSE 1',Mouse1:'MOUSE 3',Mouse2:'MOUSE 2',Mouse3:'MOUSE 4',Mouse4:'MOUSE 5',WheelUp:'WHEEL UP',WheelDown:'WHEEL DOWN',ShiftLeft:'LEFT SHIFT',ShiftRight:'RIGHT SHIFT',ControlLeft:'LEFT CTRL',ControlRight:'RIGHT CTRL',AltLeft:'LEFT ALT',AltRight:'RIGHT ALT',Space:'SPACE',Escape:'ESC',ArrowLeft:'LEFT ARROW',ArrowRight:'RIGHT ARROW',ArrowUp:'UP ARROW',ArrowDown:'DOWN ARROW',BracketLeft:'[',BracketRight:']',Backslash:'\\',Semicolon:';',Quote:"'",Comma:',',Period:'.',Slash:'/',Minus:'-',Equal:'=',Backquote:'`'})[token]||token.replace(/([a-z])([A-Z])/g,'$1 $2').toUpperCase();}
export function normalizeSettings(saved){
 const out=defaults();if(!saved||saved.version!==1)return out;
 for(const [key,min,max]of [['sensitivity',1,30],['adsSensitivity',.1,1.5],['volume',0,1],['fov',60,100],['renderScale',50,150]])if(Number.isFinite(saved[key]))out[key]=Math.max(min,Math.min(max,saved[key]));
 out.invertY=saved.invertY===true;out.showFps=saved.showFps!==false;out.aimMode=saved.aimMode==='toggle'?'toggle':'hold';
 // New defaults must not take a key already assigned by an older profile.
 const reserved=new Set(Object.values(saved.bindings||{}).filter(Array.isArray).flat().filter(Boolean));for(const action of ['crouch','prone'])if(!Array.isArray(saved.bindings?.[action]))out.bindings[action]=out.bindings[action].map(k=>reserved.has(k)?null:k);
 const used=new Set();for(const [action]of ACTIONS){const keys=Array.isArray(saved.bindings?.[action])?saved.bindings[action]:out.bindings[action];out.bindings[action]=[0,1].map(i=>{const token=keys[i];if(!validBinding(token)||used.has(token)||token==='Escape'&&action!=='pause')return null;used.add(token);return token;});}
 return out;
}
export class GameSettings {
 constructor(storage){this.storage=storage;this.listeners=new Set();try{this.value=normalizeSettings(JSON.parse(storage?.getItem(SETTINGS_KEY)));}catch{this.value=defaults();}}
 subscribe(listener){this.listeners.add(listener);return ()=>this.listeners.delete(listener);}
 changed(){this.saved=true;try{if(!this.storage)throw new Error('Storage unavailable');this.storage.setItem(SETTINGS_KEY,JSON.stringify(this.value));}catch{this.saved=false;}for(const listener of this.listeners)listener(this.value);}
 update(key,value){if(!(key in DEFAULT_SETTINGS)||['version','bindings'].includes(key))return;this.value=normalizeSettings({...this.value,[key]:value});this.changed();}
 bind(action,slot,token){
  if(!this.value.bindings[action]||![0,1].includes(slot)||token!==null&&!validBinding(token)||token==='Escape'&&action!=='pause')return [];
  const conflicts=[];if(token)for(const [other,keys]of Object.entries(this.value.bindings))for(let i=0;i<2;i++)if(keys[i]===token&&(other!==action||i!==slot)){keys[i]=null;conflicts.push(other);}
  this.value.bindings[action][slot]=token;this.changed();return conflicts;
 }
 resetControls(){this.value={...this.value,sensitivity:5,adsSensitivity:.5,invertY:false,aimMode:'hold',bindings:defaults().bindings};this.changed();}
 actions(token){return ACTIONS.filter(([action])=>this.value.bindings[action].includes(token)).map(([action])=>action);}
 held(action,tokens){return this.value.bindings[action].some(token=>token&&tokens.has(token));}
 mouseActions(button){return this.actions('Mouse'+button);}
}
export class GameInput {
 constructor(settings,action,releaseAction=()=>{}){this.settings=settings;this.action=action;this.releaseAction=releaseAction;this.reset();}
 reset(){this.tokens=new Set();this.toggledAim=false;}
 press(token,repeat=false){const already=this.tokens.has(token);this.tokens.add(token);if(repeat||already)return;
  for(const action of this.settings.actions(token)){
   if(action==='aimToggle'||action==='aim'&&this.settings.value.aimMode==='toggle')this.toggledAim=!this.toggledAim;
   else if(['crouch','prone','reload','melee','use','grenade','nextWeapon','pause','lookLeft','lookRight','lookUp','lookDown'].includes(action)||action==='fire'&&!token.startsWith('Mouse'))this.action(action);
  }
 }
 release(token){const grenadeHeld=this.settings.held('grenade',this.tokens);this.tokens.delete(token);if(grenadeHeld&&!this.settings.held('grenade',this.tokens))this.releaseAction('grenade');}
 get aiming(){return this.toggledAim||this.settings.value.aimMode==='hold'&&this.settings.held('aim',this.tokens);}
 input(mouseFire=false){const held=a=>this.settings.held(a,this.tokens);return {forward:Number(held('forward'))-Number(held('backward')),side:Number(held('right'))-Number(held('left')),sprint:held('sprint'),jump:held('jump'),use:held('use'),fire:mouseFire||this.settings.value.bindings.fire.some(t=>t&&!t.startsWith('Mouse')&&this.tokens.has(t))};}
}
