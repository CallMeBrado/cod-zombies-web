"""Recover readable owned T6 scripts under ignored local-data, entirely on E:."""
from pathlib import Path
import subprocess, shutil

ROOT=Path(__file__).resolve().parents[1]
output=ROOT/'local-data/bo2-scripts'
output.mkdir(parents=True,exist_ok=True)
with (ROOT/'.cache/bo2-decompile.log').open('w') as log:
    for zone in ['bo2-common','bo2-base','bo2-classic','bo2-patch','bo2-buried']:
        subprocess.run([str(ROOT/'.tools/gsc-tool/gsc-tool.exe'),'-m','decomp','-g','t6','-s','pc',str(ROOT/'local-data'/zone)],cwd=output,stdout=log,stderr=subprocess.STDOUT,check=True)
        generated=output/'decompiled/t6'
        if generated.exists():
            shutil.copytree(generated,output/'t6',dirs_exist_ok=True)
print('Recovered T6 gameplay scripts on E:.')
