# publiktransport.io

> **Status: archived prototype.** No active development.
> The simulation works, the game design was not validated — see [POSTMORTEM.md](./POSTMORTEM.md).

A competitive transit game in the browser. Two to four players build metro lines in
one shared city, and the goal is not to kill your rival — it is to get the city's
residents out of their cars and onto your network. Every district carries a modal
share (what fraction drives, or rides each operator), recalculated continuously
against travel time, crowding and fare, so the map never permanently fills up. It
runs offline against a bot and online through an authoritative Node host.

Development stopped on 2026-07-28. The simulation is finished and tested; the core
interaction never became enjoyable enough to build on. The reasoning is in the
postmortem, and the module-by-module salvage map is in
[ARCHITECTURE.md](./ARCHITECTURE.md).

## Match rules

- Five minutes. Whoever converts the most of the city out of its cars wins.
- Track may only follow corridors drawn on the map; dashed ones are express chords between hubs.
- Platforms are shared between all players — two lines total at a two-platform station, whoever owns them.
- Frequency is `roundTripTime / trains`; running over capacity makes a line feel slow and riders leave.
- Each seat opens with a home district, cheaper to build in, and one short line already running.

## Running it

```
npm install
npm run dev                  # http://localhost:5173
npm test
npm run host -- --port 8080  # authoritative four-seat lobby
```

For online play, open `http://localhost:8080`, choose **ONLINE LOBBY**, and share
`http://YOUR_PUBLIC_IP:8080`. Forward TCP `8080` to the hosting PC and allow it
through the host firewall. The host starts with 2–4 humans and fills empty seats
with bots; a disconnected human is bot-controlled until the same browser reclaims
its seat. It is deliberately a one-lobby, trusted-friends host: no accounts,
passwords, matchmaking, TLS or database. Behind CGNAT you will need a tunnel.

## Documentation

- **[POSTMORTEM.md](./POSTMORTEM.md)** — what was built, what worked, why it stopped.
- **[ARCHITECTURE.md](./ARCHITECTURE.md)** — every module, its dependencies, and whether it can be lifted out.
- **[NOTES.md](./NOTES.md)** — build notes, tuning history, balance problems known to be unresolved at freeze.

---

## Reference: playing

Retained because it is accurate and describes systems the postmortem discusses.

- **Click a station** to start a line, **click on** to add each stop. While you are
  drawing, every stop the open end can reach is ringed.
- **Enter** or double-click empty space confirms · **Backspace** undoes the last
  stop · **Esc** cancels. Clicking either loose end of your own line extends it.
- Buy and sell trains from the line list, bottom right.
- Overexpanding without the fare box to hold it up ends in a fire sale.
- **STILL DRIVING**, top right, ranks the corridors where the city is still in its
  cars. Click a row to light that corridor up on the map.
- Whoever is behind the leader is paid a small bounded **subsidy** every second.
  The leader never receives it.
- **Rush hour** surges a car-heavy district and its busiest neighbour for thirty
  seconds, telegraphed first — the comeback window.
- Opening or extending service commissions it visibly: stations radiate, the track
  receives a travelling pulse, riders stream toward the new stop, and a card
  reports the measured ridership, modal-share and net income change two simulation
  seconds later.
- **Civic Contracts** announce a shared corridor after the opening. Every operator
  races to gain 10 modal-share points there; first to the target, or the best
  qualifying gain at the deadline, takes a **$3,000 grant**.
- **⚡ Rapid Dispatch** adds two temporary trains to an owned line for 15 seconds.
  $500, 40-second cooldown. Never counts as permanent investment or resale value.
- **FRONTLINES** calls out controlled and contested districts. Dashed borders mark
  close fights; takeovers appear in the event feed.
- The last 68 seconds announce and then activate one **FINAL MANDATE** corridor,
  elevated through the finish.
- Lines with five or more stations gain a **LOC / EXP** toggle. Express calls at
  endpoints, hubs and every second intermediate station. Skipped stops are hollow
  and lose their platform; returning to Local needs a free platform at each.

The strip across the top is the whole city's modal share. It is the scoreboard.

| Key | |
|---|---|
| `F1` | segment flows |
| `F2` | desire lines |
| `F3` | pause |
| `F4` | district numbers |
| `R` | restart |

Line-list controls: `− / +` sell or buy a permanent train, `⚡` Rapid Dispatch,
`LOC / EXP` service plan, `×` closes the line.

URL parameters: `?seed=42`, `?speed=4`, `?bot=off`, `?skip=120` (fast-forward).

The **PARAMETERS** panel, top right, edits every tunable in offline development.
It is disabled during authoritative online matches.

## Layout

```
src/sim/      pure simulation — no DOM, no Math.random, no Date.now
src/bot/      greedy opponent, emits the same Commands a player does
src/online/   browser WebSocket client and reconnect handling
src/shared/   versioned client/server protocol
src/render/   Canvas 2D
src/ui/       plain DOM HUD
src/input/    line drawing
server/       authoritative Node host, lobby and static file server
tools/        headless harnesses used for balance tuning
```

`src/sim/` has one entry point, `tick(state, commands)`, and one serialisable
`GameState`.
