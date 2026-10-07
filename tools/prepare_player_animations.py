"""Co-op teammates: third-person player animations (pb_*) and character models.

Black Ops: exports the player body clips from common_zombie.ff (xanims only,
into .cache/pb-anims) and copies the runtime's set into the Kino folder.
World at War: the same from common.ff (into .cache/waw-pb-anims, copied to
the shared common folder), plus each map's four player characters from the
original character scripts (Nacht's char_usa_marine_player1-4, Der Riese's
Dempsey, Nikolai, Takeo and Richtofen). Both are listed in each manifest as
`playerAnimations` and `playerBodies`.
"""
import json
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
GAME = Path(r'E:\SteamLibrary\steamapps\common\Call of Duty Black Ops')
WAW = Path(r'E:\SteamLibrary\steamapps\common\Call of Duty World at War')
CACHE = ROOT / '.cache/pb-anims'
WAW_CACHE = ROOT / '.cache/waw-pb-anims'
UNLINKER = ROOT / '.tools/oat-source/build/bin/Release_x86/Unlinker.exe'
DIRECTIONS = ['forward', 'back', 'left', 'right']
CLIPS = ['pb_stand_alert', 'pb_stand_alert_pistol', 'pb_stand_ads', 'pb_stand_ads_pistol', 'pb_sprint', 'pb_sprint_pistol',
         *[f'pb_combatrun_{d}_loop' for d in DIRECTIONS], *[f'pb_combatrun_{d}_loop_pistol' for d in ['back', 'left', 'right']], 'pb_pistol_run_fast',
         *[f'pb_stand_shoot_walk_{d}' for d in DIRECTIONS], *[f'pb_combatwalk_{d}_loop_pistol' for d in DIRECTIONS],
         'pb_crouch_alert', 'pb_crouch_alert_pistol', *[f'pb_crouch_run_{d}' for d in DIRECTIONS], *[f'pb_crouch_run_{d}_pistol' for d in DIRECTIONS],
         'pb_prone_aim', 'pb_prone_aim_pistol', 'pb_prone_crawl', 'pb_prone_crawl_back', 'pb_prone_crawl_left', 'pb_prone_crawl_right',
         'pb_prone_crawl_pistol', 'pb_prone_crawl_pistol_back', 'pb_prone_pistol_crawl_left', 'pb_prone_pistol_crawl_right',
         'pb_dive_prone', 'pb_dive_prone_pistol', 'pb_dive_prone_land',
         'pb_laststand_idle', *[f'pb_laststand_crawl_{d}' for d in DIRECTIONS], 'pb_stand2laststand',
         'pb_standjump_takeoff', 'pb_standjump_land', 'pb_standjump_takeoff_pistol', 'pb_standjump_land_pistol']
# World at War has no dive and crawls in last stand with its prone pistol crawl.
WAW_CLIPS = [c for c in CLIPS if 'dive' not in c and 'laststand_crawl' not in c and c != 'pb_stand2laststand'] + \
    ['pb_prone_pistolcrawl_' + d for d in 'fblr']
# char_usa_marine_player1-4.gsc (Nacht) and Der Riese's four characters.
WAW_BODIES = {
    'gameplay': [{'name': 'Player ' + str(i + 1), 'body': body, 'head': head, 'hat': hat, 'gear': gear} for i, (body, head, hat, gear) in enumerate([
        ('char_usa_marine_player_body1_1', 'char_usa_marine_head1_1', 'char_usa_raider_helm1', 'char_usa_raider_gear2'),
        ('char_usa_marine_player_body2_1', 'char_usa_marine_head2_2', 'char_usa_raider_helm2', 'char_usa_raider_gear3'),
        ('char_usa_marine_player_body1_1', 'char_usa_marine_head3_3', 'char_usa_raider_helm2', 'char_usa_raider_gear2'),
        ('char_usa_marine_player_body2_1', 'char_usa_marine_head4_4', 'char_usa_raider_helm1', 'char_usa_raider_gear3')])],
    'gameplay/der-riese': [
        {'name': 'Dempsey', 'body': 'char_usa_marine_polonsky_zomb'},
        {'name': 'Nikolai', 'body': 'char_rus_guard_chernova_zomb'},
        {'name': 'Takeo', 'body': 'char_jap_impinf_officer_body_zomb', 'head': 'char_jap_impinf_officer_head', 'hat': 'char_jap_impinf_officer_hat_zomb'},
        {'name': 'Richtofen', 'body': 'char_ger_ansel_body_zomb', 'head': 'char_ger_ansel_head_zomb', 'hat': 'char_ger_waffen_officercap1_zomb'}],
}


def export(output, zones, log_name):
    args = [str(UNLINKER), '--no-color', '--include-assets', 'xanim', '--output-folder', str(output)]
    for zone in zones[:-1]:
        args += ['--load', str(zone)]
    args.append(str(zones[-1]))
    with (ROOT / 'local-data' / log_name).open('w') as log:
        subprocess.run(args, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, check=True)


def copy_clips(cache, clips, target, export_clips):
    if not all((cache / 'web-anims' / (name + '.json')).exists() for name in clips):
        export_clips()
    target.mkdir(parents=True, exist_ok=True)
    for name in clips:
        source = cache / 'web-anims' / (name + '.json')
        if not source.exists():
            raise RuntimeError('Missing player animation: ' + name)
        if not (target / source.name).exists() or (target / source.name).stat().st_mtime < source.stat().st_mtime:
            shutil.copy2(source, target / source.name)


def update_manifest(path, values):
    manifest = json.loads(path.read_text())
    if any(manifest.get(key) != value for key, value in values.items()):
        manifest.update(values)
        path.write_text(json.dumps(manifest, separators=(',', ':')))


def prepare():
    from bo1_maps import BO1_MAPS
    for m in BO1_MAPS.values():
        manifest = ROOT / 'local-data' / m['data'] / 'manifest.json'
        if not manifest.exists():
            continue
        common = GAME / 'zone/Common'
        copy_clips(CACHE, CLIPS, ROOT / 'local-data' / m['zone'] / 'web-anims',
                   lambda: export(CACHE, [common / 'common.ff', common / 'common_zombie.ff'], 'pb-anim-extract.log'))
        update_manifest(manifest, {'playerAnimations': CLIPS})
        print(f'Prepared {len(CLIPS)} Black Ops third-person player animations ({m["id"]})')
    waw = [(ROOT / 'local-data' / folder / 'manifest.json', bodies) for folder, bodies in WAW_BODIES.items()]
    if any(path.exists() for path, _ in waw):
        zone = WAW / 'zone/english'
        copy_clips(WAW_CACHE, WAW_CLIPS, ROOT / 'local-data/common/web-anims',
                   lambda: export(WAW_CACHE, [zone / 'code_post_gfx.ff', zone / 'common.ff'], 'waw-pb-anim-extract.log'))
        for path, bodies in waw:
            if not path.exists():
                continue
            for body in bodies:
                for key in ['body', 'head', 'hat', 'gear']:
                    if key in body and not any((ROOT / 'local-data' / zone / 'model_export' / (body[key] + '_lod0.glb')).exists() for zone in ['nacht', 'der-riese', 'common']):
                        raise RuntimeError('Missing character model: ' + body[key])
            update_manifest(path, {'playerAnimations': WAW_CLIPS, 'playerBodies': bodies})
        print(f'Prepared {len(WAW_CLIPS)} World at War third-person player animations and both maps\' player characters')


if __name__ == '__main__':
    prepare()
