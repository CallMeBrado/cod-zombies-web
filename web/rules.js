// Algorithms recovered from maps/_zombiemode.gsc, for one local player.
export function roundCount(round, maxAI = 24) {
  return Math.trunc(maxAI * (round===1 ? .2 : round<3 ? .4 : round<4 ? .6 : round<5 ? .8 : 1));
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
