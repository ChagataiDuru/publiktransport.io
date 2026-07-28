# publiktransport.io — postmortem

**Status: archived prototype. Development stopped 2026-07-28.**

Short version: the simulation was validated, the game design was not. That is a
legitimate and complete result for a prototype, and it is the reason this repo is
frozen rather than continued.

---

## 1. What we were trying to do

The concept was a competitive transit builder for the browser. Two to four
players build metro lines in one shared city. You do not attack your rival
directly; you compete for the same residents. Every district carries a modal
share — what fraction of its population drives, or rides each operator — and that
split is recalculated continuously against travel time, crowding and fare. Whoever
converts more of the city out of its cars inside a five-minute match wins.

The bet was that a real transport model would carry the game. Rather than scripting
outcomes, the plan was to build an honest gravity-demand and logit mode-choice
simulation, put two rivals inside it, and let the interesting decisions fall out of
the model itself: contest a corridor, run an express over someone's line and take
their passengers, over-extend and go bankrupt on upkeep. The map never fills up
permanently, so a well-placed line can take a corridor off a rival long after they
built it. That premise held up technically. It did not turn into an enjoyable
five-second interaction, which is what this document is about.

---

## 2. What was built

- **Dates:** first commit 2026-07-27, last commit 2026-07-28.
- **Commits:** 16.
- **Size:** 11,881 tracked lines total — 6,166 lines of `src/` TypeScript, 431 in
  `server/`, 1,116 in `tests/`, 356 in `tools/`, 1,134 of CSS.
- **Playable state:** playable, offline and online. `npm run dev` gives a full
  match against the bot; `npm run host` runs an authoritative four-seat lobby.
  The test suite is green: 13 files, 65 tests, all passing at the archive commit.

Simulation modules (`src/sim/`): `state.ts` (tick loop, entry point), `types.ts`,
`params.ts`, `rng.ts`, `map.ts`, `maps.ts`, `expanded-map.ts`, `map-validation.ts`,
`network.ts` (line-expanded routing), `demand.ts`, `modechoice.ts`, `crowding.ts`,
`economy.ts`, `commands.ts`, `events.ts`, `gameplay.ts` (contracts, dispatch,
mandate, service plans), `pressure.ts`, `rivalry.ts`, `serialize.ts`.

Everything else: `src/bot/greedy.ts`, `src/online/client.ts`,
`src/shared/protocol.ts`, `src/input/linebuilder.ts`, `src/render/` (8 modules),
`src/ui/` (`hud.ts`, `endscreen.ts`, `devpanel.ts`), `server/index.ts`, and three
headless harnesses in `tools/` (`playtest.ts`, `coverage.ts`, `balance-sweep.ts`).

Tests (13 files, 65 tests): `balance`, `commands`, `crowding`, `determinism`,
`economy`, `gameplay`, `maps`, `modechoice`, `multiplayer`, `network`, `opening`,
`protocol`, `view`. The load-bearing ones are `determinism` (same seed and commands
reproduce state after 3000 ticks; the bot is deterministic on its own),
`multiplayer` (deterministic four-player bot match, `Infinity` round-trips and the
state hash survives serialisation) and `gameplay` (contracts, dispatch and service
plans replay identically).

Final balance, from the ten-seed sweep recorded in `NOTES.md` §2: two-player
matches average 51.1% car share, 6.2 lines, 21.7/36 occupied stations, 12.3/14
covered districts, with a mirror-match gap of ~1.3 points. Four-bot matches:
39.0% car, 9.9 lines, 27.9/36 stations, 13.0/14 districts.

**Playtesting:** tested in four-player sessions. The repository contains no record
of how many sessions were run, on what dates, or with how many distinct people —
that was never written down, and it is not reconstructed here.

---

## 3. What worked

The technical stack did what it was supposed to. Each item below maps to the code
that implements it.

| Capability | Where |
|---|---|
| Deterministic game state, one serialisable `GameState`, one `tick()` entry point | `src/sim/state.ts` |
| Authoritative Node server: lobby, 10 Hz sim, command authorisation, reconnect takeover | `server/index.ts` |
| Command architecture — players and bots emit the same validated commands | `src/sim/commands.ts` |
| Greedy bot, running on the same command surface as a human | `src/bot/greedy.ts` |
| Lobby / multiplayer client with reconnect tokens and seat reclaim | `src/online/client.ts`, `src/shared/protocol.ts` |
| Map abstraction — fully declarative city data, two maps, validation | `src/sim/map.ts`, `maps.ts`, `expanded-map.ts`, `map-validation.ts` |
| Camera: pan, zoom-around-cursor, clamped world/screen transforms | `src/render/view.ts` |
| Graph / network modelling — line-expanded Dijkstra with transfer penalties and express chords | `src/sim/network.ts` |
| Dynamic demand — gravity model, rush hour, contract and mandate multipliers | `src/sim/demand.ts` |
| Economy — construction cost, upkeep, land value, refunds, catch-up subsidy | `src/sim/economy.ts` |
| Event system — discriminated union, monotonic IDs, bounded history | `src/sim/events.ts` |
| Deterministic RNG, seeded, zero dependencies | `src/sim/rng.ts` |
| Replay-friendly architecture — explicit `Infinity` encoding, state hashing | `src/sim/serialize.ts` |
| Four-player state synchronisation | `server/index.ts` + `src/online/client.ts` |

The tuning work also worked, in the sense that it did what tuning can do. The
parameters shipped in the brief produced a dead match — both sides bankrupt inside
60 seconds, modal share never leaving the car. `NOTES.md` §2 records how that was
corrected and re-verified against a headless sweep. The balance is real balance.

---

## 4. What did not work

The prototype was tested in four-player sessions, and the feedback repeated:

> "I understand what I'm doing, but I don't particularly enjoy doing it."

That is not a balance complaint or a clarity complaint, and it did not move when
balance or clarity improved. Three things explain it.

**1. The feedback is statistical, not individual.** The player watches a modal
share percentage drift. There is no average character on screen; nobody responds
emotionally to an average. The simulation's core output — an OD matrix folded into
a share vector — is exactly the kind of quantity that is legible without being
felt.

**2. There is nothing to lose, so there is no threat.** The score is relative.
"Am I winning?" is answered by reading a bar and comparing it to another bar. There
is no question anywhere in the game answerable at a glance, the way "am I dying?"
is answerable at a glance. Nothing the player owns can be taken away or destroyed
in a way they watch happen.

**3. The competition is indirect.** Interference passes behind the logit
mode-choice model. When a rival takes your passengers you do not see the event —
a number moves. The most aggressive action in the game, running an express over
someone's corridor, resolves as a share value shifting a few points over the
following seconds.

Together: too much game around a core interaction that isn't enjoyable enough to
carry it. The primary verb stayed **select nodes → create/modify route → observe
simulation response**, which is a cerebral verb. Mini Metro covers nearly the same
conceptual territory and gets enormous mileage out of it because its whole design
is distilled around one tactile, escalating spatial puzzle. This project went the
other way — modal shares, competitors, contracts, subsidies, capacity, land value,
service plans, regional control. Each addition is individually defensible. The
accumulation is the problem.

---

## 5. Solutions tried

Every one of these was built and shipped. None of them moved enjoyment.

| Hypothesis | What was done | Result |
|---|---|---|
| Not enough feedback | Visual juice added | Readability improved, enjoyment did not |
| Not enough failure | Contracts, dispatch, express/local, rivalry | Number of decisions increased, enjoyment did not |
| No room for four players | Map architecture expanded | Congestion resolved, enjoyment did not |
| Competition unreadable | Frontlines and event display | Comprehensibility improved, enjoyment did not |
| Finale undramatic | Final Mandate | Closing improved, enjoyment did not |

The pattern is the finding. Five different hypotheses, five successful
implementations, five times the named problem was genuinely fixed, and the reported
experience did not change. That is what exhausting a design direction looks like.

---

## 6. Reusable parts

The simulation stack is worth more than the game built on it. Per-module
extractability — what each file does, what it depends on, and whether it can be
lifted out independently — is documented in **[ARCHITECTURE.md](./ARCHITECTURE.md)**,
including a flat list of files that transfer to a new project directly.

---

## 7. The cheapest experiment not tried

Recorded so it is not lost:

- Individual passenger agents that accumulate visibly at stations.
- A station whose capacity is exceeded for N seconds drops off the network — an
  asset that can actually be lost.
- When a rival wins a corridor, its passengers visibly walk to their platform
  instead of yours.

Together these attack all three diagnoses in section 4: a countable thing on
screen instead of an average, something losable, and a rival's win rendered as a
visible event rather than a number.

**Caveat:** this requires the current aggregate simulation — OD matrix plus share
vector — to emit individual agents. That is not a small change to `demand.ts`,
`crowding.ts` and the render layer. It is not cheap. It is only cheap relative to a
pivot, which is the sense in which it was the cheapest thing left untried.

---

## 8. The lesson

**Prototype the five-second interaction loop before the five-minute system loop.**
This project built an excellent five-minute loop — demand responds, economies
tighten, rivals contest ground, a match has an arc — on top of a five-second loop
that was never tested for enjoyment on its own. Every subsequent addition was
another five-minute system stacked on the same untested five-second core, which is
why five separate fixes all landed and none of them helped.

Second: **do not design to rescue sunk engineering effort.** The correct response
to a validated simulation and an unvalidated game is to keep the architecture and
stop the game, not to keep adding systems until the investment feels justified.
The architecture is preserved here. Which pieces of it live is a decision for the
next game's core interaction to make — not one to make now, in advance, out of
attachment to code that already exists.

---

## 9. Timeline

| Date | Commit | |
|---|---|---|
| 2026-07-27 | `4911ccc` | M0 — Vite + TS + Vitest scaffold, seeded RNG, hand-built city map |
| 2026-07-27 | `d33bf17` | M2 — gravity demand, line-expanded Dijkstra, logit mode choice |
| 2026-07-27 | `dcc95f8` | M3 — trains, frequency, capacity, the crowding valve |
| 2026-07-27 | `30afe32` | M4 — greedy opponent, land value, three-way modal share |
| 2026-07-27 | `632e79d` | M6 — rebalance against a headless harness, docs, tuning tools |
| 2026-07-27 | `9910780` | Four-player online mode and UI pass |
| 2026-07-27 | `86a9a82` | Home districts, catch-up subsidy, STILL DRIVING panel |
| 2026-07-28 | `a02d37c` | Gameplay feedback and tactical systems — contracts, dispatch, frontlines, Final Mandate |
| 2026-07-28 | `e0f8d3d` | Expanded map systems — last feature commit |

Full tuning history, the decisions taken where the spec was open, and the balance
problems known to be unresolved at freeze: **[NOTES.md](./NOTES.md)**.
