# Testing report

Everything below was run against the code in this repository. Environment: Node 22, a local game server (`npm run build && npm start`), and headless Chromium (Playwright 1.56) using **SwiftShader software WebGL**. No GPU was available.

## Automated suites

| Suite | What it drives | Result |
| --- | --- | --- |
| `npm run typecheck` | `tsc --noEmit` over client, server and tests | clean |
| `npm run test:sim` | Shared simulation, headless | **43 / 43 pass** |
| `npm run test:server` | Two raw WebSocket clients against the real server | **10 / 10 pass** |
| `npm run test:e2e` | The real game in Chromium, driven with keyboard/mouse events | **43 / 43 pass** |
| `npm run test:mp` | Two (then three) separate browser sessions on the real server | **23 / 23 pass** |

### Covered by `test:sim`

- **Movement:** acceleration to run speed, gravity, grounded detection, jump and double jump, landing, dash.
- **Collision:** the fountain basin blocks movement.
- **Rooftops:** 8/8 sampled shop rooftops can be reached from the street with jump plus Stand-assisted air jump. The ledge mantle is included.
- **Jotaro:** 3-hit combo, ORA barrage (16 hits, *STAND RUSH* announcement, cooldown), uppercut launch, Stand Leap distance, 2 s time stop.
- **DIO:** 3-hit combo, MUDA barrage, knife fan (5 projectiles, ranged hit), Evasive Dash with i-frames, 3 s time stop.
- **Time stop, for both characters:**
  - Targets are frozen: they don't move and take no damage.
  - Hits on frozen targets are queued.
  - The caster can move.
  - Queued damage lands when time resumes.
  - The long cooldown applies.
- **Defence:** blocking reduces damage, and a perfect block staggers the attacker.
- **K.O.s:** two K.O.s in one swing trigger *DOUBLE K.O.*; respawn delay works.
- **AI:** bots (melee, gunner, zombie) attack the player, and the DIO boss uses time stop.
- **Performance:** 10 bots for 600 ticks takes about 30 ms.

### Covered by `test:server`

- Room hosting and joining. An unknown room code is rejected.
- A teleport is corrected by the server (`corr` message).
- Cooldowns are enforced on the server: a second barrage request is ignored.
- The server resolves barrage hits on the remote target.
- A full match: 3 K.O.s with 2 server-side respawns. The match ends with `reason: 'ko'`, both clients receive results, and the room returns to the lobby.

### Covered by `test:e2e` (real browser, real input events)

- **Training as Jotaro:**
  - W moves (camera-relative); jump and double jump; landing.
  - E summons Star Platinum.
  - The 3-hit combo lands 3 hits; the Q barrage chains 17 hits.
  - The R uppercut launches the dummy; Shift with the Stand out performs the Stand Leap.
  - F stops time for exactly 2.0 s: hits are queued, the frozen target takes no damage, and queued damage is released as one hit on resume.
  - V pose; right-mouse block.
  - The dummy's "fight back" behaviour works.
- **Training as DIO:**
  - E summons The World. R throws knives that hit at range.
  - Shift performs the Evasive Dash. Q is the MUDA barrage.
  - F stops time for exactly 3.0 s. Knives thrown during stopped time **hang in mid-air (5/5 frozen)** and hit when time resumes.
- **Missions:**
  - M1 spawns 6 enemies, the AI engages, and completing it shows MISSION COMPLETE.
  - NEXT MISSION starts M2. Clearing 3 waves completes it.
  - NEXT MISSION starts M3 with the DIO boss (756 HP). The boss attacks and **uses time stop on the player**.
  - Player death shows the RETIRED screen. RETRY restarts the mission.
- **Free roam:** enemies spawn around town, and the player respawns after death.
- **Pause and errors:** Esc pauses and Esc resumes. No console errors were logged.

> The mission-completion checks finish enemies off through the sim (`sim.ko`), so the run doesn't take minutes in software rendering. The combat itself is exercised by the other checks.

### Covered by `test:mp` (two browser sessions)

- Host gets a room code, guest joins, and both appear in the lobby. Adding and removing a bot works.
- The match starts on both clients.
- **Synchronized state:**
  - B's movement is replicated to A with 0.00 m error after interpolation.
  - Stand summon, knife projectiles and server-validated damage replicate. A and B see the same HP.
- **Time stop across clients:** A's time stop freezes B on B's client. B can't move while frozen and recovers when time resumes.
- **K.O. flow:** B can be K.O.ed, the K.O. is credited to A, and B respawns.
- **Match end:** the match plays out to **3 K.O.s** and ends with results on both clients (*YOU WIN!* / *MATCH OVER — FIRST TO 3 K.O.*). The room then returns to the lobby.
- **Bot room:** a separate room with one human and one server bot works; the bot moves and attacks.

## Visual review

I checked full-quality screenshots of the title, character select, roster lineup, Jotaro/Star Platinum, DIO/The World, the ORA rush, the uppercut, the ZA WARUDO knives, free roam, HUD, the time-stop HUD, the lobby and results (`npm run screenshots`, plus the e2e shots in `tests/out/`). Curated copies are in `docs/screenshots/`.

## Bugs found and fixed during testing

- **Characters rendered pure white.** The base emissive colour defaulted to white (`new THREE.Color()`).
- **The sim slowed down at low frame rates.** Frame delta was clamped at 50 ms; it now catches up with up to 15 fixed steps per frame.
- **Hitch on the first hit (about 0.7 s in software GL).** First-use shader compilation of effect materials. All effect, Stand, fist and knife shaders are now pre-compiled at startup.
- **Fighters could stand inside each other.** This made hit spheres miss. Added soft body separation, and melee hits now use a capsule from the attacker's chest to the reach point.
- **Knives in DIO's time stop reached nearby targets before freezing.** They now freeze after 0.08 s of flight.
- **The idle Stand blocked the over-the-shoulder view.** It now floats behind the user's left shoulder.
- **Tall shops were hard to climb** because players bonked on the awnings. Added an airborne ledge mantle (≤ 1.2 m) and raised the Stand-assisted leap to about 7 m.
- **The Google Fonts stylesheet blocked page load** when offline or slow. It is now non-blocking.
- **Esc did nothing in a multiplayer match** started by the server, because pointer lock wasn't granted. Added an Esc pause fallback and guarded the resume handler against double-firing.
- **The results screen didn't say why a match ended.** It now shows *TIME UP* or *FIRST TO N K.O.*
- **Multiplayer attacks could resolve from a stale position.** The client sent ability requests before that frame's movement update, so at low frame rates the server saw an out-of-date position and most melee hits missed. The client now sends a fresh state packet immediately before any action, and all 3 combo hits register (210 → 187 HP).

## Measured performance

The mission 1 scene, with 7 fighters and the whole town, uses **289 draw calls and about 64k triangles**. Sixty sim ticks with 7 fighters take about 5 ms of CPU. In headless **software** WebGL the game ran at 7–10 fps at half resolution. That number reflects the CPU rasterizer, not the game.

## Not verified / limitations

- **Real-GPU frame rate:** only software WebGL was available. The draw-call and triangle budget is small, but I couldn't measure 60 fps on real hardware.
- **Pointer lock and mouse-look feel:** headless Chromium can't grant pointer lock. Tests used `?test`, which accepts clicks without lock, and set the camera yaw directly. The click-to-lock → Esc-releases → pause flow and sensitivity feel weren't exercised with a physical mouse.
- **Audio:** sounds are synthesized with WebAudio and no errors were logged, but nobody listened to them.
- **Internet hosting:** only tested on localhost and through the Vite dev proxy. The port-forwarding, tunnel and VPS instructions in the README weren't exercised. Latency and packet-loss behaviour beyond about 1–5 ms localhost ping is untested.
- **Four simultaneous human players:** tested 2 humans, 2 humans plus a bot, and 1 human plus a bot. Four humans use the same code path but weren't run.
- **Apartment climbing:** balconies are climbable by design (3 m spacing with jump plus mantle), but only shop rooftops have an automated climb test.
- **Reference video:** no video was available in this session. The art direction follows the written brief (blocky AoT-style action translated to JoJo).
- **Not supported:** gamepad and touch/mobile controls.
