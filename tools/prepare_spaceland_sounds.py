"""Decode selected native IW7 SAB v4 FLAC frames to browser audio on E:."""
import argparse
import json
import struct
import subprocess
from pathlib import Path
from iw7_memory import Memory,state,assets
from extract_spaceland import OUTPUT,PRIVATE,key


def prepare(pid):
    context=state();memory=Memory(pid);aliases={}
    for asset in assets(memory,context['pools'],20):
        if asset['temporary']:continue
        bank=asset['header'];count=memory.unpack('<I',bank+32)[0];table=memory.pointer(bank+40)
        for i in range(count):
            at=table+i*32;name=memory.string(memory.pointer(at));head=memory.pointer(at+16);n=memory.unpack('<I',at+24)[0]
            if name in aliases:continue
            rows=[]
            for j in range(min(n,8)):
                p=head+j*200;filename=memory.string(memory.pointer(p+32)) if memory.pointer(p+32) else ''
                secondary=memory.string(memory.pointer(p+16)) if memory.pointer(p+16) else None
                rows.append({'id':memory.unpack('<I',p+52)[0],'file':filename,'volume':memory.unpack('<f',p+76)[0],'secondary':secondary})
            aliases[name]=rows
    chosen=[name for name in aliases if name in ['mus_zombies_newwave','mus_zombies_newwave_lsrs','mus_zombies_endwave','mus_zombies_endwave_lsrs','zmb_walk','zmb_run','zmb_attack_swipe'] or name.startswith(('wondercard_','vm_gesture_zmb_load_in_')) or name.startswith(('weap_g18_','weap_m1_')) and 'plr' in name and 'pap' not in name or name.startswith('wpn_') and ('g18' in name or 'knife' in name)]
    for name in chosen:
        for row in aliases[name]:
            if row['secondary'] in aliases and row['secondary'] not in chosen:chosen.append(row['secondary'])
    wanted={row['id'] for name in chosen for row in aliases[name]};found={}
    directory=Path(context['directory']);files=list(directory.glob('*.sabl'))+list(directory.glob('*.sabs'))+list((directory/'english').glob('*.sabl'))+list((directory/'english').glob('*.sabs'))
    for path in files:
        with path.open('rb') as stream:
            h=stream.read(56)
            if len(h)<56:continue
            magic,version,stride,_,_,count=struct.unpack_from('<6I',h)
            if magic!=0x23585532 or version!=4:continue
            offset=struct.unpack_from('<Q',h,40)[0];stream.seek(offset);table=stream.read(count*stride)
            for i in range(count):
                entry=table[i*stride:(i+1)*stride];ident,size,seek,samples,_,data,rate,channels=struct.unpack_from('<5IQIB',entry)
                if ident in wanted and ident not in found and size>0:found[ident]=(path,data+seek,size,rate,channels,samples)
    (OUTPUT/'audio').mkdir(exist_ok=True);(PRIVATE/'audio').mkdir(exist_ok=True);exported={};missing=[]
    for name in chosen:
        results=[]
        for row in aliases[name]:
            if row['id'] not in found:missing.append(name);continue
            path,offset,size,rate,channels,samples=found[row['id']];url='audio/'+key(str(row['id']))+'.ogg';out=OUTPUT/url
            if not out.exists():
                with path.open('rb') as stream:stream.seek(offset);data=stream.read(size)
                # STREAMINFO contains channel count/rate so ffmpeg doesn't guess.
                packed=(rate<<44)|((channels-1)<<41)|(15<<36)|samples
                header=b'fLaC'+bytes([0x80,0,0,34])+struct.pack('>HH',16,65535)+bytes(6)+packed.to_bytes(8,'big')+bytes(16)
                source=PRIVATE/'audio'/f'{row["id"]}.flac';source.write_bytes(header+data)
                subprocess.run(['ffmpeg','-v','error','-y','-i',str(source),'-ac','2','-c:a','libvorbis','-q:a','4',str(out)],check=True,capture_output=True)
            results.append({'url':url,'bytes':out.stat().st_size,'volume':max(.1,min(1,row['volume'])),'secondary':row['secondary']})
        if results:exported[name]=results
    memory.close();(OUTPUT/'sounds.json').write_text(json.dumps(exported,separators=(',',':')),encoding='utf8')
    (PRIVATE/'sound-extraction-report.json').write_text(json.dumps({'aliases':len(exported),'missing':missing},indent=2),encoding='utf8');print('Prepared',len(exported),'native sound aliases; missing',len(missing))


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--pid',type=int,required=True);prepare(p.parse_args().pid)
