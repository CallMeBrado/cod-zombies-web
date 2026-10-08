"""Origins additions to the local OAT T6 exporter. Run after extend_bo2_exporter."""
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
source=ROOT/'.tools/oat-source/src'
loader=source/'ObjLoading/Game/T6/ObjLoaderT6.cpp'
text=loader.read_text(encoding='utf-8')
if 'Local browser export: Origins' not in text:
    if '        LoadIPakForZone(searchPath,"patch_zm",zone);' not in text:
        raise RuntimeError('Apply extend_bo2_exporter.py first: T6 IPak hook not found.')
    text=text.replace('        LoadIPakForZone(searchPath,"patch_zm",zone);', '''        // Local browser export: Origins uses dlczm4 rather than dlc4.
        if(zone.m_name.find("tomb")!=std::string::npos)LoadIPakForZone(searchPath,"dlczm4",zone);
        LoadIPakForZone(searchPath,"patch_zm",zone);''',1)
    loader.write_text(text,encoding='utf-8')
dumper=source/'ObjWriting/Game/T6/WebWorld/WebWorldDumperT6.cpp'
text=dumper.read_text(encoding='utf-8')
if 'name.find("zmb_staff")' not in text:
    if '&& name.find("raygun") == std::string::npos' not in text:
        raise RuntimeError('Apply extend_bo2_exporter.py first: T6 effect filter not found.')
    text=text.replace('&& name.find("raygun") == std::string::npos','&& name.find("zmb_staff") == std::string::npos && name.find("tomb") == std::string::npos && name.find("raygun") == std::string::npos',1)
    dumper.write_text(text,encoding='utf-8')
print('Installed Origins DLC texture and effect exporter support.')
