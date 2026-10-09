# Town Survival

Play at `/black-ops-2/?map=town`. In the BO2 map selector, choose Green Run,
then **Town · Survival**. TranZit remains a separate mode on the same globe pin.

The port uses the installed BO2 Town world, textures, baked lightmaps,
Green Run sky, CIA/CDC models, weapon and zombie animations, and Survival
loading artwork. Its rules come from the owned `zm_transit_standard_town.gsc`
and `zm_transit_lava.gsc`. This is gameplay reconstructed on the browser T6
runtime; it does not execute the original game binary or GSC interpreter.

Power starts on. The map includes two mystery-box sites, the original wall
buys, Galvaknuckles, five solo perk machines, Pack-a-Punch, barrier repairs,
lava damage, burning-zombie death blasts, round progression and server saves.
The four native Survival collision brushes are exported from the original
Town collision model. Only Town geometry and nearby scenery are prepared,
retaining native surface, brush-model and navigation references.

One original start on clear pavement is used so a solo player does not burn
while the opening finishes. Slow zombies probe pavement seams at their
animation speed. An actor stranded by native rubble is retried through an
authored spawn, retaining its health and place in the round.

The installed game has no separate Town loading movie. The launch screen uses
Town's original Survival artwork and native Green Run underscore in a stereo
movie, with the shared byte-based progress bar and ready-only skip control.

Semtex purchasing is pending; frag grenades work. Tombstone is removed in
solo, matching the original solo setup. Grief and Turned are not modes in
this port.

Rebuild on E: with `npm run extract:town` and `npm run prepare:town`.
Run `npm run test:town` for native asset-pack validation, original exit
collision, floors at 30–240 FPS, purchases, Pack-a-Punch, lava, save/restore,
three naturally spawned rounds and HTTP/loading/private-file checks.

Browser validation uses the main server and native rendered actors. Evidence
is kept privately under `local-data/town-browser-test.json` and
`local-data/town-gameplay-test.png`, outside Git.
