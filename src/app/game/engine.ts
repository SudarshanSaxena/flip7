import { ActionType, Card, GameState, Player, Task, cardName } from './models';

export const FLIP7_BONUS = 15;
const MAX_LOG = 300;

// ---------------------------------------------------------------- helpers

export function buildDeck(): Card[] {
  const cards: Card[] = [];
  let id = 0;
  for (let value = 0; value <= 12; value++) {
    const copies = value === 0 ? 1 : value;
    for (let i = 0; i < copies; i++) cards.push({ id: id++, kind: 'number', value });
  }
  for (const value of [2, 4, 6, 8, 10]) cards.push({ id: id++, kind: 'modifier', value });
  cards.push({ id: id++, kind: 'modifier', value: 0, times2: true });
  const actions: ActionType[] = ['freeze', 'flipThree', 'secondChance'];
  for (const action of actions) {
    for (let i = 0; i < 3; i++) cards.push({ id: id++, kind: 'action', value: 0, action });
  }
  return cards;
}

export function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** x2 doubles only the number cards; plus modifiers are added afterwards. */
export function scoreHand(hand: Card[]): number {
  const numbers = hand.filter((c) => c.kind === 'number').reduce((sum, c) => sum + c.value, 0);
  const doubled = hand.some((c) => c.kind === 'modifier' && c.times2) ? numbers * 2 : numbers;
  const bonus = hand
    .filter((c) => c.kind === 'modifier' && !c.times2)
    .reduce((sum, c) => sum + c.value, 0);
  return doubled + bonus;
}

export function uniqueCount(hand: Card[]): number {
  return new Set(hand.filter((c) => c.kind === 'number').map((c) => c.value)).size;
}

export function hasSecondChance(p: Player): boolean {
  return p.hand.some((c) => c.kind === 'action' && c.action === 'secondChance');
}

function log(s: GameState, message: string): void {
  s.log.push(message);
  if (s.log.length > MAX_LOG) s.log.splice(0, s.log.length - MAX_LOG);
}

// ------------------------------------------------------------ game set-up

export function createGame(names: string[], targetScore = 200): GameState {
  const s: GameState = {
    phase: 'playing',
    players: names.map(
      (name, id): Player => ({
        id,
        name,
        total: 0,
        hand: [],
        status: 'active',
        flip7: false,
        roundScore: 0,
      }),
    ),
    deck: shuffle(buildDeck()),
    discard: [],
    round: 0,
    dealer: names.length - 1,
    current: 0,
    stack: [],
    pending: null,
    flip3: null,
    log: [],
    targetScore,
    roundSummary: [],
    winnerIds: [],
  };
  startRound(s);
  return s;
}

function startRound(s: GameState): void {
  const n = s.players.length;
  for (const p of s.players) {
    s.discard.push(...p.hand);
    p.hand = [];
    p.status = 'active';
    p.flip7 = false;
    p.roundScore = 0;
  }
  s.round += 1;
  s.dealer = (s.dealer + 1) % n;
  s.phase = 'playing';
  s.pending = null;
  s.flip3 = null;
  s.roundSummary = [];
  s.stack = [];
  log(s, `Round ${s.round}: ${s.players[s.dealer].name} deals.`);

  const first = (s.dealer + 1) % n;
  s.current = first;
  // LIFO: startTurns runs last, then one initial card per player, starting with `first`.
  s.stack.push({ t: 'startTurns' });
  for (let i = n - 1; i >= 0; i--) s.stack.push({ t: 'dealOne', pid: (first + i) % n });
  run(s);
}

// ---------------------------------------------------------- player actions

function canAct(s: GameState): boolean {
  return (
    s.phase === 'playing' &&
    s.pending === null &&
    s.stack.length === 0 &&
    s.players[s.current].status === 'active'
  );
}

export function hit(s: GameState): void {
  if (!canAct(s)) return;
  s.stack.push({ t: 'endTurn' });
  s.stack.push({ t: 'hit', pid: s.current });
  run(s);
}

export function stay(s: GameState): void {
  if (!canAct(s)) return;
  const p = s.players[s.current];
  p.status = 'stayed';
  log(s, `${p.name} stays and banks ${scoreHand(p.hand)}.`);
  advance(s);
}

/** Resolves a pending target choice (Freeze, Flip Three or a spare Second Chance). */
export function choose(s: GameState, targetId: number): void {
  const pend = s.pending;
  if (!pend || !pend.eligible.includes(targetId)) return;
  s.pending = null;
  if (pend.kind === 'secondChance') {
    const target = s.players[targetId];
    target.hand.push(pend.card);
    log(s, `${s.players[pend.actorId].name} gives the spare Second Chance to ${target.name}.`);
  } else {
    applyAction(s, pend.kind, pend.actorId, targetId, pend.card);
  }
  run(s);
}

export function nextRound(s: GameState): void {
  if (s.phase !== 'roundOver') return;
  startRound(s);
}

// ----------------------------------------------------------- engine core

function run(s: GameState): void {
  while (s.phase === 'playing' && s.pending === null && s.stack.length > 0) {
    exec(s, s.stack.pop() as Task);
  }
}

function exec(s: GameState, task: Task): void {
  switch (task.t) {
    case 'dealOne':
    case 'hit': {
      const p = s.players[task.pid];
      if (p.status !== 'active') return;
      const card = draw(s);
      if (card) deliver(s, p, card);
      return;
    }
    case 'flip3Draw': {
      const f = s.flip3;
      if (!f) return;
      const p = s.players[f.pid];
      if (p.status !== 'active') return;
      const card = draw(s);
      if (card) deliver(s, p, card);
      return;
    }
    case 'flip3Finish': {
      const f = s.flip3;
      if (!f) return;
      s.flip3 = null;
      for (let i = f.deferred.length - 1; i >= 0; i--) {
        s.stack.push({ t: 'resolveAction', pid: f.pid, card: f.deferred[i] });
      }
      return;
    }
    case 'resolveAction': {
      const action = task.card.action as ActionType;
      const eligible = s.players.filter((p) => p.status === 'active').map((p) => p.id);
      if (eligible.length === 0) {
        s.discard.push(task.card);
      } else if (eligible.length === 1) {
        applyAction(s, action, task.pid, eligible[0], task.card);
      } else {
        s.pending = { kind: action, actorId: task.pid, card: task.card, eligible };
      }
      return;
    }
    case 'startTurns': {
      s.current = (s.dealer + 1) % s.players.length;
      if (s.players[s.current].status !== 'active') advance(s);
      return;
    }
    case 'endTurn':
      advance(s);
      return;
  }
}

function draw(s: GameState): Card | null {
  if (s.deck.length === 0) {
    if (s.discard.length === 0) {
      log(s, 'No cards left to draw. The round ends.');
      endRound(s);
      return null;
    }
    s.deck = shuffle(s.discard);
    s.discard = [];
    log(s, 'The deck ran out and the discard pile was reshuffled.');
  }
  return s.deck.pop() as Card;
}

function deliver(s: GameState, p: Player, card: Card): void {
  if (card.kind === 'action') {
    if (card.action === 'secondChance') {
      giveSecondChance(s, p, card);
    } else if (s.flip3 && s.flip3.pid === p.id) {
      s.flip3.deferred.push(card);
      log(s, `${p.name} drew ${cardName(card)}. It is set aside until Flip Three ends.`);
    } else {
      log(s, `${p.name} drew ${cardName(card)}.`);
      s.stack.push({ t: 'resolveAction', pid: p.id, card });
    }
    return;
  }

  if (card.kind === 'modifier') {
    p.hand.push(card);
    log(s, `${p.name} drew ${cardName(card)}.`);
    return;
  }

  if (p.hand.some((c) => c.kind === 'number' && c.value === card.value)) {
    const idx = p.hand.findIndex((c) => c.kind === 'action' && c.action === 'secondChance');
    if (idx >= 0) {
      const [spent] = p.hand.splice(idx, 1);
      s.discard.push(spent, card);
      log(s, `${p.name} drew a duplicate ${card.value}, but Second Chance saves them.`);
    } else {
      p.hand.push(card);
      p.status = 'busted';
      log(s, `${p.name} drew a duplicate ${card.value} and BUSTS.`);
      if (s.flip3 && s.flip3.pid === p.id) {
        s.discard.push(...s.flip3.deferred);
        s.flip3 = null;
      }
    }
    return;
  }

  p.hand.push(card);
  log(s, `${p.name} drew ${card.value}.`);
  if (uniqueCount(p.hand) >= 7) {
    p.flip7 = true;
    log(s, `${p.name} FLIPPED 7 unique numbers!`);
    endRound(s);
  }
}

function giveSecondChance(s: GameState, p: Player, card: Card): void {
  if (!hasSecondChance(p)) {
    p.hand.push(card);
    log(s, `${p.name} drew Second Chance and keeps it.`);
    return;
  }
  const eligible = s.players
    .filter((q) => q.id !== p.id && q.status === 'active' && !hasSecondChance(q))
    .map((q) => q.id);
  if (eligible.length === 0) {
    s.discard.push(card);
    log(s, `${p.name} drew a spare Second Chance. Nobody can take it, so it is discarded.`);
  } else if (eligible.length === 1) {
    s.players[eligible[0]].hand.push(card);
    log(s, `${p.name} gives a spare Second Chance to ${s.players[eligible[0]].name}.`);
  } else {
    log(s, `${p.name} drew a spare Second Chance and must give it away.`);
    s.pending = { kind: 'secondChance', actorId: p.id, card, eligible };
  }
}

function applyAction(
  s: GameState,
  action: ActionType,
  actorId: number,
  targetId: number,
  card: Card,
): void {
  const actor = s.players[actorId];
  const target = s.players[targetId];
  s.discard.push(card);
  if (action === 'freeze') {
    target.status = 'frozen';
    log(s, `${actor.name} freezes ${target.name}, who banks ${scoreHand(target.hand)}.`);
  } else if (action === 'flipThree') {
    log(s, `${actor.name} makes ${target.name} flip three cards.`);
    s.flip3 = { pid: targetId, deferred: [] };
    s.stack.push({ t: 'flip3Finish' });
    for (let i = 0; i < 3; i++) s.stack.push({ t: 'flip3Draw' });
  }
}

function advance(s: GameState): void {
  const n = s.players.length;
  for (let i = 1; i <= n; i++) {
    const idx = (s.current + i) % n;
    if (s.players[idx].status === 'active') {
      s.current = idx;
      return;
    }
  }
  endRound(s);
}

function endRound(s: GameState): void {
  if (s.phase !== 'playing') return;
  if (s.pending) s.discard.push(s.pending.card);
  if (s.flip3) s.discard.push(...s.flip3.deferred);
  for (const task of s.stack) {
    if (task.t === 'resolveAction') s.discard.push(task.card);
  }
  s.stack = [];
  s.pending = null;
  s.flip3 = null;

  s.roundSummary = s.players.map((p) => {
    const score = p.status === 'busted' ? 0 : scoreHand(p.hand) + (p.flip7 ? FLIP7_BONUS : 0);
    p.roundScore = score;
    p.total += score;
    return {
      playerId: p.id,
      name: p.name,
      status: p.status,
      flip7: p.flip7,
      score,
      total: p.total,
    };
  });

  const max = Math.max(...s.players.map((p) => p.total));
  const leaders = s.players.filter((p) => p.total === max);
  if (max >= s.targetScore && leaders.length === 1) {
    s.phase = 'gameOver';
    s.winnerIds = [leaders[0].id];
    log(s, `${leaders[0].name} wins the game with ${max}.`);
  } else {
    s.phase = 'roundOver';
    if (max >= s.targetScore) log(s, `Tied at ${max}. Another round decides it.`);
    else log(s, `Round ${s.round} is over.`);
  }
}
