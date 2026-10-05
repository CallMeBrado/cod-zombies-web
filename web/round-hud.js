export const ROUND_RED='#6c0100';
const clamp=value=>Math.max(0,Math.min(1,value));
const color=white=>{
  if(white===0)return ROUND_RED;if(white===1)return '#ffffff';
  return '#'+[108,1,0].map(v=>Math.round(v+(255-v)*white).toString(16).padStart(2,'0')).join('');
};
// _zombiemode.gsc::chalk_round_hint fades to white over a quarter of
// zombie_between_round_time, pulses in .5-second legs, then fades back to
// (0.423, 0.004, 0). Its hint thread continues across the new-round boundary.
// Simulation time keeps both color and opacity frozen while paused.
export function roundIndicatorState(game) {
  let round=game.round||1,alpha=1,white=0;
  if(game.round>0&&(game.phase==='between'||game.round>1)){
    const duration=game.vars?.zombie_between_round_time||10,quarter=duration*.25;
    // The script's loop has ceil(duration) iterations, each containing two
    // half-second fades; its red fade starts after those complete iterations.
    const pulseSeconds=Math.ceil(duration),elapsed=Math.max(0,game.time-game.roundEndedAt);
    if(elapsed<quarter)white=clamp(elapsed/quarter);
    else if(elapsed<quarter+pulseSeconds){
      white=1;const phase=(elapsed-quarter)%1;alpha=phase<.5?1-phase*2:(phase-.5)*2;
    }else white=1-clamp((elapsed-quarter-pulseSeconds)/quarter);
  }
  if(game.round>1&&game.time-game.roundStartedAt<1){
    const elapsed=Math.max(0,game.time-game.roundStartedAt);
    if(elapsed<.5){round--;alpha=1-elapsed*2;}else alpha=(elapsed-.5)*2;
  }
  return {round,alpha,color:color(white)};
}
