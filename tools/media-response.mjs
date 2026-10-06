import {createReadStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';

export function mediaRange(header,size){
  if(!header)return null;
  const match=/^bytes=(\d*)-(\d*)$/.exec(header);
  if(!match||!size||!match[1]&&!match[2])return false;
  const start=match[1]?Number(match[1]):Math.max(0,size-Number(match[2]));
  const end=match[1]&&match[2]?Math.min(size-1,Number(match[2])):size-1;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start)return false;
  return {start,end};
}
export async function sendMovie(req,res,file,info){
  const range=mediaRange(req.headers.range,info.size),headers={'Content-Type':'video/mp4','Accept-Ranges':'bytes',
    'Cache-Control':'public, max-age=86400','X-Content-Type-Options':'nosniff'};
  if(range===false){res.writeHead(416,{...headers,'Content-Range':`bytes */${info.size}`});res.end();return;}
  if(range){headers['Content-Range']=`bytes ${range.start}-${range.end}/${info.size}`;headers['Content-Length']=range.end-range.start+1;}
  else headers['Content-Length']=info.size;
  res.writeHead(range?206:200,headers);
  if(req.method==='HEAD')res.end();else await pipeline(createReadStream(file,range||{}),res);
}
