// The original end of a game (_zombiemode.gsc / _zm.gsc end_game()):
// player_fake_death() drops the downed player to the ground without weapons;
// "GAME OVER" and "You Survived N Rounds" fade in over 1 s with the
// game-over music; 3 s later intermission() tours the map's intermission
// cameras for zombie_intermission_time (15 s) while the zombies left
// standing lose their heads one by one (zombie_game_over_death); then
// player_exit_level() fades to black and the game ends 1.5 s later.
import * as THREE from 'three';

const INTERMISSION_AT=3,INTERMISSION_TIME=15,EXIT_FADE=1,EXIT_WAIT=1.5,DROP_TIME=.8,PRONE_EYE=11;
const vec=s=>String(s||'0 0 0').trim().split(/\s+/).map(Number);

// MoveTo / RotateTo with acceleration and deceleration times: the fraction
// of the way travelled after t of `time` seconds.
function travelled(t,time,accel,decel){
  if(time<=0)return 1;t=Math.max(0,Math.min(time,t));
  const peak=1/(time-accel/2-decel/2);
  if(t<accel)return peak*t*t/(2*accel);
  if(t<=time-decel)return peak*(accel/2+(t-accel));
  const left=time-t;return 1-peak*left*left/(2*decel);
}

export class GameOverSequence {
  constructor({entities,game='waw',root=document.body}){
    this.kind=game;
    // getstructarray("intermission"), else the info_intermission entities.
    const structs=entities.filter(e=>e.targetname==='intermission');
    this.points=(structs.length?structs:entities.filter(e=>e.classname==='info_intermission')).map(e=>{
      const target=e.target&&entities.find(x=>x.targetname===e.target);
      return {origin:vec(e.origin),angles:vec(e.angles),speed:Number(e.speed)||20,target:target?{origin:vec(target.origin),angles:vec(target.angles)}:null};
    });
    this.element=document.createElement('div');this.element.id='game-over';this.element.setAttribute('aria-live','polite');
    this.element.innerHTML='<div class="game-over-black"></div><div class="game-over-text"><div class="game-over-title">GAME OVER</div><div class="game-over-rounds"></div></div>';
    root.append(this.element);this.black=this.element.querySelector('.game-over-black');this.text=this.element.querySelector('.game-over-text');
    this.element.classList.toggle('black-ops',game!=='waw');
    this.active=false;
  }
  start({round,eye,yaw,pitch,eyeAbove=60}){
    this.active=true;this.eyeAbove=eyeAbove;this.done=false;this.time=0;this.eye=eye.slice();this.yaw=yaw;this.pitch=pitch;this.shot=null;this.queue=[];this.gibDue=INTERMISSION_AT+.5+Math.random()*2;
    this.element.querySelector('.game-over-rounds').textContent=round<2?'You Survived 1 Round':`You Survived ${round} Rounds`;
    this.element.classList.add('active');this.black.style.opacity='0';this.text.style.opacity='0';
  }
  stop(){this.active=false;this.element.classList.remove('active');}
  // Advances the sequence; returns the events that fall in this step.
  update(dt){
    if(!this.active)return [];
    const before=this.time,after=this.time+=dt,events=[];const crossed=at=>before<at&&after>=at;
    if(before===0)events.push('start');
    if(crossed(1))events.push('music');
    if(crossed(INTERMISSION_AT))events.push('intermission');
    if(after>=this.gibDue&&after<INTERMISSION_AT+INTERMISSION_TIME){events.push('gib');this.gibDue=after+.5+Math.random()*2;}
    if(crossed(INTERMISSION_AT+INTERMISSION_TIME))events.push('exit');
    if(crossed(INTERMISSION_AT+INTERMISSION_TIME+EXIT_WAIT)){events.push('end');this.done=true;}
    // GAME OVER and the rounds fade in over 1 s; Black Ops fades them out
    // with the screen at the end.
    const exit=after-(INTERMISSION_AT+INTERMISSION_TIME);
    this.text.style.opacity=String(Math.min(1,after)*(this.kind!=='waw'&&exit>0?Math.max(0,1-exit/EXIT_FADE):1));
    this.black.style.opacity=String(this.blackness(after));
    return events;
  }
  blackness(t){
    if(t<INTERMISSION_AT)return 0;
    const exit=t-(INTERMISSION_AT+INTERMISSION_TIME);if(exit>=0)return Math.max(this.shotBlack(t),Math.min(1,exit/EXIT_FADE));
    return this.shotBlack(t);
  }
  // player_intermission(): randomized intermission cameras; each moving one
  // glides to its target at its speed (default 20), easing and fading for a
  // quarter of the move (at most 1 s); a still one shows for 5 s.
  nextShot(t){
    if(!this.queue.length)this.queue=this.points.slice().sort(()=>Math.random()-.5);
    const point=this.queue.shift();if(!point)return null;
    if(point.target){const time=Math.hypot(...point.target.origin.map((v,k)=>v-point.origin[k]))/point.speed,q=Math.min(1,time*.25);return {point,start:t,time,q,length:time};}
    return {point,start:t,time:0,q:1,length:7};
  }
  shotAt(t){
    if(t<INTERMISSION_AT||!this.points.length)return null;
    while(!this.shot||t>=this.shot.start+this.shot.length){const next=this.nextShot(this.shot?this.shot.start+this.shot.length:INTERMISSION_AT);if(!next)return null;this.shot=next;}
    return this.shot;
  }
  shotBlack(t){
    const s=this.shotAt(t);if(!s)return 1;const local=t-s.start;
    if(s.point.target)return local<s.q?1-local/s.q:local>s.time-s.q?(local-(s.time-s.q))/s.q:0;
    return local<1?1-local:local<6?0:Math.min(1,local-6);
  }
  // Poses the camera: on the ground after the fall, then the intermission shots.
  pose(camera){
    if(!this.active)return false;const t=this.time;camera.up.set(0,0,1);
    if(t<INTERMISSION_AT){
      const f=Math.min(1,t/DROP_TIME),ease=1-(1-f)*(1-f),floor=this.eye[2]-this.eyeHeight();
      camera.position.set(this.eye[0],this.eye[1],this.eye[2]+(floor+PRONE_EYE-this.eye[2])*ease);
      const pitch=this.pitch*(1-ease)+.12*ease;
      camera.lookAt(camera.position.clone().add(new THREE.Vector3(Math.cos(this.yaw)*Math.cos(pitch),Math.sin(this.yaw)*Math.cos(pitch),Math.sin(pitch))));camera.rotateZ(-.18*ease);
      return true;
    }
    const s=this.shotAt(t);if(!s)return true;const p=s.point;
    let origin=p.origin,angles=p.angles;
    if(p.target){
      const f=travelled(t-s.start,s.time,s.q,s.q);origin=p.origin.map((v,k)=>v+(p.target.origin[k]-v)*f);
      // Black Ops turns the camera to the target's angles as it moves.
      if(this.kind!=='waw')angles=p.angles.map((v,k)=>v+(((p.target.angles[k]-v+540)%360)-180)*f);
    }
    camera.position.set(...origin);
    const yaw=THREE.MathUtils.degToRad(angles[1]),pitch=-THREE.MathUtils.degToRad(angles[0]);
    camera.lookAt(camera.position.clone().add(new THREE.Vector3(Math.cos(yaw)*Math.cos(pitch),Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch))));
    if(angles[2])camera.rotateZ(-THREE.MathUtils.degToRad(angles[2]));
    return true;
  }
  eyeHeight(){return this.eyeAbove??60;}
}
