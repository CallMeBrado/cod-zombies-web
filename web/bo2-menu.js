// Black Ops II's zombies menu (ui_zm.ff / T6.Zombie.*): the space backdrop
// (lui_bkg_zm, its sun and flares), the asteroid belts drifting across
// (GameRockZombie), the moon, and the location globe (GameGlobeZombie):
// globe_map_zm drawn on a sphere that turns by itself in the lobby and, in
// map selection, moves to the centre and spins to each location
// (SelectMapZombie, zm/mapstable.csv's longitude and latitude).
const NAMES={zm_transit:'TRANZIT',zm_nuked:'NUKETOWN',zm_highrise:'DIE RISE',zm_prison:'MOB OF THE DEAD',zm_buried:'BURIED',zm_tomb:'ORIGINS'};
const ORDER=['zm_transit','zm_nuked','zm_highrise','zm_prison','zm_buried','zm_tomb'];
const SELF_ROTATION=4; // degrees a second in the lobby
const ease=t=>t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;

const VERTEX='attribute vec2 p;varying vec2 v;void main(){v=p;gl_Position=vec4(p,0.,1.);}';
// The sphere: each pixel's normal, turned by the globe's longitude and tilt,
// samples the equirectangular map; the sun lights it from the upper left and
// an orange haze rims the limb. The magma lines glow on the night side too.
const FRAGMENT=`precision highp float;varying vec2 v;uniform sampler2D map;uniform float lon,lat,aspect,time;
const float PI=3.14159265;
void main(){
  vec2 q=vec2(v.x*aspect,v.y)/.86;float r2=dot(q,q);
  if(r2>1.){float halo=smoothstep(1.13,1.,sqrt(r2));gl_FragColor=vec4(vec3(1.,.42,.12)*halo*halo*.55,halo*halo*.55);return;}
  vec3 n=vec3(q.x,q.y,sqrt(1.-r2));
  float cl=cos(lat),sl=sin(lat);vec3 t=vec3(n.x,n.y*cl+n.z*sl,-n.y*sl+n.z*cl);
  float cy=cos(lon),sy=sin(lon);vec3 w=vec3(t.x*cy+t.z*sy,t.y,-t.x*sy+t.z*cy);
  // globe_map_zm's stylised continents sit about 27 degrees south of true latitude.
  vec2 uv=vec2(atan(w.x,w.z)/(2.*PI)+.5,.5-(asin(clamp(w.y,-1.,1.))-.47)/PI);
  vec3 c=texture2D(map,uv).rgb;
  vec3 L=normalize(vec3(-.55,.55,.62));float lit=max(dot(n,L),0.);
  float glow=max(c.r-c.b*1.4,0.);
  vec3 col=c*(.35+1.1*lit)+vec3(1.,.45,.15)*glow*(.6+.25*sin(time*1.7+uv.x*40.));
  float rim=pow(1.-n.z,3.);col+=vec3(1.,.5,.2)*rim*.55*(.4+lit);
  gl_FragColor=vec4(col,1.);
}`;

export class Bo2Menu {
  constructor(menu,{maps,onChoose,sounds,view=()=>document.body.dataset.menuView,visible}){
    Object.assign(this,{menu,maps,onChoose,sounds,view,visible});
    this.lon=-40;this.lat=-12;this.spin=null;this.mode='home';this.current=null;
    const art=menu.art,root=document.createElement('div');root.id='bo2-backdrop';root.setAttribute('aria-hidden','true');
    const layer=(cls,name)=>{const d=document.createElement('div');d.className='bo2-layer '+cls;if(name&&art[name])d.style.backgroundImage=`url("${art[name]}")`;root.append(d);return d;};
    layer('bo2-space','lui_bkg_zm');layer('bo2-sun','lui_bkg_zm_sun');layer('bo2-rocks bo2-rocks-back','lui_bkg_zm_rocks_back');
    this.canvas=document.createElement('canvas');this.canvas.className='bo2-globe';root.append(this.canvas);
    layer('bo2-moon','lui_bkg_zm_meteor');layer('bo2-rocks bo2-rocks-front','lui_bkg_zm_rocks_front');layer('bo2-rocks bo2-rocks-forward','lui_bkg_zm_rocks_front_forward');
    layer('bo2-flare','lui_bkg_zm_flare');layer('bo2-flare-left','lui_bkg_zm_flare_left');
    // The pins are menu options: they sit in the overlay, above its backing.
    this.pins=document.createElement('div');this.pins.className='bo2-pins';(document.getElementById('overlay')||root).append(this.pins);
    this.places=ORDER.filter(id=>menu.places[id]).map(id=>{
      const place=menu.places[id],playable=maps.find(m=>m.asset===id),pin=document.createElement('button');
      pin.type='button';pin.className='bo2-pin'+(playable?' playable':'');pin.dataset.menuSound='none';pin.dataset.place=id;pin.setAttribute('aria-label',NAMES[id]+(playable?'':' (not available)'));
      const sign=art[place.signpost]?`<img src="${art[place.signpost]}" alt="">`:'';
      pin.innerHTML=`<span class="bo2-pin-marker"></span>${sign}<span class="bo2-pin-name">${NAMES[id]}</span>${playable?'':'<span class="bo2-pin-note">NOT AVAILABLE</span>'}`;
      pin.addEventListener('click',()=>this.pick(id));
      this.pins.append(pin);return {id,lon:-place.longitude,lat:place.latitude,pin,playable};
    });
    // GamepadButton / MapRotationInput: step to the previous or next location.
    const cycle=document.createElement('div');cycle.className='bo2-cycle';
    for(const dir of [-1,1]){const b=document.createElement('button');b.type='button';b.className=dir<0?'bo2-prev':'bo2-next';b.dataset.menuSound='none';b.setAttribute('aria-label',dir<0?'Previous location':'Next location');
      b.innerHTML=`<svg viewBox="0 0 24 48" aria-hidden="true"><polyline points="${dir<0?'18,4 6,24 18,44':'6,4 18,24 6,44'}"/></svg>`;b.addEventListener('click',()=>this.step(dir));cycle.append(b);}
    this.pins.append(cycle);
    addEventListener('keydown',e=>{if(this.mode!=='select'||!this.visible()||e.target.closest?.('input,select,textarea'))return;if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();this.step(e.key==='ArrowLeft'?-1:1);}});
    document.body.prepend(root);this.root=root;
    // SELECT MAP confirms with zmb_ui_map_level_select.
    const accept=document.getElementById('map-accept');if(accept)accept.dataset.menuSound='mapSelect';
    this.initGl(art.globe_map_zm);
    addEventListener('resize',()=>this.resize());this.resize();
    this.last=performance.now();requestAnimationFrame(t=>this.frame(t));
    document.body.classList.add('bo2-menu-ready');
  }
  initGl(url){
    const gl=this.canvas.getContext('webgl',{premultipliedAlpha:false,alpha:true,preserveDrawingBuffer:true});if(!gl)return;this.gl=gl;
    const shader=(type,src)=>{const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);return s;};
    const program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,VERTEX));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,FRAGMENT));gl.linkProgram(program);gl.useProgram(program);this.program=program;
    const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
    const p=gl.getAttribLocation(program,'p');gl.enableVertexAttribArray(p);gl.vertexAttribPointer(p,2,gl.FLOAT,false,0,0);
    this.uniforms=Object.fromEntries(['lon','lat','aspect','time','map'].map(n=>[n,gl.getUniformLocation(program,n)]));
    gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
    const image=new Image();image.onload=()=>{const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);this.texture=t;};
    image.src=url;
  }
  resize(){const r=this.canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio,1.5);this.canvas.width=Math.max(1,Math.round(r.width*dpr));this.canvas.height=Math.max(1,Math.round(r.height*dpr));}
  // SelectMapZombie: picking a location spins the globe to it (the spin
  // sounds and the map switch tick); an unavailable one is denied.
  pick(id){
    const place=this.places.find(p=>p.id===id);if(!place)return;
    if(this.current!==id){this.sounds.play('mapSwitch');this.rotateTo(place);this.current=id;}
    const accept=document.getElementById('map-accept');if(accept)accept.disabled=!place.playable;
    if(!place.playable){this.sounds.play('deny');this.flash(place);return;}
    this.onChoose(place.playable);
  }
  step(dir){const i=this.places.findIndex(p=>p.id===this.current),next=this.places[(Math.max(0,i)+dir+this.places.length)%this.places.length];this.pick(next.id);}
  flash(place){place.pin.classList.remove('denied');void place.pin.offsetWidth;place.pin.classList.add('denied');}
  rotateTo(place,duration=1.4){
    const delta=((place.lon-this.lon)%360+540)%360-180;
    this.spin={fromLon:this.lon,toLon:this.lon+delta,fromLat:this.lat,toLat:Math.max(-50,Math.min(50,place.lat)),start:performance.now(),duration:Math.max(.5,duration*Math.abs(delta)/180+.4)*1000};
    this.sounds.play('spinStart');
  }
  select(mapId){const id=this.maps.find(m=>m.id===mapId)?.asset;const place=this.places.find(p=>p.id===id);if(place&&this.current!==id){this.current=id;this.rotateTo(place);}}
  frame(now){
    requestAnimationFrame(t=>this.frame(t));
    const dt=Math.min(.1,(now-this.last)/1000);this.last=now;
    const shown=this.visible();this.root.classList.toggle('hidden',!shown);this.pins.classList.toggle('hidden',!shown);if(!shown)return;
    // Lobby: the globe drifts round by itself; map selection: centred, still.
    const mode=this.view()==='maps'?'select':'home';
    if(mode!==this.mode){this.mode=mode;document.body.dataset.bo2Globe=mode;this.sounds.play(mode==='select'?'globeMoveIn':'globeMoveOut');
      const accept=document.getElementById('map-accept');if(accept)accept.disabled=false;
      if(mode==='select'){const sel=this.maps.find(m=>m.id===document.querySelector('#map-list [aria-selected=true]')?.dataset.map)||this.maps[0];this.current=null;this.select(sel?.id);}
      requestAnimationFrame(()=>this.resize());}
    if(this.spin){const t=Math.min(1,(now-this.spin.start)/this.spin.duration),k=ease(t);this.lon=this.spin.fromLon+(this.spin.toLon-this.spin.fromLon)*k;this.lat=this.spin.fromLat+(this.spin.toLat-this.spin.fromLat)*k;
      if(t>=1){this.spin=null;this.sounds.play('spinStop');}}
    else if(mode==='home'){this.lon-=SELF_ROTATION*dt;this.lat+=(-12-this.lat)*Math.min(1,dt);}
    this.draw(now/1000);this.placePins();
  }
  draw(time){
    const gl=this.gl;if(!gl||!this.texture)return;const w=this.canvas.width,h=this.canvas.height;gl.viewport(0,0,w,h);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(this.uniforms.lon,this.lon*Math.PI/180);gl.uniform1f(this.uniforms.lat,this.lat*Math.PI/180);gl.uniform1f(this.uniforms.aspect,w/h);gl.uniform1f(this.uniforms.time,time);
    gl.uniform1i(this.uniforms.map,0);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
  }
  // SphereToCartesian: each location's point on the turned globe, shown
  // while it faces the viewer.
  placePins(){
    const r=this.canvas.getBoundingClientRect(),radius=Math.min(r.width,r.height)/2*.86,cx=r.left+r.width/2,cy=r.top+r.height/2,select=this.mode==='select';
    // The location arrows sit either side of the globe.
    const key=`${cx|0},${cy|0},${radius|0}`;if(key!==this.globeKey){this.globeKey=key;const st=document.body.style;st.setProperty('--bo2-globe-x',cx+'px');st.setProperty('--bo2-globe-y',cy+'px');st.setProperty('--bo2-globe-r',radius+'px');}
    const lon=this.lon*Math.PI/180,lat=this.lat*Math.PI/180;
    for(const place of this.places){
      const a=place.lon*Math.PI/180,b=place.lat*Math.PI/180;
      // World point, then the shader's turn inverted (yaw by -lon, tilt by -lat).
      let x=Math.cos(b)*Math.sin(a),y=Math.sin(b),z=Math.cos(b)*Math.cos(a);
      const cosLon=Math.cos(lon),sinLon=Math.sin(lon);[x,z]=[x*cosLon-z*sinLon,x*sinLon+z*cosLon];
      const cl=Math.cos(lat),sl=Math.sin(lat);[y,z]=[y*cl-z*sl,y*sl+z*cl];
      const front=z>.2&&select;place.pin.classList.toggle('shown',front);place.pin.classList.toggle('current',place.id===this.current);
      if(front){place.pin.style.transform=`translate(${cx+x*radius}px,${cy-y*radius}px)`;place.pin.style.opacity=String(Math.min(1,(z-.2)/.25));}
    }
  }
}
