import fs from 'node:fs';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url),local='http://127.0.0.1:8789',publicUrl='https://zombies.kleinfelter.tech';
const status=await(await fetch(local+'/api/status')).json(),hash=b=>createHash('sha256').update(b).digest('hex');
const files=fs.readdirSync(new URL('web/',root)).filter(n=>n.endsWith('.js'));
const results=await Promise.all(files.map(async file=>{
  const path='/runtime/'+status.build+'/'+file,expected=fs.readFileSync(new URL('web/'+file,root));
  const responses=await Promise.all([local,publicUrl].map(async host=>{const response=await fetch(host+path,{signal:AbortSignal.timeout(20000)}),bytes=Buffer.from(await response.arrayBuffer());return {host,status:response.status,match:response.ok&&hash(bytes)===hash(expected)};}));
  return {file,responses};
}));
const report={build:status.build,files:results,allMatch:results.every(r=>r.responses.every(s=>s.match)),publicRootStatus:(await fetch(publicUrl+'/?build='+status.build,{signal:AbortSignal.timeout(20000)})).status};
fs.writeFileSync(new URL('local-data/served-build-verification.json',root),JSON.stringify(report,null,2));
console.log(JSON.stringify({build:report.build,modules:results.length,allMatch:report.allMatch,publicRootStatus:report.publicRootStatus}));
if(!report.allMatch)process.exitCode=1;
