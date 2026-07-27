import { createInitialState } from '../src/sim/state.ts';
import { dist } from '../src/sim/map.ts';
const s = createInitialState(1);
let worst = 0;
for (const nb of s.neighborhoods) {
  const ds = s.stations.map(st => ({ id: st.id, name: st.name, d: dist(nb.centroid, st.pos) })).sort((a,b)=>a.d-b.d);
  worst = Math.max(worst, ds[0].d);
  console.log(`${nb.name.padEnd(14)} nearest ${ds[0].name.padEnd(16)} ${ds[0].d.toFixed(0).padStart(4)}u ${(ds[0].d/8).toFixed(1).padStart(5)}s | 2nd ${ds[1].d.toFixed(0).padStart(4)}u | 3rd ${ds[2].d.toFixed(0).padStart(4)}u | 4th ${ds[3].d.toFixed(0).padStart(4)}u`);
}
console.log('worst nearest-station distance:', worst.toFixed(0), 'u =', (worst/8).toFixed(1), 's');
