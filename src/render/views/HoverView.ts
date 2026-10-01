/**
 * Destaque da torre sob o mouse (T16), junto com a janela de informações:
 * o alcance da torre e um contorno nas casas das vizinhas que ela afeta
 * (`affectedNeighbors`, a mesma vizinhança do motor de gatilhos). Só
 * redesenha quando a torre, a casa ou as vizinhas mudam.
 */

import Phaser from 'phaser';
import renderConfig from '../../data/render.json';
import type { Tower } from '../../sim/towers/placement';
import { getTowerType, type TowerData } from '../../sim/towers/towerData';
import type { IsoProjection } from '../iso';
import { hexColor } from './color';

const range = renderConfig.towers.range;
const style = renderConfig.hoverInfo;

export class HoverView {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly projection: IsoProjection;
  private readonly data: TowerData;
  private key = '';

  constructor(scene: Phaser.Scene, projection: IsoProjection, data: TowerData) {
    this.g = scene.add.graphics();
    this.projection = projection;
    this.data = data;
  }

  /** `tower`: a torre da janela aberta (`null` = nenhuma); `neighbors`: as vizinhas que ela afeta. */
  draw(tower: Tower | null, neighbors: readonly Tower[]): void {
    const key = tower
      ? `${tower.id}:${tower.x},${tower.y}:${tower.star}:` +
        neighbors.map((n) => `${n.x},${n.y}`).join(';')
      : '';
    if (key === this.key) return;
    this.key = key;
    const g = this.g;
    g.clear();
    if (!tower) return;

    g.lineStyle(style.neighborLineWidth, hexColor(style.neighborColor), style.neighborAlpha);
    for (const neighbor of neighbors) {
      const [top, right, bottom, left] = this.projection.diamond(neighbor);
      g.beginPath();
      g.moveTo(top.x, top.y);
      g.lineTo(right.x, right.y);
      g.lineTo(bottom.x, bottom.y);
      g.lineTo(left.x, left.y);
      g.closePath();
      g.strokePath();
    }
    const center = this.projection.toScreen(tower);
    const size = this.projection.circleSize(getTowerType(this.data, tower.type).range);
    g.fillStyle(hexColor(range.fillColor), range.fillAlpha);
    g.fillEllipse(center.x, center.y, size.width, size.height);
    g.lineStyle(range.lineWidth, hexColor(range.lineColor), range.lineAlpha);
    g.strokeEllipse(center.x, center.y, size.width, size.height);
  }

  destroy(): void {
    this.g.destroy();
  }
}
