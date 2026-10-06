// The pack uses ordinary versioned HTTP caching, including on Firefox/HTTPS.
// Parsed assets and decoded models remain in memory across solo restarts.
import {selectedMap} from './maps.js';
const files=new Map(),jsonFiles=new Map();
export const preloadState={ready:false,files:0,bytes:0,loadedBytes:0,totalBytes:0,completedPacks:0,downloadMs:0,url:null,hits:0,networkFallbacks:0};
export async function readPackResponse(response,expectedBytes,onBytes=()=>{}){
  if(!response.ok)throw new Error(`Map preload failed (${response.status}).`);
  if(!response.body){const buffer=await response.arrayBuffer();onBytes(buffer.byteLength);return buffer;}
  const reader=response.body.getReader(),target=expectedBytes?new Uint8Array(expectedBytes):null,chunks=[];let offset=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;
    if(target){if(offset+value.length>target.length)throw new Error('Prepared map download is larger than expected.');target.set(value,offset);}else chunks.push(value);
    offset+=value.length;onBytes(value.length);
  }}finally{reader.releaseLock();}
  if(target){if(offset!==target.length)throw new Error('Incomplete prepared map download.');return target.buffer;}
  const merged=new Uint8Array(offset);let at=0;for(const chunk of chunks){merged.set(chunk,at);at+=chunk.length;}return merged.buffer;
}
export async function preloadAssets(progress=()=>{},onDownload=()=>{}){
  if(preloadState.ready)return;
  const config=document.documentElement.dataset.preload;if(!config)throw new Error('The server has no prepared map. Run the Zombies launcher.');
  const packs=JSON.parse(decodeURIComponent(config)).map(p=>typeof p==='string'?{url:p}:p);
  const title=selectedMap().title;progress('Loading prepared '+title+'…');const began=performance.now();
  let completed=0,totalBytes=0,next=0;const abort=new AbortController();
  Object.assign(preloadState,{loadedBytes:0,totalBytes:packs.reduce((n,p)=>n+(p.bytes||0),0),completedPacks:0});
  const report=()=>onDownload({loadedBytes:preloadState.loadedBytes,totalBytes:preloadState.totalBytes,completedPacks:completed,totalPacks:packs.length});report();
  async function download({url,bytes}){
  const response=await fetch(url,{signal:abort.signal});
  const buffer=await readPackResponse(response,bytes,n=>{preloadState.loadedBytes+=n;report();}),view=new DataView(buffer);
  if(buffer.byteLength<12)throw new Error('Incomplete prepared map.');
  if(new TextDecoder().decode(new Uint8Array(buffer,0,4))!=='WWPK'||view.getUint32(4,true)!==1)throw new Error('Invalid prepared map.');
  const length=view.getUint32(8,true),base=12+length;
  if(base>buffer.byteLength)throw new Error('Incomplete prepared map.');
  const index=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,12,length)));
  for(const entry of index){if(entry.offset<0||entry.length<0||base+entry.offset+entry.length>buffer.byteLength)throw new Error('Incomplete prepared map.');
    files.set(entry.url,new Uint8Array(buffer,base+entry.offset,entry.length));}
  totalBytes+=buffer.byteLength;completed++;preloadState.completedPacks=completed;report();
  }
  const workers=Array.from({length:Math.min(3,packs.length)},async()=>{while(next<packs.length)await download(packs[next++]);});
  try{await Promise.all(workers);}catch(error){abort.abort();await Promise.allSettled(workers);files.clear();throw error;}
  Object.assign(preloadState,{ready:true,files:files.size,bytes:totalBytes,downloadMs:performance.now()-began,url:packs.map(p=>p.url)});
  progress('Preparing map from loaded assets…');
}
export async function assetResponse(url){
  const resolved=new URL(url,location.href),bytes=files.get(resolved.pathname);
  if(resolved.origin===location.origin&&bytes){preloadState.hits++;return new Response(bytes);}
  if(preloadState.ready&&resolved.origin===location.origin&&resolved.pathname.startsWith('/data/'))return new Response('Asset not present in this prepared build.',{status:404});
  preloadState.networkFallbacks++;
  return fetch(url);
}
export async function assetData(url,json=false){
  const key=new URL(url,location.href).pathname,bytes=files.get(key);
  if(bytes){
    preloadState.hits++;
    if(json){if(!jsonFiles.has(key))jsonFiles.set(key,JSON.parse(new TextDecoder().decode(bytes)));return jsonFiles.get(key);}
    return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
  }
  const response=await assetResponse(url);if(!response.ok)throw new Error(`${response.status}: ${url}`);
  return json?response.json():response.arrayBuffer();
}
