# World at War Zombies browser port work

## Der Riese and map lobby

The lobby uses the installed WaW co-op background, font and map artwork. **SELECT MAP** switches between Nacht der Untoten and Der Riese; **START GAME** starts the selected solo session. Direct links accept `?map=der-riese` or `?map=nacht`. Only the selected map's asset pack is downloaded, and a map change releases the previous scene through a page reload.

Der Riese uses the original factory geometry, collision, 29 barriers, navigation nodes, player spawns, zone connections, wall purchases, starting mystery box and 17 conventional guns. The power switch enables the bridges and perk machines. Jugger-Nog, Speed Cola and Double Tap affect health, reload speed and firing speed. Link each teleporter to the mainframe within 30 seconds; all three links open Pack-a-Punch. Linked teleporters cost 1,500 points and Pack-a-Punch costs 5,000 points. The supported conventional weapons have their native upgraded definitions. WaW Quick Revive serves co-op revives, so it does not give a solo self-revive here.

This remains a browser reimplementation. Der Riese does not yet include hellhound rounds, traps, mystery-box relocation, Ray Gun/Wunderwaffe or the upgraded Colt's grenade-launcher behavior. Three barriers that require roof/drop traversal are excluded from spawn selection until that movement is supported; the other 26 use prepared native approaches so an unreachable zombie cannot stall a round. Teleporter and perk interactions are implemented, while their full native cinematics and effects remain incomplete.

Factory preparation: `python -B tools/prepare_der_riese.py`, then `npm.cmd run prepare:map`. Extracted factory assets stay in `local-data/der-riese`; generated factory gameplay data stays in `local-data/gameplay/der-riese`; both maps' compressed packs stay in `.cache/preload`, all on E:. `npm.cmd run test:der-riese` checks spawn grounding at 240 FPS, barrier approaches and traversal, interior paths at slow/sprinting speeds, purchases, power, all zones, perks, teleporter links, upgrades, reset and a complete first round with the starting pistol. The exporter now traverses both the inline leaf and partition children, selects referenced world collision, and preserves terrain contents flags rather than making nonsolid decorative triangles into invisible walls. Native traversal endpoints that intersect a window frame with the browser actor's wider hull settle on a nearby clear native surface.

Der Riese verification completed round one with four starting-pistol kills and 100 health in both the simulation and the live browser. Live checks also covered the original pistol textures, fire/reload animation and startup audio, pause/options, restart, and switching maps through the lobby. Path checks cover 124 approaches, 124 window climbs and 52 interior pursuit routes. Nacht's full existing regression suite passed. Evidence is saved in `local-data/der-riese-verification.json`, `der-riese-path-verification.json`, `der-riese-browser-verification.json`, and `der-riese-http-verification.json`.

Project folder: `E:\WaW zombies webui`

## Testing mod menu

During play, hold **Aim** and press **Knife** (default **right mouse + V**) to open the mod menu. It follows your current key bindings and also works with toggle aim. In the embedded browser, **X then V** opens it. You can also choose **MOD MENU** from the pause menu. Play and audio pause while the menu is open; **Esc** or **BACK** resumes.

The menu includes god mode, unlimited points (999,999), unlimited ammo and grenades, available weapon selection, round selection from 1 to 100, and immediate points/ammo/grenade refills. Round selection removes the current zombies and starts the selected wave with its correct count and health; purchases, perks and map progression stay intact. Weapon choices are limited to the models and weapon definitions supported by the selected map.

All toggles default to off when the page loads and reset when changing maps or reloading. They remain active across an in-page level restart until you turn them off. **TURN OFF ALL MODS** disables the toggles; restart afterward to restore normal starting points and loadout. `npm.cmd run test:mods` checks normal damage, god mode, spending, ammo, grenades, weapon changes and round scaling on both maps. The browser check used Aim + Knife, selected round 20 and MP40, resumed play, and verified all four toggles.

Game installation: `E:\SteamLibrary\steamapps\common\Call of Duty World at War`

The application is a **solo Zombies browser prototype using the original Nacht der Untoten and Der Riese maps**. It uses the installed game's geometry, textures, character and weapon models, original zombie animation clips, sounds, collision hulls, navigation graph, weapon settings, and recovered round/scoring rules.

The browser engine is a new JavaScript implementation. This is **not a completed port of the native WaW engine**: it does not run CoDWaW.exe, execute the full original GSC program, or provide exact gameplay parity. The recovered lighting shader's diffuse path, original weapon clips and HUD assets now replace the initial fullbright renderer and improvised gun movement. Some lighting, effects, actor movement, and weapon behavior remain approximations.

## Play Zombies

Double-click **Play Zombies.cmd** in this folder. It starts the local server on E: and opens your default browser. Chrome or Edge is recommended for mouse capture. Alternatively, use PowerShell:

The dependencies are already installed on E:. From PowerShell:

```powershell
Set-Location 'E:\WaW zombies webui'
npm.cmd start
```

Open http://127.0.0.1:8789, choose **SELECT MAP** in the Zombies lobby, select Nacht der Untoten or Der Riese, then choose **START GAME**. Changing maps loads a fresh scene; settings and key bindings are retained.

- WASD: move; mouse: look; left click: shoot; right click: aim.
- R: reload; V: knife; G: throw a grenade.
- E: buy a nearby wall weapon, ammo, passage, or mystery box. Hold E by a broken window to rebuild it.
- Q or 1/2: switch between your two weapons.
- Shift: sprint; Space: jump; Esc: pause.
- In Codex's embedded browser, drag to look or use arrow keys; F fires and X toggles aim.

You begin with a Colt M1911, 500 points, and four grenades. The Kar98k wall purchase costs 200 points. Kill the complete wave to advance. The original solo wave sizes begin with 4, 9, 14, and 19 zombies; health increases from 150. You can die and restart a fresh session.

The server reads this project's web files, dependencies, and game assets. It listens on all IPv4 interfaces (`0.0.0.0`) so other devices on your local network can play. Extraction reports, server logs and process files are not served. All tool downloads, extracted data, compiler output, and project npm caches are on E:.

## Play over your local network

Start **Play Zombies.cmd** on this PC. On another computer connected to the same local network, open **http://172.30.0.106:8789/** in a browser and select **Play solo Zombies**. The launcher also prints the current LAN address; use that address if DHCP changes this PC's IP.

Keep this PC and the server running while playing. Each browser runs its own solo game; sharing the server does not add co-op. A desktop browser with a keyboard and mouse is needed for the current controls.

Windows Firewall was disabled when LAN access was configured, so no firewall setting was changed. If a firewall is enabled later, allow inbound TCP port `8789` for `node.exe` from the local subnet on the active network adapter. The current adapter is `Ethernet 2`, with a Public network profile. No router port forwarding is needed for devices on the same subnet.

To restrict the server to this PC again, stop it and start with `$env:HOST='127.0.0.1'; npm.cmd start` in PowerShell. The default LAN binding returns when `HOST` is unset.

## Spawn collision and startup audio fixes

The follow-up 240 FPS fix also handles a sweep that starts exactly on a floor: an entirely solid sweep is blocked rather than treated as free movement. Player movement and game logic now use fixed 120 Hz steps, independent of rendering, and new sessions begin grounded on a validated original brush. Regression checks include 240 Hz rendering with 2, 8 and 100 ms timestamp rounding, duplicate/negative timestamps, exact floor contact, jumping and walking away from that contact.

The original collision sweep now clamps an entering hit to the beginning of the movement step when it falls inside the contact margin. Previously, very short or uneven frames discarded that hit, allowing the player to fall through a floor. Regression checks cover all four original spawn points at 20–1,000 FPS and uneven frame times, including jumping and landing. These use the exported map brushes; no replacement floor was added.

The runtime now prepares audio before enabling Play, then unlocks live browser audio from the Play click. A fresh session plays Nacht's original `mx_splash_screen` after one second and starts the `mx_zombie_wave_1` loop when the intro finishes. Original chalk, end-of-round and ambient cues are also restored. Pause suspends audio, Resume continues it, and Restart clears the old sources before replaying the intro.

Sound preparation resolves IWD member names without regard to case and handles OAT's `.xwma` exports for aliases that refer to `.wav`. The native exporter now includes the missing splash, round-over and ambient aliases. Converted sound files remain in `local-data/gameplay/sounds` on E:.

Run `npm.cmd test` for startup regressions and gameplay integration, or `npm.cmd run test:startup` for the focused checks. Results are saved in `local-data/startup-verification.json` and `local-data/startup-audio-verification.json`. Refresh an already-open browser tab to load the fixes.

Live checks through `http://172.30.0.106:8789/` confirmed that the player stays on the floor with 100 health, can jump and land, and produces nonzero audio output during the original intro and chalk cues. Pause/Resume preserves the intro, the background music loop begins afterwards, firing plays the Colt sound, and Restart removes the previous sources before scheduling one fresh intro. See `local-data/browser-startup-verification.json` and `local-data/browser-startup-fixed.png`. Browser diagnostics reported no errors or warnings. The gameplay integration also completed rounds 1 and 2 after these fixes.

## Prepared map and browser updates

The launcher prepares 678 runtime assets on E: in `.cache/preload`, served as ten compressed, versioned parts (about 93.2 MiB total). The first visit downloads them; later visits reuse the browser's normal HTTP cache. The original map, models, textures and sounds are ready before Play is enabled. Restarts reuse the loaded scene and decoded audio in memory. A new page still has to build its WebGL scene from the cached data; keeping the tab open gives the fastest restart.

JavaScript and CSS now use content-versioned `/runtime/<build>/...` URLs. This prevents a reverse proxy's long script cache from retaining an older collision implementation after an update. The current build ID is visible at the bottom of the menu and in `/api/status`. Reload the page after updates; if the HTML itself is cached, append `?build=<current-build-id>` to the page URL.

For Firefox on this PC, **Play in Firefox (E cache).cmd** uses a separate game profile and disk cache under this project's `.cache` on E:. It opens the local server and does not change your existing Firefox profile. Other devices use their own browser cache. Server source, generated packs and compiler/npm caches remain on E:.

## Work completed and verified

- Identified the installed campaign/co-op executable as PE32 x86. Its imports include Direct3D 9, DirectSound, Win32, Bink, and Winsock.
- Extracted 276 original GSC scripts, totaling approximately 154,642 lines, from the shared game package and Nacht. These are script source assets shipped with the game, rather than recovered native engine source.
- Inventoried 1,037 original Nacht entities, including the four `initial_spawn_points` used by the Zombies scripts.
- Located 1,077 candidate named native function records by inspecting adjacent name/function/flags pointers in the executable. These are static candidates, not verified engine symbols or decompiled functions.
- Added a GfxWorld exporter to OpenAssetTools and built it locally. It emits a browser manifest and explicit binary buffers without host pointers.
- Verified all 91,002 map vertices, 67,965 triangles, 3,741 surfaces, 1,506 static model placements, 70 unique static models, and 65 unique map diffuse textures. The browser loads all of these dependencies.
- Extracted 2,715 original collision brushes, 145 brush-model definitions, and 658 navigation nodes with 5,376 links. The browser uses swept-box movement and the recovered graph.
- Exported original zombie walking, attacking, and death animation tracks. Restored the model export's Y-up coordinates to the game's Z-up system.
- Prepared 148 original sound files as PCM WAV using the existing FFmpeg installation, including first-person shots, reload and knife notetrack sounds, mystery box music, cash purchases and barrier repair. Output stays on E:.
- Exported the original two-layer baked lightmap atlas and 21 primary lights. Disassembled the installed map shader using Windows' existing D3D compiler, then reconstructed its ambient/directional diffuse lighting and packed normal decoding. Added normal-map shading, cool/desaturated grading from `zombie.vision`, foliage transparency and lighting for models sampled from the baked map. The full native reflection, shadow-map and layered-material pipeline remains unfinished.
- Rebuilt the HUD with the original game font atlas, dark red chalk round graphics that fade to white between rounds, and the red score strip. Removed the persistent website header, health bar, wave counters and FPS display during play. Menus use a restrained list layout.
- Added original idle, hip-fire, ADS fire, reload, bolt and knife clips for supported weapons. The first ADS-up frame supplies the missing hip torso pose; its final transform supplies iron-sight alignment. Original fire/bolt timing, hip spread, ADS accuracy and shotgun pellet counts now drive shots. Browser bullets intersect posed character meshes, including the separate head, and use original world collision for obstructions.
- Dragging to look in the embedded browser no longer fires on mouse-down. Taps fire on release; holding a stationary button supports automatic fire. Keyboard F remains available. Pointer-lock mouse input is preserved for browsers that support it.
- Implemented solo waves, bullet traces, health/regeneration, two weapon slots, ammunition/reload, melee, grenades, points, wall purchases, ammo purchases, the mystery box, unlockable passages, barricade breaking/rebuilding, pickups, pause, death, and restart.
- Integration testing uses the actual extracted map: floor/wall collision, an idle player's death, restart, walking to and buying the Kar98k, and clearing rounds 1 and 2 to reach round 3 with normal ammunition and ray hits. See `local-data/gameplay-verification.json`. Browser checks cover starting, movement, a wall purchase, shooting and killing a zombie with points awarded, reload, pause, death, and restart. See `local-data/browser-verification.json` and `local-data/browser-combat.png`.

Original extraction data is under `local-data/nacht` and `local-data/common`. The runtime manifest is `local-data/gameplay/manifest.json`. The reusable inventory is `local-data/inspection.json`; buffer verification is `local-data/world-verification.json`. Run `npm.cmd test` for the gameplay integration checks.

The fidelity update was checked in the embedded browser: drag consumed zero ammunition, firing consumed one round and played `viewmodel_colt45_fire`, reload played `viewmodel_colt45_reload_notempty`, and an accurately aimed shot against a visible zombie torso killed it and awarded 60 points. Kar98k re-chamber animation and original audio were also observed. See `local-data/browser-fidelity-verification.json` and `local-data/browser-fidelity-combat.png`. The automated core integration test reached round 3 with 13 kills, 16 shots and 100 health using normal aiming, ammunition and reloads. The browser test used normal keyboard/mouse input; read-only diagnostics inspected the visible actors' bone positions to aim the test.

## Pickups, barrier entry, sprint, knife, box and input update

The pickup placeholders now use the original ammo can, skull, x2 icon and bomb models, original particle textures and exported effect curves. Their rotation and accelerating expiry blink follow the recovered scripts. The browser particle renderer remains an approximation of native FX, particularly lights, distortion, ribbons and soft intersections.

Zombies tear boards at original animation notetracks, finish their tear clips, approach the original negotiation start, and vault to its paired end with original animation timing and decoded root motion. One zombie traverses each window at a time. Rebuilding waits until the vault is clear. Actor rigs are pooled and fully posed before being shown.

The original Ka-Bar is attached to `tag_knife_attach` during the slash. Melee damage follows the original weapon delay. Sprint poses use each weapon's recovered offsets, rotations, scale and transition times; sideways movement and ADS cancel sprint. Full native sprint stamina, locomotion blending and camera behavior remain unfinished.

The box opens its original lid, cycles supported original world weapon models through the recovered 40-step sequence, plays the original box sounds, and offers its selection for 12 seconds. Press E to take it. A missed offer returns into the box. The supported pool currently contains 11 firearms.

Mouse input now handles both aim/fire button orders and each release independently. Mouse events are used because a second held mouse button does not generate another `pointerdown`. Keyboard F and mouse fire no longer overwrite each other's state. In embedded drag-look mode, holding aim also allows firing while moving the mouse.

Rendering retains all 1,506 static placements in 106 shared batches with visibility checks. World geometry is compacted per brush and culled in spatial sections. At the same spawn view, world draw calls decreased from 726 to about 130. The fixed 120 Hz simulation now interpolates player and actor positions for display. All 32 actor rigs, 11 weapon rigs and the fixed outside spawn routes are prepared before Play; rigs are drawn offscreen to allocate GPU buffers. Shots reject distant ray candidates before posed mesh work and reuse that work across shotgun pellets. HUD updates are bounded to 60 Hz. These changes reduce work; browser frame spikes and Firefox Internet performance still need direct verification.

`npm.cmd test` includes original-floor/startup tests, the round-3 gameplay integration, board/vault/melee/box/sprint regressions, and both mouse button orders and releases. Core results are in `local-data/fidelity-gameplay-verification.json`. Visual fixtures share the game's actual components at `/tests/fidelity.html`; they are developer previews, not gameplay sessions. Screenshots and diagnostics are saved under `local-data`, including `original-knife.png`, `original-barrier-vault.png`, `original-box-offered.png` and `ads-fire-verification.json`. Actual game input verified ADS fire, ammunition consumption and the original ADS fire animation.

The final 1,000-frame desktop preview (1280×720, three spawned zombies) measured a 9.3 ms 95th percentile callback interval and 31 intervals above 25 ms. Occasional stalls remain. Core spawn profiling fell from roughly 9–15 ms to 0.03–0.43 ms after preparing routes. See `local-data/fidelity-performance-final.json` and `local-data/prepared-spawn-cpu-profile.json`; these are local measurements, not a Firefox-over-Internet or 240 FPS guarantee. All 12 runtime modules matched local source byte-for-byte at the public origin; its page still requires the existing authentication. Run `node tools/verify_served_build.mjs` to repeat that check.

## Sprint fire, world collision and session performance update

Firing during sprint now queues one shot until the weapon's original sprint-out time finishes (0.3 seconds for the Colt). The weapon returns to its firing pose before the muzzle flash and ammunition consumption. Reload, melee and changing weapons cancel a queued shot. Held fire prevents re-entering sprint. The round chalk uses Nacht's dark red `(0.423, 0.004, 0)` during play. Its original `chalk_round_hint` sequence fades to white over a quarter of the between-round time, pulses in half-second legs, then fades back to red over another quarter. The hint thread continues across the new-round boundary; with Nacht's 10-second between-round interval, it finishes returning to red five seconds into the new round. The new-round tally still fades out/in in half-second legs. Both color and opacity use simulation time and pause with the game.

The HUD now applies the computed color to both chalk sprites and numeric rounds using a reused 128×64 tint layer. Regression checks cover the initial red-to-white blend, white pulse, white-to-red blend, completion, paused time, and rounds above 10. Browser checks on build `04f42fa1e097a703` verified actual HUD pixels at white `(255,255,255)`, mid-fade `(182,128,128)`, and final red `(108,1,0)`, including round 11. See `local-data/round-color-browser-verification.json`, `round-fading-preview.png`, and `round-red-preview.png`. All 17 public runtime modules matched the updated local source.

The collision export now includes 977 original static collision models (1,146 solid surfaces) and all 19,500 original terrain triangles. The `waw-collision-v3` export preserves native face/barycentric planes: the runtime reconstructs 60,354 placed solid prop triangles instead of filling whole surface bounds. Zombie bodies use swept movement and step handling for approach and hunting. Only the scripted window vault follows its original negotiation motion. Navigation conforms to actual ground height and checks steps along stair links. Spawn preparation uses the original init, door and upstairs spawners; all 36 prepared routes to the 12 barriers have been simulated to arrival without falling or getting stuck.

Long diagonal collision sweeps now traverse grid cells along the ray rather than scanning the entire enclosing rectangle. Animated zombie bullet hits refit conservative bone influence bounds once per simulation tick and skin only the triangles in intersected BVH leaves; subsequent shotgun pellets reuse them. Final hits remain triangle accurate. Navigation tests nearby nodes first and uses a heap for shortest-path searches. The whole navigation graph is collision-checked during loading; opening/rebuilding a barrier or opening a door refreshes only nearby links. Restart restores the prepared graph. Per-actor sight checks are spread across physics ticks. These changes reduce simultaneous rerouting stalls. Expired corpses leave the game simulation after five seconds. Impact and grenade meshes share a bounded pool that survives restart without creating per-shot geometry/materials.

Live profiling additionally found 8,680,766 baked-light entries caused by overlapping surface vertex ranges. The loader now keeps the first occurrence of each lightmap/vertex pair (29,935 unique samples) and searches a tree within the same 27 original spatial cells. `tools/test_baked_light.mjs` compares 2,004 native-map positions, including exact vertices and cell boundaries, against the previous lookup: all return the identical sample, preserving its UV and lightmap color. On build `4ae07a5b6f5df7c7`, a normal round-1 desktop run through barrier entry and hunting ended with a 600-frame sample at 1280×720 showing 8.4 ms p95 frame interval, 3 ms p95 CPU work, 4.3 ms peak CPU work and no frames over 25 ms. Cached-asset load-to-ready took 1.77 seconds. The idle player was eventually killed; this is a frame-performance check, not a survival result. See `local-data/browser-entry-performance-final.json` and `baked-light-verification.json`.

The final fixture includes the actual periodic actor-lighting updates. After 10 repeated 24-actor waves and 3,285 shots (294 simulated seconds), its normal-clock 600-frame sample measured 8.4 ms p95 callback interval, 9.4 ms p95 CPU work and zero intervals over 25 ms. Resources remained at 179 geometries and 296 textures; see `local-data/browser-stress-lighting-final.json`. The preceding accelerated 10× portion intentionally performs ten times the physics work per frame and is not used for normal-speed performance claims.

`tools/test_runtime_regressions.mjs` covers sprint-to-fire timing, crate and intact-barrier obstruction, all 36 spawn routes, long sweeps against an exhaustive collision search, 20.4 minutes of simulation with 1,920 kills, 1,000 graphics-resource reuse cycles, 5,208 reference posed-mesh rays, and round color/pulse/fade timing. The core combat integration still reaches round 3 using normal ray hits, ammunition, reloads and wall ammo purchases. Browser fixtures additionally compare rays against the original animated zombie and exercise 24 actors with the actual renderer. Results stay in `local-data`. These checks do not establish exact native engine parity or guarantee smooth 240 FPS in Firefox over the Internet.

The desktop browser resource soak completed over 27 simulated minutes and 16,973 shots with 24-actor wave reuse. After warming all rigs, renderer resource counts remained at 179 geometries and 296 textures. At normal clock speed after the soak, a 600-frame sample at 1280×720 measured an 8.4 ms 95th percentile callback interval, 13 ms 95th percentile CPU work, and zero intervals above 25 ms. This developer fixture keeps health and ammunition supplied and generates additional impacts; it is a resource/performance test, not a normal survival run. See `local-data/browser-wave-performance-late.json`, `browser-soak-final-start.json`, `browser-soak-final-end.json` and `original-posed-hit-comparison.json`. Measurements were taken on build `23c93ed7e9b4c202` before the final staggering of per-actor sight checks; subsequent changes distribute those ten checks per second across physics ticks. Public source modules match local files; the authenticated public root/assets require the user's normal sign-in, so Firefox Internet play has not been directly tested here.

## Starting-room movement and nearby spawn selection

Static prop collision now uses the original triangles, leaving the empty space around irregular rubble clear. Vertical step probes no longer slide the character sideways toward a window; shallow floor/brush contact permits sliding or moving away while still blocking movement into the solid surface. Crates, walls and intact barrier clips remain solid. The starting-room audit found 419 sampled movement cases that the old surface boxes blocked and the native triangles permit. All 9,317 unique reconstructed native triangles preserve their original plane/barycentric coordinates and lie within the exported surface bounds.

Entry selection now favors nearby reachable windows using distance through the unlocked navigation graph. It updates with the player's location, respects locked rooms, and distinguishes upstairs from downstairs by route distance. This is a deliberate browser gameplay adjustment: the shipped Nacht scripts randomize unlocked spawners rather than explicitly selecting the player's nearest window. The original spawner groups, exterior approaches, board tearing and vault sequence remain in use.

Navigation links are directional and validated with small actor physics steps. Routes include the initial connection to their first native node, and arrival allows floor-height variation within the 18-unit step limit. `tools/build_preload.mjs` saves 5,197 directed link results and the prepared window routes in `local-data/gameplay/navigation.json` on E:. A source/data hash rebuilds it when movement code, collision, entities or nodes change. Browsers load this ready graph with the 682-asset map pack (about 94.8 MiB compressed).

`tools/test_movement_spawn.mjs` walks the player to all five starting-room windows and back at 240 render FPS, checks the previously blocked rubble movements and spawn preferences in the starting room, Help room, upstairs and after returning downstairs. `tools/test_spawn_speeds.mjs` simulates all 36 outside routes at 47, 57, 100 and 145 units per second: all 144 runs reach their barriers. The full `npm.cmd test` suite also retains the actual combat, floor, input, audio, scoring, HUD, collision obstruction and resource regressions.

The shared browser component test walked to and around the west starting window without sticking, using the actual player update and collision code. See `local-data/starting-window-walk-proof.png`, `browser-window-walk-verification.json` and `movement-spawn-verification.json`. On build `68a961a1cffca021`, cached loading reached ready in 2.04 seconds; normal round-1 entry and hunting measured 8.4 ms p95 frame interval, 3.5 ms p95 CPU and 4.3 ms maximum CPU across the final 600 frames, with no frame intervals over 25 ms. The idle player was killed after 42.2 simulated seconds. See `local-data/browser-collision-performance-final.json`. These local desktop measurements do not establish Firefox Internet performance or exact native engine movement parity.

Final build `8f9aa79de4a5793f` repeats the browser window walk successfully and passes the complete test suite, including 144 outside routes at multiple zombie speeds. Its 24-actor wave fixture, after three waves and 907 shots at normal simulation speed, recorded 9.2 ms p95 CPU, 8.4 ms p95 frame interval and zero intervals over 25 ms in its last 600 frames. This fixture supplies health/ammunition and adds eight impacts per rendered frame; it measures load, not survival. See `local-data/browser-native-collision-24-actors.json`. All 18 runtime modules match local source at the public origin; the public root retains its existing authentication.

## Original point popups and transaction sounds

Every earned or spent amount now produces a popup beside the score: yellow `+amount` for gains and dark red deductions. The original font atlas is tinted once during loading. Popups follow `_zombiemode_score.gsc`'s 0.5-second randomized leftward movement and fade during its final 0.25 seconds. They use simulation time, pause with the game, expire, reset on restart and have a 64-entry burst limit.

Successful weapon, ammunition, passage and mystery-box purchases play the installed game's `cha_ching` asset; insufficient funds play `no_cha_ching`. Taking an already paid box weapon does not charge or replay the purchase cue. Successful board replacement plays `repair_boards`, the alias used by Nacht's `rebuild_barrier_piece` script event. Repair cooldowns and occupied vaults produce neither sound nor points. The existing round repair reward cap remains enforced.

`tools/test_score_feedback.mjs` checks damage, headshot, Double Points, nuke, purchase/ammunition/door/box transactions, failed buys, repair rewards/cooldowns, popup expiry/reset/bounds and all three original PCM sound files. All project tests pass. The browser fixture verified the visible popup and both purchase and repair cues with nonzero output RMS; see `local-data/points-feedback-proof.png`, `browser-purchase-feedback.json`, `browser-repair-feedback.json` and `score-feedback-verification.json`. All 17 public runtime modules matched local source byte-for-byte on final build `4ae07a5b6f5df7c7`.

## WaW pause menu and saved options

The pause screen now follows the installed game's `pausedmenu.menu`: the right-aligned PAUSED title and Resume Game / Options / Restart Level / Quit list, dimmed frozen game, top/bottom bars, original normal-font atlas, original right-side button backing/highlight textures, and gold selection color. The options layout follows the recovered in-game options menus. Source menus are kept in `local-data/pause-ui/ui`; extraction logs and converted texture assets stay on E:.

Press Esc, then Options. Controls supports primary and secondary keyboard, mouse-button and wheel bindings for 19 actions, conflict removal, clearing/canceling a binding, and restoring default controls. Esc remains a reliable pause/back key. Interaction, reload and input hints use the selected bindings. Mouse options include the native 1–30 sensitivity range (default 5), an independent ADS multiplier, inversion, and hold/toggle aim. Sound controls master volume; Graphics controls field of view, render resolution and browser fullscreen where supported. Settings apply immediately and persist in localStorage separately for each browser/site address. Restart and quit use cancelable in-game confirmations.

`tools/test_settings.mjs` checks persistence/validation, blocked storage, conflict removal, remapped actions and native-map interaction prompts, hold/toggle aim, wheel and swapped mouse-button bindings. The complete `npm.cmd test` suite passes; all 21 public runtime modules match local source on final build `8d1ec3f4753e46ee`. The authenticated public page still uses the existing sign-in.

Actual browser input verified that W/R stopped moving/reloading after binding I/J, and the new keys performed those actions. Measured hip and ADS camera changes matched sensitivity 9.5 and ADS multiplier 0.30, including inverted mouse motion. Reload preserved the selected controls/options; volume, field of view and render resolution affected their actual runtime values. Opening/changing options left simulation time and ticks frozen. Test settings were restored to defaults. Final build checks cover Escape binding cancellation and returning from/canceling restart/quit confirmations. Evidence is in `local-data/browser-pause-settings-verification.json`, `browser-mouse-settings-verification.json`, `browser-saved-menu-settings.json`, and `pause-menu-final-browser.json`; final screenshots are `pause-menu-proof.png`, `pause-controls-proof.png`, and `pause-mouse-settings-proof.png`. The updated prepared pack includes 684 assets (about 94.9 MiB compressed).

## MP40 sprint view correction

Sprint pitch now converts native positive pitch (forward/down) to the view camera's negative X rotation. The previous sign lifted the MP40 across the screen. Original weapon offsets, angles, scale and transition times remain the pose inputs; the coordinate correction also applies to other weapons.

On build `7db7a200d2e2876b`, the shared original-model preview checks a complete MP40 sprint bob cycle at 1280×720. Its highest gun vertex stays below 78% of the screen height; the preceding pose reached about 11% from the top. Sprint exit returns the root to its neutral position/rotation/scale, and original MP40 ADS, fire and reload poses were checked. The other ten supported weapons were also rendered at full sprint. See `local-data/mp40-sprint-before.json`, `mp40-sprint-after.json`, `mp40-sprint-verification.json`, and `mp40-sprint-proof.png`. The full `npm.cmd test` suite passes, including sprint-to-fire timing, and all 21 public runtime modules match local source. These are checks of the browser's shared weapon renderer.

## Original grenade animation, projectile and explosion

Grenades now use the installed MK2 view/projectile models and original idle, pull-pin and throw clips. The weapon lowers, the hands pull the pin, the grenade releases at the native fire delay, and the weapon returns after the offhand sequence. Throwing cancels reload/rechamber presentation and blocks conflicting fire, melee, switching and sprint input until the sequence ends. The original pin and throw sounds follow the animation milestones.

The projectile uses the recovered 940-unit forward speed, 120-unit upward speed, native bounce coefficients and 3.5-second fuse measured from the throw phase. Swept collision prevents it passing through floors and world objects, and low-energy floor contact settles it. Detonation applies the original 256-unit radius and 200-to-50 damage falloff, checks solid cover, awards normal kill points and can injure or kill the player. Original bounce, explosion and bass sounds accompany it.

The exporter and fidelity preparation now include the original concrete grenade explosion and flash effects, including their sprite textures, smoke, debris, curves and material blending. Four projectile slots and four reusable explosion instances are prepared and warmed before Play. Pause freezes their simulation; finite blast effects and already-started explosion sounds finish even if the blast kills the player. Unsupported native FX features retain the renderer limitations described above. The prepared map now contains 712 assets (about 96.7 MiB compressed), including 162 decoded native sound buffers.

`tools/test_grenades.mjs` checks release/fuse timing at 240 render updates, native floor collision/bounces, single detonation, cover obstruction, kill scoring, self damage, restart, audio lifecycle and 1,000 explosion pool reuse cycles. The complete regression suite passed after the grenade changes; the final additional kill/self-damage checks also pass. See `local-data/grenade-verification.json` and `grenade-all-tests.log`.

Actual G-key input on build `73fc08265dd3d81c` verified the throw, blocked conflicting fire without consuming gun ammunition, unchanged paused simulation time, bounce cues, explosion/bass cues and self-damage at detonation. See `local-data/grenade-gameplay-browser.json`. The shared native-asset fixture separately verified visible pull-pin/throw poses, projectile release and a visible audible blast; screenshots are `grenade-pullpin-proof.png`, `grenade-throw-proof.png` and `grenade-explosion-proof.png`, with diagnostics in `grenade-visual-browser.json`. All 22 runtime modules match the final local source at the public origin. These checks use the local desktop browser; they do not establish exact original engine parity or Firefox-over-Internet performance.

## Starting pistol slide and magazine correction

Attached firearm part translations now preserve the original model bind positions before applying XAnim movement offsets. Previously the Colt slide jumped toward its animation offset's origin while firing or empty, separating from the frame; magazine reload movement had the same error. Hand pose tracks retain their authored local positions, and gun part rotations retain their original animation values. Loaded and empty idle poses now also synchronize with ammunition after reload completion, including when physics refills the magazine just after the rendered clip ends.

`tools/test_weapon_parts.mjs` uses the exported Colt and hand skeletons with the actual animation loader, mixer and weapon view. It checks slide alignment during recoil, original empty lockback, slide/magazine return after empty reload, and three rapid magazines followed by rig reactivation. The complete `npm.cmd test` suite passes. Shared original-model browser previews verified firing, last shot, empty idle and empty reload; normal gameplay input fired eight rounds into the empty-idle animation. Evidence is in `local-data/colt-parts-verification.json`, `colt-browser-verification.json`, `colt-all-tests.log`, `colt-fire-fixed.png` and `colt-empty-fixed.png`. The final browser preview also verified automatic slide closure after ammunition refill without explicitly restarting idle. All 22 public runtime modules match local source on build `236da0175553d123`.

## Grenade openings and live throwback

Grenade release and movement now trace solid geometry instead of the player's movement mask. Invisible player clips around windows, bars and rubble no longer stop the projectile; solid boards, bars, walls, props and floors still collide. `tools/test_grenade_throwback.mjs` follows ballistic paths through all 12 native window openings (one narrow window requires its visible boards removed), verifies five clear paths through player-only volumes, and retains solid floor/crate obstruction checks.

Press the Use key (E by default) near a reachable live grenade to pick it up and automatically throw it in the direction you aim. A prompt shows the remaining fuse. Throwback takes priority over nearby purchases and rebuilding, uses the original `viewmodel_livegrenade_tossback` pickup clip followed by the MK2 throw, and requires no inventory ammunition. It reuses the same projectile and original detonation deadline. The fuse continues in hand and can kill the player before release; it freezes with paused simulation. Held projectiles hide their ground mesh and reuse its pool slot when released. The low pickup gesture has a smoothly blended view offset to keep it visible in the browser.

Core checks passed for unchanged fuse timing, zero-inventory pickup, expiry in hand, conflicting actions, reset and 100 pool-slot rethrows. The full regression suite passed before the final pickup view offset adjustment; no additional gameplay testing was performed after that presentation adjustment, following Brad's request to handle gameplay testing himself. A shared-component browser preview on build `fed0d7606093e362` showed a grenade passing through the starting-room window without a bounce and confirmed E-key pickup with zero ammunition. See `local-data/grenade-window-proof.png`, `grenade-throwback-prompt.png`, `grenade-throwback-verification.json` and `grenade-throwback-all-tests.log`. The prepared pack includes 713 assets and the live throwback clip. All 22 public source modules match local files on final build `13c192665dc367e5`.

## Hold to cook grenades

Hold the grenade binding (G by default) to lower the gun, pull the pin and keep the live grenade in hand. The native 3.5-second fuse starts when the pin-pull phase finishes; releasing the last held grenade binding starts the throw without resetting that fuse. A quick tap retains the normal pin-pull/throw timing. Holding past the deadline causes an explosion in hand. Keyboard, mouse and secondary bindings share the same release behavior; repeated keydown events do not consume extra grenades. The existing E-key ground throwback preserves its original deadline and automatic throw behavior.

The offhand view keeps the completed pull-pin pose while cooking and follows the changed throw schedule on release. Pausing freezes simulation and the fuse. If input is cleared by a menu or lost focus, resuming releases the grenade rather than leaving it stuck in hand.

A quick logic check passed for holding, release, preserved fuse, expiry in hand, tap timing, and releasing the last of two grenade bindings. Syntax checks also passed. Gameplay/browser testing is left to Brad as requested. The prepared map was refreshed on E:; no new assets were needed.

## Crosshair movement, cooking pulse and interior drops

The HUD crosshair now expands and settles with movement and firing using the equipped weapon's extracted hip-spread values, projected through the current field of view. Its center stays on the aim point. While holding a live cooked grenade, the arms and brightness pulse once per second until release or fuse expiry. Both effects use simulation time and freeze when paused.

Powerups can only drop from zombies in the hunt stage, after their barrier traversal finishes inside the map. Kills outside or during entry still award the usual points, including sixth kills, but cannot create a drop. This applies to every kill path through the shared damage handler.

Quick logic and syntax checks passed for movement settling, shot bloom, cooking pulse, release, pause, restart, fuse expiry and drop eligibility. Gameplay testing remains with Brad as requested. The prepared map pack was refreshed on E:.

## Reproduce extraction

```powershell
Set-Location 'E:\WaW zombies webui'
python -B tools/extract_game.py
python -B tools/verify_world.py
```

Extraction reads the installed game files and writes inside this project. Only Nacht and shared dependencies are extracted; the complete game installation is not duplicated. Later IWD archives take precedence when resolving loose image references.

## Rebuild the native exporter

```powershell
Set-Location 'E:\WaW zombies webui'
& .\tools\build_exporter.ps1
```

The existing Visual Studio Build Tools 2026 installation is used. Source and build outputs remain under `.tools/oat-source` on E:. The extension is saved separately in `tools/oat-web-world.patch` so it can be restored if the downloaded source tree is lost. Base OAT source revision: `59904a3e1dd698ce1c8b8e750d12b47e19cf83ba`. The downloaded stock image converter is OAT v0.33.0. Premake is v5.0.0-beta8.

To rebuild the downloaded tool environment, run `tools/setup_tools.ps1`, then build the exporter, extract, and start the server. This requires network access and the already-installed compiler, FFmpeg, and Node/Python runtimes.

## Compatibility work still required

The next substantial milestone is execution of the original `maps/_zombiemode.gsc` under a compatible script runtime. This requires GSC parsing/execution, entity fields, function resolution, cooperative script threads, `wait`, `notify`, `waittill`, and `endon`, followed by implementations of the native builtins those scripts use.

This prototype implements those engine services in a limited form around the original assets. Exact native AI/physics, complete material/shadow/reflection rendering, animation transitions and camera kick, destructible effects, complete weapon/powerup behavior, and GSC scheduling still need reverse engineering and compatibility work. There is no co-op, multiplayer, save system, or other Zombies map support in this build. The mystery box uses the supported firearm subset; unsupported wall weapons identify that limitation in game.

The original engine functions need further reverse engineering and validation against the installed executable. A full original-game browser port has not been achieved or demonstrated by this project.

## Third-party source

[OpenAssetTools](https://github.com/Laupetin/OpenAssetTools) is GPL-3.0. Its locally modified source keeps its original license. The saved exporter patch is also GPL-3.0; see `tools/OAT-PATCH-LICENSE`. [Three.js](https://github.com/mrdoob/three.js) is MIT licensed. Original game assets and scripts retain their original ownership and are kept as local, ignored extraction output.
