export const LANE_WIDTH = 3.6;
export const LANE_COUNT = 4;
/** Half the width of the driveable lanes (without shoulders). */
export const ROAD_HALF = (LANE_WIDTH * LANE_COUNT) / 2;
export const SHOULDER = 1.4;
/** Full asphalt width including both shoulders. */
export const ROAD_TOTAL = (ROAD_HALF + SHOULDER) * 2;

/** The world scrolls toward +z; the player always sits at z = 0 and drives toward -z. */
export const SPAWN_Z = -300;
export const DESPAWN_AHEAD = -390;
export const DESPAWN_BEHIND = 32;

export const KMH = 3.6;
export const toMs = (kmh: number) => kmh / KMH;

export const PLAYER_CFG = {
  minSpeed: toMs(30),
  startSpeed: toMs(80),
  maxSpeed: toMs(220),
  nitroSpeed: toMs(290),
  accel: 8,
  brake: 22,
  coast: 1.6,
};

export type GameMode = 'oneway' | 'twoway';
export type TimeOfDay = 'day' | 'night';

export const laneCenter = (lane: number) => (lane - (LANE_COUNT - 1) / 2) * LANE_WIDTH;

export const PLAYER_COLORS = [0xd7263d, 0x1b8fe0, 0xf4c430, 0x22b8a6, 0xf2f2f2, 0x1d1d22, 0xff6a13, 0x8e44ad];

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const approach = (v: number, target: number, step: number) =>
  v < target ? Math.min(target, v + step) : Math.max(target, v - step);
/** Frame-rate independent exponential smoothing factor. */
export const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);
