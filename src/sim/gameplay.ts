import { pushGameEvent } from './events.ts';
import { PARAMS } from './params.ts';
import { updateLineDerived } from './network.ts';
import { districtFrontline } from './rivalry.ts';
import type { CivicContract, GameState, Id, PlayerId } from './types.ts';

function pairShare(state: GameState, player: PlayerId, a: Id, b: Id): number {
  const ab = state.odShare[a][b]?.[player + 1] ?? 0;
  const ba = state.odShare[b][a]?.[player + 1] ?? 0;
  return (ab + ba) / 2;
}

/** Stable deterministic corridor ranking shared by contracts and the finale. */
export function rankStrategicCorridors(state: GameState): Array<{ i: Id; j: Id; score: number }> {
  const out: Array<{ i: Id; j: Id; score: number }> = [];
  for (let i = 0; i < state.neighborhoods.length; i++) {
    for (let j = i + 1; j < state.neighborhoods.length; j++) {
      const demand = state.odMatrix[i][j] + state.odMatrix[j][i];
      if (demand <= 0) continue;
      const shares = state.players.map((player) => pairShare(state, player.id, i, j));
      const ranked = [...shares].sort((a, b) => b - a);
      const monopoly = ranked[0] ?? 0;
      const second = ranked[1] ?? 0;
      const car = (state.odShare[i][j][0] + state.odShare[j][i][0]) / 2;
      const reachable = state.players.filter(
        (player) =>
          isFinite(state.routes[player.id]?.time[i]?.[j] ?? Infinity) ||
          isFinite(state.routes[player.id]?.time[j]?.[i] ?? Infinity),
      ).length;
      const contestability = 0.25 + 0.75 * (reachable / state.players.length);
      const balance = 1 - Math.min(0.85, Math.max(0, monopoly - second));
      out.push({ i, j, score: demand * car * contestability * balance });
    }
  }
  return out.sort((a, b) => b.score - a.score || a.i - b.i || a.j - b.j);
}

function makeContract(state: GameState): CivicContract | null {
  const target = rankStrategicCorridors(state)[0];
  if (!target) return null;
  const hz = PARAMS.TICK_HZ;
  const startsAtTick = state.tick + Math.round(PARAMS.CIVIC_CONTRACT_TELEGRAPH * hz);
  return {
    id: state.nextContractId++,
    phase: 'announced',
    originId: target.i,
    destinationId: target.j,
    announcedAtTick: state.tick,
    startsAtTick,
    endsAtTick: startsAtTick + Math.round(PARAMS.CIVIC_CONTRACT_DURATION * hz),
    baselineShares: new Array<number>(state.players.length).fill(0),
    currentGains: new Array<number>(state.players.length).fill(0),
    targetGain: PARAMS.CIVIC_CONTRACT_TARGET_GAIN,
    reward: PARAMS.CIVIC_CONTRACT_REWARD,
    demandMultiplier: PARAMS.CIVIC_CONTRACT_DEMAND_MULTIPLIER,
    winner: null,
    resolvedAtTick: null,
  };
}

function resolveContract(state: GameState, winner: PlayerId | null): void {
  const contract = state.civicContract;
  if (!contract || contract.phase === 'resolved') return;
  contract.phase = 'resolved';
  contract.winner = winner;
  contract.resolvedAtTick = state.tick;
  if (winner !== null) state.players[winner].cash += contract.reward;
  pushGameEvent(state, {
    kind: 'contractResolved',
    player: winner ?? -1,
    contractId: contract.id,
    reward: winner === null ? 0 : contract.reward,
  });
}

function updateContract(state: GameState): void {
  const contract = state.civicContract;
  if (!contract) {
    if (state.finalMandate || state.tick < state.nextContractTick) return;
    state.civicContract = makeContract(state);
    return;
  }
  if (contract.phase === 'announced' && state.tick >= contract.startsAtTick) {
    contract.phase = 'active';
    for (const player of state.players) {
      contract.baselineShares[player.id] = pairShare(
        state,
        player.id,
        contract.originId,
        contract.destinationId,
      );
    }
    pushGameEvent(state, {
      kind: 'contractStarted',
      player: -1,
      contractId: contract.id,
      originId: contract.originId,
      destinationId: contract.destinationId,
    });
  }
  if (contract.phase === 'active') {
    for (const player of state.players) {
      contract.currentGains[player.id] =
        pairShare(state, player.id, contract.originId, contract.destinationId) -
        contract.baselineShares[player.id];
    }
    const immediate = state.players
      .map((player) => ({ player: player.id, gain: contract.currentGains[player.id] }))
      .filter((entry) => entry.gain >= contract.targetGain)
      .sort((a, b) => b.gain - a.gain || a.player - b.player)[0];
    if (immediate) resolveContract(state, immediate.player);
    else if (state.tick >= contract.endsAtTick) {
      const best = state.players
        .map((player) => ({ player: player.id, gain: contract.currentGains[player.id] }))
        .sort((a, b) => b.gain - a.gain || a.player - b.player)[0];
      resolveContract(state, best && best.gain >= PARAMS.CIVIC_CONTRACT_MIN_WIN_GAIN ? best.player : null);
    }
  }
  if (
    contract.phase === 'resolved' &&
    contract.resolvedAtTick !== null &&
    state.tick >=
      contract.resolvedAtTick + Math.round(PARAMS.CIVIC_CONTRACT_RESOLVED_DISPLAY * PARAMS.TICK_HZ)
  ) {
    state.civicContract = null;
    state.nextContractTick =
      state.tick + Math.round(PARAMS.CIVIC_CONTRACT_COOLDOWN * PARAMS.TICK_HZ);
  }
}

function updateFinalMandate(state: GameState): void {
  if (state.finalMandate) {
    if (!state.finalMandate.active && state.tick >= state.finalMandate.startsAtTick) {
      state.finalMandate.active = true;
      pushGameEvent(state, {
        kind: 'finalMandate',
        player: -1,
        originId: state.finalMandate.originId,
        destinationId: state.finalMandate.destinationId,
        active: true,
      });
    }
    return;
  }
  const announceAt =
    state.matchLengthTicks -
    Math.round(
      (PARAMS.FINAL_MANDATE_START_SECONDS + PARAMS.FINAL_MANDATE_TELEGRAPH_SECONDS) *
        PARAMS.TICK_HZ,
    );
  if (state.tick < announceAt) return;
  const target = rankStrategicCorridors(state)[0];
  if (!target) return;
  state.finalMandate = {
    originId: target.i,
    destinationId: target.j,
    announcedAtTick: state.tick,
    startsAtTick: state.tick + Math.round(PARAMS.FINAL_MANDATE_TELEGRAPH_SECONDS * PARAMS.TICK_HZ),
    active: false,
  };
  if (state.civicContract?.phase !== 'resolved') resolveContract(state, null);
  pushGameEvent(state, {
    kind: 'finalMandate',
    player: -1,
    originId: target.i,
    destinationId: target.j,
    active: false,
  });
}

function updateDispatch(state: GameState): void {
  for (const player of state.players) {
    for (const line of player.lines) {
      if (line.dispatchEndsAtTick > 0 && state.tick >= line.dispatchEndsAtTick) {
        line.dispatchEndsAtTick = 0;
        updateLineDerived(state.stations, line);
        state.netDirty[player.id] = true;
        pushGameEvent(state, {
          kind: 'dispatchExpired',
          player: player.id,
          lineId: line.id,
        });
      }
    }
  }
}

function updateDistricts(state: GameState): void {
  for (const neighborhood of state.neighborhoods) {
    const front = districtFrontline(state, neighborhood.id);
    const next = front.leader ?? -1;
    const previous = state.districtLeaders[neighborhood.id] ?? -1;
    if (next === previous) continue;
    state.districtLeaders[neighborhood.id] = next;
    pushGameEvent(state, {
      kind: 'districtChanged',
      player: next,
      districtId: neighborhood.id,
      previous,
    });
  }
}

export function updateGameplay(state: GameState): void {
  updateDispatch(state);
  updateFinalMandate(state);
  updateContract(state);
  updateDistricts(state);
}

export function strategicDemandMultiplier(state: GameState, i: Id, j: Id): number {
  let multiplier = 1;
  const contract = state.civicContract;
  if (
    contract?.phase === 'active' &&
    ((contract.originId === i && contract.destinationId === j) ||
      (contract.originId === j && contract.destinationId === i))
  ) {
    multiplier *= contract.demandMultiplier;
  }
  const mandate = state.finalMandate;
  if (
    mandate?.active &&
    ((mandate.originId === i && mandate.destinationId === j) ||
      (mandate.originId === j && mandate.destinationId === i))
  ) {
    multiplier *= PARAMS.FINAL_MANDATE_DEMAND_MULTIPLIER;
  }
  return multiplier;
}

/** Useful to tests and HUD without duplicating demand math. */
export function corridorDemand(state: GameState, i: Id, j: Id): number {
  return state.odMatrix[i][j] + state.odMatrix[j][i];
}
