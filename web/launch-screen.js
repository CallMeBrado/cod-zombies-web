// A finished movie cannot start an unprepared map, and Skip never bypasses loading.
export class LaunchGate {
  // A lobby match holds every player on the loading screen until all have loaded.
  constructor(finish){this.finish=finish;this.ready=false;this.mediaDone=false;this.skipped=false;this.finished=false;this.held=false;}
  check(){if(!this.finished&&!this.held&&this.ready&&(this.mediaDone||this.skipped)){this.finished=true;this.finish();}}
  loaded(){this.ready=true;this.check();}
  ended(){this.mediaDone=true;this.check();}
  skip(){if(!this.ready||this.held)return false;this.skipped=true;this.check();return true;}
}

export class LaunchScreen {
  constructor(map,volume){
    this.map=map;this.volume=volume;this.active=false;
    this.root=document.createElement('section');this.root.id='launch-screen';this.root.hidden=true;
    this.root.setAttribute('aria-label',map.title+' loading screen');
    this.root.innerHTML=`<video id="launch-movie" playsinline preload="none"></video>
      <div class="launch-footer"><div class="launch-heading"><strong id="launch-map"></strong><span id="launch-percent"></span></div>
      <progress id="launch-progress" max="100" value="0" aria-label="Map loading progress"></progress>
      <div class="launch-detail"><span id="launch-status" role="status"></span><span id="launch-bytes"></span></div>
      <div class="launch-actions"><button id="launch-play" hidden>PLAY INTRO WITH SOUND</button><button id="launch-skip" disabled>LOADING MAP…</button><button id="launch-back" hidden>BACK TO LOBBY</button></div></div>`;
    document.body.append(this.root);this.movie=this.root.querySelector('video');
    this.element=id=>this.root.querySelector('#launch-'+id);
    this.element('map').textContent=map.title.toUpperCase();
    this.movie.poster='/data/'+(map.game==='black-ops'?map.data:'gameplay')+'/hud/'+map.image+'.png';
    this.movie.addEventListener('ended',()=>{
      // Some original movies fade to black. Keep the original map artwork
      // visible when a slow download outlasts the cinematic.
      if(this.active&&!this.gate?.ready)this.movie.style.opacity='0';
      this.gate?.ended();
    });
    this.movie.addEventListener('error',()=>{if(this.active){this.movie.style.opacity='0';this.gate?.ended();}});
    this.element('skip').onclick=()=>this.gate?.skip();
    this.element('play').onclick=()=>this.play();
    this.element('back').onclick=()=>location.reload();
    document.addEventListener('visibilitychange',()=>this.finishIfVisible());
  }
  play(){
    this.movie.volume=this.volume();this.element('play').hidden=true;
    this.movie.play().catch(error=>{
      if(!this.active)return;
      if(error.name==='NotAllowedError')this.element('play').hidden=false;
      else this.gate.ended();
    });
  }
  begin({hold=false}={}){
    this.active=true;this.root.hidden=false;document.body.classList.add('launching');
    this.element('back').hidden=true;this.element('skip').disabled=true;this.element('skip').textContent='LOADING MAP…';
    this.element('bytes').textContent='';this.update(0,'Loading '+this.map.title+'…');
    this.movie.style.opacity='1';this.root.style.backgroundImage=`url("${this.movie.poster}")`;
    this.movie.src='/data/launch/'+this.map.id+'.mp4?build='+document.documentElement.dataset.build;
    this.gate=new LaunchGate(()=>this.finishIfVisible());this.gate.held=hold;
    const completion=new Promise(resolve=>this.resolve=resolve);
    this.play();return completion;
  }
  finishIfVisible(){
    if(!this.active||!this.gate?.finished||document.hidden)return;
    this.movie.pause();this.active=false;this.root.hidden=true;document.body.classList.remove('launching');this.resolve();
  }
  update(percent,status){
    this.element('progress').value=percent;this.element('percent').textContent=Math.floor(percent)+'%';
    if(status)this.element('status').textContent=status;
  }
  downloaded(info){
    const total=info.totalBytes,loaded=info.loadedBytes;
    const now=performance.now();if(loaded!==total&&now-(this.downloadUpdate||0)<50)return;this.downloadUpdate=now;
    this.update(total?Math.min(70,70*loaded/total):0,'Downloading map assets…');
    this.element('bytes').textContent=total?`${(loaded/1048576).toFixed(1)} / ${(total/1048576).toFixed(1)} MB`:'';
  }
  prepared(completed,status){this.update(70+30*completed/8,status);}
  ready(){
    this.update(100,'Map ready · waiting for the intro to finish');this.element('skip').disabled=false;
    this.element('skip').textContent='SKIP INTRO & START GAME';this.gate.loaded();
  }
  // Lobby match: loaded, waiting for the other players.
  waiting(status){if(!this.gate?.held)return;this.update(100,status);this.element('skip').disabled=true;this.element('skip').textContent='WAITING FOR PLAYERS…';}
  // Everyone has loaded: all players go in together, cutting the intro.
  release(){if(!this.gate)return;this.gate.held=false;this.gate.skipped=true;this.gate.check();}
  fail(error){
    this.gate=null;this.movie.pause();this.element('play').hidden=true;
    this.element('skip').disabled=true;this.element('skip').textContent='LOAD FAILED';
    this.element('status').textContent=error.message;this.element('back').hidden=false;
  }
  diagnostics(){return {active:this.active,ready:!!this.gate?.ready,mediaDone:!!this.gate?.mediaDone,skipped:!!this.gate?.skipped,
    movieTime:this.movie.currentTime,movieDuration:this.movie.duration,muted:this.movie.muted,volume:this.movie.volume,percent:this.element('progress').value};}
}
