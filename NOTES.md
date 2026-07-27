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

**Every seat opens with a home district and a two-stop stub line in it.**
Nothing in the brief asks for this; §4.3 only notes that both players start
identical. Played that way the first thirty seconds were solved — both sides
raced the same highest-demand corridor and whoever got there first compounded
the lead through `LAND_VALUE_STEP`. Seats now open in Old Town / Exchange /
Quayside / Foundry (`HOME_SEATS` in `map.ts`), build there at `HOME_DISCOUNT`,
and start with the stub already running. The stub is granted through the
ordinary `CreateLine` path with the money advanced first, so platform locks,
land value and the 50% refund all behave exactly as if it had been built.
`createInitialState(seed, players, { starterLines: false })` turns it off; only
unit tests that need a bare map use it.

**Weaker homes open with more cash.** Foundry's catchment is half Exchange's, so
a fixed `STARTING_CASH` would have made the seat draw decide the match.
Opening cash scales with the mean-to-own ratio of home catchment (own population
plus half of each corridor neighbour's), clamped, exponent `HOME_COMPENSATION`.
At `1.0` a mirror bot match finishes within ~1.3 points; at `0` the seat-1
advantage is ~3 points and a slower planner never wins. See §2.

**There is a catch-up subsidy, which the brief does not have.** A trailing
operator is paid `SUBSIDY_PER_POINT` $/s per point of city share behind the
leader, capped at `SUBSIDY_MAX`. It is deliberately small next to a healthy fare
box (~$180/s late game) and large next to an opening one (~$20/s), so it buys a
comeback attempt early and nothing at all late. It never overtakes: the leader
by definition receives zero.

**Rush hour surges a district *and* its busiest neighbour**, and picks from the
five districts with the most people still driving rather than uniformly at
random. Surging a corridor somebody already serves well just pays the leader;
surging one nobody serves is an opening. `RushHour.secondary` is `-1` when the
district has no corridor neighbour.

**Land value decays back toward 1.0.** Without it the first service into a
district raised the price there permanently and the opening advantage compounded
for the rest of the match.

**The bot and the HUD read the same unmet-demand ranking** (`sim/pressure.ts`).
It was the bot's private `rankedCarPairs`; making it a shared pure function is
what let the "STILL DRIVING" panel exist without a second, subtly different
implementation of the same idea.

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

### Refinement pass (2026-07-27, second)

Ten-seed sweep before this pass: **54.5% car**, mirror-match gap **3–6 points
with seat 1 always ahead**, a planner deciding every 10s won **6/10**. The
problems were the ones flagged below it: trains were effectively free, rush hour
moved the score about two points, crowding took ~8s to be felt, and the opening
was a race down one corridor.

| Param | Before | Now | Why |
|---|---:|---:|---|
| `TRAIN_UPKEEP` | `1.2` | `2.6` | A train paid for its own upkeep for 20 minutes before the purchase price mattered, so over a 5-minute match frequency was a free action and both bots hoarded. |
| `TRAIN_COST` | `1500` | `1200` | Lowered alongside the upkeep rise: buying frequency should be an easy decision to make and an expensive one to keep. |
| `DEMAND_RECALC_HZ` | `1` | `2` | Halves the lag between a line going over capacity and the player feeling it. |
| `SHARE_LERP` | `0.15` | `0.1` | Compensates for the doubled recalculation rate; net response is slightly faster, not twice as fast. |
| `RUSH_MULTIPLIER` | `3.0` | `4.0` | Rush hour was worth about two points of city share. It is meant to be the comeback window. |
| `RUSH_DURATION` | `20` | `30` | Long enough to react to rather than just survive. |
| `RUSH_INTERVAL` | `60` | `55` | Four surges in a match instead of three. |
| `LAND_VALUE_DECAY` | — | `0.015`/s | New. Claiming ground is a temporary moat, not a permanent tax on everyone else. |
| `HOME_DISCOUNT` | — | `0.75` | New. Makes each seat's natural opening a different corridor. |
| `HOME_COMPENSATION` | — | `1.0` | New. Swept over 0 / 0.6 / 1.0 / 1.6 / 2.4; the planner-win rate peaks hard at 1.0 (0, 1, **5**, 4, 0 wins out of 10). |
| `SUBSIDY_PER_POINT` | — | `1.1` | New, capped at `SUBSIDY_MAX: 22`. |

After: **51.1% car**, **6.2 lines**, **21.7/36 stations**, **12.3/14 districts**,
mirror-match gap **~1.3 points**, planner wins **5/10**. Four bots: **39.0%
car**, **9.9 lines**, **27.9/36 stations**, **13.0/14 districts**.

**Still not right, in order of how much it bothers me:**

- **Four-seat matches are still not square.** Averaged over ten seeds the four
  bots finish at 17.6 / 15.9 / 12.6 / 15.0 percent — a 4.9-point spread, all of
  it against the Quayside seat, which is boxed in by the other three. I tried
  Millbank (6.8 spread), Riverton (7.2) and pointing Quayside's stub into
  Central (9.2); the shipped set is the flattest of the four. The honest fix is
  a second map laid out for four, not more compensation on this one.
- **The stubs themselves are not equally productive.** Left alone for 30
  seconds they diverge by about 5 points of city share, which is what the
  opening-cash compensation is paying for. Compensating on *measured stub
  yield* rather than population would be more precise; I could not do it
  without running the simulation inside `createInitialState`.
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

Two of the three previously listed here are now built: the unmet-demand readout
is the **STILL DRIVING** panel (`sim/pressure.ts` + `ui/hud.ts`, click a row to
light the corridor on the map), and asymmetric openings are the home districts
and stub lines described in §1. What is worth doing next:

1. **A second map, laid out for four.** The four-seat spread in §2 is a property
   of this city: its demand mass sits in one row of three districts, so the two
   seats flanking Central are simply better. A map with four balanced quarters
   would fix in geometry what opening cash is currently papering over, and the
   map data is already fully declarative in `map.ts`.
2. **A one-minute opening tutorial that plays itself.** The commissioning guide
   and reachable-stop highlight get a first-time player from "nothing happens when I
   click" to building, but the contextual prompts still do not teach route
   planning or platform conflicts.
3. **Balance and clarity passes for the new tactical systems.** Contract target
   gain, Express stopping patterns and the last-minute multiplier now have the
   right architecture but need observation across a wider range of human skill.

---

## 5. Gameplay and fun expansion (2026-07-28)

### Architecture decisions

- **Structured events are authoritative; effects are not.** `GameEvent` is a
  discriminated union stored in the normal snapshot. `nextEventId` only
  increases, while history is trimmed to 32 entries. A client initializes its
  cursor to the newest event on a new seed/reconnect and therefore never
  replays a whole match. Rings, rider streams, pulses and impact-card lifetime
  use render time/local comparison state and never enter `GameState`.
- **Contracts and the Final Mandate reuse the OD pipeline.** Corridor ranking,
  lifecycle, baselines, progress, cash grants and mandate scheduling live in
  `sim/gameplay.ts`. `effectiveDemand` folds their multiplier in before
  assignment, crowding, fares and score. Rush/contract/mandate stacking is
  capped at `MAX_DEMAND_MULTIPLIER: 6`.
- **Rapid Dispatch is temporary capacity, not ownership.** Lines retain their
  permanent `trains` and `investment`. `effectiveTrainCount` adds two only while
  `dispatchEndsAtTick` is active. Upkeep and refunds continue to use permanent
  trains, and expiration dirties the same route cache as a normal frequency
  change.
- **District control is derived.** No territory score was added. Frontlines rank
  the existing neighborhood modal shares, and only the stable controlled leader
  is retained to detect one takeover event.
- **Express stops are deterministic.** An Express line serves both endpoints,
  every hub and even-indexed intermediate stations. Trains still traverse every
  physical segment, but skipped nodes are absent from access and transfer
  tables and contribute no dwell. Switching to Express releases skipped
  platforms; returning to Local is rejected unless each platform can be
  reacquired. Extending recalculates the pattern and always serves the new
  endpoint.
- **Online snapshots still omit route caches.** The browser-side pressure panel
  now derives its small route table when needed. Previously, dereferencing the
  omitted cache crashed the first online snapshot and made the clock, canvas and
  bots appear frozen.

### New parameter defaults

| System | Parameters |
|---|---|
| Contracts | first 35s; telegraph 7s; active 30s; cooldown 20s; result 5s; demand ×2; target +10 pts; minimum deadline gain +2.5 pts; reward $3,000 |
| Demand safety | maximum combined multiplier ×6 |
| Rapid Dispatch | +2 trains; active 15s; cooldown 40s; cost $500 |
| Frontlines | minimum share 18%; control margin 8 pts; contested margin 8 pts |
| Final Mandate | starts with 60s left after an 8s telegraph; demand ×2.5 |
| Express | minimum 5 stations |

### Deliberate simplifications and tuning risks

- Contract contestability uses current route reachability plus remaining car
  share and monopoly penalty. It does not estimate future construction cost or
  prove that every player can reach the pair before the deadline.
- The impact card attributes the two seconds after construction to that action.
  It is honest authoritative measurement, but concurrent rush/contract/rival
  changes can contribute to the displayed delta.
- Rider streams use neighborhood centroids and a fixed bounded particle count,
  not one particle per passenger or a full catchment analysis.
- District control currently uses thresholded recomputation rather than a
  separate multi-tick capture timer. The 8-point margin prevents most noise,
  but close human matches should be watched for undesirable churn.
- Express uses one automatic stopping pattern; manual stops, mixed local/express
  fleets and schedule editing remain intentionally out of scope.
- The HUD now carries contracts, frontlines, events, guidance and line tactics.
  Common desktop sizes are supported, but smaller laptop widths need a future
  responsive consolidation pass.
