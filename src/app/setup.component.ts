import { Component, computed, inject, signal } from '@angular/core';
import { GameService } from './game/game.service';

type Tab = 'local' | 'host' | 'join';

@Component({
  selector: 'app-setup',
  template: `
    <main class="setup">
      <h1>FLIP <span>7</span></h1>
      <p class="sub">2 to 10 players. All game logic runs in the browsers, with no backend.</p>

      <div class="tabs">
        <button [class.on]="tab() === 'local'" (click)="tab.set('local')">Same screen</button>
        <button [class.on]="tab() === 'host'" (click)="tab.set('host')">Host online</button>
        <button [class.on]="tab() === 'join'" (click)="tab.set('join')">Join online</button>
      </div>

      @if (game.notice(); as n) {
        <p class="error">{{ n }}</p>
      }

      @if (tab() === 'local') {
        <h2>How many players?</h2>
        <div class="counts">
          @for (n of options; track n) {
            <button [class.on]="count() === n" (click)="count.set(n)">{{ n }}</button>
          }
        </div>

        <h2>Names</h2>
        <div class="names">
          @for (i of slots(); track i) {
            <label>
              <span>{{ i + 1 }}</span>
              <input
                [value]="names()[i]"
                [placeholder]="'Player ' + (i + 1)"
                maxlength="16"
                (input)="rename(i, $event)"
              />
            </label>
          }
        </div>

        <button class="go" (click)="start()">Deal the cards</button>
      }

      @if (tab() === 'host') {
        <h2>Your name</h2>
        <input
          class="wide"
          [value]="myName()"
          placeholder="Host"
          maxlength="16"
          (input)="myName.set(read($event))"
        />
        <p class="hint">
          You create a room and share the code. Your browser runs the game, so keep this tab open.
        </p>
        <button class="go" [disabled]="busy()" (click)="host()">
          {{ busy() ? 'Creating room...' : 'Create room' }}
        </button>
      }

      @if (tab() === 'join') {
        <h2>Room code</h2>
        <input
          class="wide code"
          [value]="joinCode()"
          placeholder="ABCDE"
          maxlength="8"
          (input)="joinCode.set(read($event).toUpperCase())"
        />
        <h2>Your name</h2>
        <input
          class="wide"
          [value]="myName()"
          placeholder="Player"
          maxlength="16"
          (input)="myName.set(read($event))"
        />
        <button class="go" [disabled]="busy() || joinCode().trim().length === 0" (click)="join()">
          {{ busy() ? 'Joining...' : 'Join room' }}
        </button>
      }

      @if (error(); as e) {
        <p class="error">{{ e }}</p>
      }
    </main>
  `,
  styles: [
    `
      .setup {
        max-width: 560px;
        margin: 0 auto;
        padding: 2.5rem 1rem 4rem;
      }
      h1 {
        font-size: 3.2rem;
        margin: 0;
        letter-spacing: 0.05em;
      }
      .sub,
      .hint {
        color: var(--muted);
      }
      .tabs {
        display: flex;
        gap: 0.5rem;
        margin: 1.5rem 0 0;
      }
      .tabs button {
        flex: 1;
        background: var(--felt-dark);
      }
      .tabs button.on,
      .counts button.on {
        background: var(--gold);
        color: #1a1a1a;
      }
      h2 {
        font-size: 1rem;
        margin: 1.8rem 0 0.6rem;
        color: var(--muted);
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .counts {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
      }
      .counts button {
        width: 46px;
        height: 46px;
        padding: 0;
        font-weight: 700;
        background: var(--felt-dark);
      }
      .names {
        display: grid;
        gap: 0.5rem;
      }
      label {
        display: flex;
        align-items: center;
        gap: 0.7rem;
      }
      label span {
        width: 1.5rem;
        color: var(--muted);
        text-align: right;
      }
      input {
        flex: 1;
        padding: 0.6rem 0.8rem;
        border-radius: 10px;
        border: 1px solid #2f7a61;
        background: var(--felt-dark);
        color: var(--ink);
        font: inherit;
      }
      input.wide {
        width: 100%;
      }
      input.code {
        font-size: 1.6rem;
        letter-spacing: 0.3em;
        text-transform: uppercase;
      }
      .go {
        margin-top: 2rem;
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
      .error {
        margin-top: 1rem;
        padding: 0.6rem 0.9rem;
        border-radius: 10px;
        background: rgba(229, 72, 77, 0.25);
      }
    `,
  ],
})
export class SetupComponent {
  readonly game = inject(GameService);

  readonly tab = signal<Tab>('local');
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  readonly options = [2, 3, 4, 5, 6, 7, 8, 9, 10];
  readonly count = signal(4);
  readonly names = signal<string[]>(Array.from({ length: 10 }, () => ''));
  readonly slots = computed(() => Array.from({ length: this.count() }, (_, i) => i));

  readonly myName = signal('');
  readonly joinCode = signal('');

  read(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  rename(index: number, event: Event): void {
    const value = this.read(event);
    this.names.update((all) => all.map((name, i) => (i === index ? value : name)));
  }

  start(): void {
    const chosen = this.slots().map((i) => this.names()[i].trim() || `Player ${i + 1}`);
    this.game.start(chosen);
  }

  async host(): Promise<void> {
    await this.run(() => this.game.hostRoom(this.myName()));
  }

  async join(): Promise<void> {
    await this.run(() => this.game.joinRoom(this.joinCode(), this.myName() || 'Player'));
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.error.set(null);
    this.game.notice.set(null);
    this.busy.set(true);
    try {
      await action();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Could not connect.');
    } finally {
      this.busy.set(false);
    }
  }
}
