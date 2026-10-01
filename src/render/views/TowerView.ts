/**
 * Greybox das torres: um bloco em pé na casa da torre, com a cor da classe
 * principal (a primeira da lista), e o alcance da torre da casa selecionada
 * (o círculo do alcance vira uma elipse na projeção isométrica).
 *
 * Os blocos são imagens na mesma Layer dos inimigos, com profundidade
 * `isoDepth` (x + y), para torres e inimigos se sobreporem na ordem certa.
 * As imagens só mudam quando a lista de torres muda; o alcance só é
 * redesenhado quando muda a torre selecionada.
 *
 * Cada torre mostra as estrelas (★1 a ★3) acima do bloco. Uma fusão
 * (`towersMerged`) tira na hora as imagens das torres absorvidas e faz um
 * flash curto na sobrevivente final: a cascata emite dois eventos, mas o
 * flash sai só no último (o primeiro cairia numa torre que some).
 *
 * Mover ou trocar (`towerMoved`, T15) leva a imagem e as estrelas para a casa
 * nova. Com as torres travadas, `showLocked` treme a torre e mostra um cadeado.
 */

import Phaser from 'phaser';
import renderConfig from '../../data/render.json';
import type { SimEvent } from '../../sim/engine/events';
import type { GridCoord } from '../../sim/grid/map';
import type { RunState } from '../../sim/state';
import type { Tower } from '../../sim/towers/placement';
import { getTowerType, type TowerData } from '../../sim/towers/towerData';
import { isoDepth, type IsoProjection } from '../iso';
import { hexColor } from './color';
import { fusionFlashes } from './fusionFlash';

const style = renderConfig.towers;
const classColors: Readonly<Record<string, string>> = style.classColors;

const TEXTURE_BLOCK = 'tower-block';

/** Cor da torre: a da classe principal (a primeira da lista). */
export function towerColor(data: TowerData, towerType: string): number {
  const mainClass = getTowerType(data, towerType).classes[0] ?? '';
  return hexColor(classColors[mainClass] ?? style.fallbackColor);
}

/** Estrelas da torre, como texto: ★1 = "★", ★3 = "★★★". */
export function starsLabel(star: number): string {
  return '★'.repeat(Math.max(1, Math.floor(star)));
}

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
  private readonly labels = new Map<number, { text: Phaser.GameObjects.Text; star: number }>();
  private drawnList: readonly Tower[] | null = null;
  private drawnCount = -1;
  /** Uma torre entrou ou saiu neste quadro (cobre vender e comprar no mesmo quadro). */
  private dirty = false;
  /** Torre cujo alcance está desenhado (`null` = nenhuma) e a casa em que ela estava. */
  private rangeTower: Tower | null = null;
  private rangeCell: GridCoord | null = null;

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

  handleEvents(events: readonly SimEvent[]): void {
    const flashes = fusionFlashes(events);
    for (const event of events) {
      if (event.type === 'towerPlaced' || event.type === 'towerSold') this.dirty = true;
      else if (event.type === 'towerMoved') {
        this.placeAt(event.towerId, { x: event.x, y: event.y });
        if (event.swappedWithId !== null) {
          this.placeAt(event.swappedWithId, { x: event.fromX, y: event.fromY });
        }
      } else if (event.type === 'towersMerged') {
        this.dirty = true;
        for (const id of event.absorbedIds) this.removeTower(id);
      }
    }
    for (const f of flashes) this.flash(f.towerId, f.x, f.y);
  }

  /** Leva a imagem e as estrelas da torre para a casa (depois de mover ou trocar). */
  private placeAt(id: number, cell: GridCoord): void {
    const p = this.projection.toScreen(cell);
    const depth = isoDepth(cell);
    this.scene.tweens.killTweensOf(this.images.get(id) ?? []);
    this.images.get(id)?.setPosition(p.x, p.y).setDepth(depth);
    this.labels
      .get(id)
      ?.text.setPosition(p.x, this.labelY(p.y))
      .setDepth(depth + 0.1);
  }

  /** Torre travada (onda ativa): tremida curta e um cadeado sobre o bloco. */
  showLocked(towerId: number, cell: GridCoord): void {
    const { locked } = style;
    const p = this.projection.toScreen(cell);
    const image = this.images.get(towerId);
    if (image) {
      this.scene.tweens.killTweensOf(image);
      image.setPosition(p.x, p.y);
      this.scene.tweens.add({
        targets: image,
        x: { from: p.x - locked.shakePx, to: p.x + locked.shakePx },
        duration: locked.shakeMs,
        yoyo: true,
        repeat: locked.shakeRepeats - 1,
        onComplete: () => image.setPosition(p.x, p.y),
      });
    }
    // Cadeado: arco (alça) sobre um retângulo (corpo), acima das estrelas.
    const w = locked.iconWidth;
    const h = locked.iconHeight;
    const r = locked.iconShackleRadius;
    const icon = new Phaser.GameObjects.Graphics(this.scene)
      .setPosition(p.x, this.labelY(p.y) - locked.iconOffsetY)
      .setDepth(isoDepth(cell) + 0.6);
    icon.lineStyle(locked.iconLineWidth + 2, hexColor(locked.iconOutlineColor));
    icon.beginPath();
    icon.arc(0, -h, r, Math.PI, 0);
    icon.strokePath();
    icon.lineStyle(locked.iconLineWidth, hexColor(locked.iconColor));
    icon.beginPath();
    icon.arc(0, -h, r, Math.PI, 0);
    icon.strokePath();
    icon.fillStyle(hexColor(locked.iconColor));
    icon.fillRect(-w / 2, -h, w, h);
    icon.lineStyle(1, hexColor(locked.iconOutlineColor));
    icon.strokeRect(-w / 2, -h, w, h);
    this.layer.add(icon);
    this.scene.tweens.add({
      targets: icon,
      alpha: { from: 1, to: 0 },
      delay: locked.iconMs / 2,
      duration: locked.iconMs / 2,
      onComplete: () => icon.destroy(),
    });
  }

  /** Altura (y na tela) do texto de estrelas de uma torre cuja base está em `baseY`. */
  private labelY(baseY: number): number {
    return baseY - style.height - style.outlineWidth * 2 - style.stars.offsetY;
  }

  private removeTower(id: number): void {
    this.images.get(id)?.destroy();
    this.images.delete(id);
    this.labels.get(id)?.text.destroy();
    this.labels.delete(id);
  }

  /** Flash curto sobre a sobrevivente final da fusão. */
  private flash(towerId: number, x: number, y: number): void {
    const { fusion } = style;
    const p = this.projection.toScreen({ x, y });
    const image = new Phaser.GameObjects.Image(this.scene, p.x, p.y, TEXTURE_BLOCK)
      .setOrigin(0.5, 1)
      .setTint(hexColor(fusion.flashColor))
      .setScale(fusion.flashScale)
      .setDepth(isoDepth({ x, y }) + 0.5);
    this.layer.add(image);
    this.scene.tweens.add({
      targets: image,
      alpha: { from: 1, to: 0 },
      duration: fusion.flashMs,
      onComplete: () => image.destroy(),
    });
    void towerId;
  }

  draw(state: Readonly<RunState>, selected: GridCoord | null): void {
    this.syncImages(state.towers);
    const tower = selected
      ? (state.towers.find((t) => t.x === selected.x && t.y === selected.y) ?? null)
      : null;
    if (
      tower !== this.rangeTower ||
      (tower && (tower.x !== this.rangeCell?.x || tower.y !== this.rangeCell.y))
    ) {
      this.drawRange(tower);
    }
  }

  private syncImages(towers: readonly Tower[]): void {
    if (!this.dirty && towers === this.drawnList && towers.length === this.drawnCount) return;
    this.dirty = false;
    this.drawnList = towers;
    this.drawnCount = towers.length;

    const present = new Set<number>();
    for (const tower of towers) {
      present.add(tower.id);
      this.syncLabel(tower);
      if (this.images.has(tower.id)) continue;
      const p = this.projection.toScreen(tower);
      const image = new Phaser.GameObjects.Image(this.scene, p.x, p.y, TEXTURE_BLOCK)
        .setOrigin(0.5, 1)
        .setTint(this.colorOf(tower.type))
        .setDepth(isoDepth(tower));
      this.layer.add(image);
      this.images.set(tower.id, image);
    }
    for (const id of [...this.images.keys()]) {
      if (!present.has(id)) this.removeTower(id);
    }
  }

  /** Cria ou atualiza o texto de estrelas da torre (só refaz quando a estrela muda). */
  private syncLabel(tower: Tower): void {
    const p = this.projection.toScreen(tower);
    const current = this.labels.get(tower.id);
    if (current) {
      if (current.star === tower.star) return;
      current.text.setText(starsLabel(tower.star));
      current.star = tower.star;
      return;
    }
    const { stars } = style;
    const text = new Phaser.GameObjects.Text(
      this.scene,
      p.x,
      this.labelY(p.y),
      starsLabel(tower.star),
      { fontSize: `${stars.fontSize}px`, color: stars.color },
    )
      .setOrigin(0.5, 1)
      .setDepth(isoDepth(tower) + 0.1);
    this.layer.add(text);
    this.labels.set(tower.id, { text, star: tower.star });
  }

  private drawRange(tower: Tower | null): void {
    this.rangeTower = tower;
    this.rangeCell = tower && { x: tower.x, y: tower.y };
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
    return towerColor(this.data, towerType);
  }
}
