import http from 'node:http';
import { readFile, stat, realpath, readdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import {MAPS,BO1_MAPS,mapById} from '../web/maps.js';
import {pageRoute} from '../web/routes.js';
import {createSaveApi} from './save-api.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const port = Number(process.env.PORT || 8789);
const host = process.env.HOST || '0.0.0.0';
const saveApi=createSaveApi({directory:path.join(root,'local-data/saves'),maps:[...MAPS,...BO1_MAPS]});
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
function lanUrls() {
  if (host === '127.0.0.1' || host === '::1') return [];
  return [...new Set(Object.entries(networkInterfaces())
    .filter(([name]) => !/vmware|vethernet|virtualbox|docker|loopback/i.test(name))
    .flatMap(([, addresses]) => addresses
      .filter(address => address.family === 'IPv4' && !address.internal && !address.address.startsWith('169.254.') &&
        (host === '0.0.0.0' || host === '::' || host === address.address))
      .map(address => `http://${address.address}:${port}/`)))];
}
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.wav': 'audio/wav', '.glb': 'model/gltf-binary' };
const builds=new Map();
async function currentBuild(){
  const preload=JSON.parse(await readFile(path.join(root,'local-data/preload.json'),'utf8'));
  const maps={nacht:preload};for(const map of MAPS.slice(1))maps[map.id]=JSON.parse(await readFile(path.join(root,'local-data',map.data,'preload.json'),'utf8'));
  for(const map of BO1_MAPS)try{maps[map.id]=JSON.parse(await readFile(path.join(root,'local-data',map.data,'preload.json'),'utf8'));}catch{}
  const names=(await readdir(path.join(root,'web'))).filter(n=>/\.(js|css|html)$/.test(n)).sort();
  const files=await Promise.all(names.map(async name=>[name,await readFile(path.join(root,'web',name))]));
  const hash=createHash('sha256').update(JSON.stringify(Object.entries(maps).map(([key,value])=>[key,value.id])));for(const [name,buffer] of files)hash.update(name).update(buffer);
  const id=hash.digest('hex').slice(0,16);
  if(!builds.has(id)){builds.set(id,{id,files:new Map(files),preload,maps});if(builds.size>4)builds.delete(builds.keys().next().value);}
  return builds.get(id);
}
function sendBuffer(req,res,buffer,type,cache='no-store'){
  res.writeHead(200,{'Content-Type':type,'Content-Length':buffer.length,'Cache-Control':cache,'X-Content-Type-Options':'nosniff'});
  res.end(req.method==='HEAD'?undefined:buffer);
}
const server = http.createServer(async (req, res) => {
  try {
    const apiUrl=new URL(req.url,'http://localhost');if(await saveApi(req,res,apiUrl))return;
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405); res.end(); return;
    }
    const requestUrl=new URL(req.url,'http://localhost'),pathname=decodeURIComponent(requestUrl.pathname),page=pageRoute(requestUrl);
    if(page?.redirect){res.writeHead(302,{'Location':page.redirect,'Cache-Control':'no-store'});res.end();return;}
    if(page?.template){
      const build=await currentBuild();
      const map=page.game==='black-ops'?BO1_MAPS[0]:MAPS.find(m=>m.id===requestUrl.searchParams.get('map'))||MAPS[0];
      const preview=page.game==='black-ops'&&build.maps[map.id]?.navigationVersion!=='kino-ground-v2';
      const preloadConfig=page.game&&!preview?encodeURIComponent(JSON.stringify(build.maps[map.id].packs.map(pack=>pack.url))):'';
      const html=build.files.get(preview?'bo1-progress.html':page.template).toString('utf8').replaceAll('__BUILD__',build.id).replaceAll('__PRELOAD__',preloadConfig);
      sendBuffer(req,res,Buffer.from(html),'text/html');return;
    }
    if(pathname.startsWith('/runtime/')){
      const match=pathname.match(/^\/runtime\/([a-f0-9]{16})\/([^/]+)$/);
      await currentBuild();const build=match&&builds.get(match[1]),buffer=build?.files.get(match?.[2]);
      if(!buffer){res.writeHead(404,{'Cache-Control':'no-store'});res.end('Build expired. Reload the page.');return;}
      sendBuffer(req,res,buffer,mime[path.extname(match[2])]||'application/octet-stream','public, max-age=31536000, immutable');return;
    }
    if(pathname.startsWith('/packs/')){
      const match=pathname.match(/^\/packs\/([a-f0-9]{20}\.pack)$/);
      if(!match){res.writeHead(404);res.end();return;}
      const compressed=/\bgzip\b/i.test(req.headers['accept-encoding']||'');
      const file=path.join(root,'.cache/preload',match[1]+(compressed?'.gz':'')),info=await stat(file);
      res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':info.size,
        'Cache-Control':'public, max-age=31536000, immutable','Vary':'Accept-Encoding',
        'X-Content-Type-Options':'nosniff',...(compressed?{'Content-Encoding':'gzip'}:{})});
      if(req.method==='HEAD')res.end();else await pipeline(createReadStream(file),res);return;
    }
    let folder = path.join(root, 'web');
    let relative = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (pathname.startsWith('/data/')) {
      folder = path.join(root, 'local-data'); relative = pathname.slice(6);
      // Publish game assets, while keeping extraction reports, logs and process files local.
      const assetFolder = path.relative(folder, path.resolve(folder, relative)).split(path.sep)[0];
      if (!['gameplay', 'nacht', 'der-riese', 'common', 'ui','bo1-kino','bo1-common','bo1-base','bo1-english','bo1-ui'].includes(assetFolder)) {
        res.writeHead(404); res.end('File not found.'); return;
      }
    } else if (pathname.startsWith('/vendor/')) {
      folder = path.join(root, 'node_modules', 'three'); relative = pathname.slice(8).replace(/^0\.186\.1\//,'');
    } else if (pathname === '/api/status') {
      const report = JSON.parse(await readFile(path.join(root, 'local-data', 'inspection.json'), 'utf8'));
      const build=await currentBuild();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ project: 'waw-zombies-web-runtime', spawns: report.playerSpawns,
        scripts: report.scripts.length, entities: report.entities.length, runtime: report.runtime,
        network: { host, port, lanUrls: lanUrls() },build:build.id,physicsHz:120,
        preload:{packs:build.preload.packs.map(p=>p.url),files:build.preload.files,bytes:build.preload.bytes,gzipBytes:build.preload.gzipBytes} }));
      return;
    }
    const candidate = path.resolve(folder, relative);
    const rel = path.relative(folder, candidate);
    if (rel.startsWith('..') || path.isAbsolute(rel) || relative.includes('\0')) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    const actual = await realpath(candidate);
    const actualRel = path.relative(await realpath(folder), actual);
    if (actualRel.startsWith('..') || path.isAbsolute(actualRel)) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    const info = await stat(actual);
    if (!info.isFile()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': mime[path.extname(actual)] || 'application/octet-stream',
      'Content-Length': info.size, 'Cache-Control': pathname.startsWith('/vendor/0.186.1/')?'public, max-age=31536000, immutable':'no-store',
      'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : await readFile(actual));
  } catch (error) {
    if(res.headersSent){res.destroy(error);return;}
    const code = error.code === 'ENOENT' ? 404 : 500;
    res.writeHead(code, { 'Content-Type': 'text/plain' });
    res.end(code === 404 ? 'File not found. Run the extraction tools first.' : 'Unable to load local file.');
  }
});
server.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? `Port ${port} is busy. Set PORT to an unused port and retry.` : error.message);
  process.exitCode = 1;
});
server.listen(port, host, () => {
  console.log(`Solo Zombies: http://127.0.0.1:${port}/`);
  for (const url of lanUrls()) console.log(`Local network: ${url}`);
  console.log(`Listening on ${host}:${port}\nProject: ${root}`);
});
