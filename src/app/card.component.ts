import { Component, computed, input } from '@angular/core';
import { Card, cardFace, cardName } from './game/models';

@Component({
  selector: 'app-card',
  template: `<div class="card" [class]="cls()" [style.background]="bg()" [attr.title]="title()">
    <span class="face">{{ face() }}</span>
  </div>`,
  styles: [
    `
      .card {
        width: 54px;
        height: 78px;
        border-radius: 8px;
        display: grid;
        place-items: center;
        font-weight: 800;
        font-size: 1.5rem;
        color: #fff;
        border: 2px solid rgba(255, 255, 255, 0.85);
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
      }
      .modifier {
        background: #7a4bd6;
      }
      .action {
        background: #1f2937;
        font-size: 0.62rem;
        text-align: center;
        line-height: 1.15;
        padding: 0 3px;
      }
      .action.freeze {
        background: #1f7ea8;
      }
      .action.flipThree {
        background: #c2410c;
      }
      .action.secondChance {
        background: #15803d;
      }
      .dupe {
        outline: 3px solid var(--red);
        outline-offset: 2px;
        opacity: 0.85;
      }
    `,
  ],
})
export class CardComponent {
  readonly card = input.required<Card>();
  readonly dupe = input(false);

  readonly face = computed(() => cardFace(this.card()));
  readonly title = computed(() => cardName(this.card()));
  readonly cls = computed(() => {
    const c = this.card();
    const parts: string[] = [c.kind];
    if (c.action) parts.push(c.action);
    if (this.dupe()) parts.push('dupe');
    return parts.join(' ');
  });
  readonly bg = computed(() => {
    const c = this.card();
    return c.kind === 'number' ? `hsl(${(c.value * 29) % 360} 60% 42%)` : null;
  });
}
