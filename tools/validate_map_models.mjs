// Check the shipped pack, not just exported files that the browser cannot see.
import assert from 'node:assert/strict';
import {open,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ALL_MAPS} from '../web/maps.js';
import {nativeDiffuse} from '../web/native-material.js';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),data=path.join(root,'local-data');
const read=async relative=>JSON.parse(await readFile(path.join(data,relative),'utf8'));
export async function validateMapModels(id){
  const chosen=ALL_MAPS.find(m=>m.id===id);assert(chosen,'Unknown map: '+id);
  const zones=chosen.assetZones||[...new Set([chosen.zone,'common','nacht'])];
  const [manifest,presentation,world,preload]=await Promise.all([
    read(chosen.data+'/manifest.json'),read(chosen.data+'/presentation.json'),
    read(chosen.zone+'/web-world/'+chosen.asset+'.json'),read(id==='nacht'?'preload.json':chosen.data+'/preload.json')]);
  const urls=new Set();
  for(const pack of preload.packs){
    const file=await open(path.join(root,'.cache/preload',pack.file),'r');
    try{
      const header=Buffer.alloc(12);assert.equal((await file.read(header,0,12,0)).bytesRead,12);
      assert.equal(header.toString('ascii',0,4),'WWPK');assert.equal(header.readUInt32LE(4),1);
      const length=header.readUInt32LE(8);assert(length<=pack.bytes-12,'Invalid pack index');
      const index=Buffer.alloc(length);assert.equal((await file.read(index,0,length,12)).bytesRead,length);
      for(const entry of JSON.parse(index.toString('utf8'))){
        assert(entry.offset>=0&&entry.length>=0&&12+length+entry.offset+entry.length<=pack.bytes,'Invalid packed asset: '+entry.url);
        urls.add(entry.url);
      }
    }finally{await file.close();}
  }
  const clean=name=>name.replace(/^,/,''),assetUrl=relative=>'/data/'+relative.split('/').map(encodeURIComponent).join('/');
  const packed=(folder,name,suffix)=>zones.map(z=>assetUrl(`${z}/${folder}/${clean(name)}${suffix}`)).find(url=>urls.has(url));
  for(const effect of Object.values(presentation.effects||{}))for(const element of effect.elements||[])for(const url of element.textures||[]){
    const resolved=new URL(url,'http://asset'),key=resolved.pathname.split('/').map(s=>encodeURIComponent(decodeURIComponent(s))).join('/');
    assert(!resolved.hash&&!resolved.search&&urls.has(key),'Effect texture URL missing from pack: '+effect.name+' / '+url);
  }
  const names=new Set([...Object.values(presentation.powerups||{}),...world.staticModels.map(m=>m.model),
    ...Object.values(manifest.weapons).map(w=>w.secondaryModel).filter(Boolean),
    ...manifest.entities.filter(e=>e.classname==='script_model').map(e=>e.model),
    ...(manifest.characterArms||[]),presentation.actors?.body,presentation.actors?.head,
    presentation.gore?.neckModel,presentation.box?.teddyModel,...(manifest.map?.propModels||[])]);
  for(const weapon of Object.values(manifest.weapons||{})){
    if(weapon.originsElement)for(const [key,value]of Object.entries(weapon))if(/^attach(?:View|World)Model\d+$/.test(key)&&value)names.add(value);
    for(const key of ['gunModel','knifeModel','worldModel'])if(weapon[key])names.add(weapon[key]);
    if(weapon.weaponType==='projectile'&&weapon.projectileModel)names.add(weapon.projectileModel);
  }
  for(const gesture of Object.values(manifest.gestures||{}))if(gesture.gunModel)names.add(gesture.gunModel);
  for(const key of ['gunModel','projectileModel'])if(manifest.grenade?.[key])names.add(manifest.grenade[key]);
  if(manifest.map?.meleeUpgrade?.gunModel)names.add(manifest.map.meleeUpgrade.gunModel);
  for(const record of [...Object.values(manifest.equipment||{}),...Object.values(presentation.actorVariants||{}),...(manifest.playerBodies||[])]){
    for(const key of ['model','body','head','hat','gear','neckModel'])if(record[key])names.add(record[key]);
    for(const attachment of record.attachments||[])names.add(attachment.model);
  }
  let models=0;const materials=new Set(),textures=new Set();
  for(const name of names){
    if(!name||name.startsWith('*'))continue;
    const url=packed('model_export',name,'_lod0.glb');assert(url,'Original model missing from '+id+' pack: '+name);models++;
    const relative=decodeURIComponent(url.slice('/data/'.length)),buffer=await readFile(path.join(data,relative));
    assert.equal(buffer.toString('ascii',0,4),'glTF');
    const gltf=JSON.parse(buffer.toString('utf8',20,20+buffer.readUInt32LE(12)));
    for(const material of gltf.materials||[]){
      if(!material.name)continue;
      const record=packed('materials',material.name,'.json');if(!record)continue;materials.add(record);
      const native=await read(decodeURIComponent(record.slice('/data/'.length))),color=nativeDiffuse(native);
      if(color){const image=packed('images',color.image,'.dds');assert(image,'Original material texture missing from pack: '+color.image);textures.add(image);}
    }
    for(const image of gltf.images||[]){
      // assets.js generates the engine's flat normal texture in memory.
      if(!image.uri||image.uri.startsWith('data:')||/\/\$identitynormalmap\.dds$/i.test(image.uri))continue;
      const direct=new URL(image.uri,'http://asset'+url).pathname;
      const found=urls.has(direct)?direct:packed('images',decodeURIComponent(path.posix.basename(image.uri)).replace(/\.dds$/i,''),'.dds');
      assert(found,'Original GLB texture missing from pack: '+name+' / '+image.uri);textures.add(found);
    }
  }
  const animations=new Set([...Object.keys(presentation.animations||{}),...(manifest.playerAnimations||[]),
    ...manifest.entities.map(e=>e.closedAnim).filter(Boolean),...(manifest.map?.propAnimations||[]),...(manifest.map?.arthurAnimations||[])]);
  for(const actor of Object.values(presentation.actorVariants||{}))for(const name of Object.values(actor.animations||{}))animations.add(name);
  for(const record of [...Object.values(manifest.weapons||{}),...Object.values(manifest.gestures||{}),manifest.grenade||{},manifest.map?.meleeUpgrade||{}])
    for(const [key,value]of Object.entries(record))if(key.endsWith('Anim')&&!/Camera|camera/.test(key)&&value)animations.add(value);
  for(const item of Object.values(manifest.equipment||{}))for(const name of [item.animation,item.launchAnimation].filter(Boolean))animations.add(name);
  const missingAnimations=[...animations].filter(name=>!packed('web-anims',name,'.json'));
  assert.deepEqual(missingAnimations,[],'Original animations missing from '+id+' pack');
  const result={map:id,models,materials:materials.size,textures:textures.size,animations:animations.size,packedAssets:urls.size};
  console.log('Prepared model pack check passed: '+JSON.stringify(result));return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await validateMapModels(process.argv[process.argv.indexOf('--map')+1]||'tranzit');
