import {PAD_ACTIONS,padKey,padButtonLabel,controllerFamily} from './gamepad.js';
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
const $=id=>document.getElementById(id);
export function buttonGlyph(token,style='generic'){
  const label=padButtonLabel(token,style),node=el('span','pad-glyph');node.setAttribute('aria-label',label);node.dataset.label=label;
  const index=token?.startsWith('Button')?Number(token.slice(6)):-1,face=index>=0&&index<4;
  node.classList.toggle('pad-face',face);node.classList.toggle('pad-stick',index===10||index===11);
  if(style==='playstation'&&face){
    const paths=['<path d="M7 7L21 21M21 7L7 21"/>','<circle cx="14" cy="14" r="9"/>','<rect x="6" y="6" width="16" height="16"/>','<path d="M14 4L25 23H3Z"/>'];
    node.innerHTML='<svg viewBox="0 0 28 28" aria-hidden="true">'+paths[index]+'</svg>';node.style.setProperty('--button-color',['#93b5ee','#ef8b89','#e6a2c9','#81d9bf'][index]);
  }else{
    node.textContent=label==='MENU'||label==='OPTIONS'?'≡':label;node.style.setProperty('--button-color',face&&style==='xbox'?['#84cf72','#e88885','#89b7e9','#e0c979'][index]:'#ddd');
  }return node;
}
const hint=(token,style,label)=>{const n=el('span','pad-action');n.append(buttonGlyph(token,style),el('span','pad-action-label',label));return n;};

export class ControllerPanel {
  constructor(settings,pads,menu){
    this.settings=settings;this.pads=pads;this.menu=menu;this.capture=null;this.rows=new Map();this.controls=new Map();this.selectedKey=null;this.axisSignature=null;
    const container=$('controller-settings');
    for(const [key,label,type,min,max,step]of [
      ['enabled','Enable controller','checkbox'],['sensitivity','Look sensitivity','range',1,10,.5],['adsSensitivity','Aim sensitivity','range',.1,1.5,.05],['moveDeadzone','Movement deadzone','range',.02,.45,.01],['lookDeadzone','Look deadzone','range',.02,.45,.01],['invertY','Invert controller look','checkbox'],['aimMode','Aim down sight','select'],['promptStyle','Button icons','select']]){
      const row=el('label','setting-row'),title=el('span',null,label),input=el('input');title.dataset.menuText='';row.append(title);
      let control=input;if(type==='select'){control=el('select');for(const [value,text]of key==='aimMode'?[['hold','Hold'],['toggle','Toggle']]:[['auto','Auto detect'],['xbox','Xbox / Backbone'],['playstation','PlayStation'],['nintendo','Nintendo'],['generic','Generic button numbers']]){const option=el('option',null,text);option.value=value;control.append(option);}}
      else{control.type=type;if(type==='range'){control.min=min;control.max=max;control.step=step;}}
      control.id='pad-'+key;row.append(control);const output=el('output');if(type==='range'){output.htmlFor=control.id;row.append(output);}
      control.addEventListener(type==='range'?'input':'change',()=>settings.update(key,type==='checkbox'?control.checked:type==='range'?Number(control.value):control.value));this.controls.set(key,{control,output,type});container.append(row);
    }
    const deviceRow=el('label','setting-row');deviceRow.append(el('span',null,'Controller'));this.device=el('select');this.device.setAttribute('aria-label','Controller to configure');deviceRow.append(this.device);container.append(deviceRow);this.device.onchange=()=>{this.capture=null;this.selectedKey=this.device.value;this.axisSignature=null;this.sync();};
    container.append(el('h3',null,'BUTTON MAPPING'));
    for(const [action,label]of PAD_ACTIONS){const row=el('div','pad-binding-row'),button=el('button','pad-binding');button.type='button';row.append(el('span',null,label),button);button.onclick=()=>this.capture?.action===action?this.cancel():this.startCapture(action);this.rows.set(action,button);container.append(row);}
    container.append(el('h3',null,'STICK MAPPING'));this.axes=new Map();
    for(const [action,label]of [['moveX','Move left / right'],['moveY','Move up / down'],['lookX','Look left / right'],['lookY','Look up / down']]){const row=el('label','setting-row'),select=el('select');select.setAttribute('aria-label',label);row.append(el('span',null,label),select);select.onchange=()=>{if(this.pad)this.settings.setAxis(this.pad,action,select.value||null);};this.axes.set(action,select);container.append(row);}
    const actions=el('div','pad-mapping-actions');this.apply=el('button','small-action','USE THIS MAPPING');this.apply.type='button';this.apply.onclick=()=>{if(this.pad){settings.configure(this.pad,{ready:true});this.status('Mapping saved.');}};this.reset=el('button','small-action','RESET MAPPING');this.reset.type='button';this.reset.onclick=()=>{if(this.pad){settings.reset(this.pad);this.status('Default mapping restored.');}};actions.append(this.apply,this.reset);container.append(actions);
    this.help=el('p','settings-help','Press a controller button to detect it. Select a binding and press a button or trigger. Select the binding again or press Esc to cancel; Backspace clears. For an unmapped controller, set its buttons/sticks, release all controls, then choose USE THIS MAPPING.');container.append(this.help);
    document.addEventListener('keydown',e=>{if(!this.capturing)return;e.preventDefault();e.stopImmediatePropagation();if(e.repeat)return;if(e.code==='Escape')this.cancel();else if(['Backspace','Delete'].includes(e.code))this.finish(null,this.pad);},true);
    settings.subscribe(()=>this.sync());this.sync();
  }
  get pad(){return this.pads.devices.find(p=>padKey(p)===this.selectedKey)||this.pads.current;}
  get capturing(){if(this.capture&&(this.menu.view!=='options'||this.menu.activeTab!=='controller'))this.cancel();return !!this.capture;}
  style(pad){return this.settings.value.promptStyle!=='auto'?this.settings.value.promptStyle:pad.mapping==='standard'?controllerFamily(pad.id):'generic';}
  status(text){$('controller-status').textContent=text;}
  startCapture(action){if(!this.pad)return;this.capture={action,key:padKey(this.pad)};this.sync();this.status('Press a controller button or trigger. Esc cancels; Backspace clears.');}
  cancel(){this.capture=null;this.sync();}
  finish(token,pad){if(!this.capture||!pad||padKey(pad)!==this.capture.key)return;const action=this.capture.action;this.capture=null;this.settings.bind(pad,action,token);this.sync();this.rows.get(action).focus();}
  sync(){
    if(this.capture&&(this.menu.view!=='options'||this.menu.activeTab!=='controller'))this.capture=null;
    const v=this.settings.value;for(const [key,{control,output,type}]of this.controls){if(type==='checkbox')control.checked=v[key];else control.value=v[key];if(type==='range')output.textContent=/Deadzone/.test(key)?Math.round(v[key]*100)+'%':key==='adsSensitivity'?v[key].toFixed(2)+'×':v[key];}
    const signature=this.pads.devices.map(p=>p.index+':'+padKey(p)).join('|');if(signature!==this.deviceSignature){this.deviceSignature=signature;this.device.replaceChildren();for(const pad of this.pads.devices){const option=el('option',null,String(pad.id||'Controller').slice(0,100));option.value=padKey(pad);this.device.append(option);}}
    const pad=this.pad;this.device.disabled=!pad;if(pad){this.selectedKey=padKey(pad);this.device.value=this.selectedKey;}
    if(this.capture&&!this.pads.devices.some(p=>padKey(p)===this.capture.key))this.capture=null;
    if(!this.capture){if(!this.pads.supported)this.status(globalThis.isSecureContext===false?'Controller detection needs HTTPS or localhost. Open the secure site to use a controller.':'This browser does not expose controllers.');else if(this.pads.error)this.status('Controller access is blocked. Open the site in a supported browser tab.');else if(!pad)this.status('Connect a controller and press a button to detect it.');else this.status(String(pad.id||'Controller').slice(0,100)+' · '+(this.settings.mapping(pad).ready?'Ready':'Unmapped: configure controls below')+(this.settings.saved===false?' · Settings could not be saved.':''));}
    const mapping=pad?this.settings.mapping(pad):null;for(const [action,button]of this.rows){button.disabled=!pad;const capturing=this.capture?.action===action;button.classList.toggle('capturing',capturing);button.replaceChildren(capturing?el('span',null,'PRESS A BUTTON'):pad?buttonGlyph(mapping.bindings[action],this.style(pad)):el('span',null,'NOT CONNECTED'));button.setAttribute('aria-label',PAD_ACTIONS.find(([a])=>a===action)[1]+', '+(pad?padButtonLabel(mapping.bindings[action],this.style(pad)):'not connected'));}
    const axisSignature=pad?padKey(pad)+':'+pad.axes.length:'none';if(axisSignature!==this.axisSignature){this.axisSignature=axisSignature;for(const select of this.axes.values()){select.replaceChildren(el('option',null,'None'));select.options[0].value='';for(let i=0;i<Math.min(16,pad?.axes.length||0);i++)for(const sign of ['+','-']){const option=el('option',null,'Axis '+(i+1)+(sign==='-'?' (inverted)':''));option.value='Axis'+i+sign;select.append(option);}}}
    for(const [action,select]of this.axes){select.disabled=!pad;select.value=mapping?.axes[action]||'';}this.apply.disabled=!pad;this.reset.disabled=!pad;this.menu.text?.paint();
  }
}

export class ControllerMenu {
  constructor(menu,{mode,launch,notice=()=>{}}){Object.assign(this,{menu,mode,launch,notice});}
  elements(){const root=this.mode()==='loading'?this.launch.root:$('overlay');return [...(root?.querySelectorAll('button,a[href],input:not([type=hidden]),select')||[])].filter(n=>!n.disabled&&n.getClientRects().length>0);}
  move(direction){
    const list=this.elements();if(!list.length)return;let current=document.activeElement,index=list.indexOf(current);
    if(['left','right'].includes(direction)&&index>=0){const step=direction==='right'?1:-1;
      if(current.type==='range'||current.type==='number'){const value=Number(current.value)+step*Number(current.step||1),min=current.min===''?-Infinity:Number(current.min),max=current.max===''?Infinity:Number(current.max);current.value=Math.max(min,Math.min(max,value));current.dispatchEvent(new Event('input',{bubbles:true}));return;}
      if(current.tagName==='SELECT'){current.selectedIndex=Math.max(0,Math.min(current.options.length-1,current.selectedIndex+step));current.dispatchEvent(new Event('change',{bubbles:true}));return;}
      if(current.getAttribute('role')==='tab'){this.tab(step);return;}
    }
    index=index<0?0:(index+(direction==='up'||direction==='left'?-1:1)+list.length)%list.length;list[index].focus();list[index].scrollIntoView?.({block:'nearest'});
  }
  tab(delta){if(this.menu.view!=='options')return;const tabs=this.menu.tabs,index=tabs.indexOf(this.menu.activeTab),tab=tabs[(index+delta+tabs.length)%tabs.length];this.menu.selectTab(tab);$('tab-'+tab).focus();}
  handle(action){
    if(this.mode()==='starting')return;
    if(action==='previousTab'||action==='nextTab'){this.tab(action==='nextTab'?1:-1);return;}
    if(['up','down','left','right'].includes(action)){this.move(action);return;}
    if(this.mode()==='loading'){
      if(action==='confirm'){const list=this.elements(),focused=document.activeElement,target=list.includes(focused)?focused:list.find(n=>n===this.launch.element('skip'))||list[0];target?.click();}
      else if(action==='pause'){const skip=this.launch.element('skip');if(!skip.disabled)skip.click();}
      else if(action==='back'){const back=this.launch.element('back');if(back&&!back.hidden&&!back.disabled)back.click();}return;
    }
    if(action==='pause'){if(this.menu.context==='pause'){this.menu.show('home');this.menu.callbacks.resume();}return;}
    if(action==='back'){this.menu.back();return;}
    if(action==='confirm'){
      const list=this.elements();let target=document.activeElement;if(!list.includes(target))target=list.find(n=>n.id==='play')||list[0];if(!target)return;
      if(target.id==='play'&&this.menu.context!=='pause'&&globalThis.navigator?.userActivation&&!navigator.userActivation.hasBeenActive){this.notice('Click START GAME once to enable browser audio, then use your controller.');target.focus();return;}
      target.focus();if(target.tagName==='SELECT'){this.move('right');return;}if(target.type==='range'||target.type==='number'){this.move('right');return;}target.click();
    }
  }
}

export class ControllerHud {
  constructor(pads){
    this.pads=pads;this.root=el('div','controller-hud');this.root.id='controller-hud';this.root.hidden=true;this.root.setAttribute('aria-label','Controller controls');
    this.context=el('div','controller-context');this.reload=el('div','controller-reload');this.legend=el('div','controller-legend');this.root.append(this.context,this.reload,this.legend);document.body.append(this.root);
    this.menuHint=el('span','controller-menu-hint');this.menuHint.hidden=true;document.body.append(this.menuHint);this.lastStyle=null;this.lastPrompt=null;this.lastReload=null;
  }
  sync(){
    const active=this.pads.active;this.menuHint.hidden=!active;const original=document.querySelector('.menu-hint');if(original)original.hidden=active;document.body.dataset.controllerActive=String(active);
    const key=this.pads.style+':'+JSON.stringify(this.pads.current?this.pads.settings.mapping(this.pads.current).bindings:null);if(key===this.lastStyle)return;this.lastStyle=key;this.lastPrompt=null;this.lastReload=null;this.legend.replaceChildren();this.menuHint.replaceChildren();if(!this.pads.current)return;
    for(const [action,label]of [['aim','Aim'],['fire','Fire'],['interact','Reload / use'],['jump','Stand / jump'],['stance','Crouch / prone'],['nextWeapon','Swap'],['grenade','Grenade'],['melee','Knife'],['sprint','Sprint'],['pause','Pause']]){const item=hint(this.pads.token(action),this.pads.style,label);this.legend.append(item);if(action==='stance')this.stanceLabel=item.querySelector('.pad-action-label');}
    for(const [action,label]of [['confirm','SELECT'],['back','BACK'],['pause','RESUME']])this.menuHint.append(hint(this.pads.token(action),this.pads.style,label));
  }
  update(game,playing){
    const wasHidden=this.root.hidden;this.root.hidden=!this.pads.active||!playing||!game;this.menuHint.hidden=!this.pads.active||playing||document.getElementById('launch-screen')?.hidden===false;if(this.menuHint.lastChild)this.menuHint.lastChild.hidden=document.body.dataset.menuContext!=='pause';if(this.root.hidden)return;
    const now=performance.now();if(!wasHidden&&now<this.promptDue)return;this.promptDue=now+50;
    if(this.stanceLabel)this.stanceLabel.textContent=game.data.game==='black-ops'&&game.sprinting?'Hold: dive':'Crouch / prone';
    const prompt=game.prompt(),label=this.pads.label('use');if(prompt!==this.lastPrompt){this.lastPrompt=prompt;this.context.replaceChildren();const at=label?prompt.indexOf(label):-1;if(at>=0){if(at)this.context.append(el('span',null,prompt.slice(0,at).trim()));this.context.append(buttonGlyph(this.pads.token('interact'),this.pads.style),el('span',null,prompt.slice(at+label.length).replace(/^\s*·\s*/,'')));}else this.context.textContent=prompt;this.context.hidden=!prompt;}
    const reload=game.reloadEnd?'RELOADING':game.weapon.clip===0?'RELOAD':'';if(reload!==this.lastReload){this.lastReload=reload;this.reload.replaceChildren();if(reload==='RELOAD')this.reload.append(buttonGlyph(this.pads.token('interact'),this.pads.style));this.reload.append(el('span',null,reload));this.reload.hidden=!reload;}
  }
}
