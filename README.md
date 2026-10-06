# CoD Zombies Web

A browser runtime for **Call of Duty Zombies**, with World at War, Black Ops and Black Ops II. It loads the original maps, models, textures, lighting, animations, sounds and HUD art from your own installed copies of the games and plays them in a desktop browser with [three.js](https://threejs.org/).

World at War has **Nacht der Untoten** and **Der Riese**. The Black Ops browser preview adds **Kino der Toten**, using the installed game's original T5 map and assets.

The collection opens each game's own themed lobby: **World at War** at `/world-at-war/`, **Black Ops** at `/black-ops/`, and **Black Ops II / Buried** at `/black-ops-2/`. **ALL GAMES** returns to the collection; existing `?map=nacht` and `?map=der-riese` links still work.

![Nacht der Untoten in the browser](docs/images/nacht-gameplay.jpg)

> **Unofficial fan project.** Not affiliated with or endorsed by Activision or Treyarch. No game assets are included in this repository. You need a legally owned copy of the corresponding game and map DLC; the tools extract assets from your installation into a local, git-ignored folder.

---

## Contents

- [Screenshots](#screenshots)
- [Feature status](#feature-status)
- [Requirements](#requirements)
- [Game files used](#game-files-used)
- [Setup](#setup)
- [Playing](#playing)
- [Development](#development)
- [Project layout](#project-layout)
- [How it works](#how-it-works)
- [Credits and licences](#credits-and-licences)

---

## Screenshots

| | |
|---|---|
| ![Der Riese lobby](docs/images/der-riese-lobby.jpg) | ![Der Riese mainframe with the testing mod menu](docs/images/der-riese-mainframe-mod-menu.jpg) |
| **Zombies lobby** with the original map art and font | **Der Riese mainframe**, with the optional testing mod menu open |
| ![A zombie vaulting through a window](docs/images/zombie-window-vault.jpg) | ![Grenade explosion](docs/images/grenade-explosion.jpg) |
| **Zombie climbing through a window** after tearing off the boards | **Grenade explosion** with the original effects |

![WaW pause menu](docs/images/pause-menu.jpg)

*The WaW-style pause menu. Options include rebindable keys, mouse settings, sound and graphics. Some screenshots were captured during development, so a few HUD details differ slightly from the current build.*

---

## Feature status

The game is a JavaScript reimplementation. The original game scripts (`.gsc`) are not executed; their rules, numbers and timings are ported by hand and checked against the extracted scripts.

### Working: both maps

- **Original assets:** map geometry, baked lightmaps, textures, static and script models, weapons, viewmodel animations, sounds and HUD art, all loaded from your install.
- **Rounds:** original solo zombie counts, health scaling and spawn delays, with up to 32 zombies alive at once.
  - Nacht's script adds no solo bonus, so it caps at 24 per round.
  - Der Riese scales up, for example 60 zombies at round 20.
- **Zombie AI:**
  - Spawns at windows near the player.
  - Tears off boards and climbs in with the original animations.
  - Navigates using the map's own path nodes.
  - Each zombie walks, runs or sprints using the original movement roll and clips.
  - Zombies keep their spacing instead of stacking into one model.
- **Weapons:**
  - Original viewmodels, iron sights, recoil, reloads, sprint poses and knife.
  - Short knife lunges select a nearby living zombie in front, use native charge timing and stabbing clips, and gently center aim. Movement respects native player hulls, stairs, walls and window clips; close attacks keep the normal swipe. Melee hits share the blood effects.
  - Wall buys, and the mystery box with weapon cycling and a manual grab.
  - Gunfire uses the rendered map and prop triangles, so openings and transparent cutouts admit shots. Rebuildable window boards can be shot through; solid cover still blocks bullets.
  - Bullets can hit multiple living zombies along their path, using the original weapon penetration tier to approximate flesh penetration. Solid cover still stops the path.
  - Range damage blends from each original weapon's close damage to its far damage, then stays at its minimum. Shotguns retain their native pellet count and cone width, with a centered pellet and distributed spread for consistent close blasts. Animated head and torso combat volumes supplement mesh hits, so torn clothing and pose seams cannot make an otherwise valid hit miss. These mechanics are shared by WaW and Black Ops.
  - Grenades: cook them, throw them through windows, or pick up live ones and throw them back.
- **Zombie deaths:** shared skeletal ragdolls for WaW and Black Ops, with physical map contacts, fixed-step simulation and sleeping corpses in the prepared actor pool. Lethal headshots detach the original head rig into an independent physical head and expose the native gore stump, with the original head-gib sound. Hits create blood sprays and wall/floor splats using each game's original textures; five fixed GPU batches and bounded actor slots prevent effects from accumulating. All gore resets when an actor is recycled or a game is restarted.
- **Barriers:** rebuilt with the use key, awarding points with the original repair sound.
- **Power-ups:**
  - Max Ammo, Insta-Kill, Double Points, Nuke, plus Carpenter on Der Riese.
  - Original shuffled drop rotation.
  - Spawn sound and looping hum while a drop sits on the ground.
- **HUD:** chalk round tally with the white flash between rounds, score with +point popups, ammo, grenades, perk icons and a moving crosshair.
- **Shared lobby:** everyone who opens the same map on the same server (on your network or through the public site) joins one pre-game lobby, up to 4 players. The PLAYERS list shows each player, who hosts (the first to arrive; it passes on when they leave) and whether they are READY, LOADING, WAITING or IN GAME. In Black Ops each player gets a different character. Only the host can Start Game: everyone in the lobby loads the map, players who finish first wait on the loading screen, and all of them go in together. Saves load only when you are alone in the lobby.
- **Online co-op:** a match started from a shared lobby is one game. The host's browser runs the world (rounds, zombies, doors, barriers, the box, power-ups, power and teleporters) and every other browser mirrors it, reporting its own hits, purchases and repairs; the host pays each player's points and kills. Zombies hunt the nearest player who is not down. Players start on the map's separate spawn markers, see each other's character, stance, dives, weapon and gunfire, and every player's score is listed above your own. Max ammo refills everyone, a nuke pays everyone 400 and a carpenter 200; the box weapon belongs to whoever paid. Zombies per round grow with the player count as in the original scripts. Last stand: lethal damage downs you with a pistol and a 30-second bleed-out; a teammate holds Use for 3 seconds (1.5 with Quick Revive) to revive you; bleeding out leaves you watching a teammate until the next round; the game ends when everyone is down. Co-op Quick Revive costs 1500 and no longer self-revives. The game keeps running behind the pause menu; Quit leaves the match. Players' browsers exchange state with the server about 25 times a second through ordinary requests, so it works through proxies. Teammates are solid: you cannot walk through a standing teammate, and their body stops your shots (friendly fire does no damage). Teammates are the original characters (Nacht's four Marines with their helmets and gear, Der Riese's and Kino's Dempsey, Nikolai, Takeo and Richtofen) animated with the games' own third-person player clips: idle, aiming, running and strafing in four directions, sprinting, crouching, prone crawling, diving and the last-stand crawl, with pistol variants, holding their current weapon. `tools/prepare_player_animations.py` (run by the build) exports those clips and lists each map's characters.
- **Step smoothing:** as in the original, stepping onto stairs, ledges and low props (up to the 18-unit step) moves the player instantly but the view glides over 0.2 s instead of popping.
- **Player stances:** crouch and prone in both games, with lower camera/shot/grenade origins, smaller collision hulls, slower movement and native weapon stance spread. Crouch uses C, prone uses Ctrl, and Stand/Jump uses Space. Standing up under low cover is blocked. Controller B/Circle taps crouch, holds prone; A/Cross stands before jumping. Rebind these in Options. Saves retain stance; older saves default to standing.
- **Dolphin dive (Black Ops):** Ctrl while sprinting, or hold B/Circle while sprinting, dives forward and ends prone. The physics are BlackOps.exe's own (the `dtp_*` dvar defaults and its dive code): the dive keeps the full sprint speed, launches at twice a normal jump's upward speed, holds at the 39-unit jump height until 400 ms after takeoff, then falls; on landing it slides without friction for 300 ms, stops, and movement resumes 100 ms later. That is about 7.3 m on flat ground. A dive needs 250 ms of sprinting and 1.5 s since the last dive ended; a long drop out of a dive does fall damage between 65 and 200 units. The weapon plays the gun's own dive clips and is ready again its `dtpOutTime` after landing. Walls shorten the path and ledges extend the fall. Landing and slide sounds follow the floor surface, with the stock launch/landing grunts, and an animated character body is posed for the dive. As in the original, you never see your own body in first person; it is shown only in the third-person debug view, ready for other players in a future co-op mode. WaW never dolphin dives. [The original PC manual](https://cdn.akamai.steamstatic.com/steam/apps/42700/manuals/BlackOps_PC_Manual_v2.pdf) documents the keyboard controls.
- **Audio:** 3D positional sound for machines, jingles, the PA system and pickups.
- **Pause menu:**
  - Rebindable keys (primary and secondary bindings, mouse buttons, wheel).
  - Controller support shared by WaW and Black Ops, with analog sticks, independent aim/fire triggers, grenade cooking, menu navigation and input-dependent button icons.
  - Mouse and aim sensitivity, invert, hold/toggle aim.
  - Volume, field of view, render scale, fullscreen.
  - FPS counter.
- **Launching a map:** selecting a map opens its lobby without downloading the game pack. START GAME plays the installed game's original loading movie and soundtrack while downloading assets. The progress bar measures downloaded bytes, then completed preparation stages. Once the map is ready, SKIP INTRO starts immediately; otherwise it waits for the movie to end. Der Riese's original loading clip is a silent still frame and remains on screen while the map loads. Saved-game loading uses the same flow across both games. `npm run prepare:launch` converts the original movies on E:; the normal launcher also prepares them when necessary.
- **Save game:** three named server slots per map, shared by everyone who has access to the site, with no extra sign-in. Pause → SAVE GAME, enter a name, then choose a slot. Resume from LOAD GAME on any browser or device. Saves keep live zombies, round progress, drops, timers and map state, with thumbnail and statistics. Files live under `local-data/saves/` on E: and persist across server restarts; existing browser saves import into empty slots once. A changed slot rejects stale writes from another device; overwrites and deletions retain a recovery backup.
- **Character voices (Black Ops):** solo Kino plays as a random one of Dempsey, Nikolai, Takeo or Richtofen (add `&character=0`–`3` to pick), with that character's arms and voice. Lines follow `_zombiemode_audio.gsc`: kill types and their chances, kill streaks, weapon and favourite-weapon pickups, Pack-a-Punch, perks, power-ups, refused purchases, ammo warnings, going down and the level-start line. `npm run prepare:voice` rebuilds the voice files.
- **Testing mod menu:** choose MOD MENU from the pause menu. It has god mode, unlimited points, ammo and grenades, noclip (fly through walls: look to steer, hold Jump to rise, Sprint for speed), a weapon selector and a round selector.
- **Rendering performance:** the original engine's cell-and-portal visibility (DPVS) is exported with each map. Each frame starts in the view's cell and flood-fills through the portals it can see, so only those cells' world surfaces, static props and map entities are drawn. Static props also use their original cull distances. Add `?cells=0` to the URL to compare against drawing everything.
- **Network play:** other devices on your local network can connect. Each browser runs its own solo game.

### Working: Der Riese

- Lobby and map selection, power switch, doors and zone unlocking.
  - The power lever keeps its authored off pose and rolls upward over the original 0.3 seconds. Powered navigation routes are prepared before play to avoid a pause when the switch is used.
- **Perks:** buying one plays the machine's sting at the machine, then the original drink animation and sounds. The perk takes effect when you finish drinking.
  - Jugger-Nog, Speed Cola and Double Tap work.
  - Each machine plays idle jingles and electrical sparks.
- **Teleporters:**
  - Linking shows the original stopwatch and plays the PA countdown and announcements.
  - Linked pads teleport you to the mainframe.
  - Each link strikes lightning by the spawn fence and drops a power-up.
- **Pack-a-Punch:**
  - Opens after all three links.
  - Plays the knuckle-crack animation while your gun rolls into the machine.
  - The upgraded gun comes back out with a ticking timer; leave it 15 seconds and it's gone.

### Black Ops: Kino der Toten preview

The dedicated T5 runtime uses Kino's original theater geometry, packed HDR lighting, collision, navigation, weapon rigs, animation clips and decoded sound banks. It implements BO1 round counts, wall purchases, mystery box cycling, perks, three solo Quick Revives, power and the linked teleporter's 30-second projection-room visit and automatic return. Native firearms include burst fire and Pack-a-Punch variants. The preview also has pause/settings, the testing menu and shared named server saves.

This is a browser reimplementation, not the original executable or complete BO1 engine. Hellhound rounds, Nova crawlers, traps, film reels, Mustang & Sally and full wonder-weapon projectile/effect fidelity are still pending. Ray Gun splash and the Thunder Gun cone currently use simplified combat behavior.

To prepare BO1 from the installed game on E: after installing the existing OAT toolchain:

```powershell
python -B tools/extend_bo1_exporter.py
& tools/build_exporter.ps1
python -B tools/extract_bo1.py
npm run prepare:bo1
```

Extraction, conversion, prepared packs and navigation remain under this project on E:. `npm run test:bo1` checks the native floor, ammo, rounds, interactions and sounds; `npm run test:saves` checks server persistence and sharing.

### Black Ops II: Buried

Buried opens from the collection into an orange and charcoal BO2 lobby and map selector. Its dedicated T6 rules run on the shared browser renderer and fixed-step movement/combat foundation. The original executable is not run in the browser.

The map uses the original T6 packed world geometry, three-layer HDR lightmaps, native collision, static models, doors, windows and 2,403 navigation nodes with 16,603 links. The exporter also reads T6 weapon definitions, character rigs, XAnim clips, material states, sound banks and Buried's original loading movie. START GAME downloads a prepared pack with measured byte progress, prepares the scene, then waits for the movie or offers Skip Intro.

Survival includes T6 round counts and health scaling, spawning near occupied zones, factory descent, town doors, original viewmodels and animations, wall buys and mystery box cycling, seven perk machines, power and Pack-a-Punch. Buried rules add Arthur's key/cell, booze charges through authored barricades, candy protection, six placeable weapon chalks, the bank and weapon locker, mansion ghosts and a free perk. Buildable parts can be assembled at free benches into a Turbine, Trample Steam, Head Chopper or Subsurface Resonator. Equip one and use **5 / controller D-pad Up** to place it; Use retrieves it. Bindings can be changed in Options. The Resonator needs a nearby Turbine.

Ray Gun, Ray Gun Mark II and explosive weapons use traveling projectiles, native damage and splash values. The Paralyzer has heat, cooling, slowing and a damage cone. Shared grenade cooking, stance/dive controls, gore, pause/options, testing menu and named server saves also apply to Buried. Saves keep chalks, Arthur, bank/locker, maze gates and built/placed equipment.

This is a playable survival port under development, not complete stock BO2 parity. Easter-egg quests, the Time Bomb, persistent upgrades, dual-wield presentation, chalk drawing visuals, upgraded melee viewmodels, Vulture Aid's gas and through-wall markers, full native wonder-weapon effects and exact Arthur/ghost behavior remain unfinished. Solo survival is the tested mode; Buried's special interactions have not yet been validated in co-op. Some equipment and ghost behaviors are approximations. The initial map pack is about 500 MiB compressed and is cached after download.

To extract the installed game and prepare Buried on E: using the existing OAT toolchain:

```powershell
python -B tools/extend_bo2_exporter.py
& tools/build_exporter.ps1
python -B tools/extract_bo2.py
npm run prepare:bo2
npm run test:bo2
```

`tools/decompile_bo2.py` optionally produces local script references using gsc-tool. Those scripts stay under ignored `local-data/bo2-scripts/` and are not served or packaged. All extraction, navigation, cache and prepared asset output remains under this project's directory on E:.

### WaW: in progress or not yet implemented

| Area | Status |
|---|---|
| **Ray Gun / Wunderwaffe DG-2** | Not implemented yet. Their weapon files are extracted, but projectile, splash and chain-lightning behaviour is still to do. |
| **Zombie vocals** | Growls, screams and attack and death sounds are not played yet. The animation sound cues that should trigger them have been identified. |
| **Hellhounds** | Not implemented. When the teleporter drop would send a hellhound, nothing appears instead. |
| **Der Riese extras** | Electric traps, monkey bombs and Bouncing Betties are not implemented. |
| **Der Riese spawns** | Three roof/drop zombie spawns are disabled because their traversal isn't supported yet. |
| **Teleporting** | Teleporting doesn't yet kill zombies around the pad as the original does. |
| **Quick Revive** | Can't be bought solo, matching WaW, where it only speeds up reviving teammates. |
| **Effects** | Lightning "trail" elements are drawn as camera-facing sprites rather than true ribbons. |
| **Sound ranges** | The extracted sound definitions have no min/max distances, so hearing ranges are chosen per sound type. |
| **Saves** | Can't save mid-drink, during Pack-a-Punch, with a grenade in hand or during a burst. Save after the action finishes. |
| **Multiplayer** | Solo only. There's no co-op and no last stand: going down ends the game. |
| **Other maps** | Verrückt, Shi No Numa and additional Black Ops / Black Ops II maps haven't been started. |
| **Setup automation** | Der Riese extraction isn't scripted yet; see [Setup](#setup). |

---

## Requirements

| Software | Notes |
|---|---|
| **Windows 10/11** | The extraction tools and helper scripts are Windows-specific. |
| **Call of Duty: World at War** | Installed through Steam or similar. You must own it. |
| **Node.js** | Runs the game server and tests. Developed and tested with 25.9. |
| **Python 3** | Runs the extraction and preparation scripts. Tested with 3.14. |
| **FFmpeg** | Must be on `PATH`. Converts audio and images. Tested with 8.1. |
| **Git** | Fetches the OpenAssetTools source. |
| **Visual Studio Build Tools 2026** | Needs the C++ desktop workload. Only used to build the custom asset exporter. |
| **A desktop browser** | Chrome, Edge or Firefox, with keyboard and mouse. |
| **Disk space** | About 4 GB for the extracted assets, tools and caches. |

---

## Game files used

The tools read these files from your game folder (for example `…\steamapps\common\Call of Duty World at War`). They never modify them.

| File | Used for |
|---|---|
| `zone/english/code_post_gfx.ff` | Menu and HUD fonts and images |
| `zone/english/common.ff` | Shared models, animations, weapons, effects and sounds |
| `zone/english/nazi_zombie_prototype.ff` | Nacht der Untoten: map, scripts and assets |
| `zone/english/nazi_zombie_factory.ff` | Der Riese: map, scripts and assets |
| `zone/english/localized_nazi_zombie_factory.ff` | Der Riese: localized strings and assets |
| `main/*.iwd` | Image and sound archives |

The extracted output goes to `local-data/`, which is git-ignored and should never be committed or shared.

---

## Setup

> The default game location in the scripts is `E:\SteamLibrary\steamapps\common\Call of Duty World at War`. `extract_game.py` and `prepare_gameplay.py` accept `--game-dir`. `prepare_fidelity.py` and `prepare_der_riese.py` currently hardcode the path in a `GAME` constant, so edit that line if your game lives elsewhere. `.npmrc` also pins npm's cache to this project's original folder; change or remove its `cache=` line on another machine.

**1. Clone the repository**

```bash
git clone https://github.com/CallMeBrado/cod-zombies-web.git
```

**2. Download the tools.** This downloads Premake 5.0.0-beta8 (checksum-verified) and OpenAssetTools v0.33.0. It also clones the OpenAssetTools source at a pinned revision, applies this project's exporter patch, and installs the npm dependencies.

```powershell
powershell -ExecutionPolicy Bypass -File tools\setup_tools.ps1
```

**3. Build the custom asset exporter**

```powershell
powershell -ExecutionPolicy Bypass -File tools\build_exporter.ps1
```

**4. Extract and prepare Nacht der Untoten.** This also runs the inspection, world verification and gameplay preparation steps.

```powershell
python -B tools\extract_game.py --game-dir "D:\Games\Call of Duty World at War"
```

**5. Der Riese (manual for now).** `tools/prepare_der_riese.py` builds Der Riese's gameplay data. But it expects `local-data/der-riese` to already contain a full extraction of `nazi_zombie_factory.ff`, and that extraction step isn't scripted yet. Automating it is the next setup task.

**6. Start the game**

```powershell
npm start
```

Then open **http://127.0.0.1:8789** and choose **World at War**. On Windows you can double-click **`Play Zombies.cmd`** instead: it prepares the map packs, starts the server in the background and opens your browser.

The first load downloads and caches the map packs (roughly 100 MB for Nacht and 150 MB for Der Riese, compressed). After that, reloads take a couple of seconds.

---

## Playing

In the lobby, choose **SELECT MAP**, pick a map, then **START GAME**. You start with a Colt M1911, 500 points and four grenades.

### Default controls

Every binding can be changed under **Esc → Options → Controls**.

| Action | Key |
|---|---|
| Move | W A S D |
| Look | Mouse (arrow keys also work) |
| Fire / aim | Left mouse / right mouse (or F to fire, X to toggle aim) |
| Sprint / jump | Shift / Space |
| Reload | R |
| Knife | V |
| Grenade | G (hold to cook, release to throw) |
| Switch weapon | Q or mouse wheel |
| Use, buy, rebuild, pick up a grenade | E (hold E at a window to rebuild) |
| Pause | Esc |
| Testing mod menu | Pause, then choose MOD MENU |

If the browser releases the mouse (after Esc or switching windows), click the game to capture it again.

### Local network play

The server listens on all network interfaces at port **8789**. Other computers on your network can open `http://<this-PC's-address>:8789/`; the launcher prints the address. Each browser plays its own solo game.

These environment variables apply when starting with `npm start`. `Play Zombies.cmd` always uses port 8789.

| Environment variable | Effect |
|---|---|
| `HOST=127.0.0.1` | Only this PC can connect. |
| `PORT=9000` | Use a different port. |

If Windows Firewall is enabled, allow inbound TCP on that port for `node.exe` on your local network.

### Settings and saves

Settings and key bindings remain specific to each browser. Game saves are stored on the server under `local-data/saves/`, so the same named slots appear on other devices. Everyone who can access the site shares them; no additional sign-in is needed. Back up that folder to preserve the saves. The old browser saves are retained locally and imported into empty server slots once.

### Controllers

Connect an Xbox, PlayStation, Backbone or other controller and press a button while the game tab is visible. Controllers reported by the browser with the standard mapping work immediately. Button icons follow the active input: Xbox letters, PlayStation symbols, Nintendo labels or generic button numbers. Mouse movement, clicks or keyboard input switch back to keyboard prompts. Disconnecting an active controller pauses the game.

Default controls: left stick moves; right stick looks; LT/L2 aims; RT/R2 fires; A/Cross stands/jumps; B/Circle taps crouch and holds prone (hold while sprinting to dive in BO1); X/Square reloads or uses nearby objects (hold to repair barriers); Y/Triangle switches weapons; RB/R1 throws a grenade (hold to cook); LS/L3 toggles sprint; RS/R3 knifes; Menu/Options pauses and resumes. Use the D-pad or left stick to navigate menus, A/Cross to select and B/Circle to go back. LB/L1 and RB/R1 cycle settings tabs.

**Options → Controller** contains stick sensitivity, aim sensitivity, deadzones, inverted look, hold/toggle aim, icon style and per-device button/stick remapping. Unmapped controllers need a one-time setup there: map the controls, release all buttons/sticks, then choose **USE THIS MAPPING**. Settings are saved in that browser, independently of keyboard bindings.

Use HTTPS (or `http://localhost:8789` on the server PC); browsers can restrict [Gamepad API access](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/getGamepads) on plain HTTP network URLs. Firefox exposes devices after a controller interaction while the page is visible. If browser audio is not unlocked yet, click START GAME once; controller input can then handle the remaining launch and gameplay controls.

---

## Development

```bash
npm test                 # Full suite: startup, gameplay, physics, weapons, saves, powerups, routes
npm run test:der-riese   # Der Riese progression, perks, teleporters, Pack-a-Punch and all spawn routes
npm run test:controllers # Input switching, mappings, menus, triggers and analog movement at 30–240 FPS
npm run test:coop        # Host and guest Kino games through the relay: shared zombies, kills, doors, power, revive, game over
npm run test:lobby       # Shared lobby: joining, characters, host-only start, load-in together, timeouts
npm run test:movement    # Crouch/prone, low cover, saves, controller tap/hold and native BO1 dives
npm run test:dive        # Native trajectory/recovery, cooldown, ledges, collision events, grunts and character rigs
npm run prepare:map      # Rebuild both maps' preload packs and zombie navigation
```

The route tests run zombies from every spawn at every gait speed the map uses, through the windows and to the player. Any stuck route fails the suite.

The dive settings are in `web/dive-config.js`, in world units and seconds. In the local developer console, `wawPreview.configureDive({ jumpHeight: 39, maxApexSeconds: 0.4 })` changes them for later dives. `wawPreview.diveTelemetry()` reports takeoff position, launch speed, peak rise, touchdown/stop distance, airborne/slide duration, movement/weapon-ready times and launch/landing counts. `wawPreview.setDiveThirdPerson(true)` shows the character pose; set it to `false` to restore the first-person view. `npm run prepare:dive` converts the owned stock sound layers and prepares body dependencies on E:. Shared exertion recordings are used by default; the profile table can map character-specific banks when matching recordings exist. No unique per-character dive recordings are assumed.

After changing collision or movement code, run `npm run prepare:map` to rebuild the prepared zombie navigation, then run both test commands.

---

## Project layout

```
web/                 Browser runtime: rendering, game rules, AI, HUD, menus, audio
  game.js            Core solo game: rounds, zombies, weapons, power-ups, saves
  map-rules.js       Der Riese: power, perks, teleporters, Pack-a-Punch, PA system
  collision.js       Swept-box collision against map brushes and model triangles
  main.js            Scene setup, rendering loop and event wiring
tools/               Extraction, preparation, server and test scripts
  serve.mjs          Static server for the runtime and map packs
  build_preload.mjs  Bundles each map's assets into cached packs and prepares navigation
  oat-web-world.patch  OpenAssetTools exporter patch (maps, collision, effects, sounds)
  test_*.mjs         Automated tests
docs/                Screenshots and the development log
local-data/          Extracted game data (git-ignored, never commit)
```

---

## How it works

1. **Extraction:** a patched [OpenAssetTools](https://github.com/Laupetin/OpenAssetTools) exporter reads the game's fastfiles and IWD archives. It writes maps, collision, models (GLB), animations, effects, sounds and textures into `local-data/`.
2. **Preparation:** Python scripts read the original map entities and zombie scripts and produce gameplay manifests: weapons, round rules, spawners, barriers, perks and teleporters.
3. **Packing:** `build_preload.mjs` bundles each map into compressed, cacheable packs and precomputes zombie navigation.
4. **Runtime:** the browser loads a map pack, renders it with three.js using the original lightmaps, and runs a fixed 120 Hz simulation.

For the detailed history of how the port was built, see [`docs/development-log.md`](docs/development-log.md).

---

## Credits and licences

- **Call of Duty: World at War** and all its assets belong to Activision and Treyarch. This project doesn't distribute them.
- **[OpenAssetTools](https://github.com/Laupetin/OpenAssetTools)** is GPL-3.0. The exporter patch in `tools/oat-web-world.patch` is also GPL-3.0 (see `tools/OAT-PATCH-LICENSE`).
- **[three.js](https://github.com/mrdoob/three.js)** is MIT licensed.
