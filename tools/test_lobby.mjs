import assert from 'node:assert/strict';
import http from 'node:http';
import {MAPS,BO1_MAPS,BO2_MAPS} from '../web/maps.js';
import {createLobbyApi} from './lobby-api.mjs';

// Every browser starts in its own lobby; co-op is opt-in (join, invite link).
let clock=0;const api=createLobbyApi({maps:[...MAPS,...BO1_MAPS,...BO2_MAPS],now:()=>clock});
const server=http.createServer(async(req,res)=>{if(!await api(req,res,new URL(req.url,'http://localhost'))){res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
const call=async(map,path,body={},headers={})=>{const r=await fetch(`${base}/api/lobby/${map}/${path}`,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});return {status:r.status,value:r.status===204?null:await r.json()};};
const join=async(map,character,extra={})=>(await call(map,'join',{...(character==null?{}:{character}),...extra})).value;
const poll=async(map,id,patch={})=>(await call(map,id,patch)).value;
const move=async(map,id,lobby)=>(await call(map,id+'/move',{lobby}));
const me=s=>s.players.find(p=>p.id===s.you);

// Two Kino players each get their own lobby: neither blocks the other's start,
// and each sees the other's lobby as open.
const a=await join('kino',0),b=await join('kino',0);
assert.equal(a.players.length,1);assert.equal(b.players.length,1);assert.notEqual(a.lobby,b.lobby,'Separate private lobbies');
assert.equal(b.host,b.you,'Alone, you host your own lobby');
const seenByA=await poll('kino',a.you);assert.deepEqual(seenByA.open.map(l=>l.id),[b.lobby]);assert(seenByA.open[0].joinable);
const solo=(await call('kino',b.you+'/start')).value;assert.deepEqual(solo.match.players,[b.you],'A solo start never waits on anyone else');
await poll('kino',b.you,{loaded:solo.match.id});assert((await poll('kino',b.you)).match.go);
assert(!(await poll('kino',a.you)).open.find(l=>l.id===b.lobby).joinable,'A lobby mid-game cannot be joined');
await poll('kino',b.you,{status:'lobby'});assert.equal((await poll('kino',b.you)).match,null);
// B joins A's lobby; both asked for Dempsey, so B gets another character.
const joined=(await move('kino',b.you,a.lobby)).value;assert.equal(joined.lobby,a.lobby);assert.equal(joined.players.length,2);
const seen=await poll('kino',a.you);assert.equal(seen.players.length,2);assert.equal(seen.host,a.you,'The first player hosts');
assert.equal(me(a).character,0);assert.notEqual(me(joined).character,0,'Black Ops characters are unique per lobby');assert.deepEqual(seen.players.map(p=>p.slot),[0,1]);
assert.equal((await call('kino',b.you,{status:'nonsense'})).status,400);
assert.notEqual(me(await poll('kino',b.you,{character:0})).character,0,'A taken character is not handed out twice');
assert.equal((await call('kino',b.you,{status:'playing'},{Origin:'https://elsewhere.example'})).status,403,'Other sites cannot change the lobby');
// Only the host starts. Everyone in the lobby loads; nobody goes in until all have loaded.
assert.equal((await call('kino',b.you+'/start')).status,403,'Guests cannot start the game');
const started=(await call('kino',a.you+'/start')).value;assert(started.match&&!started.match.go);assert.deepEqual(new Set(started.match.players),new Set([a.you,b.you]));
assert(started.players.every(p=>p.status==='loading'));assert.equal((await call('kino',a.you+'/start')).status,409,'One start at a time');
assert.equal((await move('kino',b.you,null)).status,409,'A player in a game cannot leave its lobby');
let host=await poll('kino',a.you,{loaded:started.match.id});assert.equal(me(host).status,'waiting');assert.equal(host.match.go,false,'The host waits for the other player');
const guest=await poll('kino',b.you,{loaded:started.match.id});assert.equal(guest.match.go,true,'Everyone loaded: the match goes');assert((await poll('kino',a.you)).match.go);
// A newcomer cannot join a lobby that is mid-game; an invite to it gives them their own.
const late=await join('kino',null,{lobby:a.lobby});assert.notEqual(late.lobby,a.lobby);assert.equal((await move('kino',late.you,a.lobby)).status,409);
await poll('kino',a.you,{status:'lobby'});await poll('kino',b.you,{status:'lobby'});assert.equal((await poll('kino',a.you)).match,null);
// An invite link joins that lobby directly.
const invited=await join('kino',null,{lobby:a.lobby});assert.equal(invited.lobby,a.lobby);assert.equal(invited.players.length,3);
// A player who drops out while loading no longer holds the others.
const second=(await call('kino',a.you+'/start')).value;await poll('kino',a.you,{loaded:second.match.id});await poll('kino',invited.you,{loaded:second.match.id});
assert.equal((await call('kino',b.you+'/leave')).status,204);assert((await poll('kino',a.you)).match.go,'Leaving releases the players waiting on you');
for(const id of [a.you,invited.you])await poll('kino',id,{status:'lobby'});
// Leaving a shared lobby puts you back in your own.
const back=(await move('kino',invited.you,null)).value;assert.notEqual(back.lobby,a.lobby);assert.equal(back.players.length,1);assert.equal(back.host,invited.you);
assert.equal((await poll('kino',a.you)).players.length,1);
// Other maps are separate; World at War players are numbered without characters.
const n=await join('nacht');assert.equal(me(n).character,null);assert.equal(n.players.length,1);assert.equal(n.open.length,0);
const origins=await join('origins',2);assert.equal(me(origins).character,2);assert.equal(origins.players.length,1);assert.equal(origins.open.length,0);assert.equal((await call('origins',origins.you+'/leave')).status,204);
// A fifth player finds the lobby full.
const c=await join('kino',null,{lobby:a.lobby}),d=await join('kino',null,{lobby:a.lobby}),e=await join('kino',null,{lobby:a.lobby});
assert.equal((await poll('kino',a.you)).players.length,4);assert.equal(new Set((await poll('kino',a.you)).players.map(p=>p.character)).size,4,'Four players, four characters');
const full=await call('kino','join',{lobby:a.lobby});assert.equal(full.status,409);assert.equal(full.value.full,true);
assert.equal((await move('kino',back.you,a.lobby)).status,409,'Cannot move into a full lobby');
// Players who stop checking in leave; the host passes on and the slot is reused.
clock+=11000;for(const id of [c.you,d.you,e.you,back.you,n.you])await poll(id===n.you?'nacht':'kino',id);clock+=11000;
const after=await poll('kino',c.you);assert.equal(after.players.length,3);assert.equal(after.host,c.you,'The next player becomes host');
assert.equal((await call('kino',a.you)).status,404,'A player who left cannot update');
assert.equal(me(await join('kino',null,{lobby:after.lobby})).slot,0,'A new player takes the free slot');
clock+=30000;assert.equal(api.lobbies('kino').length,0,'Quiet lobbies close');
// A guest busy preparing the map for a minute is not dropped, and a guest
// that was dropped rejoins as itself, keeping its place in the match.
const h=await join('der-riese'),g=await join('der-riese',null,{lobby:h.lobby}),m=(await call('der-riese',h.you+'/start')).value.match;
assert.equal(m.players.length,2);
await poll('der-riese',h.you,{loaded:m.id});for(let i=0;i<12;i++){clock+=5000;await poll('der-riese',h.you);}
let waiting=await poll('der-riese',h.you);assert.equal(waiting.players.length,2,'A busy loading guest stays in the lobby');assert.equal(waiting.match.go,false,'The host keeps waiting for them');
for(let i=0;i<10;i++){clock+=20000;await poll('der-riese',h.you);}assert.equal((await call('der-riese',g.you)).status,404);
const rejoin=await call('der-riese','join',{id:g.you,status:'loading'});assert.equal(rejoin.value.you,g.you,'Rejoins with the same id');assert.equal(rejoin.value.lobby,h.lobby,'Back in the same lobby');assert(rejoin.value.match.players.includes(g.you),'Keeps its place in the match');
assert.equal(me(rejoin.value).status,'loading');assert.equal((await poll('der-riese',g.you,{loaded:m.id})).match.go,true);assert.equal((await poll('der-riese',g.you,{loaded:m.id})).match.go,true,'Repeating loaded is harmless');
server.close();
console.log('Lobby passed:',JSON.stringify({privateLobbies:true,soloStartNeverBlocked:true,openLobbyList:true,joinAndLeave:true,inviteLink:true,uniqueCharacters:true,hostOnlyStart:true,waitForAllLoaded:true,noJoinMidGame:true,dropOutReleases:true,separateMaps:true,full:4,hostHandoff:true,timeout:true,slowLoader:true,rejoin:true}));
