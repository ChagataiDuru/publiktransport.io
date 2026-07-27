import { decide } from '../src/bot/greedy.ts';
import { PARAMS } from '../src/sim/params.ts';
import { createInitialState, tick } from '../src/sim/state.ts';
import { carTime } from '../src/sim/demand.ts';
import type { Command, GameState, PlayerId } from '../src/sim/types.ts';

Object.assign(PARAMS, JSON.parse(process.env.P ?? '{}'));
const seed = Number(process.env.SEED ?? 42);
const quiet = process.env.Q === '1';

let s: GameState = createInitialState(seed);
const hz = PARAMS.TICK_HZ;
const offset = [0, Math.round(PARAMS.BOT_DECISION_INTERVAL * hz / 2)];
const last = [-1e9, -1e9];

for (let t = 0; t < PARAMS.MATCH_SECONDS * hz; t++) {
  const cmds: Command[] = [];
  for (let p = 0 as PlayerId; p < 2; p = (p + 1) as PlayerId) {
    if (s.tick - last[p] >= PARAMS.BOT_DECISION_INTERVAL * hz && (s.tick + offset[p]) % 5 === 0) {
      last[p] = s.tick;
      cmds.push(...decide(s, p));
    }
  }
  s = tick(s, cmds);
  if (!quiet && t % (30 * hz) === 0) {
    const c = s.cityShare;
    console.log(
      `t=${(t/hz).toString().padStart(3)}s car=${(c[0]*100).toFixed(1)}% p1=${(c[1]*100).toFixed(1)}% p2=${(c[2]*100).toFixed(1)}%` +
      ` | cash ${s.players[0].cash.toFixed(0)}/${s.players[1].cash.toFixed(0)}` +
      ` | lines ${s.players[0].lines.length}/${s.players[1].lines.length}` +
      ` trains ${s.players[0].lines.reduce((a,l)=>a+l.trains,0)}/${s.players[1].lines.reduce((a,l)=>a+l.trains,0)}`
    );
  }
}
const c = s.cityShare;
console.log(`SEED ${seed} FINAL car=${(c[0]*100).toFixed(1)}% p1=${(c[1]*100).toFixed(1)}% p2=${(c[2]*100).toFixed(1)}%` +
  ` lines ${s.players[0].lines.length}/${s.players[1].lines.length}` +
  ` trains ${s.players[0].lines.reduce((a,l)=>a+l.trains,0)}/${s.players[1].lines.reduce((a,l)=>a+l.trains,0)}` +
  ` cash ${s.players[0].cash.toFixed(0)}/${s.players[1].cash.toFixed(0)}`);
if (!quiet) {
  for (const pl of s.players) {
    console.log(`--- P${pl.id} ---`);
    for (const l of pl.lines) console.log(`  L${l.id} stops=${l.stations.length} trains=${l.trains} load=${l.loadFactor.toFixed(2)} riders=${l.ridership.toFixed(0)} track=${l.trackLength.toFixed(0)}`);
  }
  console.log('nb0->nb6 transit', s.routes[0].time[0][6].toFixed(0), 'car', carTime(s, 0, 6, s.odShare[0][6][0]).toFixed(0));
}
