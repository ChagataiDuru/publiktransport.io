import type { RngState } from './rng.ts';

export type Id = number;
export type PlayerId = number;
export type ModalShare = number[];

export interface Vec2 {
  x: number;
  y: number;
}

export interface Station {
  id: Id;
  name: string;
  pos: Vec2; // 1600x1000 world coordinates
  neighborhood: Id;
  platforms: number; // 2 normal, 3-4 hub — shared between all competitors
  isHub: boolean;
}

/** Buildable corridor. Track may only be laid along an edge that exists here. */
export interface MapEdge {
  a: Id;
  b: Id;
  /** Express chords skip intermediate stations; drawn thinner as a hint. */
  express: boolean;
}

export interface Neighborhood {
  id: Id;
  name: string;
  centroid: Vec2;
  polygon: Vec2[];
  population: number;
  /** [car, ...players], sums to 1 */
  share: ModalShare;
}

export interface Line {
  id: Id;
  owner: PlayerId;
  stations: Id[]; // ordered, min 2
  trains: number;
  color: string;
  roundTripTime: number; // seconds, derived
  headway: number; // seconds = roundTripTime / trains
  loadFactor: number; // busiest segment / capacity
  ridership: number; // passengers per minute
  /** Passenger flow per minute on segment i (stations[i] -> stations[i+1]). */
  segmentFlow: number[];
  trackLength: number;
  /** Everything spent on this line so far — the basis for the 50% refund. */
  investment: number;
  servicePlan: 'local' | 'express';
  dispatchEndsAtTick: number;
}

export interface Player {
  id: PlayerId;
  cash: number;
  lines: Line[];
  score: number; // converted population
  incomeRate: number; // $/second
  upkeepRate: number;
  /** Population share of the whole city currently riding this player. */
  cityShare: number;
  /** Seat's opening district: cheaper to build in, and where its stub line is. */
  homeDistrict: Id;
  /** Public money paid to whoever is behind the leader, $/second. */
  subsidyRate: number;
  dispatchReadyAtTick: number;
}

export type GameEvent =
  | { id: number; tick: number; kind: 'serviceOpened'; player: PlayerId; lineId: Id; stationIds: Id[] }
  | { id: number; tick: number; kind: 'lineExtended'; player: PlayerId; lineId: Id; stationId: Id; end: 'head' | 'tail' }
  | { id: number; tick: number; kind: 'lineDeleted'; player: PlayerId; lineId: Id }
  | { id: number; tick: number; kind: 'capacityAdded'; player: PlayerId; lineId: Id; trainDelta: number }
  | { id: number; tick: number; kind: 'rushStarted'; player: -1; originId: Id; destinationId: Id }
  | { id: number; tick: number; kind: 'contractStarted'; player: -1; contractId: number; originId: Id; destinationId: Id }
  | { id: number; tick: number; kind: 'contractResolved'; player: PlayerId | -1; contractId: number; reward: number }
  | { id: number; tick: number; kind: 'dispatchStarted' | 'dispatchExpired'; player: PlayerId; lineId: Id }
  | { id: number; tick: number; kind: 'districtChanged'; player: PlayerId | -1; districtId: Id; previous: PlayerId | -1 }
  | { id: number; tick: number; kind: 'finalMandate'; player: -1; originId: Id; destinationId: Id; active: boolean }
  | { id: number; tick: number; kind: 'servicePlanChanged'; player: PlayerId; lineId: Id; servicePlan: 'local' | 'express' }
  | { id: number; tick: number; kind: 'text'; player: PlayerId | -1; text: string };

export interface CivicContract {
  id: number;
  phase: 'announced' | 'active' | 'resolved';
  originId: Id;
  destinationId: Id;
  announcedAtTick: number;
  startsAtTick: number;
  endsAtTick: number;
  baselineShares: number[];
  currentGains: number[];
  targetGain: number;
  reward: number;
  demandMultiplier: number;
  winner: PlayerId | null;
  resolvedAtTick: number | null;
}

export interface FinalMandate {
  originId: Id;
  destinationId: Id;
  announcedAtTick: number;
  startsAtTick: number;
  active: boolean;
}

export interface RushHour {
  active: boolean;
  neighborhood: Id;
  /** Rush spills into one adjacent district; -1 when the district is isolated. */
  secondary: Id;
  /** Marker appears here, surge begins at startsAtTick. */
  telegraphedAtTick: number;
  startsAtTick: number;
  endsAtTick: number;
}

/** One hop of a chosen route: ride `line` from stations[seg] to stations[seg+1]. */
export interface PathHop {
  line: Id;
  seg: number;
  forward: boolean;
}

export interface RouteTable {
  /** Door-to-door seconds from neighborhood i to j, Infinity if unreachable. */
  time: number[][];
  /** Hops taken for that trip, used to push flow onto line segments. */
  path: PathHop[][][];
  /** Number of transfers, for HUD/debug only. */
  transfers: number[][];
}

export interface GameState {
  tick: number; // 10 Hz
  seed: number;
  rng: RngState;
  matchLengthTicks: number;
  phase: 'playing' | 'ended';

  players: Player[];

  // static map data (never mutated after createInitialState)
  stations: Station[];
  neighborhoods: Neighborhood[];
  edges: MapEdge[];

  landValue: number[]; // per neighborhood multiplier, starts at 1.0
  odMatrix: number[][]; // base trips per minute, neighborhood -> neighborhood
  /** Live per-OD-pair modal split, [car, ...players]. */
  odShare: ModalShare[][];
  rushHour: RushHour | null;
  lastRushTick: number;
  /** Platforms consumed per station, shared across all players. */
  platformUsage: number[];

  /** Derived route caches, rebuilt only when a player's network changes. */
  routes: RouteTable[];
  netDirty: boolean[];

  nextLineId: number;
  totalPopulation: number;
  /** City-wide [car, ...players] population split — the top bar. */
  cityShare: ModalShare;

  botLastDecisionTick: number[];
  events: GameEvent[];
  nextEventId: number;
  civicContract: CivicContract | null;
  nextContractTick: number;
  nextContractId: number;
  finalMandate: FinalMandate | null;
  districtLeaders: Array<PlayerId | -1>;
}

export type Command =
  | { type: 'CreateLine'; player: PlayerId; stations: Id[] }
  | { type: 'ExtendLine'; player: PlayerId; line: Id; station: Id; end: 'head' | 'tail' }
  | { type: 'DeleteLine'; player: PlayerId; line: Id }
  | { type: 'BuyTrain'; player: PlayerId; line: Id }
  | { type: 'SellTrain'; player: PlayerId; line: Id }
  | { type: 'DispatchRapidService'; player: PlayerId; line: Id }
  | { type: 'SetServicePlan'; player: PlayerId; line: Id; servicePlan: 'local' | 'express' };
