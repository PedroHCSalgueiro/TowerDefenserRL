/**
 * Greybox do núcleo: barra de vida sobre a casa do núcleo e uma linha rápida
 * até o alvo a cada ataque.
 */

import Phaser from 'phaser';
import renderConfig from '../../data/render.json';
import type { SimEvent } from '../../sim/engine/events';
import type { GridMap } from '../../sim/grid/map';
import type { RunState } from '../../sim/state';
import type { IsoProjection, Point } from '../iso';
import { hexColor } from './color';

const style = renderConfig.nexus;

export class NexusView {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly projection: IsoProjection;
  private readonly origin: Point;
  private shot: Point | null = null;
  private shotMsLeft = 0;

  constructor(scene: Phaser.Scene, projection: IsoProjection, map: GridMap) {
    this.g = scene.add.graphics();
    this.projection = projection;
    this.origin = projection.toScreen(map.nexus);
  }

  handleEvents(events: readonly SimEvent[]): void {
    for (const event of events) {
      if (event.type === 'nexusFired') {
        this.shot = this.projection.toScreen(event);
        this.shotMsLeft = style.attackLine.durationMs;
      }
    }
  }

  draw(state: Readonly<RunState>, deltaMs: number): void {
    const g = this.g;
    g.clear();

    if (this.shot && this.shotMsLeft > 0) {
      const line = style.attackLine;
      g.lineStyle(line.width, hexColor(line.color), this.shotMsLeft / line.durationMs);
      g.lineBetween(this.origin.x, this.origin.y, this.shot.x, this.shot.y);
      this.shotMsLeft -= deltaMs;
    }

    const bar = style.healthBar;
    const left = this.origin.x - bar.width / 2;
    const top = this.origin.y - bar.offsetY;
    g.fillStyle(hexColor(bar.backColor));
    g.fillRect(left, top, bar.width, bar.height);
    g.fillStyle(hexColor(bar.fillColor));
    g.fillRect(left, top, (bar.width * state.nexus.hp) / state.nexus.maxHp, bar.height);
  }
}
