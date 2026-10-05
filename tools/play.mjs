import {spawn,spawnSync} from 'node:child_process';
import {openSync,closeSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),url='http://127.0.0.1:8789';
async function ready() {
  try {
    const response=await fetch(url+'/api/status',{signal:AbortSignal.timeout(1000)});
    return response.ok&&(await response.json()).project==='waw-zombies-web-runtime';
  } catch{return false;}
}
try {
  const preload=spawnSync(process.execPath,['tools/build_preload.mjs'],{cwd:root,windowsHide:true,stdio:'inherit'});
  if(preload.status!==0)throw new Error('Unable to prepare the original map. See the error above.');
  if(!await ready()) {
    const out=openSync(path.join(root,'local-data/server.log'),'a'),err=openSync(path.join(root,'local-data/server-error.log'),'a');
    const server=spawn(process.execPath,['tools/serve.mjs'],{cwd:root,detached:true,windowsHide:true,stdio:['ignore',out,err]});
    closeSync(out);closeSync(err);server.unref();
    let running=false;
    for(let attempt=0;attempt<30;attempt++) {
      await new Promise(resolve=>setTimeout(resolve,200));
      if(await ready()){running=true;break;}
      if(server.exitCode!==null)break;
    }
    if(!running)throw new Error('Unable to start the Zombies server. See local-data/server-error.log; port 8789 may be in use.');
    writeFileSync(path.join(root,'local-data/server.pid'),String(server.pid));
  }
  console.log('Play solo Zombies: '+url);
  const status=await fetch(url+'/api/status',{signal:AbortSignal.timeout(2000)}).then(response=>response.json());
  for(const lanUrl of status.network?.lanUrls||[])console.log('Play from another device on your local network: '+lanUrl);
  if(!process.argv.includes('--no-browser')) {
    // Fixed local URL; no user data or shell-built filesystem operations.
    const browser=spawn('powershell.exe',['-NoProfile','-Command',"Start-Process 'http://127.0.0.1:8789'"],{detached:true,windowsHide:true,stdio:'ignore'});
    browser.unref();
  }
} catch(error){console.error(error.message);process.exitCode=1;}
