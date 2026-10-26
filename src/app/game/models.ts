export type CardKind = 'number' | 'modifier' | 'action';
export type ActionType = 'freeze' | 'flipThree' | 'secondChance';
export type PlayerStatus = 'active' | 'stayed' | 'busted' | 'frozen';
export type Phase = 'playing' | 'roundOver' | 'gameOver';

export interface Card {
  id: number;
  kind: CardKind;
  /** Number cards: the face value. Plus modifiers: the bonus. */
  value: number;
  times2?: boolean;
  action?: ActionType;
}

export interface Player {
  id: number;
  name: string;
  total: number;
  hand: Card[];
  status: PlayerStatus;
  flip7: boolean;
  roundScore: number;
}

export type Task =
  | { t: 'dealOne'; pid: number }
  | { t: 'hit'; pid: number }
  | { t: 'flip3Draw' }
  | { t: 'flip3Finish' }
  | { t: 'resolveAction'; pid: number; card: Card }
  | { t: 'startTurns' }
  | { t: 'endTurn' };

export interface PendingChoice {
  kind: ActionType;
  actorId: number;
  card: Card;
  eligible: number[];
}

export interface Flip3Context {
  pid: number;
  deferred: Card[];
}

export interface RoundResult {
  playerId: number;
  name: string;
  status: PlayerStatus;
  flip7: boolean;
  score: number;
  total: number;
}

export interface GameState {
  phase: Phase;
  players: Player[];
  deck: Card[];
  discard: Card[];
  round: number;
  dealer: number;
  current: number;
  /** LIFO work queue; the engine drains it until it needs player input. */
  stack: Task[];
  pending: PendingChoice | null;
  flip3: Flip3Context | null;
  log: string[];
  targetScore: number;
  roundSummary: RoundResult[];
  winnerIds: number[];
}

export function cardName(c: Card): string {
  if (c.kind === 'number') return String(c.value);
  if (c.kind === 'modifier') return c.times2 ? 'x2' : `+${c.value}`;
  switch (c.action) {
    case 'freeze':
      return 'Freeze';
    case 'flipThree':
      return 'Flip Three';
    default:
      return 'Second Chance';
  }
}

export function cardFace(c: Card): string {
  if (c.kind === 'number') return String(c.value);
  if (c.kind === 'modifier') return c.times2 ? '×2' : `+${c.value}`;
  switch (c.action) {
    case 'freeze':
      return 'FREEZE';
    case 'flipThree':
      return 'FLIP 3';
    default:
      return '2ND CHANCE';
  }
}
