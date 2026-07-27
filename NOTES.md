# NOTES

Build notes for **publiktransport.io**. Sections follow §13 of the brief.

---

## 1. Decisions taken where the spec was open

**Track may only follow a corridor that exists on the map.** §5.1 asks the command
validator to check "are the stations adjacent", but the data model has no edge list
beyond `map.ts` mentioning *kenarlar*. I read that as: the map ships a fixed
buildable graph and a line must follow it. This makes the platform lock and the
corridor race mean something, and it gives the bot a graph to plan on.
`MapEdge[]` lives on `GameState` and is never mutated.

**Express chords are part of the map.** Ten hub-to-hub edges are marked
`express: true` and skip everything between their endpoints. Without them the
"run an express over the rival's corridor and steal their share" fantasy in §1
has nothing to run on, because every line would have to call at every station in
between. They render as faint dashed corridors.

**`STATION_DWELL` is charged twice:** once per stop in `roundTripTime` (as the
spec says) and once on each in-vehicle edge during routing. Routing that ignored
dwell would make an all-stops line look exactly as fast as an express, which
kills the mechanic above.

**A new line ships with one train**, and `TRAIN_COST` is folded into
`createLineCost`. A line with zero trains has `headway = Infinity` and carries
nobody; it is not deleted, so buying one train revives it. This is what makes the
bankruptcy fire sale a slow bleed rather than an instant wipe.

**`platformUsage` is `number[]` indexed by station id, not `Map<Id, number>.`**
The spec asks for a `Map`, but `GameState` also has to be serialisable, and a
`Map` does not survive `JSON.stringify`. Same shape, same semantics.

**Access and egress are limited to a district's three nearest served stations**
(`LIMITS.ACCESS_STATIONS`), on top of `MAX_WALK_TIME`. Without the cap a district
could "walk" to any station on the map that was inside the time budget, which
made coverage irrelevant. See §2 — this interacts with `MAX_WALK_TIME`.

**`tick()` mutates and returns the same `GameState` object.** The signature in the
brief is `tick(state, commands): GameState`, which reads as immutable, but copying
196 OD entries and every route table ten times a second buys nothing. The
contract that actually matters — pure, no DOM, no `Math.random`, no `Date.now` —
holds. A server that needs snapshots can structured-clone at its own cadence.

**Route tables live on `GameState`.** They are derived, but they have to survive
between ticks (they are rebuilt at 1 Hz, not every tick). `netDirty[player]`
forces an immediate rebuild after a command so the HUD reacts on the next frame.

**Neighborhood share is the demand-weighted average of the splits of trips
originating there.** The spec defines the split per OD pair and the score per
neighborhood but not the bridge between them.

**Both players cap at 6 lines and 14 stations per line** (`LIMITS`). Six matches
the number of distinct line colours, and it keeps the line-expanded graph at the
~216 nodes the brief assumes.

**`BOT_COST_DISCOUNT` is an affordability multiplier, not a price cut.** The bot
will commit to a build when `cash >= cost * BOT_COST_DISCOUNT`. Below 1.0 it plays
more recklessly. Making it an actual discount would mean the bot paying different
prices than the player, which would corrupt the shared economy.

**`?skip=<seconds>` fast-forwards the match at load.** Added while tuning the late
game; it stays because it is the fastest way to look at a specific minute of a
match. It runs the same `step()` the main loop does, bot included.

**Extra file: `src/render/view.ts`.** Camera, colour helpers and the `ViewState`
type shared by every render module. Putting them in `renderer.ts` would have made
every submodule import its own parent.

**`tools/` holds three headless harnesses** (`playtest.ts`, `coverage.ts`,
`balance-sweep.ts`). They are
how the tuning below was done and they are worth keeping; they are not shipped.

**The offline build has no client runtime dependencies.** Online hosting adds
the small Node-only `ws` dependency; browsers still use the native WebSocket
API. `tsx` and the `ws` types are development/host tooling.

---

## 2. Parameters that felt wrong, and what they are now

The brief calls the values in §12 starting guesses. Played at those numbers the
match is not merely unbalanced, it is dead: both sides go bankrupt inside 60
seconds and the modal share never moves off the car. The first pass corrected
the foundational simulation values below.

| Param | Spec | Now | Why |
|---|---|---|---|
| `TRACK_UPKEEP` | `0.02` | `0.004` | This was the fatal one. A 1000-unit line costs $20/s to hold, which exceeds its entire construction cost over a 300s match and dwarfs any plausible fare box. First line built ⇒ guaranteed bankruptcy. At `0.004` track is a real drag on sprawl without being a death sentence. |
| `STATION_DWELL` | `20` | `6` | 20s per stop put 240s of dwell into a 6-stop round trip, so a single-train line ran a 262s headway — an average wait longer than driving across the whole city. Nobody rode anything. |
| `MAX_WALK_TIME` | `300` | `40` | At `WALK_SPEED: 8`, 300s is 2400 world units: every district could walk to every station on a 1600×1000 map. Coverage stopped mattering and the whole city converted uniformly no matter where you built. Every district has a station within 13s of its centroid, so 40s reaches your own district plus the near edge of a neighbour. |
| `FARE` | `0.06` | `0.08` | Consequence of the above: with sane upkeep the fare box needed to make a well-run line clearly profitable rather than marginal. |
| `STARTING_CASH` | `12000` | `15000` | A player can now build a useful opening and still make a meaningful follow-up instead of watching the cash counter. |
| `BETA` | `0.008` | `0.012` | At 0.008 a network six times slower than driving still held 22% share, so the difference between a good line and a bad one barely showed. 0.012 makes quality legible without making the loser's share collapse to nothing. |

### Accessibility and map-fill pass (2026-07-27)

Repeated 300-second matches showed a second problem: the bot spent nearly all
of its surplus on trains, the map stopped at three total lines, and a human had
no time to read the opening before the bot claimed the best corridor. These
values are deliberately conservative:

| Param | Before | Now | Why |
|---|---:|---:|---|
| `TRACK_COST_PER_UNIT` | `4.5` | `3.5` | Makes long corridors and extensions about 22% cheaper. |
| `STATION_COST` | `900` | `700` | Keeps station-heavy routes from consuming the whole opening wallet. |
| `LAND_VALUE_STEP` | `0.25` | `0.15` | Contested districts still get dearer, but the follower is not priced out after one line. |
| `BOT_OPENING_DELAY` | `0` | `10s` | Gives a human time to inspect demand and start drawing before the bot acts. |
| `BOT_COST_DISCOUNT` | `1.0` | `1.05` | The bot keeps a 5% cash buffer rather than spending at the exact affordable tick. |

The greedy policy now prioritises a second or third line over extra frequency
unless a line is genuinely overloaded. Run `npm run test:balance` to reproduce
the ten-seed sweep. Two-player results average **4.6 lines**, **18.5/36 occupied
stations**, **12.3/14 covered districts**, and **54.5% car share**. Four-bot
matches average **6.6 lines** and **22.5/36 occupied stations**. A planner making
the same quality of decisions only every ten seconds wins **6/10** matches
against the bot; this is used as a difficulty signal, not a hard unit test.

**Still not right, in order of how much it bothers me:**

- `CROWD_PENALTY_K: 1.8` bites hard but slowly — the 1 Hz recalculation plus
  `SHARE_LERP: 0.15` means about eight seconds pass between a line going over
  capacity and the player feeling it. I would try `SHARE_LERP: 0.22` for
  crowding specifically, or run the crowding feedback at 2 Hz.
- `RUSH_MULTIPLIER: 3.0` over `RUSH_DURATION: 20` moves the city share by
  roughly two points. Visible, but not the "big score swing / comeback
  mechanic" §5.7 promises. Try `4.0` and `30`, or make rush hour hit two
  adjacent districts.
- `TRAIN_UPKEEP: 1.2` vs `TRAIN_COST: 1500` means a train pays for its own
  upkeep for 20 minutes before the purchase price matters. Over a 5-minute match
  trains are effectively free once you can afford one, which is why both bots
  end up train-hoarding. Either `TRAIN_UPKEEP: 3.0` or `TRAIN_COST: 900`.
- `CONGESTION_K: 1.4` clamps out at `CONGESTION_MAX: 3.0` only when everyone
  drives. In practice congestion lands around 1.6–2.0 and the self-balancing
  loop is gentler than the brief implies. It is doing its job — car share
  stops falling around 45% — but you have to be looking for it.

Before the accessibility pass, greedy bot vs greedy bot over seeds 1 / 42 / 777 /
2024 / 99 ended at **55–57% car**, first mover **23–27%**, second mover
**18–20%**, with 2 lines and 12–15 trains against 1 line and 9–11 trains.

That 6-point gap is not noise — **whoever builds first wins**, every seed. The
opener claims the highest-demand corridor, and `LAND_VALUE_STEP` then makes the
same ground more expensive for the follower, so the lead compounds through
exactly the mechanic §5.5 introduced to reward it. Against a human it reads as
"don't dawdle", which is fine; between two equal agents it is a coin flip decided
before either has any information. This is the strongest argument for the
asymmetric openings in §4.3.

---

## 3. Multiplayer implementation

The multiplayer lift is now implemented as a single authoritative Node host:

1. **`server/index.ts`** serves the Vite build and owns one four-seat lobby, the
   10 Hz simulation, command authorisation, server-side bots and reconnect
   takeover.
2. **`src/shared/protocol.ts`** is the versioned, runtime-validated wire contract.
   Clients never choose their trusted player id; the server attaches it from the
   authenticated seat.
3. **`src/sim/serialize.ts`** explicitly encodes positive and negative
   `Infinity` for snapshots.
4. **`src/sim/**`** now supports two through four competitors with dynamic
   `{car, ...players}` modal shares, route tables and bot timers.
5. **`src/online/client.ts`** stores a reconnect token, retries dropped sockets
   and reclaims the same seat. While disconnected, the server bot controls it.
6. **The dev panel is hidden online.** The server process is the only authority
   mutating simulation parameters and state during a network match.

For this small trusted-friends target, clients render authoritative snapshots at
5 Hz rather than predicting locally. That keeps command ordering and recovery
simple and leaves the deterministic local loop untouched for offline play.

---

## 4. Next three features, most valuable first

1. **Line-level scheduling instead of a single train count.** Right now a line is
   one number and every train stops everywhere. Letting a player run some trains
   as express over their own stopping pattern would turn the express chords from
   a map feature into a decision, and it is the shortest path to the depth the
   crowding model already supports.
2. **A visible pressure readout for where people want to go and can't.** F2 shows
   raw desire lines, but nothing shows *unmet* desire — the pairs with high demand
   and terrible service. That is the single question a player asks every four
   seconds, and it is currently answered by squinting. A ranked list of the top
   five underserved corridors, with a click-to-preview line, would carry most of
   the strategic load.
3. **Asymmetric openings.** Both players start with the same $15k on the same
   static map, so the first 30 seconds are close to solved. Giving each side a
   different starting position, a starter line, or a district they already hold
   would make the first decision interesting and is nearly free to build on top
   of `createInitialState`.
