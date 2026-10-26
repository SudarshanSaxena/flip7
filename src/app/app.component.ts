import { Component, inject } from '@angular/core';
import { GameComponent } from './game.component';
import { GameService } from './game/game.service';
import { LobbyComponent } from './lobby.component';
import { SetupComponent } from './setup.component';

@Component({
  selector: 'app-root',
  imports: [SetupComponent, LobbyComponent, GameComponent],
  template: `
    @if (game.state()) {
      <app-game />
    } @else if (game.mode() !== 'local') {
      <app-lobby />
    } @else {
      <app-setup />
    }
  `,
})
export class AppComponent {
  readonly game = inject(GameService);
}
