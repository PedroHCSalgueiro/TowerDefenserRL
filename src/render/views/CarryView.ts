/**
 * Torre fantasma presa ao mouse enquanto o jogador compra (arrastando ou
 * pelas teclas 1 a 5): um losango verde na casa sob o mouse se dá para
 * construir, vermelho se não, e o bloco da torre com a cor da classe.
 */

import Phaser from 'phaser';
import renderConfig from '../../data/render.json';
import type { GridCoord } from '../../sim/grid/map';
import { getTowerType, type TowerData } from '../../sim/towers/towerData';
import type { IsoProjection } from '../iso';
import { hexColor } from './color';

const { carry: carryStyle, hover: hoverStyle, towers: towerStyle } = renderConfig;
const classColors: Readonly<Record<string, string>> = towerStyle.classColors;

export class CarryView {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly projection: IsoProjection;
  private readonly data: TowerData;

  constructor(scene: Phaser.Scene, projection: IsoProjection, data: TowerData) {
    this.projection = projection;
    this.data = data;
    this.graphics = scene.add.graphics().setDepth(1_000_000);
  }

  /** `towerType === null` esconde o fantasma. */
  draw(towerType: string | null, cell: GridCoord | null, valid: boolean): void {
    const g = this.graphics;
    g.clear();
    if (towerType === null || cell === null) return;
    const [top, right, bottom, left] = this.projection.diamond(cell);
    g.fillStyle(
      hexColor(valid ? hoverStyle.buildableColor : hoverStyle.blockedColor),
      carryStyle.alpha,
    );
    g.beginPath();
    g.moveTo(top.x, top.y);
    g.lineTo(right.x, right.y);
    g.lineTo(bottom.x, bottom.y);
    g.lineTo(left.x, left.y);
    g.closePath();
    g.fillPath();

    const mainClass = getTowerType(this.data, towerType).classes[0] ?? '';
    const color = classColors[mainClass] ?? towerStyle.fallbackColor;
    const center = this.projection.toScreen(cell);
    g.fillStyle(hexColor(color), carryStyle.alpha);
    g.fillRect(
      center.x - towerStyle.width / 2,
      center.y - towerStyle.height,
      towerStyle.width,
      towerStyle.height,
    );
  }

  destroy(): void {
    this.graphics.destroy();
  }
}
