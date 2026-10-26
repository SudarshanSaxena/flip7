import { GameState } from './models';

export const ROOM_PREFIX = 'flip7-room-';

export interface RosterEntry {
  name: string;
  connected: boolean;
}

/** Guest to host. The host validates every one of these before applying it. */
export type ClientMsg =
  | { type: 'join'; clientId: string; name: string }
  | { type: 'hit' }
  | { type: 'stay' }
  | { type: 'choose'; target: number };

/** Host to guest. `seat` is the recipient's player index. */
export type HostMsg =
  | { type: 'lobby'; roster: RosterEntry[]; seat: number }
  | { type: 'state'; state: GameState; roster: RosterEntry[]; seat: number }
  | { type: 'rejected'; reason: string }
  | { type: 'closed' };
