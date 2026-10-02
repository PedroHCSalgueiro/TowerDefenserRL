/**
 * Greybox dos inimigos: círculo com a cor do tipo e barra de vida. Voadores
 * são desenhados acima de uma sombra no chão. Chefões têm tamanho próprio
 * (`scales`) e o elite é desenhado `eliteScale` vezes maior.
 *
 * Cada slot do pool de inimigos tem suas imagens (corpo, sombra, fundo e
 * preenchimento da barra), criadas uma vez e reaproveitadas; o slot inativo
 * só fica invisível. As texturas são geradas uma vez a partir de um Graphics.
 * Isso troca o Graphics redesenhado a cada quadro (caro com 1.000 inimigos:
 * a geometria era refeita toda vez) por imagens em lote.
 *
 * Tudo fica na Layer compartilhada com as torres, ordenado pela profundidade
 * isométrica `isoDepth` (x + y: quem está mais abaixo na tela é desenhado
 * por cima), na posição interpolada entre o tick anterior e o atual.
 */

import Phaser from 'phaser';
import renderConfig from '../../data/render.json';
import { getEnemyType, type EnemyData } from '../../sim/enemies/enemyData';
import { lerp } from '../../sim/engine/clock';
import type { RunState } from '../../sim/state';
import { isoDepth, type IsoProjection } from '../iso';
import { hexColor } from './color';

const style = renderConfig.enemies;
const colors: Readonly<Record<string, string>> = style.colors;
const scales: Readonly<Record<string, number>> = style.scales;

const TEXTURE_BODY = 'enemy-body';
const TEXTURE_SHADOW = 'enemy-shadow';
const TEXTURE_PIXEL = 'enemy-pixel';
// Dentro da mesma profundidade: sombra, corpo e barra, nessa ordem.
const DEPTH_STEP = 1e-4;

interface SlotImages {
  body: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  barBack: Phaser.GameObjects.Image;
  barFill: Phaser.GameObjects.Image;
  visible: boolean;
  /** Tipo e elite desenhados por último (cor e tamanho só mudam quando eles mudam). */
  type: string;
  elite: boolean;
}

function createTextures(scene: Phaser.Scene): void {
  if (scene.textures.exists(TEXTURE_BODY)) return;
  const g = scene.make.graphics({}, false);

  const outline = style.outlineWidth;
  const size = Math.ceil((style.radius + outline) * 2);
  g.fillStyle(0xffffff);
  g.fillCircle(size / 2, size / 2, style.radius);
  g.lineStyle(outline, hexColor(style.outlineColor));
  g.strokeCircle(size / 2, size / 2, style.radius);
  g.generateTexture(TEXTURE_BODY, size, size);

  g.clear();
  const { shadow } = style;
  g.fillStyle(hexColor(shadow.color), shadow.alpha);
  g.fillEllipse(shadow.width / 2, shadow.height / 2, shadow.width, shadow.height);
  g.generateTexture(TEXTURE_SHADOW, shadow.width, shadow.height);

  g.clear();
  g.fillStyle(0xffffff);
  g.fillRect(0, 0, 1, 1);
  g.generateTexture(TEXTURE_PIXEL, 1, 1);
  g.destroy();
}

export class EnemyView {
  private readonly scene: Phaser.Scene;
  private readonly layer: Phaser.GameObjects.Layer;
  private readonly projection: IsoProjection;
  private readonly data: EnemyData;
  private readonly images: SlotImages[] = [];
  private readonly typeColor = new Map<string, number>();
  private readonly barBackColor = hexColor(style.healthBar.backColor);
  private readonly barFillColor = hexColor(style.healthBar.fillColor);

  constructor(
    scene: Phaser.Scene,
    projection: IsoProjection,
    data: EnemyData,
    layer: Phaser.GameObjects.Layer,
  ) {
    this.scene = scene;
    this.layer = layer;
    this.projection = projection;
    this.data = data;
    createTextures(scene);
  }

  draw(state: Readonly<RunState>, alpha: number): void {
    const { slots } = state.enemies;
    while (this.images.length < slots.length) {
      this.images.push(this.createSlotImages());
    }
    const bar = style.healthBar;

    for (const enemy of slots) {
      const images = this.images[enemy.slot]!;
      if (!enemy.active) {
        if (images.visible) this.setVisible(images, false);
        continue;
      }
      if (!images.visible) this.setVisible(images, true);

      const at = { x: lerp(enemy.prevX, enemy.x, alpha), y: lerp(enemy.prevY, enemy.y, alpha) };
      const p = this.projection.toScreen(at);
      const flying = getEnemyType(this.data, enemy.type).movement === 'air';
      const depth = isoDepth(at);
      const y = flying ? p.y - style.flyingHeight : p.y;

      if (images.type !== enemy.type || images.elite !== enemy.elite) {
        images.type = enemy.type;
        images.elite = enemy.elite;
        images.body.setTint(this.colorOf(enemy.type));
        images.body.setScale((scales[enemy.type] ?? 1) * (enemy.elite ? style.eliteScale : 1));
      }
      images.shadow.setVisible(flying);
      if (flying) images.shadow.setPosition(p.x, p.y).setDepth(depth - DEPTH_STEP);
      images.body.setPosition(p.x, y).setDepth(depth);

      const left = p.x - bar.width / 2;
      const top = y - bar.offsetY;
      images.barBack.setPosition(left, top).setDepth(depth + DEPTH_STEP);
      images.barFill
        .setPosition(left, top)
        .setScale(bar.width * Math.max(0, enemy.hp / enemy.maxHp), bar.height)
        .setDepth(depth + 2 * DEPTH_STEP);
    }
  }

  private createSlotImages(): SlotImages {
    const add = (texture: string): Phaser.GameObjects.Image => {
      const image = new Phaser.GameObjects.Image(this.scene, 0, 0, texture).setVisible(false);
      this.layer.add(image);
      return image;
    };
    const bar = style.healthBar;
    return {
      shadow: add(TEXTURE_SHADOW),
      body: add(TEXTURE_BODY),
      barBack: add(TEXTURE_PIXEL)
        .setOrigin(0, 0)
        .setScale(bar.width, bar.height)
        .setTint(this.barBackColor),
      barFill: add(TEXTURE_PIXEL).setOrigin(0, 0).setTint(this.barFillColor),
      visible: false,
      type: '',
      elite: false,
    };
  }

  private setVisible(images: SlotImages, visible: boolean): void {
    images.visible = visible;
    images.body.setVisible(visible);
    images.barBack.setVisible(visible);
    images.barFill.setVisible(visible);
    if (!visible) images.shadow.setVisible(false);
  }

  private colorOf(type: string): number {
    let color = this.typeColor.get(type);
    if (color === undefined) {
      color = hexColor(colors[type] ?? style.fallbackColor);
      this.typeColor.set(type, color);
    }
    return color;
  }
}
