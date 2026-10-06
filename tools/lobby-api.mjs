import {randomUUID} from 'node:crypto';
const error=(status,message)=>Object.assign(new Error(message),{status});
export const LOBBY_STATUSES=['lobby','loading','waiting','playing'];

// Pre-game lobbies: everyone who opens the same map on this server shares one.
// Browsers check in about twice a second with ordinary requests (these pass
// through any proxy); a browser that stops checking in has left. The first
// player present hosts. Only the host starts a match: everyone in the lobby
// loads, and the match goes once every one of them has finished loading.
// A browser preparing a map (or sitting in a background tab) can be busy or
// throttled for a long time, so loading, waiting and playing players get a
// much longer allowance than players idling in the lobby. A dropped browser
// rejoins with its old id and keeps its place.
export function createLobbyApi({maps,maxPlayers=4,lobbyTimeoutMs=20000,busyTimeoutMs=180000,characters=4,now=()=>Date.now(),log=()=>{}}){
  const valid=new Map(maps.map(m=>[m.id,m])),lobbies=new Map();
  const send=(res,status,value)=>{const body=value==null?'':JSON.stringify(value);res.writeHead(status,{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(body);};
  async function body(req,limit=4096){let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>limit)throw error(413,'Lobby update too large.');chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}catch{throw error(400,'Invalid lobby update.');}}
  function sameSite(req){
    if(req.headers['sec-fetch-site']==='cross-site')throw error(403,'Use the lobby on this site.');
    if(req.headers.origin){let host;try{host=new URL(req.headers.origin).host.toLowerCase();}catch{throw error(403,'Invalid origin.');}
      if(host!==String(req.headers.host).toLowerCase())throw error(403,'Use the lobby on this site.');}
  }
  // Black Ops players each play a different one of the four characters.
  const usesCharacters=map=>['black-ops','black-ops-2'].includes(valid.get(map)?.game);
  function freeCharacter(l,wanted,self){
    const taken=new Set([...l.players.values()].filter(p=>p!==self).map(p=>p.character));
    if(Number.isInteger(wanted)&&wanted>=0&&wanted<characters&&!taken.has(wanted))return wanted;
    for(let c=0;c<characters;c++)if(!taken.has(c))return c;return 0;
  }
  const host=l=>[...l.players.values()].sort((a,b)=>a.joined-b.joined)[0]||null;
  // Drop players who stopped checking in, and settle the match.
  function settle(map){
    const l=lobbies.get(map);if(!l)return null;const time=now();
    for(const [id,p]of l.players)if(time-p.seen>(p.status==='lobby'?lobbyTimeoutMs:busyTimeoutMs)){l.players.delete(id);log(`lobby ${map}: ${id.slice(0,8)} timed out (${p.status})`);}
    const m=l.match;
    if(m){
      for(const id of m.players)if(!l.players.has(id)){m.players.delete(id);if(!m.go)m.loaded.delete(id);(m.dropped??=new Set()).add(id);}
      if(!m.go&&m.players.size&&[...m.players].every(id=>m.loaded.has(id))){m.go=true;log(`lobby ${map}: match ${m.id.slice(0,8)} go (${m.players.size} players)`);}
      // The match is over for the lobby once all of its players are back in the lobby or gone.
      if(!m.players.size||m.go&&[...m.players].every(id=>l.players.get(id).status==='lobby'))l.match=null;
    }
    if(!l.players.size){lobbies.delete(map);return null;}
    return l;
  }
  function view(map,you){
    const l=settle(map),players=l?[...l.players.values()]:[],m=l?.match;
    return {map,max:maxPlayers,you,host:l?host(l)?.id:null,players:players.map(p=>({id:p.id,slot:p.slot,character:p.character,status:p.status})).sort((a,b)=>a.slot-b.slot),
      match:m?{id:m.id,host:m.host,players:[...m.players],loaded:[...m.loaded],go:m.go}:null};
  }
  function join(map,input){
    let l=settle(map);if(!l){l={players:new Map(),match:null};lobbies.set(map,l);}
    if(l.players.size>=maxPlayers)throw Object.assign(error(409,'This lobby is full.'),{full:true});
    const slots=new Set([...l.players.values()].map(p=>p.slot));let slot=0;while(slots.has(slot))slot++;
    // A browser that was dropped rejoins as itself: same id, its match place kept.
    const previous=typeof input.id==='string'&&/^[0-9a-f-]{36}$/.test(input.id)&&!l.players.has(input.id)?input.id:null;
    const time=now(),player={id:previous||randomUUID(),slot,status:LOBBY_STATUSES.includes(input.status)?input.status:'lobby',joined:time,seen:time,character:null};
    if(usesCharacters(map))player.character=freeCharacter(l,Number(input.character),player);
    l.players.set(player.id,player);
    if(previous&&l.match?.dropped?.has(previous)){l.match.players.add(previous);l.match.dropped.delete(previous);}
    log(`lobby ${map}: ${player.id.slice(0,8)} ${previous?'rejoined':'joined'} (${l.players.size} players)`);
    return view(map,player.id);
  }
  function present(map,id){const l=settle(map),player=l?.players.get(id);if(!player)throw error(404,'Not in this lobby.');player.seen=now();return {l,player};}
  function update(map,id,input){
    const {l,player}=present(map,id);
    if(input.status!==undefined){if(!LOBBY_STATUSES.includes(input.status))throw error(400,'Unknown lobby status.');player.status=input.status;}
    if(input.character!==undefined&&usesCharacters(map))player.character=freeCharacter(l,Number(input.character),player);
    if(input.loaded!==undefined&&l.match?.id===input.loaded&&l.match.players.has(id)&&!l.match.loaded.has(id)){l.match.loaded.add(id);if(!l.match.go)player.status='waiting';log(`lobby ${map}: ${id.slice(0,8)} loaded (${l.match.loaded.size}/${l.match.players.size})`);}
    return view(map,id);
  }
  function start(map,id){
    const {l}=present(map,id);
    if(host(l).id!==id)throw error(403,'Only the host can start the game.');
    if(l.match&&!l.match.go)throw error(409,'A game is already starting.');
    const players=[...l.players.values()].filter(p=>p.status==='lobby');
    l.match={id:randomUUID(),host:id,players:new Set(players.map(p=>p.id)),loaded:new Set(),go:false};
    for(const p of players)p.status='loading';
    log(`lobby ${map}: host ${id.slice(0,8)} started match ${l.match.id.slice(0,8)} (${players.length} players)`);
    return view(map,id);
  }
  // The in-game relay. Every player in a running match exchanges with the
  // server about 25 times a second: it posts its own player state (kept as the
  // latest only), the host also posts its world snapshot (latest only), and
  // events go to the host, one player or everyone, delivered in order until
  // the recipient acknowledges them.
  function net(map,id,input){
    const {l}=present(map,id),m=l.match;
    if(!m||!m.players.has(id))throw error(409,'Not in a running game.');
    const relay=m.relay??={states:new Map(),queues:new Map(),seqs:new Map(),snap:null,snapSeq:0};
    if(input.state&&typeof input.state==='object')relay.states.set(id,input.state);
    if(input.snap&&typeof input.snap==='object'&&id===m.host)relay.snap={seq:++relay.snapSeq,data:input.snap};
    for(const event of Array.isArray(input.events)?input.events.slice(0,500):[]){
      const to=event?.to,targets=to==='all'?[...m.players].filter(p=>p!==id):to==='host'?(m.host===id?[]:[m.host]):typeof to==='string'&&m.players.has(to)&&to!==id?[to]:[];
      for(const target of targets){
        const queue=relay.queues.get(target)||[],seq=(relay.seqs.get(target)||0)+1;relay.seqs.set(target,seq);
        queue.push({seq,from:id,msg:event.msg});if(queue.length>4000)queue.splice(0,queue.length-4000);relay.queues.set(target,queue);
      }
    }
    const queue=relay.queues.get(id)||[],ack=Number(input.ack)||0;while(queue.length&&queue[0].seq<=ack)queue.shift();
    const players=[...m.players].filter(p=>p!==id).map(p=>{const player=l.players.get(p);return {id:p,slot:player?.slot??null,character:player?.character??null,status:player?.status??null,present:!!player&&player.status!=='lobby',state:relay.states.get(p)||null};});
    const snap=relay.snap&&relay.snap.seq>(Number(input.snapSeq)||0)?relay.snap:null;
    const host=l.players.get(m.host);
    return {match:m.id,host:m.host,hostPresent:!!host&&host.status!=='lobby',you:id,players,snap,events:queue.slice(0,1000)};
  }
  function leave(map,id){const l=lobbies.get(map);if(l?.players.delete(id)){log(`lobby ${map}: ${id.slice(0,8)} left`);settle(map);}}
  const api=async function handle(req,res,url){
    if(!url.pathname.startsWith('/api/lobby/'))return false;
    try{
      const match=url.pathname.match(/^\/api\/lobby\/([a-z0-9-]+)\/(join|[0-9a-f-]{36})(?:\/(start|leave|net))?$/);
      if(!match||!valid.has(match[1]))throw error(404,'Unknown lobby.');
      if(req.method!=='POST')throw error(405,'Unsupported lobby action.');
      sameSite(req);const [,map,who,action]=match,input=await body(req,action==='net'?1<<20:4096);
      if(who==='join'){if(action)throw error(404,'Unknown lobby action.');send(res,200,join(map,input));}
      else if(action==='start')send(res,200,start(map,who));
      else if(action==='leave'){leave(map,who);send(res,204,null);}
      else if(action==='net')send(res,200,net(map,who,input));
      else send(res,200,update(map,who,input));
      return true;
    }catch(e){send(res,e.status||500,{error:e.status?e.message:'Lobby unavailable.',...(e.full?{full:true,max:maxPlayers}:{})});return true;}
  };
  api.view=view;api.close=()=>lobbies.clear();
  return api;
}
