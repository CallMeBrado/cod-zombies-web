"""The Black Ops zombies maps prepared from the installed game (all on E:).

zone: the map's own extracted fastfile; search: zones searched for its
assets, newest first; english: its localized zone (voice and sounds)."""
BO1_MAPS = {
    'kino': dict(id='kino', zone='bo1-kino', asset='zombie_theater', data='gameplay/bo1-kino', english='bo1-english',
                 search=['bo1-kino', 'bo1-common', 'bo1-base', 'bo1-english', 'bo1-ui'],
                 bodies=[{'name': 'Dempsey', 'body': 'c_usa_dempsey_body'},
                         {'name': 'Nikolai', 'body': 'c_rus_nikolai_body'},
                         {'name': 'Takeo', 'body': 'c_jap_takeo_body'},
                         {'name': 'Richtofen', 'body': 'c_ger_richtofen_body', 'head': 'c_ger_richtofen_head', 'hat': 'c_ger_richtofen_offcap'}]),
    'ascension': dict(id='ascension', zone='bo1-cosmodrome', asset='zombie_cosmodrome', data='gameplay/bo1-cosmodrome', english='bo1-cosmodrome-english',
                      search=['bo1-cosmodrome-patch', 'bo1-cosmodrome', 'bo1-common', 'bo1-base', 'bo1-cosmodrome-english', 'bo1-english', 'bo1-ui'],
                      # character/c_*_dlc2.gsc: the crew's Ascension outfits.
                      bodies=[{'name': 'Dempsey', 'body': 'c_usa_dempsey_dlc2_body'},
                              {'name': 'Nikolai', 'body': 'c_rus_nikolai_dlc2_body'},
                              {'name': 'Takeo', 'body': 'c_jap_takeo_dlc2_body'},
                              {'name': 'Richtofen', 'body': 'c_ger_richtofen_dlc2_body'}]),
}
