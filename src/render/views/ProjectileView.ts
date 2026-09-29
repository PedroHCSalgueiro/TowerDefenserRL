/**
 * Greybox dos projéteis: um ponto por projétil, na posição interpolada, e um
 * clarão curto (elipse que some) em cada dano em área (tiro em área ou
 * explosão de gatilho).
 * Um único Graphics redesenhado por quadro, como os inimigos.
 */

import Phaser from 'phaser';
import renderConfig from '../../data/render.json';
import { lerp } from '../../sim/engine/clock';
import type { SimEvent } from '../../sim/engine/events';
import type { RunState } from '../../sim/state';
import type { IsoProjection, Point, Size } from '../iso';
import { hexColor } from './color';

const style = renderConfig.projectiles;
const explosionStyle = style.explosion;

interface Flash {
  center: Point;
  size: Size;
  msLeft: number;
}

export class ProjectileView {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly projection: IsoProjection;
  private readonly color = hexColor(style.color);
  private readonly explosionColor = hexColor(explosionStyle.color);
  private flashes: Flash[] = [];

  constructor(scene: Phaser.Scene, projection: IsoProjection) {
    this.g = scene.add.graphics();
    this.projection = projection;
  }

  /**
   * Guarda as explosões do quadro (acima do teto, as mais antigas saem). Numa
   * avalanche de gatilhos chegam milhares por quadro: só as últimas
   * `maxActive` viram clarão.
   */
  handleEvents(events: readonly SimEvent[]): void {
    const max = explosionStyle.maxActive;
    let first = events.length;
    for (let found = 0; first > 0 && found < max;) {
      if (events[--first]!.type === 'areaExploded') found++;
    }
    for (let i = first; i < events.length; i++) {
      const event = events[i]!;
      if (event.type !== 'areaExploded') continue;
      this.flashes.push({
        center: this.projection.toScreen(event),
        size: this.projection.circleSize(event.radius),
        msLeft: explosionStyle.durationMs,
      });
    }
    if (this.flashes.length > max) {
      this.flashes = this.flashes.slice(-max);
    }
  }

  draw(state: Readonly<RunState>, alpha: number, deltaMs: number): void {
    const g = this.g;
    g.clear();

    for (const flash of this.flashes) {
      const fade = flash.msLeft / explosionStyle.durationMs;
      g.lineStyle(explosionStyle.lineWidth, this.explosionColor, explosionStyle.alpha * fade);
      g.strokeEllipse(flash.center.x, flash.center.y, flash.size.width, flash.size.height);
      flash.msLeft -= deltaMs;
    }
    this.flashes = this.flashes.filter((flash) => flash.msLeft > 0);

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
