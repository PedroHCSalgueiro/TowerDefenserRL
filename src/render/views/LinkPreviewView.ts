/**
 * Ligações da torre na mão (T23): contorno leve nas casas vizinhas dela e
 * setas até as torres com que vai se ligar naquela casa, na cor do tipo de
 * ligação (ativa, carga, copia). Só desenha o que `previewLinks` devolve.
 */

import Phaser from 'phaser';
import renderConfig from '../../data/render.json';
import type { LinkKind, LinkPreview } from '../../sim/triggers/links';
import type { IsoProjection } from '../iso';
import { hexColor } from './color';

const style = renderConfig.linkPreview;
const kindColors: Readonly<Record<LinkKind, string>> = style.colors;

export class LinkPreviewView {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly projection: IsoProjection;

  constructor(scene: Phaser.Scene, projection: IsoProjection) {
    this.projection = projection;
    // Logo abaixo da torre fantasma (CarryView).
    this.graphics = scene.add.graphics().setDepth(999_999);
  }

  /** `null` limpa. */
  draw(preview: LinkPreview | null): void {
    const g = this.graphics;
    g.clear();
    if (!preview) return;
    g.lineStyle(style.cellLineWidth, hexColor(style.cellColor), style.cellAlpha);
    for (const cell of preview.neighborCells) {
      const [top, right, bottom, left] = this.projection.diamond(cell);
      g.beginPath();
      g.moveTo(top.x, top.y);
      g.lineTo(right.x, right.y);
      g.lineTo(bottom.x, bottom.y);
      g.lineTo(left.x, left.y);
      g.closePath();
      g.strokePath();
    }
    for (const link of preview.links) {
      const a = this.projection.toScreen(link.from);
      const b = this.projection.toScreen(link.to);
      this.arrow(a.x, a.y - style.arrowLift, b.x, b.y - style.arrowLift, kindColors[link.kind]);
    }
  }

  private arrow(x1: number, y1: number, x2: number, y2: number, color: string): void {
    const g = this.graphics;
    const length = Math.hypot(x2 - x1, y2 - y1);
    if (length <= style.arrowInset * 2) return;
    const ux = (x2 - x1) / length;
    const uy = (y2 - y1) / length;
    // Começa e termina um pouco antes dos centros, para a ponta não sumir sob a torre.
    const sx = x1 + ux * style.arrowInset;
    const sy = y1 + uy * style.arrowInset;
    const ex = x2 - ux * style.arrowInset;
    const ey = y2 - uy * style.arrowInset;
    const c = hexColor(color);
    g.lineStyle(style.arrowLineWidth, c, style.arrowAlpha);
    g.lineBetween(
      sx,
      sy,
      ex - ux * style.arrowHeadLength * 0.5,
      ey - uy * style.arrowHeadLength * 0.5,
    );
    const bx = ex - ux * style.arrowHeadLength;
    const by = ey - uy * style.arrowHeadLength;
    const half = style.arrowHeadWidth / 2;
    g.fillStyle(c, style.arrowAlpha);
    g.fillTriangle(ex, ey, bx - uy * half, by + ux * half, bx + uy * half, by - ux * half);
  }

  destroy(): void {
    this.graphics.destroy();
  }
}
