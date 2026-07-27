# publiktransport.io

A competitive transit game in the browser. Two players build metro lines in the
same city. The goal is not to kill your rival — it is to get the city's residents
out of their cars and onto your network. Whoever converts more people in five
minutes wins.

Every district has a modal share: what fraction of its population drives, rides
player 1, or rides player 2. That three-way split is recalculated continuously,
so the map never really fills up — a well-placed express can take a corridor off
your rival long after they built it.

```
npm install
npm run dev      # http://localhost:5173
npm test
npm run build
npm run host -- --port 8080
```

## Online play

`npm run host -- --port 8080` builds the client and starts one authoritative
four-seat lobby on your PC. Open `http://localhost:8080`, choose **ONLINE
LOBBY**, then share `http://YOUR_PUBLIC_IP:8080` with friends.

- Forward TCP port `8080` to the hosting PC in your router and allow it through
  the host firewall.
- The host can start with 2–4 humans and can fill empty seats with bots.
- A disconnected human is bot-controlled until the same browser reconnects and
  reclaims its seat.
- The server is intentionally a simple one-lobby, trusted-friends host: no
  accounts, passwords, public matchmaking, TLS setup or persistent database.
- If your ISP uses CGNAT or blocks inbound ports, direct public-IP hosting will
  require a VPN/tunnel or a genuinely routable public address.

## Playing

You start with a **home district** — outlined in your colour, cheaper to build
in — and one short line already running in it. Extending that stub is the
fastest first move.

- **Click a station** to start a line, **click on** to add each stop. Track only
  follows the corridors already drawn on the map (the faint lines); dashed ones
  are express chords between hubs that skip everything in between. While you are
  drawing, every stop the open end can reach is ringed.
- **Enter** or double-click empty space confirms · **Backspace** undoes the last
  stop · **Esc** cancels. Clicking either loose end of one of your own lines
  extends it instead of starting a new one.
- Buy and sell trains from the line list, bottom right. Frequency is
  `roundTripTime / trains`, so a long line needs more of them.
- Platforms are **shared between both players**. Two lines total can call at a
  two-platform station, whoever they belong to. Hubs take three or four.
- Running a line over capacity makes it look slow to passengers and they leave.
  Overexpanding without the fare box to hold it up ends in a fire sale.
- **STILL DRIVING**, top right, ranks the corridors where the city is still in
  its cars and tells you why you are not winning them. Click a row to light that
  corridor up on the map.
- Whoever is behind the leader is paid a small **subsidy** every second, shown in
  the wallet. It is bounded, and the leader never receives it.
- **Rush hour** surges a car-heavy district and its busiest neighbour for thirty
  seconds. It is telegraphed first — that is the comeback window.

The strip across the top is the whole city's modal share. It is the scoreboard.

| Key | |
|---|---|
| `F1` | segment flows |
| `F2` | desire lines |
| `F3` | pause |
| `F4` | district numbers |
| `R` | restart |

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
`GameState`. It is written to be lifted onto a Node server unchanged — see
`NOTES.md` §3 for what would have to move.

Build notes, tuning history and known balance problems: **[NOTES.md](NOTES.md)**.
