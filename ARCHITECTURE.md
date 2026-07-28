# Architecture

Module map for **publiktransport.io**, written at archive time to answer one
question from a future project: *what can I lift out of here?*

This file is meant to outlive [POSTMORTEM.md](./POSTMORTEM.md). The postmortem
explains why the game stopped; this explains what survived it.

**Extractable** means: can this file be copied into an unrelated project and
compile with only the dependencies listed beside it?

- **yes** — self-contained, or depends only on other *yes* files.
- **partial** — the algorithm or pattern transfers, but the file carries
  game-specific types or content you would rewrite.
- **no** — this *is* publiktransport.io. Read it for ideas, do not copy it.

Import edges below are the real ones, read off the source at commit `e0f8d3d`.

---

## Simulation core — `src/sim/`

Pure. No DOM, no `Math.random`, no `Date.now`. One entry point, `tick(state, commands)`.

| File | What it does | Depends on | Extractable |
|---|---|---|---|
| `params.ts` | Every tunable in the game, one object, mutated in place by the dev panel | — | **yes** |
| `rng.ts` | Seeded deterministic PRNG | — | **yes** |
| `serialize.ts` | Snapshot encode/decode; explicitly round-trips `±Infinity`, which `JSON` cannot | — | **yes** |
| `types.ts` | Every simulation type, including `GameState` | `rng` | **yes** |
| `events.ts` | Structured `GameEvent` union, monotonic IDs, history bounded to 32 | `types` | **yes** |
| `modechoice.ts` | Logit mode choice — utility vector in, share vector out, with smoothing | `params` | **yes** |
| `map.ts` | City data model: stations, districts, corridor edges, express chords, home seats | `types` | **yes** |
| `map-validation.ts` | Asserts a map is connected and every district reachable | `map` | **yes** |
| `network.ts` | Line-expanded Dijkstra: transfer penalties, dwell, express skip patterns | `map`, `params`, `types` | **yes** |
| `expanded-map.ts` | The larger four-player city, as data | `map`, `types` | partial |
| `maps.ts` | Map registry, selection by player count | `expanded-map`, `map` | partial |
| `demand.ts` | Gravity demand over OD pairs; folds rush/contract/mandate multipliers into `effectiveDemand` | `gameplay`, `map`, `params`, `types` | partial |
| `crowding.ts` | Load factor per segment, crowding penalty back into perceived travel time | `demand`, `network`, `types` | partial |
| `economy.ts` | Construction cost, upkeep, land value and decay, refunds, catch-up subsidy | `events`, `map`, `params`, `types` | partial |
| `commands.ts` | The command surface. Validates and applies every mutation; players and bots both go through it | `economy`, `events`, `map`, `network`, `params`, `types` | no |
| `gameplay.ts` | Civic Contracts, Rapid Dispatch, Final Mandate, district frontlines, service plans | `events`, `network`, `params`, `rivalry`, `types` | no |
| `pressure.ts` | Ranks OD pairs still driving — shared by the bot and the STILL DRIVING panel | `demand`, `network`, `types` | no |
| `rivalry.ts` | Derives district control and contested borders from modal shares | `params`, `types` | no |
| `state.ts` | `createInitialState` and `tick`. Owns tick order and the route-cache rebuild | all of the above | no |

## Multiplayer — `server/`, `src/online/`, `src/shared/`

| File | What it does | Depends on | Extractable |
|---|---|---|---|
| `src/shared/protocol.ts` | Versioned wire contract, runtime-validated. Clients never send their own player id | `types` | partial |
| `src/online/client.ts` | Browser WebSocket client: reconnect token in `localStorage`, retry, seat reclaim | `protocol`, `serialize`, `types` | partial |
| `server/index.ts` | Authoritative host: static file serving, one four-seat lobby, 10 Hz sim, command authorisation, server-side bots, reconnect takeover | `greedy`, `protocol`, `commands`, `maps`, `params`, `serialize`, `state`, `types`, `ws`, node builtins | partial |

The *shape* here is the reusable part and it is worth restating, because it is the
piece that took the longest to get right: one authoritative process owns the
simulation; clients send intents, never state; the server attaches the trusted
seat id; snapshots are rendered at 5 Hz with no client-side prediction; a dropped
player is driven by a bot until the same browser reclaims the seat with its token.
For a small trusted-friends target that is enough, and it keeps the offline
deterministic loop completely untouched.

## Bot — `src/bot/`

| File | What it does | Depends on | Extractable |
|---|---|---|---|
| `greedy.ts` | Greedy opponent. Emits the same `Command`s a human does — no privileged access to state | `commands`, `economy`, `map`, `params`, `pressure`, `types` | no |

## Render — `src/render/`

Canvas 2D. Every module draws from `ViewState`.

| File | What it does | Depends on | Extractable |
|---|---|---|---|
| `view.ts` | Camera: world/screen transforms, zoom around cursor, clamp to bounds; colour helpers | `params`, `types` | **yes** |
| `effects.ts` | Commissioning rings, rider streams, pulses, impact cards. Render-time only, never in `GameState` | `params`, `types`, `view` | partial |
| `stations.ts` | Stations, platform occupancy, skipped-stop rendering | `network`, `types`, `view` | no |
| `lines.ts` | Line geometry, corridors, express chords | `commands`, `map`, `types`, `view` | no |
| `trains.ts` | Train positions along lines | `network`, `types`, `view` | no |
| `neighborhoods.ts` | District polygons, modal-share fill, frontline borders | `maps`, `params`, `rivalry`, `types`, `view` | no |
| `overlay.ts` | Debug overlays — segment flows (`F1`), desire lines (`F2`) | `demand`, `types`, `view` | no |
| `renderer.ts` | Draw order and frame composition | every render module | no |

## UI and input

| File | What it does | Depends on | Extractable |
|---|---|---|---|
| `src/ui/devpanel.ts` | Live editor over every key in `PARAMS`, grouped by `PARAM_GROUPS`. Disabled in online matches | `params` | **yes** |
| `src/ui/hud.ts` | Scoreboard, line list, STILL DRIVING, contracts, frontlines, event feed, guidance | `params`, `pressure`, `rivalry`, `state`, `types` | no |
| `src/ui/endscreen.ts` | Final standings | `params`, `types` | no |
| `src/ui/style.css` | All styling | — | no |
| `src/input/linebuilder.ts` | Line drawing: click to start, extend from a loose end, reachable-stop ringing, undo/cancel | `view`, `commands`, `economy`, `map`, `params`, `types` | no |
| `src/main.ts` | Boot, main loop, URL params (`?seed`, `?speed`, `?bot`, `?skip`), offline/online wiring | — | no |

## Harnesses — `tools/`

Not shipped. These are how the tuning in `NOTES.md` §2 was actually done, and the
pattern is more valuable than the code: a deterministic simulation you can run
headless N times across N seeds turns balance from opinion into measurement.

| File | What it does | Extractable |
|---|---|---|
| `balance-sweep.ts` | Ten-seed sweep, reports car share, lines, stations, districts, planner win rate | partial |
| `playtest.ts` | Single headless match to a readable summary | partial |
| `coverage.ts` | Station/district coverage report | partial |
| `online-smoke.ts` | Drives real WebSocket clients against the host, including reconnect and seat reclaim | partial |

---

## Direct transfer list

Files that move to a new project with no rewriting, only their listed imports:

```
src/sim/params.ts          zero deps
src/sim/rng.ts             zero deps
src/sim/serialize.ts       zero deps — the ±Infinity handling is the useful bit
src/sim/types.ts           needs rng.ts
src/sim/events.ts          needs types.ts
src/sim/modechoice.ts      needs params.ts — generic logit, not transit-specific
src/sim/map.ts             needs types.ts
src/sim/map-validation.ts  needs map.ts
src/sim/network.ts         needs map.ts, params.ts, types.ts
src/render/view.ts         needs params.ts, types.ts — the camera is fully general
src/ui/devpanel.ts         needs params.ts — works for any flat params object
```

Two of these are worth calling out. `network.ts` is a line-expanded Dijkstra with
transfer penalties — it is a general graph router, not a transit-only one, and it
is the single most expensive piece of thinking in the repo. `view.ts` is a
complete, tested 2D camera (`tests/view.test.ts` covers round-tripping and
clamping) with no game coupling at all.

The honest summary: **the deterministic simulation substrate transfers, the game
does not.** Everything above the `commands.ts` line in the first table is
publiktransport.io specifically, and a different game would want different systems
sitting on the same base.
