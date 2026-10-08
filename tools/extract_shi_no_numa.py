"""Export the installed Shi No Numa map and recover its IWD image dependencies on E:."""
from pathlib import Path
from zipfile import ZipFile
import json, os, struct, subprocess

ROOT=Path(__file__).resolve().parents[1]
GAME=Path(r'E:\SteamLibrary\steamapps\common\Call of Duty World at War')
DATA=ROOT/'local-data'; ZONES=GAME/'zone/english'
SEARCH=['shi-no-numa-patch','shi-no-numa','common','nacht']

def extract():
    scratch=ROOT/'.cache/temp'; scratch.mkdir(parents=True,exist_ok=True)
    env=dict(os.environ,TEMP=str(scratch),TMP=str(scratch))
    base=[str(ROOT/'.tools/oat-source/build/bin/Release_x86/Unlinker.exe'),'--no-color','--image-format','DDS','--model-format','GLB',
          '--include-assets','rawfile,mapents,weapon,material,image,font,xmodel,gfxworld,comworld,gameworldsp,clipmap,sound,loadedsound,xanim,fx']
    for zone,folder,dependencies in [('nazi_zombie_sumpf','shi-no-numa',['common']),
        ('localized_nazi_zombie_sumpf','shi-no-numa',['common','nazi_zombie_sumpf']),
        ('nazi_zombie_sumpf_patch','shi-no-numa-patch',['common','nazi_zombie_sumpf'])]:
        output=DATA/folder; output.mkdir(parents=True,exist_ok=True)
        command=base+['--output-folder',str(output)]
        for dependency in dependencies: command+=['--load',str(ZONES/(dependency+'.ff'))]
        print('Extracting '+zone,flush=True)
        with (DATA/(zone+'-extract.log')).open('w',encoding='utf-8') as log:
            subprocess.run(command+[str(ZONES/(zone+'.ff'))],cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT,check=True)
    world=json.loads((DATA/'shi-no-numa/web-world/nazi_zombie_sumpf.json').read_text())
    wanted={m[k].lstrip(',') for m in world['materials'].values() for k in ['diffuse','normal'] if m.get(k)}
    for zone in SEARCH:
        for source in (DATA/zone/'model_export').glob('*_lod0.glb'):
            raw=source.read_bytes(); size,kind=struct.unpack_from('<II',raw,12)
            if kind!=0x4E4F534A: continue
            wanted.update(Path(image['uri']).stem.lstrip(',') for image in json.loads(raw[20:20+size]).get('images',[])
                          if image.get('uri','').endswith('.dds'))
    missing={n for n in wanted if '$identity' not in n and not any((DATA/z/'images'/(n+'.dds')).is_file() for z in SEARCH)}
    sources={}
    for archive in sorted((GAME/'main').glob('*.iwd')):
        with ZipFile(archive) as bundle:
            lookup={n.casefold():n for n in bundle.namelist()}
            for name in missing:
                member=lookup.get(('images/'+name+'.iwi').casefold())
                if member: sources[name]=(archive,member)
    for name,(archive,member) in sources.items():
        target=DATA/'shi-no-numa/images'/(name+'.iwi'); target.parent.mkdir(parents=True,exist_ok=True)
        with ZipFile(archive) as bundle: target.write_bytes(bundle.read(member))
        subprocess.run([str(ROOT/'.tools/oat/ImageConverter.exe'),'--no-color',str(target)],cwd=ROOT,env=env,check=True,stdout=subprocess.DEVNULL)
    print('Shi No Numa extracted; recovered '+str(len(sources))+' IWD images; unresolved '+str(sorted(missing-sources.keys())),flush=True)

if __name__=='__main__': extract()
