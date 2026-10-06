export function contactSurfaceName(hit){
  const name=String(hit?.texture||hit?.material||hit||'').toLowerCase();
  for(const [surface,pattern]of [['wood',/wood|timber|plank|parquet/],['metal',/metal|steel|iron|tin|grate/],['dirt',/dirt|soil|earth|sand/],['gravel',/gravel|rubble|rock/],['grass',/grass|foliage/],['mud',/mud/],['snow',/snow|ice/],['concrete',/concrete|cement|brick|plaster|stone|tile/]])if(pattern.test(name))return surface;
  return 'default';
}

// One-shot identities are suitable for locally predicted or replicated events.
// Only the bounded loop map and last-take indices survive between events.
export class DiveAudio {
  constructor(audio,table={}){this.audio=audio;this.table=table;this.seen=new Set();this.lastTake=new Map();this.loops=new Map();this.counts={launch:0,landing:0,collision:0};}
  alias(prefix,surface='default'){const name=prefix+'_'+surface;return this.audio.sounds[name]?.length?name:prefix+'_default';}
  play(alias,volume,event,local=true){
    const entries=this.audio.sounds[alias];if(!entries?.length)return null;let take=Math.floor(Math.random()*entries.length),last=this.lastTake.get(alias);if(entries.length>1&&take===last)take=(take+1+Math.floor(Math.random()*(entries.length-1)))%entries.length;this.lastTake.set(alias,take);
    return this.audio.play(alias,volume,{variant:take,...(!local?{position:event.position,near:80,far:1400}:{} )});
  }
  handle(event,{local=true}={}){
    const key=(event.playerId??'local')+':'+event.session+':'+event.id,identity=key+':'+event.sequence+':'+event.type;
    if(this.seen.has(identity))return;this.seen.add(identity);if(this.seen.size>256)this.seen.delete(this.seen.values().next().value);
    const c=event.config||{},surface=event.surface||'default',profiles=this.table.profiles||{},character=['dempsey','nikolai','takeo','richtofen'][event.character],profile=(c.voiceProfile==='auto'?profiles[character]:profiles[c.voiceProfile])||profiles.shared||{};
    if(event.type==='launch'){
      this.counts.launch++;this.play(profile[local?'launch':'remoteLaunch']||'chr_launch_exert_'+(local?'plr':'npc'),c.launchMix??.8,event,local);this.play('fly_dtp_launch_plr',c.launchMix??.8,event,local);
    }else if(event.type==='landing'){
      this.counts.landing++;this.play(profile[local?'landing':'remoteLanding']||'chr_land_exert_'+(local?'plr':'npc'),c.landingMix??.85,event,local);this.play(this.alias('fly_dtp_land_plr',surface),c.impactMix??.7,event,local);if(local)this.play('fly_dtp_land_plr_lfe',c.lowImpactMix??.22,event,true);
    }else if(event.type==='collision'){
      this.counts.collision++;this.play('fly_dtp_collide_plr',c.collisionMix??.65,event,local);
    }else if(event.type==='slideStart'||event.type==='slideUpdate'){
      const alias=this.alias('fly_dtp_slide_loop_plr',surface),volume=(c.slideMix??.4)*Math.min(1,(event.speedMps||0)/Math.max(.1,(c.launchSpeedMps||6.5)*(c.touchdownRetention??.7)));let loop=this.loops.get(key);
      if(loop?.alias!==alias){loop?.record?.stop(.04);const record=this.audio.play(alias,volume,{loop:true,...(!local?{position:event.position,near:80,far:1400}:{})});loop={alias,record};this.loops.set(key,loop);}
      loop?.record?.setVolume?.(volume);
    }else if(event.type==='slideStop'||event.type==='movementReady'||event.type==='cancel'){
      this.loops.get(key)?.record?.stop(.04);this.loops.delete(key);if(event.type==='slideStop')this.play(this.alias('fly_dtp_slide_stop_plr',surface),c.slideMix??.4,event,local);
    }
  }
  reset(){for(const loop of this.loops.values())loop.record?.stop(.02);this.loops.clear();this.seen.clear();this.counts={launch:0,landing:0,collision:0};}
  diagnostics(){return {...this.counts,activeSlideLoops:this.loops.size,rememberedEvents:this.seen.size,voiceProfiles:Object.keys(this.table.profiles||{})};}
}
