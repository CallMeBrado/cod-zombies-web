import {readFile,writeFile,mkdir,rename,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
const error=(status,message)=>Object.assign(new Error(message),{status});
const json=async file=>{try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}};
async function atomic(file,value){await mkdir(path.dirname(file),{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(value),{flag:'wx'});await rename(temp,file);}

// One shared library for everyone who can access the site. No player accounts.
export function createSaveApi({directory,maps}){
  const validMaps=new Set(maps.map(m=>m.id)),queues=new Map();
  const queued=(key,run)=>{const next=(queues.get(key)||Promise.resolve()).catch(()=>{}).then(run);queues.set(key,next);next.finally(()=>{if(queues.get(key)===next)queues.delete(key);}).catch(()=>{});return next;};
  const send=(res,status,value)=>{const body=JSON.stringify(value);res.writeHead(status,{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(body);};
  async function body(req){let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>4*1024*1024)throw error(413,'This save is too large.');chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw error(400,'Invalid save data.');}}
  function sameSite(req){
    if(req.headers['sec-fetch-site']==='cross-site')throw error(403,'Use the save menu on this site.');
    if(req.headers.origin){let host;try{host=new URL(req.headers.origin).host.toLowerCase();}catch{throw error(403,'Invalid origin.');}
      if(host!==String(req.headers.host).toLowerCase())throw error(403,'Use the save menu on this site.');}
  }
  const saveFile=(map,slot)=>path.join(directory,map,slot+'.json');
  function validate(save,map,slot){
    if(!save||save.map!==map||save.slot!==slot||!save.state||![1,2].includes(save.state.version)||!save.state.player||!save.summary)throw error(400,'Invalid save slot.');
    if(save.state.player.position?.length!==3||!save.state.player.position.every(Number.isFinite)||!Array.isArray(save.state.inventory))throw error(400,'Invalid game state.');
    if(save.thumb!=null&&(!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(save.thumb)||save.thumb.length>300000))throw error(400,'Invalid save preview.');
    if(typeof save.title!=='string'||save.title.length>100)throw error(400,'Invalid map title.');
    if(save.name!=null&&(typeof save.name!=='string'||save.name.length>80))throw error(400,'Use a save name of 80 characters or fewer.');
  }
  return async function handle(req,res,url){
    if(!url.pathname.startsWith('/api/saves'))return false;
    try{
      const route=url.pathname;
      if(req.method!=='GET'&&req.method!=='HEAD')sameSite(req);
      if(route==='/api/saves'&&req.method==='GET'){
        const saves=[];for(const map of validMaps)for(let slot=0;slot<3;slot++){const saved=await json(saveFile(map,slot));if(saved)saves.push(saved);}send(res,200,{saves});return true;
      }
      const match=route.match(/^\/api\/saves\/([a-z0-9-]+)\/([0-2])$/);
      if(!match||!validMaps.has(match[1]))throw error(404,'Unknown save slot.');
      const [,map,slotText]=match,slot=Number(slotText),file=saveFile(map,slot);
      if(req.method==='GET'){const save=await json(file);if(!save)throw error(404,'This slot is empty.');send(res,200,{save});return true;}
      if(!['PUT','DELETE'].includes(req.method))throw error(405,'Unsupported save action.');
      const input=await body(req);
      const save=await queued(file,async()=>{
        const previous=await json(file);if(input.expectedRevision!==(previous?.revision??null))throw error(409,'This slot changed on another device. Refresh the slots before trying again.');
        if(req.method==='DELETE'){
          if(previous){await atomic(file+'.backup',previous);await unlink(file);}return null;
        }
        validate(input.save,map,slot);const saved={...input.save,name:input.save.name?.trim()||'Round '+input.save.summary.round,savedAt:Date.now(),revision:randomUUID()};
        if(previous)await atomic(file+'.backup',previous);await atomic(file,saved);return saved;
      });send(res,200,{save});return true;
    }catch(e){send(res,e.status||500,{error:e.status?e.message:'Server saves are temporarily unavailable. Your current game has not been lost.'});return true;}
  };
}
