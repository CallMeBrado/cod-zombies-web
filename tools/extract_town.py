"""Extract owned Green Run Survival mode; reuse the native TranZit world on E:."""
from pathlib import Path
import os, subprocess, shutil
ROOT=Path(__file__).resolve().parents[1]
GAME=Path(r'E:\SteamLibrary\steamapps\common\Call of Duty Black Ops II')
ZONES=[('all/so_zsurvival_zm_transit','bo2-town-mode',['all/common_zm','all/zm_transit']),('english/en_so_zsurvival_zm_transit','bo2-town-english',['all/common_zm','all/zm_transit','all/so_zsurvival_zm_transit'])]
def main():
    subprocess.run(['python','-B',str(ROOT/'tools/patch_town_exporter.py')],cwd=ROOT,check=True)
    if not (ROOT/'local-data/bo2-tranzit/web-world/zm_transit.json').exists():
        subprocess.run(['python','-B',str(ROOT/'tools/extract_tranzit.py')],cwd=ROOT,check=True)
        subprocess.run(['python','-B',str(ROOT/'tools/prepare_tranzit.py')],cwd=ROOT,check=True)
    scratch=ROOT/'.cache/temp';scratch.mkdir(parents=True,exist_ok=True);env=dict(os.environ,TEMP=str(scratch),TMP=str(scratch))
    scripts=ROOT/'local-data/bo2-town-scripts';scripts.mkdir(parents=True,exist_ok=True)
    for zone,folder,deps in ZONES:
        output=ROOT/'local-data'/folder;output.mkdir(parents=True,exist_ok=True)
        args=[str(ROOT/'.tools/oat-source/build/bin/Release_x86/Unlinker.exe'),'--no-color','--image-format','DDS','--model-format','GLB','--search-path',str(GAME/'zone/all')+';'+str(GAME/'sound'),'--output-folder',str(output),'--include-assets','rawfile,script,mapents,weapon,material,image,xmodel,gfxworld,comworld,gameworldsp,gameworldmp,clipmap,soundbank,xanim,fx,zbarrier,stringtable,localize']
        for dep in deps:args+=['--load',str(GAME/'zone'/(dep+'.ff'))]
        print('Extracting '+zone,flush=True)
        with (ROOT/'local-data'/(folder+'-extract.log')).open('w') as log:subprocess.run(args+[str(GAME/'zone'/(zone+'.ff'))],cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT,check=True)
        with (ROOT/'local-data'/(folder+'-decompile.log')).open('w') as log:subprocess.run([str(ROOT/'.tools/gsc-tool/gsc-tool.exe'),'-m','decomp','-g','t6','-s','pc',str(output)],cwd=scripts,env=env,stdout=log,stderr=subprocess.STDOUT,check=True)
        generated=scripts/'decompiled/t6'
        if generated.exists():shutil.copytree(generated,scripts/'t6',dirs_exist_ok=True)
        print('Finished '+folder,flush=True)
if __name__=='__main__':main()
