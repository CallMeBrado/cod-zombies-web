"""Export the installed Origins (zm_tomb) map, its patch and English zone
onto E:, and decompile its scripts; all output stays under local-data."""
from pathlib import Path
import os, subprocess, shutil

ROOT = Path(__file__).resolve().parents[1]
GAME = Path(r'E:\SteamLibrary\steamapps\common\Call of Duty Black Ops II')
ZONES = [('all/zm_tomb', 'bo2-origins', ['all/common_zm']),
         ('all/zm_tomb_patch', 'bo2-origins-patch', ['all/common_zm', 'all/zm_tomb']),
         ('english/en_zm_tomb', 'bo2-origins-english', ['all/common_zm', 'all/zm_tomb'])]


def main():
    for shared in ['bo2-common', 'bo2-base', 'bo2-ui', 'bo2-menu', 'bo2-ui-base', 'bo2-english']:
        if not (ROOT/'local-data'/shared).is_dir():
            subprocess.run(['python', '-B', str(ROOT/'tools/extract_bo2.py'), '--zone', shared], cwd=ROOT, check=True)
    scratch = ROOT/'.cache/temp'; scratch.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ, TEMP=str(scratch), TMP=str(scratch))
    exporter = ROOT/'.tools/oat-source/build/bin/Release_x86/Unlinker.exe'
    scripts = ROOT/'local-data/bo2-origins-scripts'; scripts.mkdir(parents=True, exist_ok=True)
    for zone, folder, dependencies in ZONES:
        output = ROOT/'local-data'/folder; output.mkdir(parents=True, exist_ok=True)
        command = [str(exporter), '--no-color', '--image-format', 'DDS', '--model-format', 'GLB',
                   '--search-path', str(GAME/'zone/all')+';'+str(GAME/'sound'), '--output-folder', str(output),
                   '--include-assets', 'rawfile,script,mapents,weapon,material,image,xmodel,gfxworld,comworld,gameworldsp,gameworldmp,clipmap,soundbank,xanim,fx,zbarrier,stringtable,localize']
        for dependency in dependencies: command += ['--load', str(GAME/'zone'/(dependency+'.ff'))]
        print('Extracting '+zone, flush=True)
        with (ROOT/'local-data'/(folder+'-extract.log')).open('w') as log:
            subprocess.run(command+[str(GAME/'zone'/(zone+'.ff'))], cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT, check=True)
        if any((output/'maps').rglob('*.gsc')) or any(output.rglob('*.gscc')):
            with (ROOT/'local-data'/(folder+'-decompile.log')).open('w') as log:
                subprocess.run([str(ROOT/'.tools/gsc-tool/gsc-tool.exe'), '-m', 'decomp', '-g', 't6', '-s', 'pc', str(output)], cwd=scripts, env=env, stdout=log, stderr=subprocess.STDOUT, check=True)
            generated = scripts/'decompiled/t6'
            if generated.exists(): shutil.copytree(generated, scripts/'t6', dirs_exist_ok=True)
        print('Finished '+folder, flush=True)


if __name__ == '__main__': main()
