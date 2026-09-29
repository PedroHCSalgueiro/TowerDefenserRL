/**
 * Greybox dos projéteis: um ponto por projétil, na posição interpolada.
 * Um único Graphics redesenhado por quadro, como os inimigos.
 */

import Phaser from 'phaser';
import renderConfig from '../../data/render.json';
import { lerp } from '../../sim/engine/clock';
import type { RunState } from '../../sim/state';
import type { IsoProjection } from '../iso';
import { hexColor } from './color';

const style = renderConfig.projectiles;

export class ProjectileView {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly projection: IsoProjection;
  private readonly color = hexColor(style.color);

  constructor(scene: Phaser.Scene, projection: IsoProjection) {
    this.g = scene.add.graphics();
    this.projection = projection;
  }

  draw(state: Readonly<RunState>, alpha: number): void {
    const g = this.g;
    g.clear();
    g.fillStyle(this.color);
    for (const projectile of state.projectiles.slots) {
      if (!projectile.active) continue;
      const p = this.projection.toScreen({
        x: lerp(projectile.prevX, projectile.x, alpha),
        y: lerp(projectile.prevY, projectile.y, alpha),
      });
      g.fillCircle(p.x, p.y, style.radius);
    }
  }
}
