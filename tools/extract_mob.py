"""Export the owned T6 Mob of the Dead map and decompile its scripts on E:."""
from pathlib import Path
import os, subprocess, shutil

ROOT = Path(__file__).resolve().parents[1]
GAME = Path(r'E:\SteamLibrary\steamapps\common\Call of Duty Black Ops II')
ZONES = [
    ('all/zm_prison', 'bo2-mob', ['all/common_zm']),
    ('all/so_zclassic_zm_prison', 'bo2-mob-classic', ['all/common_zm', 'all/zm_prison']),
    ('all/zm_prison_patch', 'bo2-mob-patch', ['all/common_zm', 'all/zm_prison', 'all/so_zclassic_zm_prison']),
    ('english/en_zm_prison', 'bo2-mob-english', ['all/common_zm', 'all/zm_prison']),
    ('all/dlc2_load_zm', 'bo2-mob-load', ['all/code_post_gfx_zm']),
    ('english/en_dlc2_load_zm', 'bo2-mob-english', ['all/code_post_gfx_zm','all/dlc2_load_zm']),
]

def main():
    # The shipping FF references dlc2, while Zombies textures live in dlczm2.
    # Keep this in the local exporter, matching its existing DLC1/3/4 fixups.
    loader = ROOT/'.tools/oat-source/src/ObjLoading/Game/T6/ObjLoaderT6.cpp'
    source = loader.read_text(encoding='utf-8')
    line = '        if(zone.m_name.find("prison")!=std::string::npos)LoadIPakForZone(searchPath,"dlczm2",zone);'
    if line not in source:
        anchor = '        LoadIPakForZone(searchPath,"patch_zm",zone);'
        if anchor not in source: raise RuntimeError('Local T6 exporter layout changed')
        loader.write_text(source.replace(anchor,line+'\n'+anchor),encoding='utf-8')
        with (ROOT/'local-data/bo2-mob-exporter-build.log').open('w') as log:
            subprocess.run(['powershell','-NoProfile','-File',str(ROOT/'tools/build_exporter.ps1')],cwd=ROOT,stdout=log,stderr=subprocess.STDOUT,check=True)
    for shared in ['bo2-common', 'bo2-base', 'bo2-ui', 'bo2-menu', 'bo2-ui-base', 'bo2-english']:
        if not (ROOT/'local-data'/shared).is_dir():
            subprocess.run(['python', '-B', str(ROOT/'tools/extract_bo2.py'), '--zone', shared], cwd=ROOT, check=True)
    scratch = ROOT/'.cache/temp'; scratch.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ, TEMP=str(scratch), TMP=str(scratch))
    exporter = ROOT/'.tools/oat-source/build/bin/Release_x86/Unlinker.exe'
    scripts = ROOT/'local-data/bo2-mob-scripts'; scripts.mkdir(parents=True, exist_ok=True)
    for zone, folder, dependencies in ZONES:
        output = ROOT/'local-data'/folder; output.mkdir(parents=True, exist_ok=True)
        command = [str(exporter), '--no-color', '--image-format', 'DDS', '--model-format', 'GLB',
                   '--search-path', str(GAME/'zone/all')+';'+str(GAME/'sound'), '--output-folder', str(output),
                   '--include-assets', 'rawfile,script,mapents,weapon,material,image,xmodel,gfxworld,comworld,gameworldsp,gameworldmp,clipmap,soundbank,xanim,fx,zbarrier,stringtable,localize']
        for dependency in dependencies: command += ['--load', str(GAME/'zone'/(dependency+'.ff'))]
        print('Extracting '+zone, flush=True)
        with (ROOT/'local-data'/(folder+'-extract.log')).open('w') as log:
            subprocess.run(command+[str(GAME/'zone'/(zone+'.ff'))], cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT, check=True)
        with (ROOT/'local-data'/(folder+'-decompile.log')).open('w') as log:
            subprocess.run([str(ROOT/'.tools/gsc-tool/gsc-tool.exe'), '-m', 'decomp', '-g', 't6', '-s', 'pc', str(output)], cwd=scripts, env=env, stdout=log, stderr=subprocess.STDOUT, check=True)
        generated = scripts/'decompiled/t6'
        if generated.exists(): shutil.copytree(generated, scripts/'t6', dirs_exist_ok=True)
        print('Finished '+folder, flush=True)

if __name__ == '__main__': main()
