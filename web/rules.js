// Algorithms recovered from maps/_zombiemode.gsc, for one local player.
// round_spawning(): zombie_max_ai plus a per-player bonus scaled by round/5
// (from round 10 also by round*0.15), then cut for rounds 1-4. Nacht's script
// adds (players-1)*zombie_ai_per_player, i.e. nothing solo, so it stays at 24;
// Der Riese adds 0.5*zombie_ai_per_player for a solo player.
export function roundCount(round, maxAI = 24, perPlayer = 6, soloFactor = 0) {
  let multiplier = Math.max(1, round / 5);
  if(round >= 10) multiplier *= round * .15;
  const max = maxAI + Math.trunc(soloFactor * perPlayer * multiplier + 1e-9);
  return Math.trunc(max * (round===1 ? .2 : round<3 ? .4 : round<4 ? .6 : round<5 ? .8 : 1) + 1e-9);
}
export function nextHealth(previous, round, vars) {
  if(round>=10)return previous+Math.trunc(previous*vars.zombie_health_increase_percent);
  return round>1 ? Math.trunc(previous+vars.zombie_health_increase) : previous;
}
export function spawnDelay(round, initial=3) {
  let value=initial;
  for(let i=1;i<round;i++)value=Math.max(.08,value)*.95;
  return value;
}
