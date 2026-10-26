import { Component, inject, signal } from '@angular/core';
import { CardComponent } from './card.component';
import { scoreHand, uniqueCount } from './game/engine';
import { GameService } from './game/game.service';
import { ActionType, GameState, Player, RoundResult } from './game/models';

@Component({
  selector: 'app-game',
  imports: [CardComponent],
  template: `
    @if (game.state(); as s) {
      <header class="top">
        <h1>FLIP <span>7</span></h1>
        <div class="meta">
          Round {{ s.round }} · Dealer: {{ s.players[s.dealer].name }} · First to {{ s.targetScore }}
        </div>
        <div class="meta">Deck {{ s.deck.length }} · Discard {{ s.discard.length }}</div>
        @if (game.room(); as room) {
          <div class="meta">
            Room <strong>{{ room }}</strong>
          </div>
        }
        <button class="ghost" (click)="newGame()">
          {{ game.mode() === 'local' ? 'New game' : 'Leave' }}
        </button>
      </header>

      @if (game.offline()) {
        <div class="banner">
          Disconnected from the host.
          <button (click)="game.reconnect()">Reconnect</button>
        </div>
      }
      @if (game.notice(); as n) {
        <div class="banner">{{ n }}</div>
      }

      @if (s.phase === 'playing') {
        <section class="turn">
          @if (s.pending; as pend) {
            <div class="pending">
              <app-card [card]="pend.card" />
              <div>
                <p>
                  <strong>{{ s.players[pend.actorId].name }}</strong> {{ pendingText(pend.kind) }}
                </p>
                @if (game.controls(pend.actorId)) {
                  <div class="targets">
                    @for (id of pend.eligible; track id) {
                      <button (click)="game.choose(id)">
                        {{ s.players[id].name }}@if (id === pend.actorId) {
                          (self)
                        }
                      </button>
                    }
                  </div>
                } @else {
                  <small class="wait">Waiting for {{ s.players[pend.actorId].name }} to choose...</small>
                }
              </div>
            </div>
          } @else {
            <div class="whose">
              @if (game.controls(s.current)) {
                <strong>{{ s.players[s.current].name }}</strong>, your turn
              } @else {
                <strong>{{ s.players[s.current].name }}</strong> is playing
              }
              <small>({{ unique(s.players[s.current]) }} of 7 unique numbers)</small>
            </div>
            @if (game.controls(s.current)) {
              <div class="buttons">
                <button class="hit" (click)="game.hit()">Hit</button>
                <button class="stay" (click)="game.stay()">
                  Stay and bank {{ score(s.players[s.current]) }}
                </button>
              </div>
            }
          }
        </section>
      }

      <section class="players">
        @for (p of s.players; track p.id) {
          <article
            class="player"
            [class.current]="s.phase === 'playing' && s.current === p.id"
            [class.out]="p.status !== 'active'"
          >
            <div class="head">
              <span class="name">
                {{ p.name }}
                @if (s.dealer === p.id) {
                  <small class="tag">dealer</small>
                }
                @if (game.mode() !== 'local' && game.seat() === p.id) {
                  <small class="tag you">you</small>
                }
                @if (isOffline(p.id)) {
                  <small class="tag off">offline</small>
                }
              </span>
              <span class="total">{{ p.total }}</span>
            </div>
            <div class="status">
              <span [class]="'badge ' + p.status">{{ p.status }}</span>
              <span class="round">
                Round: {{ score(p) }}
                @if (p.flip7) {
                  (+15 Flip 7)
                }
                · {{ unique(p) }}/7
              </span>
            </div>
            <div class="hand">
              @for (c of p.hand; track c.id; let last = $last) {
                <app-card [card]="c" [dupe]="p.status === 'busted' && last" />
              } @empty {
                <span class="empty">no cards</span>
              }
            </div>
          </article>
        }
      </section>

      <section class="bottom">
        <aside class="log">
          <h3>Log</h3>
          <ul>
            @for (line of recentLog(s); track $index) {
              <li>{{ line }}</li>
            }
          </ul>
        </aside>
        <details class="rules">
          <summary>Rules</summary>
          <ul>
            <li>On your turn, Hit (draw a card) or Stay (bank your points and sit out).</li>
            <li>Drawing a number you already hold busts you for 0, unless you hold Second Chance.</li>
            <li>Seven different numbers is a Flip 7: the round ends and you score +15.</li>
            <li>Score = number cards (doubled by x2) + plus modifiers (+15 for Flip 7).</li>
            <li>Freeze: target player banks and is out. Flip Three: target draws three cards.</li>
            <li>Second Chance: cancels one duplicate. Only one per player; spares go to someone else.</li>
            <li>The game ends at {{ s.targetScore }} or more. Ties at the top play another round.</li>
          </ul>
        </details>
      </section>

      @if (s.phase !== 'playing') {
        @if (peek()) {
          <div class="peekbar">
            <button (click)="peek.set(false)">Show results</button>
            @if (s.phase === 'roundOver' && game.canAdvance()) {
              <button class="primary" (click)="next()">Next round</button>
            }
          </div>
        } @else {
          <div class="overlay">
            <div class="modal">
              <h2>
                @if (s.phase === 'gameOver') {
                  Game over
                } @else {
                  Round {{ s.round }} complete
                }
              </h2>
              @if (s.phase === 'gameOver') {
                <p class="winner">{{ winnerNames(s) }} wins!</p>
              }
              <table>
                <thead>
                  <tr>
                    <th>Player</th>
                    <th>Outcome</th>
                    <th>Round</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  @for (r of standings(s); track r.playerId) {
                    <tr>
                      <td>{{ r.name }}</td>
                      <td>{{ outcome(r) }}</td>
                      <td>+{{ r.score }}</td>
                      <td>
                        <strong>{{ r.total }}</strong>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
              <div class="buttons">
                <button (click)="peek.set(true)">View board</button>
                @if (game.canAdvance()) {
                  @if (s.phase === 'roundOver') {
                    <button class="primary" (click)="next()">Next round</button>
                  } @else {
                    <button class="primary" (click)="playAgain()">Play again</button>
                  }
                } @else {
                  <small class="wait">Waiting for the host...</small>
                }
                @if (s.phase === 'gameOver') {
                  <button (click)="game.reset()">
                    {{ game.mode() === 'local' ? 'New players' : 'Leave room' }}
                  </button>
                }
              </div>
            </div>
          </div>
        }
      }
    }
  `,
  styles: [
    `
      :host {
        display: block;
        padding: 1rem 1rem 3rem;
        max-width: 1300px;
        margin: 0 auto;
      }
      .top {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.5rem 1.5rem;
      }
      .top h1 {
        margin: 0;
        font-size: 1.6rem;
      }
      .meta {
        color: var(--muted);
        font-size: 0.9rem;
      }
      .ghost {
        margin-left: auto;
        background: transparent;
        border: 1px solid var(--muted);
        color: var(--muted);
      }
      .turn {
        margin: 1rem 0;
        padding: 1rem 1.2rem;
        border-radius: 14px;
        background: rgba(0, 0, 0, 0.3);
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 1rem 2rem;
      }
      .whose {
        font-size: 1.2rem;
      }
      .whose small {
        color: var(--muted);
      }
      .buttons {
        display: flex;
        flex-wrap: wrap;
        gap: 0.7rem;
      }
      .hit,
      .stay,
      .primary {
        padding: 0.8rem 1.6rem;
        font-weight: 700;
        font-size: 1.05rem;
      }
      .hit,
      .primary {
        background: var(--gold);
        color: #1a1a1a;
      }
      .stay {
        background: var(--blue);
        color: #06223d;
      }
      .pending {
        display: flex;
        gap: 1rem;
        align-items: center;
      }
      .pending p {
        margin: 0 0 0.6rem;
      }
      .targets {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
      }
      .players {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: 0.9rem;
      }
      .player {
        padding: 0.8rem;
        border-radius: 14px;
        background: rgba(0, 0, 0, 0.25);
        border: 2px solid transparent;
        min-height: 170px;
      }
      .player.current {
        border-color: var(--gold);
        box-shadow: 0 0 18px rgba(245, 197, 66, 0.35);
      }
      .player.out {
        opacity: 0.8;
      }
      .head {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
      }
      .name {
        font-weight: 700;
        font-size: 1.1rem;
      }
      .tag {
        color: var(--muted);
        font-weight: 400;
      }
      .total {
        font-size: 1.6rem;
        font-weight: 800;
        color: var(--gold);
      }
      .status {
        display: flex;
        gap: 0.7rem;
        align-items: center;
        margin: 0.3rem 0 0.6rem;
        font-size: 0.85rem;
        color: var(--muted);
      }
      .badge {
        padding: 0.1rem 0.6rem;
        border-radius: 999px;
        font-size: 0.75rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        background: #2a6f57;
        color: var(--ink);
      }
      .badge.busted {
        background: var(--red);
      }
      .badge.stayed {
        background: var(--blue);
        color: #06223d;
      }
      .badge.frozen {
        background: #1f7ea8;
      }
      .hand {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .empty {
        color: var(--muted);
        font-size: 0.85rem;
      }
      .bottom {
        margin-top: 1.2rem;
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
        gap: 1rem;
      }
      .log,
      .rules {
        padding: 0.8rem 1rem;
        border-radius: 14px;
        background: rgba(0, 0, 0, 0.25);
        font-size: 0.9rem;
      }
      .log h3 {
        margin: 0 0 0.4rem;
        font-size: 0.9rem;
        color: var(--muted);
      }
      .log ul,
      .rules ul {
        margin: 0;
        padding-left: 1.1rem;
      }
      .rules summary {
        cursor: pointer;
        color: var(--muted);
      }
      .overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.65);
        display: grid;
        place-items: center;
        padding: 1rem;
      }
      .modal {
        width: min(560px, 100%);
        max-height: 90vh;
        overflow: auto;
        padding: 1.4rem;
        border-radius: 16px;
        background: var(--felt);
        border: 1px solid #2f7a61;
      }
      .modal h2 {
        margin-top: 0;
      }
      .winner {
        font-size: 1.4rem;
        color: var(--gold);
        font-weight: 800;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        margin-bottom: 1rem;
      }
      th,
      td {
        text-align: left;
        padding: 0.35rem 0.4rem;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      }
      th {
        color: var(--muted);
        font-weight: 500;
        font-size: 0.8rem;
      }
      .tag.you {
        color: var(--gold);
      }
      .tag.off {
        color: var(--red);
      }
      .wait {
        color: var(--muted);
      }
      .banner {
        margin-top: 0.8rem;
        padding: 0.6rem 0.9rem;
        border-radius: 10px;
        background: rgba(229, 72, 77, 0.25);
      }
      .banner button {
        margin-left: 0.6rem;
        padding: 0.3rem 0.8rem;
      }
      .peekbar {
        position: fixed;
        bottom: 1rem;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        gap: 0.7rem;
        padding: 0.6rem;
        border-radius: 14px;
        background: rgba(0, 0, 0, 0.8);
      }
    `,
  ],
})
export class GameComponent {
  readonly game = inject(GameService);
  readonly peek = signal(false);

  score(p: Player): number {
    return p.status === 'busted' ? 0 : scoreHand(p.hand);
  }

  unique(p: Player): number {
    return uniqueCount(p.hand);
  }

  isOffline(id: number): boolean {
    return this.game.roster()[id]?.connected === false;
  }

  pendingText(kind: ActionType): string {
    switch (kind) {
      case 'freeze':
        return 'drew Freeze. Choose a player to freeze (they bank their points and are out).';
      case 'flipThree':
        return 'drew Flip Three. Choose a player who must draw three cards.';
      default:
        return 'has a spare Second Chance. Give it to a player who does not have one.';
    }
  }

  recentLog(s: GameState): string[] {
    return s.log.slice(-14).reverse();
  }

  standings(s: GameState): RoundResult[] {
    return [...s.roundSummary].sort((a, b) => b.total - a.total);
  }

  outcome(r: RoundResult): string {
    if (r.flip7) return 'Flip 7! (+15 bonus)';
    switch (r.status) {
      case 'busted':
        return 'Busted';
      case 'frozen':
        return 'Frozen';
      case 'stayed':
        return 'Stayed';
      default:
        return 'Still in';
    }
  }

  winnerNames(s: GameState): string {
    return s.winnerIds.map((id) => s.players[id].name).join(', ');
  }

  next(): void {
    this.peek.set(false);
    this.game.nextRound();
  }

  playAgain(): void {
    this.peek.set(false);
    this.game.restartWithSamePlayers();
  }

  newGame(): void {
    const message =
      this.game.mode() === 'host'
        ? 'Close the room? This ends the game for everyone.'
        : this.game.mode() === 'guest'
          ? 'Leave this game?'
          : 'Abandon the current game?';
    if (confirm(message)) this.game.reset();
  }
}
