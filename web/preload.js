// The pack uses ordinary versioned HTTP caching, including on Firefox/HTTPS.
// Parsed assets and decoded models remain in memory across solo restarts.
import {selectedMap} from './maps.js';
const files=new Map(),jsonFiles=new Map();
export const preloadState={ready:false,files:0,bytes:0,downloadMs:0,url:null,hits:0,networkFallbacks:0};
export async function preloadAssets(progress=()=>{}){
  if(preloadState.ready)return;
  const config=document.documentElement.dataset.preload;if(!config)throw new Error('The server has no prepared map. Run the Zombies launcher.');
  const packs=JSON.parse(decodeURIComponent(config));
  const title=selectedMap().title;progress('Loading prepared '+title+'…');const began=performance.now();
  let completed=0,totalBytes=0;
  await Promise.all(packs.map(async url=>{
  const response=await fetch(url);if(!response.ok)throw new Error(`Map preload failed (${response.status}).`);
  const buffer=await response.arrayBuffer(),view=new DataView(buffer);
  if(new TextDecoder().decode(new Uint8Array(buffer,0,4))!=='WWPK'||view.getUint32(4,true)!==1)throw new Error('Invalid prepared map.');
  const length=view.getUint32(8,true),base=12+length;
  const index=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,12,length)));
  for(const entry of index){if(entry.offset<0||entry.length<0||base+entry.offset+entry.length>buffer.byteLength)throw new Error('Incomplete prepared map.');
    files.set(entry.url,new Uint8Array(buffer,base+entry.offset,entry.length));}
  totalBytes+=buffer.byteLength;completed++;progress(`Loading prepared ${title}… ${Math.round(completed/packs.length*100)}%`);
  }));
  Object.assign(preloadState,{ready:true,files:files.size,bytes:totalBytes,downloadMs:performance.now()-began,url:packs});
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
