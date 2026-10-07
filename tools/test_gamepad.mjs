import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {GamepadSettings,GamepadControls,normalizePadSettings,controllerFamily,padButtonLabel,radialStick,padKey} from '../web/gamepad.js';
import {ControllerMenu,ControllerPanel,buttonGlyph} from '../web/gamepad-ui.js';
import {SoloGame} from '../web/game.js';
import {BlackOpsEngine} from '../web/bo1-engine.js';
import {CollisionWorld} from '../web/collision.js';
import {MAPS,BO1_MAPS} from '../web/maps.js';
import {navigationStamp} from './navigation_stamp.mjs';

const close=(a,b,message)=>assert(Math.abs(a-b)<1e-8,message||`${a} != ${b}`);
const device=(id='Xbox Wireless Controller',index=0,mapping='standard')=>({id,index,mapping,connected:true,buttons:Array.from({length:18},()=>({value:0,pressed:false})),axes:[0,0,0,0]});
const button=(pad,index,value)=>{pad.buttons[index]={value,pressed:value>.5};};
const harness=(options={})=>{
  const pad=options.pad||device(),settings=new GamepadSettings(options.storage);let mode=options.mode||'playing',focused=true,capturing=false,pads=[null,pad],ads=0;
  const actions=[],releases=[],menus=[],looks=[],owners=[],captures=[];let disconnected=0;
  const input=new GamepadControls(settings,{getGamepads:()=>pads,supported:true,mode:()=>mode,focused:()=>focused,aimBlend:()=>ads,
    action:a=>{actions.push(a);options.action?.(a);if(a==='pause'){mode='menu';input.suppressHeld();}},release:a=>releases.push(a),look:(...v)=>looks.push(v),
    menu:a=>{menus.push(a);if(a==='pause'){mode='playing';input.suppressHeld();}},changed:o=>owners.push(o),capture:()=>capturing,rawCapture:(token,p)=>captures.push([token,p.id]),disconnect:()=>{disconnected++;mode='menu';}});
  const poll=(dt=1/60)=>input.poll(dt);poll();
  return {pad,settings,input,actions,releases,menus,looks,owners,captures,poll,press:i=>{button(pad,i,1);poll();},release:i=>{button(pad,i,0);poll();},mode:m=>mode=m,focus:f=>focused=f,ads:v=>ads=v,capture:v=>capturing=v,devices:p=>pads=p,get disconnected(){return disconnected;}};
};

// Family detection uses USB vendor IDs as well as readable device names.
for(const [id,family]of [['Xbox Wireless Controller','xbox'],['045e-028e-XInput','xbox'],['DualSense Wireless Controller','playstation'],['054c-05c4-Wireless Controller','playstation'],['Backbone One','xbox'],['Backbone One PlayStation Edition','playstation'],['Nintendo Switch Pro Controller','nintendo'],['057e-2009-Pro Controller','nintendo'],['USB Gamepad','generic']])assert.equal(controllerFamily(id),family);
assert.equal(padButtonLabel('Button0','xbox'),'A');assert.equal(padButtonLabel('Button2','playstation'),'SQUARE');assert.equal(padButtonLabel('Button7','playstation'),'R2');assert.equal(padButtonLabel('Button0','nintendo'),'B');assert.equal(padButtonLabel('Button4','generic'),'B5');assert.equal(padButtonLabel('Axis4-'),'AXIS 5-');
assert.deepEqual(radialStick(.1,-.1,.16),{x:0,y:0,magnitude:0});close(radialStick(1,1,.16).magnitude,1);
let normalized=normalizePadSettings({version:1,sensitivity:99,moveDeadzone:-5,invertY:'yes',promptStyle:'bad',mappings:{'__proto__':{},'pad:test':{ready:true,bindings:{fire:'<script>'},rest:[Infinity,5]}}});assert.equal(normalized.sensitivity,10);assert.equal(normalized.moveDeadzone,.02);assert.equal(normalized.invertY,false);assert.equal(normalized.promptStyle,'auto');assert.equal(normalized.mappings['pad:test'].bindings.fire,null);assert.deepEqual(normalized.mappings['pad:test'].rest,[0,1]);
const store=new Map(),storage={getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)},persisted=new GamepadSettings(storage),p=device();persisted.update('invertY',true);persisted.bind(p,'melee','Button2');assert.equal(persisted.mapping(p).bindings.interact,null,'Conflicting gameplay buttons are cleared');assert.equal(persisted.mapping(p).bindings.melee,'Button2');persisted.bind(p,'jump','Button0');assert.equal(persisted.mapping(p).bindings.confirm,'Button0','Gameplay jump and menu select may share a button');assert.equal(new GamepadSettings(storage).value.invertY,true);assert.equal(new GamepadSettings(storage).mapping(p).bindings.melee,'Button2');
const blocked=new GamepadSettings({getItem:()=>{throw new Error('denied');},setItem:()=>{throw new Error('denied');}});blocked.update('sensitivity',7);assert.equal(blocked.value.sensitivity,7);assert.equal(blocked.saved,false);

// Aim and fire are independent in both press orders; semi-auto fires once per edge.
for(const order of [[6,7],[7,6]]){const h=harness();h.press(order[0]);h.press(order[1]);assert(h.input.aiming&&h.input.input().fire);assert.equal(h.actions.filter(a=>a==='fire').length,1);for(let i=0;i<30;i++)h.poll();assert.equal(h.actions.filter(a=>a==='fire').length,1);h.release(6);assert(!h.input.aiming&&h.input.input().fire);h.release(7);assert(!h.input.input().fire);h.press(7);assert.equal(h.actions.filter(a=>a==='fire').length,2);}
// Trigger hysteresis avoids noisy repeated shots near the threshold.
{const h=harness();for(const v of [.4,.3,.25,.3,.4,.3]){button(h.pad,7,v);h.poll();}assert.equal(h.actions.length,1);button(h.pad,7,.1);h.poll();button(h.pad,7,.4);h.poll();assert.equal(h.actions.length,2);}

for(const hz of [30,60,120,240]){
  const h=harness();h.pad.axes[1]=-.58;h.pad.axes[2]=1;let yaw=0;for(let i=0;i<hz;i++)h.poll(1/hz);for(const v of h.looks)yaw+=v[0];close(h.input.input().forward,.5);close(h.input.input().movementScale,.5);close(yaw,-3.25,'Look rotation is independent of render FPS');
  h.looks.length=0;h.ads(1);for(let i=0;i<hz;i++)h.poll(1/hz);close(h.looks.reduce((s,v)=>s+v[0],0),-1.625,'ADS uses its own look sensitivity');
}
{const h=harness();for(let v=0;v<=.3;v+=.01){h.pad.axes[0]=v;h.poll();}assert(h.input.active,'Slow stick motion activates controller input');h.pad.axes=[0,0,0,1];h.settings.update('invertY',true);h.poll();h.pad.axes[3]=0;h.poll();h.pad.axes[3]=1;h.poll();assert(h.looks.at(-1)[1]>0,'Controller Y inversion works');}
{const h=harness();h.settings.update('aimMode','toggle');h.press(6);h.release(6);assert(h.input.aiming);h.press(6);assert(!h.input.aiming);h.release(6);h.pad.axes[1]=-1;h.poll();h.press(10);h.release(10);assert(h.input.input().sprint);h.press(7);assert(!h.input.input().sprint,'Shooting exits sprint');h.release(7);h.press(10);h.release(10);assert(h.input.input().sprint);h.press(6);assert(!h.input.input().sprint,'Aiming exits sprint');}

// Cooking lasts while RB/R1 is held and releases once, including input loss.
for(const stop of ['button','keyboard','disconnect','focus','disabled']){
  const h=harness();h.press(5);for(let i=0;i<100;i++)h.poll(1/240);assert.equal(h.actions.filter(a=>a==='grenade').length,1);assert.equal(h.releases.length,0);assert(h.input.grenadeHeld);
  if(stop==='button')h.release(5);if(stop==='keyboard')h.input.useKeyboard();if(stop==='disconnect')h.devices([]);if(stop==='focus')h.focus(false);if(stop==='disabled')h.settings.update('enabled',false);
  h.poll();h.poll();assert.deepEqual(h.releases,['grenade'],stop+' releases cooked grenade once');assert(!h.input.grenadeHeld);if(stop==='disconnect')assert.equal(h.disconnected,1);
}
{const h=harness();h.press(7);h.input.useKeyboard();h.poll();assert.equal(h.input.owner,'keyboard');assert(!h.input.input().fire);h.release(7);assert.equal(h.input.owner,'keyboard','Old controller releases cannot steal mouse/keyboard input');h.press(7);assert(h.input.active&&h.input.input().fire);}
{const h=harness();h.press(7);h.focus(false);h.poll();assert(!h.input.input().fire);h.focus(true);h.poll();assert(!h.input.input().fire,'A held trigger cannot fire after focus returns');h.release(7);h.press(7);assert(h.input.input().fire);}
{const held=device();button(held,7,1);const h=harness({pad:held});assert(!h.input.input().fire,'Held hot-plug trigger requires release');h.poll();assert.equal(h.actions.length,0);h.release(7);h.press(7);assert(h.input.input().fire);}
{const h=harness(),second=device('DualSense',2);h.devices([h.pad,null,second]);h.poll();h.press(7);button(second,6,1);h.poll();assert.equal(h.input.current.index,2);assert.equal(h.input.style,'playstation');h.release(7);assert.equal(h.input.current.index,2,'A different controller releasing a button cannot steal input');second.connected=false;h.poll();assert.equal(h.disconnected,1);assert.equal(h.input.owner,'keyboard');}

// Menu transitions retain edges: Start resumes once; A/select does not jump.
{const h=harness();h.press(9);assert.deepEqual(h.actions,['pause']);for(let i=0;i<30;i++)h.poll();assert.equal(h.menus.length,0);h.release(9);h.press(9);assert.deepEqual(h.menus,['pause']);for(let i=0;i<30;i++)h.poll();assert.deepEqual(h.actions,['pause']);h.release(9);h.press(9);assert.deepEqual(h.actions,['pause','pause']);}
{const h=harness({mode:'menu'});h.press(0);assert.deepEqual(h.menus,['confirm']);h.mode('playing');h.input.suppressHeld();h.poll();assert(!h.input.input().jump);h.release(0);h.press(0);assert(h.input.input().jump);h.poll();assert(!h.input.input().jump,'Jump is queued once per controller press');}
{const h=harness({mode:'menu'});h.press(13);assert.deepEqual(h.menus,['down']);for(let i=0;i<15;i++)h.poll();assert.equal(h.menus.length,1);for(let i=0;i<20;i++)h.poll();assert(h.menus.length>=3&&h.menus.length<8,'D-pad repeat has a delay and controlled rate');h.release(13);h.press(5);assert.equal(h.menus.at(-1),'nextTab');}

// Nonstandard devices are exposed without guessing a dangerous raw layout.
{const raw=device('USB Gamepad',3,'');raw.axes.push(-1);const h=harness({pad:raw});h.press(7);assert(!h.input.active);assert.equal(h.actions.length,0);h.release(7);h.settings.bind(raw,'fire','Axis4+');assert(!h.settings.mapping(raw).ready);h.settings.configure(raw,{ready:true});h.poll();raw.axes[4]=-.1;h.poll();assert(h.input.input().fire);assert.deepEqual(h.actions,['fire']);raw.axes[4]=-1;h.poll();assert(!h.input.input().fire);h.settings.update('promptStyle','xbox');assert.equal(h.input.style,'xbox');assert.equal(h.input.label('fire'),'AXIS 5+');}
{const h=harness({mode:'menu'});h.capture(true);h.poll();for(let v=0;v<=.7;v+=.05){h.pad.axes[2]=v;h.poll();}assert.equal(h.captures[0][0],'Axis2+','Remapping detects gradual axis motion from a fixed baseline');assert.equal(h.menus.length,0,'Binding capture cannot navigate or start a game');h.capture(false);h.pad.axes[2]=0;h.poll();}

// Exercise navigation and glyph rendering without launching gameplay in a browser.
{const panel=Object.create(ControllerPanel.prototype);panel.menu={view:'options',activeTab:'controller'};panel.capture={action:'fire'};panel.cancel=()=>panel.capture=null;assert(panel.capturing);panel.menu.activeTab='mouse';assert(!panel.capturing,'Leaving the controller tab cannot retain binding capture');panel.menu.activeTab='controller';panel.capture={action:'fire'};panel.menu.view='home';assert(!panel.capturing,'Backing out of options releases the controller for menu navigation');}
const domNode=(id='',tag='BUTTON')=>({id,tagName:tag,type:'button',disabled:false,clicks:0,attributes:{},dataset:{},classList:{toggle(){}},style:{setProperty(){}},setAttribute(k,v){this.attributes[k]=v;},getAttribute(k){return this.attributes[k];},getClientRects(){return [1];},focus(){document.activeElement=this;},click(){this.clicks++;},scrollIntoView(){},dispatchEvent(e){this.lastEvent=e.type;}});
const play=domNode('play'),options=domNode('options'),slider=Object.assign(domNode('sensitivity','INPUT'),{type:'range',value:'5',step:'.5',min:'1',max:'10'}),select=Object.assign(domNode('choice','SELECT'),{options:[{},{}],selectedIndex:0}),tabs={};let list=[play,options];
globalThis.document={activeElement:null,createElement:tag=>domNode('',tag.toUpperCase()),getElementById:id=>id==='overlay'?{querySelectorAll:()=>list}:tabs[id]};
for(const style of ['xbox','playstation','nintendo','generic']){const glyph=buttonGlyph('Button0',style);assert.equal(glyph.attributes['aria-label'],padButtonLabel('Button0',style));if(style==='playstation')assert(glyph.innerHTML.includes('<svg'));else assert.equal(glyph.textContent,padButtonLabel('Button0',style));}
let mode='menu',resumes=0,backs=0;const menu={view:'home',context:'start',tabs:['controls','controller','mouse','audio','video'],activeTab:'controls',selectTab:t=>menu.activeTab=t,show:v=>menu.view=v,back:()=>backs++,callbacks:{resume:()=>{resumes++;mode='playing';}}};for(const t of menu.tabs)tabs['tab-'+t]=domNode('tab-'+t);const skip=Object.assign(domNode('skip'),{disabled:true}),launch={root:{querySelectorAll:()=>[skip]},element:k=>k==='skip'?skip:play},nav=new ControllerMenu(menu,{mode:()=>mode,launch});nav.handle('down');assert.equal(document.activeElement,play);nav.handle('down');assert.equal(document.activeElement,options);nav.handle('confirm');assert.equal(options.clicks,1);nav.handle('back');assert.equal(backs,1);list=[slider,select];slider.focus();nav.handle('right');assert.equal(Number(slider.value),5.5);assert.equal(slider.lastEvent,'input');nav.handle('down');nav.handle('right');assert.equal(select.selectedIndex,1);assert.equal(select.lastEvent,'change');menu.view='options';nav.handle('nextTab');assert.equal(menu.activeTab,'controller');nav.handle('previousTab');assert.equal(menu.activeTab,'controls');menu.context='pause';nav.handle('pause');assert.equal(resumes,1);assert.equal(mode,'playing');mode='loading';nav.handle('confirm');assert.equal(skip.clicks,0,'Controller cannot skip unfinished asset loading');skip.disabled=false;nav.handle('confirm');assert.equal(skip.clicks,1);delete globalThis.document;

// Verify actual movement in both engines, not just the controller's input object.
const read=async p=>JSON.parse(await readFile(new URL('../local-data/'+p,import.meta.url),'utf8'));
const results=[];
for(const map of [...MAPS,...BO1_MAPS].filter(m=>m.engine!=='dead-ops')){
  const manifest=await read(map.data+'/manifest.json'),native=new CollisionWorld(await read(map.zone+'/web-world/'+map.asset+'.collision.json'),manifest.entities),g=new (map.game==='black-ops'?BlackOpsEngine:SoloGame)(manifest,native,await read(map.zone+'/web-world/'+map.asset+'.paths.json'),{},await read(map.data+'/presentation.json'));
  const reset=()=>{g.collision=native;g.newGame();g.start();g.roundDue=Infinity;g.ambientDue=Infinity;g.collision=new CollisionWorld({models:[{brushes:[]}],brushes:[{mins:[-2000,-2000,-128],maxs:[2000,2000,0],contents:1,planes:[]}]},[]);g.player.position=[0,0,0];g.player.previousPosition=[0,0,0];g.player.grounded=true;g.aim(0,0);};
  reset();for(let i=0;i<120;i++)g.update(1/120,{forward:1});const keyboard=g.player.position[0];assert(keyboard>0);
  for(const hz of [30,60,120,240]){reset();const h=harness();h.pad.axes[1]=-.58;for(let i=0;i<hz;i++){h.poll(1/hz);g.update(1/hz,h.input.input());}close(g.player.position[0],keyboard*.5,'Partial stick movement runs at half speed in '+map.id);assert(g.player.grounded);assert(Math.abs(g.player.position[2])<.01);results.push({map:map.id,hz,halfSpeed:Math.round(g.player.position[0]*100)/100});}
  // Jump pulses at 240 FPS survive a frame shorter than the physics timestep.
  reset();const h=harness();h.poll(1/240);h.press(0);g.update(1/240,h.input.input());h.poll(1/240);g.update(1/240,h.input.input());assert(g.player.position[2]>0,'Controller jump is queued for the fixed physics tick');
  const stamp=await navigationStamp(fileURLToPath(new URL('..',import.meta.url)),map,manifest);results.push({map:map.id,navigationStamp:stamp});
}
console.log('Controller checks passed:',JSON.stringify({detection:true,aimAndFire:true,analogMovement:results,fpsIndependentLook:true,grenadeCookingAndInputLoss:true,menuAndPause:true,remapping:true,hotPlugAndFocus:true,glyphs:true}));
