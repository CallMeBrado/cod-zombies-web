"""Add the original arcade canine animation family to the local T5 exporter."""
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
p = ROOT / '.tools/oat-source/src/ObjWriting/XAnim/XAnimDumper.cpp.template'
text = p.read_text()
if 'webName.find("zombie_dog_")' not in text:
    text = text.replace('webName.find("ai_zombie_") == 0', 'webName.find("zombie_dog_") == 0 || webName.find("zd_") == 0 || webName.find("ai_zombie_") == 0')
    p.write_text(text)
print('Dead Ops canine animation exporter enabled.')
