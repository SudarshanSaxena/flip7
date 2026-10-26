import { Component, inject } from '@angular/core';
import { GameService } from './game/game.service';

@Component({
  selector: 'app-lobby',
  template: `
    <main class="lobby">
      <h1>FLIP <span>7</span></h1>
      <p class="label">Room code</p>
      <div class="code">{{ game.room() }}</div>
      @if (game.mode() === 'host') {
        <p class="sub">
          Friends open this app, choose "Join online", and enter the code. You need 2 to 10 players.
        </p>
      }

      @if (game.offline()) {
        <div class="banner">
          Disconnected from the host.
          <button (click)="game.reconnect()">Reconnect</button>
        </div>
      }
      @if (game.notice(); as n) {
        <p class="error">{{ n }}</p>
      }

      <h2>Players ({{ game.roster().length }}/10)</h2>
      <ul>
        @for (p of game.roster(); track $index; let i = $index) {
          <li [class.off]="!p.connected">
            {{ p.name }}
            @if (i === 0) {
              <small>host</small>
            }
            @if (i === game.seat()) {
              <small>you</small>
            }
            @if (!p.connected) {
              <small>offline</small>
            }
          </li>
        }
      </ul>

      @if (game.mode() === 'host') {
        <button class="go" [disabled]="game.roster().length < 2" (click)="game.startOnline()">
          Start game
        </button>
      } @else {
        <p class="sub">Waiting for the host to start the game...</p>
      }
      <button class="leave" (click)="game.reset()">Leave room</button>
    </main>
  `,
  styles: [
    `
      .lobby {
        max-width: 480px;
        margin: 0 auto;
        padding: 2.5rem 1rem 4rem;
        text-align: center;
      }
      h1 {
        font-size: 3rem;
        margin: 0 0 1rem;
      }
      .label {
        margin: 0;
        color: var(--muted);
        text-transform: uppercase;
        letter-spacing: 0.08em;
        font-size: 0.85rem;
      }
      .code {
        font-size: 3rem;
        font-weight: 800;
        letter-spacing: 0.25em;
        color: var(--gold);
        user-select: all;
      }
      .sub {
        color: var(--muted);
      }
      h2 {
        font-size: 1rem;
        margin: 1.8rem 0 0.6rem;
        color: var(--muted);
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      ul {
        list-style: none;
        padding: 0;
        margin: 0 0 1.5rem;
        display: grid;
        gap: 0.4rem;
        text-align: left;
      }
      li {
        padding: 0.6rem 0.9rem;
        border-radius: 10px;
        background: rgba(0, 0, 0, 0.3);
      }
      li.off {
        opacity: 0.55;
      }
      small {
        margin-left: 0.5rem;
        color: var(--muted);
      }
      .go {
        width: 100%;
        padding: 0.9rem;
        font-size: 1.1rem;
        font-weight: 700;
        background: var(--gold);
        color: #1a1a1a;
      }
      .go:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }
      .leave {
        margin-top: 1rem;
        background: transparent;
        border: 1px solid var(--muted);
        color: var(--muted);
      }
      .banner,
      .error {
        padding: 0.6rem 0.9rem;
        border-radius: 10px;
        background: rgba(229, 72, 77, 0.25);
      }
    `,
  ],
})
export class LobbyComponent {
  readonly game = inject(GameService);
}
