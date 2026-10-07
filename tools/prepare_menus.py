"""Prepare each game's zombies menu from the installed games on E: (it exports
the menu zones it needs first): the original menu sounds and music, Black Ops II's
zombies menu art (space backdrop, asteroid belts and the location globe) and
the Black Ops frontend's monitor footage.

  World at War   code_post_gfx.ff: mouse_over / mouse_click, music_mainmenu
  Black Ops      code_post_gfx (bo1-ui): uin_navigation_*, mus_zmb_mainmenu;
                 video/int_screens.bik on the interrogation room monitors
  Black Ops II   code_post_gfx_zm / patch_ui_zm sound banks (bo2-ui-sounds):
                 cac_main_nav, cac_cmn_backout, the globe sounds and
                 mus_mp_frontend ("Damned 100AE"); ui_zm.ff art (bo2-ui-zm)

Output: local-data/gameplay/menus/<game>/ with menu.json describing it."""
from pathlib import Path
from zipfile import ZipFile
import csv, json, struct, subprocess, wave

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'local-data'
STEAM = Path(r'E:\SteamLibrary\steamapps\common')
OUT = DATA / 'gameplay' / 'menus'
CACHE = ROOT / '.cache'


def ffmpeg(*args):
    return subprocess.run(['ffmpeg', '-nostdin', '-y', '-loglevel', 'error', *map(str, args)], capture_output=True)


def iwd_index(game):
    index = {}
    for archive in sorted((STEAM / game / 'main').glob('*.iwd')):
        with ZipFile(archive) as z:
            for name in z.namelist(): index[name.casefold()] = (archive, name)
    return index


def iwd_bytes(index, name):
    where = index.get(name.casefold()) or index.get(('sound/' + name).casefold())
    if not where: return None
    with ZipFile(where[0]) as z: return z.read(where[1])


def encode(source, target, music=False):
    """Short UI sounds stay WAV; music becomes AAC like the loading movies."""
    args = ['-i', source] + (['-c:a', 'aac', '-b:a', '160k'] if music else ['-c:a', 'pcm_s16le'])
    result = ffmpeg(*args, target)
    return result.returncode == 0 and target.exists() and target.stat().st_size > 100


def bo1_audio(entry, index, zones, target, music):
    """A T5 alias variant: an IWD wav, or the fastfile's loaded WMA/BOA data."""
    name = entry['file'].replace('\\', '/').lstrip(',/')
    raw, scratch = iwd_bytes(index, name), CACHE / 'menu-audio.tmp'
    if raw:
        scratch.write_bytes(raw); return encode(scratch, target, music)
    meta = next((DATA / z / 'web-audio' / (name + '.json') for z in zones if (DATA / z / 'web-audio' / (name + '.json')).is_file()), None)
    if not meta: return False
    m = json.loads(meta.read_text()); raw = meta.with_suffix('.bin').read_bytes()
    if m['format'] == 7:
        # Headerless WMA2 packets: try the block alignments T5 uses.
        for align in ([4096, 2230, 2048, 1487, 1024] if m['channels'] == 2 else [2230, 1487, 2048, 4096, 1024]):
            if len(raw) % align: continue
            fmt = struct.pack('<HHIIHH', 0x161, m['channels'], m['rate'], 12000 if m['channels'] == 2 else 6000, align, 16)
            body = b'XWMA' + b'fmt ' + struct.pack('<I', len(fmt)) + fmt + b'data' + struct.pack('<I', len(raw)) + raw
            scratch.write_bytes(b'RIFF' + struct.pack('<I', len(body)) + body)
            if encode(scratch, target, music): return True
        return False
    if m['format'] == 6:
        header = bytearray(2096); struct.pack_into('<IIIII', header, 0, 1, m['frames'], m['rate'], m['channels'], 2096); struct.pack_into('<I', header, 21, m['blockSize'] >> 8)
        scratch.write_bytes(header + raw)
        return ffmpeg('-f', 'boa', '-i', scratch, *(['-c:a', 'aac', '-b:a', '160k'] if music else ['-c:a', 'pcm_s16le']), target).returncode == 0
    return False


def sounds_for(game, table, resolve):
    """table: role -> (alias, music?). Writes <role>.wav / .m4a; returns role -> {url, volume}."""
    folder = OUT / game; folder.mkdir(parents=True, exist_ok=True); out = {}
    for role, (alias, music) in table.items():
        found = resolve(alias)
        if not found: print(f'  {game}: no sound for {role} ({alias})'); continue
        source_fn, volume = found
        target = folder / (role + ('.m4a' if music else '.wav'))
        if source_fn(target, music): out[role] = {'alias': alias, 'url': '/data/' + target.relative_to(DATA).as_posix(), 'volume': round(volume, 3)}
        else: print(f'  {game}: could not decode {alias}')
    return out


def waw():
    index = iwd_index('Call of Duty World at War')
    def resolve(alias):
        p = DATA / 'waw-ui' / 'web-sounds' / (alias + '.json')
        if not p.is_file(): return None
        entry = json.loads(p.read_text())[0]; name = entry['file'].replace('\\', '/').lstrip(',/')
        def make(target, music):
            loaded = DATA / 'waw-ui' / 'sound' / name
            if loaded.is_file(): return encode(loaded, target, music)
            raw = iwd_bytes(index, name) or iwd_bytes(index, 'sound/' + name)
            if not raw: return False
            scratch = CACHE / ('menu-audio' + Path(name).suffix); scratch.write_bytes(raw); return encode(scratch, target, music)
        return make, entry.get('volume', 1)
    # The main menu's own sounds (ui_mp menus: onFocus mouse_over, action mouse_click).
    return {'sounds': sounds_for('waw', {'hover': ('mouse_over', False), 'click': ('mouse_click', False), 'submenu': ('mouse_submenu_over', False),
                                         'back': ('mouse_click', False), 'music': ('music_mainmenu', True)}, resolve)}


def bo1():
    index, zones = iwd_index('Call of Duty Black Ops'), ['bo1-ui', 'bo1-frontend', 'bo1-base', 'bo1-common']
    def resolve(alias):
        p = next((DATA / z / 'web-sounds' / (alias + '.json') for z in zones if (DATA / z / 'web-sounds' / (alias + '.json')).is_file()), None)
        if not p: return None
        entry = json.loads(p.read_text())[0]
        return (lambda target, music: bo1_audio(entry, index, zones, target, music)), entry.get('volume', 1)
    sounds = sounds_for('bo1', {'hover': ('uin_navigation_over', False), 'click': ('uin_navigation_click', False), 'back': ('uin_navigation_backout', False),
                                'open': ('uin_navigation_menu_sm_open', False), 'close': ('uin_navigation_menu_sm_close', False), 'music': ('mus_zmb_mainmenu', True)}, resolve)
    # Start3DCinematic("frontend"): the frontend fastfile's own frontend.bik,
    # an 8 x 8 atlas of 128-pixel tiles; bink_zombie_footage_select() puts
    # tiles 16-30 (zombie footage), 39 (bars), 47 (logo), 55 (Treyarch) and
    # 63 (static) on the monitors.
    video = OUT / 'bo1' / 'frontend.mp4'
    if not video.exists():
        r = ffmpeg('-i', DATA / 'bo1-frontend/bik/frontend.bik', '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '27', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', video)
        if r.returncode: print('  bo1: frontend.bik did not convert', r.stderr.decode()[:200])
    stale = OUT / 'bo1' / 'int_screens.mp4'
    if stale.exists(): stale.unlink()
    return {'sounds': sounds, 'monitors': '/data/gameplay/menus/bo1/frontend.mp4', 'world': {'zone': 'bo1-frontend', 'asset': 'frontend'}}


def bo2():
    base = DATA / 'bo2-ui-sounds'
    aliases = {}
    for bank in (base / 'soundbank').glob('*.aliases.csv'):
        with bank.open(newline='', encoding='utf-8', errors='replace') as f:
            for row in csv.DictReader(f):
                if row.get('Name') and row['Name'] not in aliases: aliases[row['Name']] = row
    def resolve(alias):
        row = aliases.get(alias)
        if not row: return None
        name = row['FileSource'].replace('\\', '/').split('raw/', 1)[-1]
        source = base / name
        if not source.is_file():
            # Banks store the primed and streamed copies under one source name.
            source = next(iter(source.parent.glob(source.name.split('.')[0] + '.*')), None) if source.parent.exists() else None
        if not source: return None
        volume = float(row.get('VolMin') or 100) / 100
        return (lambda target, music: encode(source, target, music)), volume
    sounds = sounds_for('bo2', {
        'hover': ('cac_main_nav', False), 'click': ('cac_submenu_edit_sel', False), 'back': ('cac_cmn_backout', False), 'deny': ('cac_cmn_deny', False),
        'spinStart': ('zmb_ui_globe_spin_start', False), 'spinStop': ('zmb_ui_globe_spin_stop', False), 'mapSwitch': ('zmb_ui_map_level_switch', False),
        'mapSelect': ('zmb_ui_map_level_select', False), 'globeIn': ('zmb_ui_globe_in_short_1', False), 'globeOut': ('zmb_ui_globe_out_short_1', False),
        'globeMoveIn': ('zmb_ui_globe_move_in', False), 'globeMoveOut': ('zmb_ui_globe_move_out', False), 'music': ('mus_mp_frontend', True)}, resolve)
    # ui_zm.ff's zombies menu art (lui_bkg_zm*, globe_map_zm, the signposts).
    folder = OUT / 'bo2'; art = {}
    for name in ['lui_bkg_zm', 'lui_bkg_zm_sun', 'lui_bkg_zm_flare', 'lui_bkg_zm_flare_left', 'lui_bkg_zm_meteor', 'lui_bkg_zm_rocks_back', 'lui_bkg_zm_rocks_front',
                 'lui_bkg_zm_rocks_front_forward', 'globe_map_zm', 'menu_zm_map_frame', 'zm_map_select_on', 'zm_map_select_off', 'menu_zm_title_screen',
                 'menu_zm_map_signpost', 'menu_zm_map_signpost_buried', 'menu_zm_map_signpost_transit', 'menu_zm_map_signpost_highrise', 'menu_zm_map_signpost_nuketown',
                 'menu_zm_map_signpost_tomb', 'zm_signpost_buried_glow', 'menu_zm_signpost_lightning']:
        source = DATA / 'bo2-ui-zm' / 'images' / (name + '.dds')
        if not source.is_file(): print('  bo2: missing', name); continue
        target = folder / (name + '.png')
        if ffmpeg('-i', source, target).returncode == 0: art[name] = '/data/' + target.relative_to(DATA).as_posix()
    # zm/mapstable.csv: each map's place on the globe (longitude, latitude).
    places = {}
    table = DATA / 'bo2-base' / 'zm' / 'mapstable.csv'
    if table.is_file():
        for row in csv.reader(table.open(encoding='utf-8')):
            if len(row) > 17 and row[0].startswith('zm_') and row[16]: places[row[0]] = {'longitude': float(row[16]), 'latitude': float(row[17]), 'signpost': row[4], 'name': row[3]}
    return {'sounds': sounds, 'art': art, 'places': places}


UNLINKER = ROOT / '.tools/oat-source/build/bin/Release_x86/Unlinker.exe'
BO2 = STEAM / 'Call of Duty Black Ops II'


def extract():
    """The menu zones, exported once with the project's exporter."""
    def unlink(output, assets, zone, *extra):
        if (DATA / output).exists(): return
        print('Extracting', Path(zone).name, flush=True)
        with (DATA / (output + '-extract.log')).open('w') as log:
            subprocess.run([str(UNLINKER), '--no-color', '--image-format', 'DDS', '--include-assets', assets, '-o', str(DATA / output), *extra, str(zone)],
                           cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, check=True)
    unlink('waw-ui', 'sound,loadedsound', STEAM / 'Call of Duty World at War/zone/english/code_post_gfx.ff')
    for zone in ['ui_zm', 'patch_ui_zm']:
        if not (DATA / 'bo2-ui-zm' / 'images' / 'globe_map_zm.dds').exists() or zone == 'patch_ui_zm' and not (DATA / 'bo2-ui-zm' / 'patch_ui_zm').exists():
            (DATA / 'bo2-ui-zm').mkdir(parents=True, exist_ok=True)
            subprocess.run([str(UNLINKER), '--no-color', '--image-format', 'DDS', '--include-assets', 'image,material,menu,menulist,rawfile,localize', '-o', str(DATA / 'bo2-ui-zm'), str(BO2 / 'zone/all' / (zone + '.ff'))],
                           cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT, check=True)
    if not (DATA / 'bo2-ui-sounds' / 'soundbank').exists():
        for zone in ['code_post_gfx_zm', 'patch_ui_zm']:
            subprocess.run([str(UNLINKER), '--no-color', '--search-path', f'{BO2 / "zone/all"};{BO2 / "sound"}', '--include-assets', 'soundbank', '-o', str(DATA / 'bo2-ui-sounds'), str(BO2 / 'zone/all' / (zone + '.ff'))],
                           cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT, check=True)
    if not (DATA / 'bo1-frontend' / 'web-world' / 'frontend.json').exists():
        subprocess.run(['python', '-B', str(ROOT / 'tools/extract_bo1.py'), '--map', 'frontend'], cwd=ROOT, check=True)


if __name__ == '__main__':
    CACHE.mkdir(exist_ok=True); OUT.mkdir(parents=True, exist_ok=True)
    extract()
    for game, build in [('waw', waw), ('bo1', bo1), ('bo2', bo2)]:
        print('Preparing', game, 'menu', flush=True)
        data = build(); (OUT / game).mkdir(parents=True, exist_ok=True)
        (OUT / game / 'menu.json').write_text(json.dumps(data, indent=1))
        print(f'  {len(data["sounds"])} sounds' + (f', {len(data.get("art", {}))} images' if 'art' in data else ''))
