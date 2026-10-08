"""Extend the installed T5 exporter for Five's native freeze/portal effects.
Run after extend_bo1_exporter.py and before build_exporter.ps1.
"""
from pathlib import Path
root=Path(__file__).resolve().parents[1]
p=root/'.tools/oat-source/src/ObjWriting/Game/T5/WebWorld/WebWorldDumperT5.cpp'
s=p.read_text()
hook='&& name.find("fx_grenade_smoke_w") == std::string::npos'
if 'name.find("freezegun")' not in s:
    if hook not in s: raise RuntimeError('T5 effect export hook not found')
    s=s.replace(hook,'&& name.find("freezegun") == std::string::npos && name.find("freeze_gun") == std::string::npos && name.find("zombie_freeze") == std::string::npos && name.find("pentagon") == std::string::npos '+hook)
    p.write_text(s)
print('Installed Five native effect exporter.')
