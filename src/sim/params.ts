/**
 * Every tunable number in the game lives here and nowhere else.
 * The dev panel mutates this object in place at runtime, so always read
 * `PARAMS.X` at the point of use — never cache a value in a module const.
 */
export const PARAMS = {
  // time
  TICK_HZ: 10,
  MATCH_SECONDS: 300,
  DEMAND_RECALC_HZ: 2,

  // speed (world units / second)
  CAR_SPEED: 55,
  TRAIN_SPEED: 90,
  WALK_SPEED: 8,
  MAX_WALK_TIME: 40, // seconds (spec: 300 — see NOTES.md)

  // routing
  TRANSFER_PENALTY: 40, // seconds
  BETA: 0.012, // logit sensitivity (spec suggested 0.008 — see NOTES.md)
  SHARE_LERP: 0.1,

  // traffic
  CONGESTION_K: 1.4,
  CONGESTION_MIN: 1.0,
  CONGESTION_MAX: 3.0,

  // capacity
  TRAIN_CAPACITY: 220,
  CROWD_PENALTY_K: 1.8,
  STATION_DWELL: 6, // per station, in round trip and in-vehicle time (spec: 20)

  // demand
  TOTAL_TRIPS_PER_MIN: 9000,
  GRAVITY_EXPONENT: 1.5,
  RUSH_MULTIPLIER: 4.0,
  RUSH_INTERVAL: 55,
  RUSH_DURATION: 30,
  RUSH_TELEGRAPH: 6,
  /** How many of the most car-bound districts rush hour can pick from. */
  RUSH_CANDIDATES: 5,

  // economy
  STARTING_CASH: 15000, // enough for an opening plus one meaningful follow-up
  FARE: 0.08, // spec: 0.06
  TRACK_COST_PER_UNIT: 3.5,
  STATION_COST: 700,
  TRAIN_COST: 1200,
  TRAIN_UPKEEP: 2.6, // $/second — frequency is a running commitment, not a one-off
  TRACK_UPKEEP: 0.004, // spec: 0.02 — see NOTES.md
  LAND_VALUE_STEP: 0.15,
  /** Land value relaxes back toward 1.0 at this fraction per second. */
  LAND_VALUE_DECAY: 0.015,
  /** Building in your own home district costs this multiple. */
  HOME_DISCOUNT: 0.75,
  /** How hard opening cash compensates a weak home district. 0 turns it off. */
  HOME_COMPENSATION: 1.0,
  REFUND_RATE: 0.5,
  /** $/second granted per percentage point of city share behind the leader. */
  SUBSIDY_PER_POINT: 1.1,
  SUBSIDY_MAX: 22,

  // bot
  BOT_DECISION_INTERVAL: 4,
  BOT_OPENING_DELAY: 10,
  BOT_COST_DISCOUNT: 1.05,
};

export type Params = typeof PARAMS;

/**
 * Structural limits — not balance knobs, so they stay out of the dev panel.
 * MAX_LINES caps the line-expanded graph at 36*6 nodes per player and matches
 * the number of distinct line colours we have.
 */
export const LIMITS = {
  MAX_LINES: 6,
  MAX_LINE_STATIONS: 14,
  /** Trips may walk to at most this many of a player's nearest stations. */
  ACCESS_STATIONS: 3,
};

/** UI identity and line palettes for up to four competitors. */
export const PLAYER_COLORS = ['#FFC53D', '#3BC4A7', '#A78BFA', '#FF7A66'] as const;

export const LINE_COLORS: string[][] = [
  ['#FFC53D', '#FFA630', '#FFE066', '#F2872B', '#FFD98A', '#E0A21C'],
  ['#3BC4A7', '#2FA5D6', '#6FE3C6', '#2C8FA8', '#9BEBD8', '#1F8C77'],
  ['#A78BFA', '#8B5CF6', '#C4B5FD', '#7C3AED', '#D8B4FE', '#9333EA'],
  ['#FF7A66', '#FB7185', '#FDBA74', '#F97316', '#FDA4AF', '#EF4444'],
];

/** Groups used purely to lay out the dev panel. Keys must exist in PARAMS. */
export const PARAM_GROUPS: { label: string; keys: (keyof Params)[] }[] = [
  { label: 'Speed', keys: ['CAR_SPEED', 'TRAIN_SPEED', 'WALK_SPEED', 'MAX_WALK_TIME'] },
  { label: 'Routing', keys: ['TRANSFER_PENALTY', 'BETA', 'SHARE_LERP'] },
  { label: 'Traffic', keys: ['CONGESTION_K', 'CONGESTION_MIN', 'CONGESTION_MAX'] },
  { label: 'Capacity', keys: ['TRAIN_CAPACITY', 'CROWD_PENALTY_K', 'STATION_DWELL'] },
  {
    label: 'Demand',
    keys: [
      'TOTAL_TRIPS_PER_MIN',
      'GRAVITY_EXPONENT',
      'RUSH_MULTIPLIER',
      'RUSH_INTERVAL',
      'RUSH_DURATION',
      'RUSH_TELEGRAPH',
      'RUSH_CANDIDATES',
    ],
  },
  {
    label: 'Economy',
    keys: [
      'STARTING_CASH',
      'FARE',
      'TRACK_COST_PER_UNIT',
      'STATION_COST',
      'TRAIN_COST',
      'TRAIN_UPKEEP',
      'TRACK_UPKEEP',
      'LAND_VALUE_STEP',
      'LAND_VALUE_DECAY',
      'HOME_DISCOUNT',
      'HOME_COMPENSATION',
      'REFUND_RATE',
      'SUBSIDY_PER_POINT',
      'SUBSIDY_MAX',
    ],
  },
  { label: 'Bot', keys: ['BOT_DECISION_INTERVAL', 'BOT_OPENING_DELAY', 'BOT_COST_DISCOUNT'] },
  { label: 'Match', keys: ['MATCH_SECONDS'] },
];
