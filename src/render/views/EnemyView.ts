/**
 * Greybox dos inimigos: círculo com a cor do tipo e barra de vida. Voadores
 * são desenhados acima de uma sombra no chão.
 *
 * Um único Graphics é redesenhado a cada quadro, na posição interpolada entre
 * o tick anterior e o atual. Nenhum objeto do Phaser é criado por inimigo.
 */

import Phaser from 'phaser';
import renderConfig from '../../data/render.json';
import { getEnemyType, type EnemyData } from '../../sim/enemies/enemyData';
import type { Enemy } from '../../sim/enemies/pool';
import { lerp } from '../../sim/engine/clock';
import type { RunState } from '../../sim/state';
import type { IsoProjection } from '../iso';
import { hexColor } from './color';

const style = renderConfig.enemies;
const colors: Readonly<Record<string, string>> = style.colors;

export class EnemyView {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly projection: IsoProjection;
  private readonly data: EnemyData;
  // Reaproveitados entre quadros: ordem de desenho e posição na tela por slot.
  private readonly order: Enemy[] = [];
  private screenX = new Float64Array(0);
  private screenY = new Float64Array(0);
  private readonly byDepth = (a: Enemy, b: Enemy): number =>
    this.screenY[a.slot]! - this.screenY[b.slot]!;

  constructor(scene: Phaser.Scene, projection: IsoProjection, data: EnemyData) {
    this.g = scene.add.graphics();
    this.projection = projection;
    this.data = data;
  }

  draw(state: Readonly<RunState>, alpha: number): void {
    const { slots } = state.enemies;
    if (this.screenX.length < slots.length) {
      this.screenX = new Float64Array(slots.length * 2);
      this.screenY = new Float64Array(slots.length * 2);
    }

    const order = this.order;
    order.length = 0;
    for (const enemy of slots) {
      if (!enemy.active) continue;
      const p = this.projection.toScreen({
        x: lerp(enemy.prevX, enemy.x, alpha),
        y: lerp(enemy.prevY, enemy.y, alpha),
      });
      this.screenX[enemy.slot] = p.x;
      this.screenY[enemy.slot] = p.y;
      order.push(enemy);
    }
    // Isométrico: quem está mais abaixo na tela é desenhado por cima.
    order.sort(this.byDepth);

    const g = this.g;
    g.clear();
    for (const enemy of order) {
      const x = this.screenX[enemy.slot]!;
      let y = this.screenY[enemy.slot]!;
      if (getEnemyType(this.data, enemy.type).movement === 'air') {
        g.fillStyle(hexColor(style.shadow.color), style.shadow.alpha);
        g.fillEllipse(x, y, style.shadow.width, style.shadow.height);
        y -= style.flyingHeight;
      }
      g.fillStyle(hexColor(colors[enemy.type] ?? style.fallbackColor));
      g.fillCircle(x, y, style.radius);
      g.lineStyle(style.outlineWidth, hexColor(style.outlineColor));
      g.strokeCircle(x, y, style.radius);
      this.drawHealthBar(x, y - style.healthBar.offsetY, enemy.hp / enemy.maxHp);
    }
  }

  private drawHealthBar(cx: number, top: number, fraction: number): void {
    const bar = style.healthBar;
    const left = cx - bar.width / 2;
    this.g.fillStyle(hexColor(bar.backColor));
    this.g.fillRect(left, top, bar.width, bar.height);
    this.g.fillStyle(hexColor(bar.fillColor));
    this.g.fillRect(left, top, bar.width * Math.max(0, fraction), bar.height);
  }
}
