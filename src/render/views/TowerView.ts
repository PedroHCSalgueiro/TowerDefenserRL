/**
 * Greybox das torres: um bloco em pé na casa da torre, com a cor da classe
 * principal (a primeira da lista), e o alcance da torre da casa selecionada
 * (o círculo do alcance vira uma elipse na projeção isométrica).
 *
 * Os blocos são imagens na mesma Layer dos inimigos, com profundidade
 * `isoDepth` (x + y), para torres e inimigos se sobreporem na ordem certa.
 * As imagens só mudam quando a lista de torres muda; o alcance só é
 * redesenhado quando muda a torre selecionada.
 */

import Phaser from 'phaser';
import renderConfig from '../../data/render.json';
import type { GridCoord } from '../../sim/grid/map';
import type { RunState } from '../../sim/state';
import type { Tower } from '../../sim/towers/placement';
import { getTowerType, type TowerData } from '../../sim/towers/towerData';
import { isoDepth, type IsoProjection } from '../iso';
import { hexColor } from './color';

const style = renderConfig.towers;
const classColors: Readonly<Record<string, string>> = style.classColors;

const TEXTURE_BLOCK = 'tower-block';

function createTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(TEXTURE_BLOCK)) return;
  const g = scene.make.graphics({}, false);
  const outline = style.outlineWidth;
  const width = style.width + outline * 2;
  const height = style.height + outline * 2;
  g.fillStyle(0xffffff);
  g.fillRect(outline, outline, style.width, style.height);
  g.lineStyle(outline, hexColor(style.outlineColor));
  g.strokeRect(outline, outline, style.width, style.height);
  g.generateTexture(TEXTURE_BLOCK, width, height);
  g.destroy();
}

export class TowerView {
  private readonly scene: Phaser.Scene;
  private readonly layer: Phaser.GameObjects.Layer;
  private readonly projection: IsoProjection;
  private readonly data: TowerData;
  private readonly range: Phaser.GameObjects.Graphics;
  private readonly images = new Map<number, Phaser.GameObjects.Image>();
  private drawnList: readonly Tower[] | null = null;
  private drawnCount = -1;
  /** Torre cujo alcance está desenhado (`null` = nenhuma). */
  private rangeTower: Tower | null = null;

  constructor(
    scene: Phaser.Scene,
    projection: IsoProjection,
    layer: Phaser.GameObjects.Layer,
    data: TowerData,
  ) {
    this.scene = scene;
    this.layer = layer;
    this.projection = projection;
    this.data = data;
    this.range = scene.add.graphics();
    createTexture(scene);
  }

  draw(state: Readonly<RunState>, selected: GridCoord | null): void {
    this.syncImages(state.towers);
    const tower = selected
      ? (state.towers.find((t) => t.x === selected.x && t.y === selected.y) ?? null)
      : null;
    if (tower !== this.rangeTower) this.drawRange(tower);
  }

  private syncImages(towers: readonly Tower[]): void {
    if (towers === this.drawnList && towers.length === this.drawnCount) return;
    this.drawnList = towers;
    this.drawnCount = towers.length;

    const present = new Set<number>();
    for (const tower of towers) {
      present.add(tower.id);
      if (this.images.has(tower.id)) continue;
      const p = this.projection.toScreen(tower);
      const image = new Phaser.GameObjects.Image(this.scene, p.x, p.y, TEXTURE_BLOCK)
        .setOrigin(0.5, 1)
        .setTint(this.colorOf(tower.type))
        .setDepth(isoDepth(tower));
      this.layer.add(image);
      this.images.set(tower.id, image);
    }
    for (const [id, image] of this.images) {
      if (present.has(id)) continue;
      image.destroy();
      this.images.delete(id);
    }
  }

  private drawRange(tower: Tower | null): void {
    this.rangeTower = tower;
    const g = this.range;
    g.clear();
    if (!tower) return;
    const center = this.projection.toScreen(tower);
    const size = this.projection.circleSize(getTowerType(this.data, tower.type).range);
    const { range } = style;
    g.fillStyle(hexColor(range.fillColor), range.fillAlpha);
    g.fillEllipse(center.x, center.y, size.width, size.height);
    g.lineStyle(range.lineWidth, hexColor(range.lineColor), range.lineAlpha);
    g.strokeEllipse(center.x, center.y, size.width, size.height);
  }

  private colorOf(towerType: string): number {
    const mainClass = getTowerType(this.data, towerType).classes[0] ?? '';
    return hexColor(classColors[mainClass] ?? style.fallbackColor);
  }
}
