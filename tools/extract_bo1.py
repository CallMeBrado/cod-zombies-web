"""Export the locally installed BO1 assets for Kino without running the game."""
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
GAME = Path(r'E:\SteamLibrary\steamapps\common\Call of Duty Black Ops')
base = [str(ROOT / '.tools/oat-source/build/bin/Release_x86/Unlinker.exe'), '--no-color',
        '--image-format', 'DDS', '--model-format', 'GLB', '--include-assets',
        'rawfile,mapents,weapon,material,image,font,xmodel,gfxworld,comworld,gameworldsp,clipmap,soundbank,xanim,fx']
for filename, output, dependencies in [
    ('Common/code_post_gfx', 'bo1-ui', []),
    ('Common/common', 'bo1-base', []),
    ('Common/common_zombie', 'bo1-common', ['Common/common']),
    ('Common/zombie_theater', 'bo1-kino', ['Common/common', 'Common/common_zombie']),
    ('English/en_zombie_theater', 'bo1-english', ['Common/zombie_theater']),
]:
    folder = ROOT / 'local-data' / output
    args = base + ['--output-folder', str(folder)]
    for dependency in dependencies:
        args += ['--load', str(GAME / 'zone' / (dependency + '.ff'))]
    args.append(str(GAME / 'zone' / (filename + '.ff')))
    print('Extracting ' + filename, flush=True)
    with (ROOT / 'local-data' / (output + '-extract.log')).open('w') as log:
        subprocess.run(args, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, check=True)
    print('Finished ' + output, flush=True)
