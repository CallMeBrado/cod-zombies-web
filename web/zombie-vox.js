// Zombie sounds as the originals play them, from each zombie's position.
// - Notetracks: a clip's "sndnt#<alias>" notes play as the zombie's animation
//   crosses them: footsteps and swipes everywhere, and in World at War the
//   vocals too (amb_vocals on walk loops, sprint_vocals, attack_vocals).
// - Der Riese: death_vocals on every death (_zombiemode_spawner.gsc) and
//   behind_vocals from zombies close behind a player (nazi_zombie_factory.gsc).
// - Black Ops (_zombiemode_audio.gsc) and Black Ops II (_zm_audio.gsc):
//   play_ambient_zombie_vocals() voices each zombie on its own loop
//   (ambience walking, sprint running, waiting 1-4 s after each), one voice
//   per zombie; attack, teardown, death and behind vocals always play.
//   Black Ops II plays the "_loud" set for the last zombie, voices only the
//   first zombie behind a player then waits 5 s, and lets at most 5 vocals
//   start per network frame (sndisnetworksafe).

// zmb_vocals_zombie_* distances and voice limits (zmb_buried.all.aliases.csv).
const RANGE={
  ambient:{near:50,far:2250,limit:6},sprint:{near:25,far:1500,limit:3},attack:{near:75,far:500,limit:5},behind:{near:50,far:250,limit:2},
  death:{near:75,far:500,limit:6},crawler:{near:250,far:750,limit:6},taunt:{near:25,far:500,limit:3},teardown:{near:25,far:1000,limit:5},
  spawn:{near:50,far:1000,limit:4},step:{near:40,far:700,limit:8},whoosh:{near:50,far:500,limit:5},fall:{near:50,far:700,limit:4},
};
const NOTE_KIND=alias=>/amb|ambien/.test(alias)?'ambient':/sprint/.test(alias)?'sprint':/attack_vocals|vocals_attack/.test(alias)?'attack':/board|teardown/.test(alias)?'teardown':
  /taunt/.test(alias)?'taunt':/crawl/.test(alias)?'crawler':/death/.test(alias)?'death':/whoosh/.test(alias)?'whoosh':/fall/.test(alias)?'fall':/step|sweetner/.test(alias)?'step':'ambient';
// Barrier board sounds are played by the barrier logic itself.
const SCRIPTED_NOTES=new Set(['remove_boards','zmb_break_boards']);
const HEAD=60;

export const ZOMBIE_VOX={
  nacht:{script:false},
  'der-riese':{script:false,death:'death_vocals',behind:{alias:'behind_vocals',ranges:{walk:200,run:200,sprint:200},height:Infinity,firstOnly:false,cooldown:0}},
  'black-ops':{script:true,prefix:'zmb_vocals_zombie_',behind:{alias:'zmb_vocals_zombie_behind',ranges:{walk:200,run:250,sprint:275},height:50,firstOnly:false,cooldown:0}},
  'black-ops-2':{script:true,prefix:'zmb_vocals_zombie_',loud:true,networkCap:5,spawn:'zmb_zombie_spawn',behind:{alias:'zmb_vocals_zombie_behind',ranges:{walk:200,run:250,sprint:275},height:50,firstOnly:true,cooldown:5}},
};

const speedOf=enemy=>/sprint/.test(enemy.gait||'')?'sprint':/run/.test(enemy.gait||'')?'run':'walk';

export class ZombieVox {
  constructor(audio,config){this.audio=audio;this.config=config;this.reset();}
  reset(){this.voices=new Map();this.behindDue=0;this.behindWait=0;this.frame=-1;this.frameCount=0;}
  has(alias){return !!this.audio?.sounds?.[alias]?.length;}
  play(alias,enemy,kind,time){
    if(!this.has(alias))return null;
    // sndisnetworksafe(): only 5 zombie vocals start per 0.05 s frame.
    if(this.config.networkCap&&kind!=='step'&&kind!=='whoosh'&&kind!=='fall'){const frame=Math.floor(time/.05);if(frame!==this.frame){this.frame=frame;this.frameCount=0;}if(++this.frameCount>this.config.networkCap)return null;}
    const r=RANGE[kind]||RANGE.ambient,p=enemy.position;
    return this.audio.play(alias,1,{position:[p[0],p[1],p[2]+(kind==='step'?4:HEAD)],near:r.near,far:r.far,limit:r.limit});
  }
  // An animation note crossed on a zombie's clip (actors.js).
  note(enemy,alias,time){
    if(SCRIPTED_NOTES.has(alias)||enemy.dead&&!/death|fall/.test(alias))return;
    this.play(alias,enemy,NOTE_KIND(alias),time);
  }
  voice(enemy){let v=this.voices.get(enemy.id);if(!v){v={due:0,talking:0,tear:null};this.voices.set(enemy.id,v);}return v;}
  // do_zombies_playvocals(): attack, teardown, behind and death always play.
  vocal(enemy,type,time){
    const c=this.config;if(!c.script)return;
    const record=this.play(c.prefix+type,enemy,type,time);if(record){const v=this.voice(enemy);v.talking=Math.max(v.talking,time+record.duration);}
  }
  attack(enemy,time){this.vocal(enemy,'attack',time);}
  death(enemy,time){
    const c=this.config;if(c.script)this.vocal(enemy,'death',time);else if(c.death)this.play(c.death,enemy,'death',time);
    this.voices.delete(enemy.id);
  }
  spawn(enemy,time){if(this.config.spawn&&enemy.stage==='rise')this.play(this.config.spawn,enemy,'spawn',time);}
  update(time,game,viewYaw){
    const c=this.config,alive=game.enemies.filter(e=>!e.dead&&e.kind!=='ghost');
    for(const id of this.voices.keys())if(!alive.some(e=>e.id===id))this.voices.delete(id);
    if(c.script){
      const last=c.loud&&alive.length===1&&game.remaining===0;
      for(const enemy of alive){
        const v=this.voice(enemy);
        if(enemy.tear&&enemy.tear.started!==v.tear){v.tear=enemy.tear.started;this.vocal(enemy,'teardown',time);}
        if(!v.due){v.due=time+Math.random();continue;}
        if(time<v.due||time<v.talking)continue;
        // play_ambient_zombie_vocals(): walkers moan, runners and sprinters
        // use the sprint set; then wait 1-4 s after the vocal.
        const type=speedOf(enemy)==='walk'?'ambience':'sprint',kind=type==='ambience'?'ambient':'sprint';
        const alias=c.prefix+type+(last&&this.has(c.prefix+type+'_loud')?'_loud':''),record=this.play(alias,enemy,kind,time);
        const length=record?.duration||0;v.talking=time+length;v.due=time+length+1+Math.random()*3;
      }
    }
    this.behind(time,game,alive,viewYaw);
  }
  // zombie_behind_vox(): every second, zombies near a player and more than
  // 95 degrees off their view play the behind vocal.
  behind(time,game,alive,viewYaw){
    const b=this.config.behind;if(!b||time<this.behindDue||time<this.behindWait)return;this.behindDue=time+1;
    const p=game.player.position;
    for(const enemy of alive){
      if(enemy.stage!=='hunt')continue;
      const dx=enemy.position[0]-p[0],dy=enemy.position[1]-p[1];
      if(Math.hypot(dx,dy)>b.ranges[speedOf(enemy)]||Math.abs(enemy.position[2]-p[2])>b.height)continue;
      const off=Math.atan2(Math.sin(Math.atan2(dy,dx)-viewYaw),Math.cos(Math.atan2(dy,dx)-viewYaw));
      if(Math.abs(off)<=95*Math.PI/180)continue;
      this.play(b.alias,enemy,'behind',time);
      if(b.firstOnly){this.behindWait=time+b.cooldown;break;}
    }
  }
}
