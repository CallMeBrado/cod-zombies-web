// maps/_zombiemode_score.gsc::score_highlight: move for .5 seconds,
// fade during the final .25, yellow gains and dark red deductions.
export const SCORE_POPUP_SECONDS=.5;
export function scorePopupState(popup,time) {
  const age=time-popup.started;
  if(age<0||age>=SCORE_POPUP_SECONDS)return null;
  const t=age/SCORE_POPUP_SECONDS;
  return {text:popup.amount>0?'+'+popup.amount:String(popup.amount),
    color:popup.amount>0?'#e6e600':'#6c0100',
    x:popup.moveX*t,y:popup.moveY*t,alpha:age<=.25?1:(.5-age)/.25};
}
