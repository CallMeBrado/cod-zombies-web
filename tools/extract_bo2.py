"""Export owned T6 Buried assets locally; all output and scratch stay on E:."""
from pathlib import Path
import subprocess, argparse, os

ROOT = Path(__file__).resolve().parents[1]
GAME = Path(r'E:\SteamLibrary\steamapps\common\Call of Duty Black Ops II')
ZONES = [
    ('all/code_post_gfx_zm', 'bo2-ui', []),
    ('all/common_zm', 'bo2-common', []),
    ('all/patch_zm', 'bo2-base', ['all/common_zm']),
    ('all/patch_ui_zm', 'bo2-menu', ['all/code_post_gfx_zm']),
    ('all/ui_zm', 'bo2-ui-base', ['all/code_post_gfx_zm']),
    ('all/dlc3_load_zm', 'bo2-dlc', ['all/code_post_gfx_zm']),
    ('all/zm_buried', 'bo2-buried', ['all/common_zm']),
    ('all/so_zclassic_zm_buried', 'bo2-classic', ['all/common_zm', 'all/zm_buried']),
    ('all/zm_buried_patch', 'bo2-patch', ['all/common_zm', 'all/zm_buried', 'all/so_zclassic_zm_buried']),
    ('english/en_zm_buried', 'bo2-english', ['all/common_zm', 'all/zm_buried']),
    ('english/en_common_zm', 'bo2-english', ['all/common_zm']),
    ('english/en_code_post_gfx_zm', 'bo2-english', ['all/code_post_gfx_zm']),
    ('english/en_dlc3_load_zm', 'bo2-english', ['all/code_post_gfx_zm']),
]
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--zone', choices=[z[1] for z in ZONES])
    parser.add_argument('--list', action='store_true')
    parser.add_argument('--types', default='rawfile,script,mapents,weapon,material,image,font,fonticon,xmodel,gfxworld,comworld,gameworldsp,gameworldmp,clipmap,soundbank,xanim,fx,zbarrier,stringtable,localize')
    args = parser.parse_args()
    scratch = ROOT / '.cache/temp'
    scratch.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ, TEMP=str(scratch), TMP=str(scratch))
    exporter = ROOT / '.tools/oat-source/build/bin/Release_x86/Unlinker.exe'
    base = [str(exporter), '--no-color', '--image-format', 'DDS', '--model-format', 'GLB',
            '--search-path', str(GAME / 'zone/all')+';'+str(GAME / 'sound')]
    for zone, output, dependencies in ZONES:
        if args.zone and args.zone != output:
            continue
        folder = ROOT / 'local-data' / output
        folder.mkdir(parents=True, exist_ok=True)
        command = base + ['--output-folder', str(folder), '--include-assets', args.types]
        for dependency in dependencies:
            command += ['--load', str(GAME / 'zone' / (dependency+'.ff'))]
        if args.list:
            command += ['--list']
        command += [str(GAME / 'zone' / (zone+'.ff'))]
        print('Extracting '+zone, flush=True)
        with (ROOT / 'local-data' / (output+('-list' if args.list else '-extract')+'.log')).open('w') as log:
            subprocess.run(command, cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT, check=True)
        print('Finished '+output, flush=True)
if __name__ == '__main__':
    main()
