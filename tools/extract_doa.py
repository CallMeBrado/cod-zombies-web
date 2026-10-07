"""Export the installed Black Ops Dead Ops Arcade fastfiles entirely on E:."""
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
GAME = Path(r'E:\SteamLibrary\steamapps\common\Call of Duty Black Ops')
DATA = ROOT / 'local-data'
base = [str(ROOT / '.tools/oat-source/build/bin/Release_x86/Unlinker.exe'), '--no-color',
        '--image-format', 'DDS', '--model-format', 'GLB', '--include-assets',
        'rawfile,mapents,weapon,material,image,font,xmodel,gfxworld,comworld,gameworldsp,clipmap,soundbank,xanim,fx']
for filename, output, dependencies in [
    ('Common/common_zombie', 'bo1-doa-common', ['Common/common']),
    ('Common/zombietron', 'bo1-doa', ['Common/common', 'Common/common_zombie']),
    ('Common/zombietron_patch', 'bo1-doa-patch', ['Common/common', 'Common/common_zombie', 'Common/zombietron']),
    ('English/en_zombietron', 'bo1-doa-english', ['Common/zombietron']),
]:
    folder = DATA / output
    args = base + ['--output-folder', str(folder)]
    if output == 'bo1-doa-common':
        args = args[:args.index('--include-assets')] + ['--include-assets', 'xanim', '--output-folder', str(folder)]
    for dependency in dependencies:
        args += ['--load', str(GAME / 'zone' / (dependency + '.ff'))]
    args.append(str(GAME / 'zone' / (filename + '.ff')))
    print('Extracting ' + filename, flush=True)
    with (DATA / (output + '-extract.log')).open('w') as log:
        subprocess.run(args, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, check=True)
    print('Finished ' + output, flush=True)
