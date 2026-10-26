import { Injectable, effect, inject, signal } from '@angular/core';
import * as engine from './engine';
import { GameState } from './models';
import { NetworkService } from './network.service';
import { ClientMsg, HostMsg, RosterEntry } from './protocol';

const STORAGE_KEY = 'flip7.save.v1';
const CLIENT_KEY = 'flip7.clientId';
const HOST_CLIENT_ID = 'host';
const MAX_PLAYERS = 10;
const MAX_NAME = 16;

export type Mode = 'local' | 'host' | 'guest';

type Action =
  | { type: 'hit' }
  | { type: 'stay' }
  | { type: 'choose'; target: number }
  | { type: 'nextRound' }
  | { type: 'rematch' };

interface Seat {
  clientId: string;
  name: string;
  /** PeerJS id of the guest's current connection, null when offline. The host never has one. */
  connId: string | null;
}

function newId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

const fallbackClientId = newId();

/** Per-tab identity, so a refreshed or reconnected guest gets the same seat back. */
function clientId(): string {
  try {
    let id = sessionStorage.getItem(CLIENT_KEY);
    if (!id) {
      id = newId();
      sessionStorage.setItem(CLIENT_KEY, id);
    }
    return id;
  } catch {
    return fallbackClientId;
  }
}

function loadSaved(): GameState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GameState;
    const valid =
      Array.isArray(parsed.players) &&
      Array.isArray(parsed.deck) &&
      Array.isArray(parsed.stack) &&
      typeof parsed.phase === 'string';
    return valid ? parsed : null;
  } catch {
    return null;
  }
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong.';
}

/**
 * Holds the game in the browser. In local mode it applies actions directly. In online mode the host
 * is the only place the engine runs: guests send intents, the host validates, applies and broadcasts
 * the new state.
 */
@Injectable({ providedIn: 'root' })
export class GameService {
  private readonly network = inject(NetworkService);

  private readonly _state = signal<GameState | null>(loadSaved());
  readonly state = this._state.asReadonly();

  readonly mode = signal<Mode>('local');
  readonly seat = signal<number | null>(null);
  readonly roster = signal<RosterEntry[]>([]);
  readonly room = signal<string | null>(null);
  /** Guest only: the data channel to the host dropped. */
  readonly offline = signal(false);
  readonly notice = signal<string | null>(null);

  private seats: Seat[] = [];
  private guestName = '';

  constructor() {
    effect(() => {
      const s = this._state();
      if (this.mode() !== 'local') return;
      try {
        if (s) localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
        else localStorage.removeItem(STORAGE_KEY);
      } catch {
        // storage unavailable: the game still works, it just won't survive a refresh
      }
    });
  }

  /** Local players, and the host, can advance rounds and restart. Guests wait for the host. */
  canAdvance(): boolean {
    return this.mode() !== 'guest';
  }

  /** True when this device may act for the given player index. */
  controls(target: number): boolean {
    if (this.mode() === 'local') return true;
    const seat = this.seat();
    return seat !== null && this.allowed(seat, target);
  }

  // ------------------------------------------------------------ local play

  start(names: string[]): void {
    this._state.set(engine.createGame(names));
  }

  // ----------------------------------------------------------- UI actions

  hit(): void {
    this.dispatch({ type: 'hit' });
  }

  stay(): void {
    this.dispatch({ type: 'stay' });
  }

  choose(targetId: number): void {
    this.dispatch({ type: 'choose', target: targetId });
  }

  nextRound(): void {
    this.dispatch({ type: 'nextRound' });
  }

  restartWithSamePlayers(): void {
    this.dispatch({ type: 'rematch' });
  }

  /** Leaves the game or room and returns to the setup screen. */
  reset(): void {
    const wasHost = this.mode() === 'host';
    if (wasHost) {
      for (const seat of this.seats) {
        if (seat.connId) this.network.sendTo(seat.connId, { type: 'closed' });
      }
    }
    this.mode.set('local');
    this.seat.set(null);
    this.roster.set([]);
    this.room.set(null);
    this.offline.set(false);
    this.seats = [];
    this._state.set(null);
    // give the 'closed' message a moment to flush before tearing the peer down
    if (wasHost) setTimeout(() => this.network.close(), 300);
    else this.network.close();
  }

  // ---------------------------------------------------------------- host

  async hostRoom(name: string): Promise<void> {
    this.seats = [{ clientId: HOST_CLIENT_ID, name: this.cleanName(name, 'Host'), connId: null }];
    try {
      const code = await this.network.openHost(
        (connId, msg) => this.onClientMessage(connId, msg),
        (connId) => this.onClientClosed(connId),
      );
      this._state.set(null);
      this.mode.set('host');
      this.seat.set(0);
      this.room.set(code);
      this.notice.set(null);
      this.syncRoster();
    } catch (e) {
      this.seats = [];
      throw e;
    }
  }

  startOnline(): void {
    if (this.mode() !== 'host' || this.seats.length < 2 || this._state()) return;
    this._state.set(engine.createGame(this.seats.map((x) => x.name)));
    this.pushAll();
  }

  private onClientMessage(connId: string, raw: unknown): void {
    const msg = raw as ClientMsg | null;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'join') {
      this.onJoin(connId, msg);
      return;
    }
    const seat = this.seats.findIndex((x) => x.connId === connId);
    if (seat < 0) return;
    switch (msg.type) {
      case 'hit':
        this.perform(seat, { type: 'hit' });
        break;
      case 'stay':
        this.perform(seat, { type: 'stay' });
        break;
      case 'choose':
        if (Number.isInteger(msg.target)) this.perform(seat, { type: 'choose', target: msg.target });
        break;
    }
  }

  private onJoin(connId: string, msg: Extract<ClientMsg, { type: 'join' }>): void {
    const id = String(msg.clientId ?? '').slice(0, 64);
    if (!id || id === HOST_CLIENT_ID) {
      this.network.sendTo(connId, { type: 'rejected', reason: 'Invalid player id.' });
      return;
    }
    const existing = this.seats.findIndex((x) => x.clientId === id);
    if (existing >= 0) {
      this.seats[existing].connId = connId;
    } else if (this._state()) {
      this.network.sendTo(connId, { type: 'rejected', reason: 'That game has already started.' });
      return;
    } else if (this.seats.length >= MAX_PLAYERS) {
      this.network.sendTo(connId, { type: 'rejected', reason: 'The room is full (10 players).' });
      return;
    } else {
      const base = this.cleanName(String(msg.name ?? ''), `Player ${this.seats.length + 1}`);
      let unique = base;
      for (let n = 2; this.seats.some((x) => x.name === unique); n++) unique = `${base} (${n})`;
      this.seats.push({ clientId: id, name: unique, connId });
    }
    this.syncRoster();
    this.pushAll();
  }

  private onClientClosed(connId: string): void {
    const i = this.seats.findIndex((x) => x.connId === connId);
    if (i < 0) return;
    if (this._state()) this.seats[i].connId = null;
    else this.seats.splice(i, 1);
    this.syncRoster();
    this.pushAll();
  }

  private syncRoster(): void {
    this.roster.set(
      this.seats.map((x) => ({
        name: x.name,
        connected: x.clientId === HOST_CLIENT_ID || x.connId !== null,
      })),
    );
  }

  private pushAll(): void {
    const state = this._state();
    const roster = this.roster();
    this.seats.forEach((x, seat) => {
      if (!x.connId) return;
      const msg: HostMsg = state
        ? { type: 'state', state, roster, seat }
        : { type: 'lobby', roster, seat };
      this.network.sendTo(x.connId, msg);
    });
  }

  private cleanName(raw: string, fallback: string): string {
    return raw.trim().slice(0, MAX_NAME) || fallback;
  }

  // --------------------------------------------------------------- guest

  async joinRoom(code: string, name: string): Promise<void> {
    const clean = code.trim().toUpperCase();
    this.guestName = name.trim().slice(0, MAX_NAME);
    await this.connectAsGuest(clean);
    this._state.set(null);
    this.mode.set('guest');
    this.room.set(clean);
    this.notice.set(null);
  }

  async reconnect(): Promise<void> {
    const code = this.room();
    if (!code) return;
    try {
      await this.connectAsGuest(code);
      this.offline.set(false);
    } catch (e) {
      this.notice.set(errorMessage(e));
    }
  }

  private async connectAsGuest(code: string): Promise<void> {
    await this.network.joinRoom(
      code,
      (msg) => this.onHostMessage(msg),
      () => {
        if (this.mode() === 'guest') this.offline.set(true);
      },
    );
    this.network.sendToHost({ type: 'join', clientId: clientId(), name: this.guestName });
  }

  private onHostMessage(msg: HostMsg): void {
    switch (msg.type) {
      case 'lobby':
        this.seat.set(msg.seat);
        this.roster.set(msg.roster);
        break;
      case 'state':
        this.seat.set(msg.seat);
        this.roster.set(msg.roster);
        this._state.set(msg.state);
        break;
      case 'rejected':
        this.reset();
        this.notice.set(msg.reason);
        break;
      case 'closed':
        this.reset();
        this.notice.set('The host closed the room.');
        break;
    }
  }

  // ------------------------------------------------------------ dispatch

  private dispatch(a: Action): void {
    const mode = this.mode();
    if (mode === 'guest') {
      if (this.offline()) return;
      if (a.type === 'hit' || a.type === 'stay' || a.type === 'choose') this.network.sendToHost(a);
      return;
    }
    this.perform(mode === 'host' ? 0 : null, a);
  }

  /** The only place state changes. `actor` is a seat index, or null for local play. */
  private perform(actor: number | null, a: Action): void {
    const cur = this._state();
    if (!cur) return;

    if (a.type === 'nextRound' || a.type === 'rematch') {
      if (actor !== null && actor !== 0) return;
      if (a.type === 'rematch' && cur.phase !== 'gameOver') return;
    } else {
      const subject = a.type === 'choose' ? cur.pending?.actorId : cur.current;
      if (subject === undefined || !this.allowed(actor, subject)) return;
    }

    let next: GameState;
    if (a.type === 'rematch') {
      next = engine.createGame(cur.players.map((p) => p.name));
    } else {
      next = structuredClone(cur);
      switch (a.type) {
        case 'hit':
          engine.hit(next);
          break;
        case 'stay':
          engine.stay(next);
          break;
        case 'choose':
          engine.choose(next, a.target);
          break;
        case 'nextRound':
          engine.nextRound(next);
          break;
      }
    }
    this._state.set(next);
    if (this.mode() === 'host') this.pushAll();
  }

  /** A seat may act for itself; the host may also act for a seat whose player is offline. */
  private allowed(actor: number | null, target: number): boolean {
    if (actor === null || actor === target) return true;
    return this.mode() === 'host' && actor === 0 && this.roster()[target]?.connected === false;
  }
}
