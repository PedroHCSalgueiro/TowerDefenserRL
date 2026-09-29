/**
 * Greybox das torres de teste da T05: um bloco na casa da torre. Só é
 * redesenhado quando a lista de torres muda.
 */

import Phaser from 'phaser';
import renderConfig from '../../data/render.json';
import type { DummyTower } from '../../sim/debug/dummyTowers';
import type { RunState } from '../../sim/state';
import type { IsoProjection } from '../iso';
import { hexColor } from './color';

const style = renderConfig.towers;

export class TowerView {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly projection: IsoProjection;
  private drawnList: readonly DummyTower[] | null = null;
  private drawnCount = -1;

  constructor(scene: Phaser.Scene, projection: IsoProjection) {
    this.g = scene.add.graphics();
    this.projection = projection;
  }

  draw(state: Readonly<RunState>): void {
    const towers = state.debug.towers;
    if (towers === this.drawnList && towers.length === this.drawnCount) return;
    this.drawnList = towers;
    this.drawnCount = towers.length;

    const g = this.g;
    g.clear();
    g.fillStyle(hexColor(style.color));
    g.lineStyle(style.outlineWidth, hexColor(style.outlineColor));
    // Ordem de profundidade isométrica: quem está mais abaixo por cima.
    const ordered = [...towers].sort((a, b) => a.x + a.y - (b.x + b.y));
    for (const tower of ordered) {
      const p = this.projection.toScreen(tower);
      g.fillRect(p.x - style.width / 2, p.y - style.height, style.width, style.height);
      g.strokeRect(p.x - style.width / 2, p.y - style.height, style.width, style.height);
    }
  }
}
