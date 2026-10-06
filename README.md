# CoD Zombies Web

A browser runtime for **Call of Duty: World at War Nazi Zombies**. It loads the original maps, models, textures, lighting, animations, sounds and HUD art from your own installed copy of the game and plays them in a desktop browser with [three.js](https://threejs.org/).

Two maps are playable solo: **Nacht der Untoten** and **Der Riese**.

![Nacht der Untoten in the browser](docs/images/nacht-gameplay.jpg)

> **Unofficial fan project.** Not affiliated with or endorsed by Activision or Treyarch. No game assets are included in this repository. You need a legally owned copy of *Call of Duty: World at War*; the tools extract assets from your installation into a local, git-ignored folder.

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
  - Wall buys, and the mystery box with weapon cycling and a manual grab.
  - Grenades: cook them, throw them through windows, or pick up live ones and throw them back.
- **Barriers:** rebuilt with the use key, awarding points with the original repair sound.
- **Power-ups:**
  - Max Ammo, Insta-Kill, Double Points, Nuke, plus Carpenter on Der Riese.
  - Original shuffled drop rotation.
  - Spawn sound and looping hum while a drop sits on the ground.
- **HUD:** chalk round tally with the white flash between rounds, score with +point popups, ammo, grenades, perk icons and a moving crosshair.
- **Audio:** 3D positional sound for machines, jingles, the PA system and pickups.
- **Pause menu:**
  - Rebindable keys (primary and secondary bindings, mouse buttons, wheel).
  - Mouse and aim sensitivity, invert, hold/toggle aim.
  - Volume, field of view, render scale, fullscreen.
  - FPS counter.
- **Save game:** three save slots per map. A save keeps the whole session: live zombies, round progress, drops, timers and map state. Slot cards show a screenshot, the round, points, kills, weapons and perks.
- **Testing mod menu:** hold Aim and press Knife. It has god mode, unlimited points, ammo and grenades, a weapon selector and a round selector.
- **Network play:** other devices on your local network can connect. Each browser runs its own solo game.

### Working: Der Riese

- Lobby and map selection, power switch, doors and zone unlocking.
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

### In progress or not yet implemented

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
| **Saves** | Stored per browser (`localStorage`). Can't save mid-drink, during Pack-a-Punch or with a grenade in hand. |
| **Multiplayer** | Solo only. There's no co-op and no last stand: going down ends the game. |
| **Other maps** | Verrückt, Shi No Numa and Black Ops maps (for example Kino der Toten) haven't been started. |
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

Then open **http://127.0.0.1:8789**. On Windows you can double-click **`Play Zombies.cmd`** instead: it prepares the map packs, starts the server in the background and opens your browser.

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
| Testing mod menu | Hold Aim, then press Knife |

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

Settings, key bindings and the save slots are stored in each browser's local storage. A save made in one browser won't appear in another.

---

## Development

```bash
npm test                 # Full suite: startup, gameplay, physics, weapons, saves, powerups, routes
npm run test:der-riese   # Der Riese progression, perks, teleporters, Pack-a-Punch and all spawn routes
npm run prepare:map      # Rebuild both maps' preload packs and zombie navigation
```

The route tests run zombies from every spawn at every gait speed the map uses, through the windows and to the player. Any stuck route fails the suite.

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
