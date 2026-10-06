import assert from 'node:assert/strict';
import http from 'node:http';
import {MAPS,BO1_MAPS} from '../web/maps.js';
import {createLobbyApi} from './lobby-api.mjs';

// Browsers on one server that open the same map share its pre-game lobby.
let clock=0;const api=createLobbyApi({maps:[...MAPS,...BO1_MAPS],now:()=>clock});
const server=http.createServer(async(req,res)=>{if(!await api(req,res,new URL(req.url,'http://localhost'))){res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
const call=async(map,path,body={},headers={})=>{const r=await fetch(`${base}/api/lobby/${map}/${path}`,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});return {status:r.status,value:r.status===204?null:await r.json()};};
const join=async(map,character)=>(await call(map,'join',character==null?{}:{character})).value;
const poll=async(map,id,patch={})=>(await call(map,id,patch)).value;
const me=s=>s.players.find(p=>p.id===s.you);

// Two Kino players see each other; both asked for Dempsey, so the second gets another character.
const a=await join('kino',0),b=await join('kino',0),seen=await poll('kino',a.you);
assert.equal(seen.players.length,2);assert.equal(seen.host,a.you,'The first player hosts');
assert.equal(me(a).character,0);assert.notEqual(me(b).character,0,'Black Ops characters are unique per lobby');assert.deepEqual(seen.players.map(p=>p.slot),[0,1]);
assert.equal((await call('kino',b.you,{status:'nonsense'})).status,400);
assert.notEqual(me(await poll('kino',b.you,{character:0})).character,0,'A taken character is not handed out twice');
assert.equal((await call('kino',b.you,{status:'playing'},{Origin:'https://elsewhere.example'})).status,403,'Other sites cannot change the lobby');
// Only the host starts. Everyone in the lobby loads; nobody goes in until all have loaded.
assert.equal((await call('kino',b.you+'/start')).status,403,'Guests cannot start the game');
const started=(await call('kino',a.you+'/start')).value;assert(started.match&&!started.match.go);assert.deepEqual(new Set(started.match.players),new Set([a.you,b.you]));
assert(started.players.every(p=>p.status==='loading'));assert.equal((await call('kino',a.you+'/start')).status,409,'One start at a time');
let host=await poll('kino',a.you,{loaded:started.match.id});assert.equal(me(host).status,'waiting');assert.equal(host.match.go,false,'The host waits for the other player');
const guest=await poll('kino',b.you,{loaded:started.match.id});assert.equal(guest.match.go,true,'Everyone loaded: the match goes');assert((await poll('kino',a.you)).match.go);
// A late joiner is not part of the running match; it ends once its players are back in the lobby.
const late=await join('kino');assert(!late.match.players.includes(late.you));
await poll('kino',a.you,{status:'playing'});await poll('kino',b.you,{status:'playing'});assert((await poll('kino',late.you)).match);
await poll('kino',a.you,{status:'lobby'});await poll('kino',b.you,{status:'lobby'});assert.equal((await poll('kino',late.you)).match,null);
// A player who drops out while loading no longer holds the others.
const second=(await call('kino',a.you+'/start')).value;await poll('kino',a.you,{loaded:second.match.id});await poll('kino',late.you,{loaded:second.match.id});
assert.equal((await call('kino',b.you+'/leave')).status,204);assert((await poll('kino',a.you)).match.go,'Leaving releases the players waiting on you');
// Other maps are separate lobbies; World at War players are numbered without characters.
const n=await join('nacht');assert.equal(me(n).character,null);assert.equal(n.players.length,1);
// A fifth player finds the lobby full.
for(const id of [a.you,late.you])await poll('kino',id,{status:'lobby'});
const c=await join('kino'),d=await join('kino');assert.equal((await poll('kino',a.you)).players.length,4);
assert.equal(new Set((await poll('kino',a.you)).players.map(p=>p.character)).size,4,'Four players, four characters');
const full=await call('kino','join');assert.equal(full.status,409);assert.equal(full.value.full,true);
// Players who stop checking in leave; the host passes on and the slot is reused.
clock+=11000;for(const id of [late.you,c.you,d.you])await poll('kino',id);clock+=11000;
const after=await poll('kino',late.you);assert.equal(after.players.length,3);assert.equal(after.host,late.you,'The next player becomes host');
assert.equal((await call('kino',a.you)).status,404,'A player who left cannot update');assert.equal(me(await join('kino')).slot,0,'A new player takes the free slot');
clock+=30000;assert.equal(api.view('kino',null).players.length,0,'Quiet lobbies empty');
// A guest busy preparing the map for a minute is not dropped, and a guest
// that was dropped rejoins as itself, keeping its place in the match.
const h=await join('der-riese'),g=await join('der-riese'),m=(await call('der-riese',h.you+'/start')).value.match;
await poll('der-riese',h.you,{loaded:m.id});for(let i=0;i<12;i++){clock+=5000;await poll('der-riese',h.you);}
let waiting=await poll('der-riese',h.you);assert.equal(waiting.players.length,2,'A busy loading guest stays in the lobby');assert.equal(waiting.match.go,false,'The host keeps waiting for them');
for(let i=0;i<10;i++){clock+=20000;await poll('der-riese',h.you);}assert.equal((await call('der-riese',g.you)).status,404);
const back=await call('der-riese','join',{id:g.you,status:'loading'});assert.equal(back.value.you,g.you,'Rejoins with the same id');assert(back.value.match.players.includes(g.you),'Keeps its place in the match');
assert.equal(me(back.value).status,'loading');assert.equal((await poll('der-riese',g.you,{loaded:m.id})).match.go,true);assert.equal((await poll('der-riese',g.you,{loaded:m.id})).match.go,true,'Repeating loaded is harmless');
server.close();
console.log('Lobby passed:',JSON.stringify({sharedLobby:true,uniqueCharacters:true,hostOnlyStart:true,waitForAllLoaded:true,lateJoiners:true,dropOutReleases:true,separateMaps:true,full:4,hostHandoff:true,timeout:true,slowLoader:true,rejoin:true}));
