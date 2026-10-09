# Mob of the Dead

Open `/black-ops-2/?map=mob-of-the-dead` or select Mob on the BO2 globe.
Press Start Game to load the map and its original movie. All three English
speaker stems (stereo, center and rear) are mixed into stereo. Skip becomes
available after the pack, original rigs, shaders and navigation are ready.

This first solo survival port uses the installed `zm_prison`, classic mode,
patch and English fastfiles. The native world has 224,550 triangles and 29
player volumes. The prepared pack validates 562 models, 705 textures and
809 animation dependencies. The four prisoners have their own viewhands,
character models and voice banks. Native guard zombies and Brutus have
their original models and animation clips; base combat, controllers,
stances, grenades, ragdolls, gore, pause/settings and named server saves
use the shared T6 runtime.

The match opens in Afterlife with the original ghost hands. Fire at a panel
within 256 units to supply its power or open its special door. Return to
the original body marker and hold Use for three seconds to revive. Afterlife
has 200 mana, drains three points per second per death that round, and costs
one mana per shot. Solo begins with three charges, spends one on the opening,
and replenishes one after a round up to three. Lethal damage enters Afterlife
while a charge remains; voluntary switch use retains perks. Its jump is
boosted and its original marked passages open while in ghost form.

Regular purchases, local perk power (Jugger-Nog, Speed Cola, Double Tap II,
Deadshot and Electric Cherry), wall weapons, the moving/cycling original
prison mystery box and Golden Gate Bridge Pack-a-Punch work. Collect the
five authored Icarus parts and use the roof bench, then board the plane.
The bridge chairs return to Alcatraz in Afterlife. Subsequent flights need
the five fuel cans. The powered gondola charges 750 points. Shield and Acid
Gat parts can be collected and assembled at a workbench. Brutus spawns on
reachable authored positions with his native body/helmet, growing health,
five helmet hits and 2,000-point machine/box lockdowns.

This is a browser reconstruction, not execution of the original game. The
full Easter egg/final confrontation, Hell's Retriever/Redeemer and dog-head
feeding, Golden Spork quest, complete prison traps, exact part retrieval
subquests and all scripted cinematic state machines are unfinished. Plane
and gondola trips currently use timed transfers between original floor
destinations rather than the complete moving vehicle simulation. Ghost
shocks activate panels and stun enemies; exact native zombie teleporting
and all Afterlife VFX still need work. Corpses use the original character
rig in an approximate lying pose. Acid Gat uses the shared explosive
projectile path without complete native attraction/acid-puddle behavior.
Co-op infrastructure recognizes the map, but the map-specific Afterlife
and quest state is validated for solo in this pass.

Prepare assets locally on E: with `npm run extract:mob` and
`npm run prepare:mob`. Extraction enables `dlczm2` in the existing local
OAT exporter. Game assets, tools, caches and logs remain excluded from Git.
The initial pack is roughly 789 MiB compressed, plus the loading movie.

`npm run test:mob` checks all packed dependencies, 30–240 FPS floor stability,
opening Afterlife, mana/expiry/held revival, local power, door/zone changes,
plane parts, bridge Pack-a-Punch and return, session restoration, three
natural starting-room rounds and Brutus combat. HTTP checks cover the menu,
versioned modules, pack, native sky, stereo movie ranges and private paths.
