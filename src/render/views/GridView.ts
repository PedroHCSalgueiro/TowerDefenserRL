/**
 * Greybox da grade: losangos para casas livres, caminho, entrada e núcleo,
 * destaque da casa sob o mouse e seleção por clique.
 */

import Phaser from 'phaser';
import renderConfig from '../../data/render.json';
import type { GridCoord, GridMap } from '../../sim/grid/map';
import { IsoProjection } from '../iso';
import { hexColor } from './color';

const { grid: gridStyle, hover: hoverStyle, selection: selectionStyle, debugLabel } = renderConfig;

function sameCell(a: GridCoord | null, b: GridCoord | null): boolean {
  return a === b || (a !== null && b !== null && a.x === b.x && a.y === b.y);
}

function formatCell(cell: GridCoord | null): string {
  return cell ? `(${cell.x}, ${cell.y})` : '—';
}

export class GridView {
  readonly projection: IsoProjection;
  private readonly map: GridMap;
  private readonly overlay: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.Text;
  private hovered: GridCoord | null = null;
  private selected: GridCoord | null = null;

  constructor(scene: Phaser.Scene, map: GridMap) {
    this.map = map;
    const camera = scene.cameras.main;
    this.projection = IsoProjection.centered(map, renderConfig.tile, camera);

    this.drawMap(scene.add.graphics());
    this.overlay = scene.add.graphics();
    // Texto provisório; vai para o painel de debug quando ele existir.
    this.label = scene.add.text(debugLabel.x, debugLabel.y, '', {
      fontFamily: 'monospace',
      fontSize: debugLabel.fontSize,
      color: debugLabel.color,
    });
    this.refresh();

    scene.input.on(Phaser.Input.Events.POINTER_MOVE, (pointer: Phaser.Input.Pointer) => {
      this.setHovered(this.cellAt(pointer));
    });
    scene.input.on(Phaser.Input.Events.GAME_OUT, () => this.setHovered(null));
    scene.input.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
      if (!pointer.leftButtonDown()) return;
      this.selected = this.cellAt(pointer);
      this.refresh();
    });
  }

  get selectedCell(): GridCoord | null {
    return this.selected;
  }

  private cellAt(pointer: Phaser.Input.Pointer): GridCoord | null {
    return this.projection.toGrid({ x: pointer.worldX, y: pointer.worldY }, this.map);
  }

  private setHovered(cell: GridCoord | null): void {
    if (sameCell(cell, this.hovered)) return;
    this.hovered = cell;
    this.refresh();
  }

  private drawMap(g: Phaser.GameObjects.Graphics): void {
    const { map } = this;
    g.lineStyle(gridStyle.lineWidth, hexColor(gridStyle.lineColor));
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const cell = { x, y };
        g.fillStyle(hexColor(this.cellColor(cell)));
        this.traceDiamond(g, cell);
        g.fillPath();
        g.strokePath();
      }
    }
  }

  private cellColor(cell: GridCoord): string {
    const { map } = this;
    if (sameCell(cell, map.nexus)) return gridStyle.nexusColor;
    if (sameCell(cell, map.entrance)) return gridStyle.entranceColor;
    return map.isPath(cell) ? gridStyle.pathColor : gridStyle.freeColor;
  }

  /** Redesenha só a camada de destaque e o texto de debug. */
  private refresh(): void {
    const g = this.overlay;
    g.clear();
    if (this.hovered) {
      const color = this.map.canPlaceTower(this.hovered)
        ? hoverStyle.buildableColor
        : hoverStyle.blockedColor;
      g.fillStyle(hexColor(color), hoverStyle.alpha);
      this.traceDiamond(g, this.hovered);
      g.fillPath();
    }
    if (this.selected) {
      g.lineStyle(selectionStyle.lineWidth, hexColor(selectionStyle.color));
      this.traceDiamond(g, this.selected);
      g.strokePath();
    }
    this.label.setText(`Mouse: ${formatCell(this.hovered)}  Seleção: ${formatCell(this.selected)}`);
  }

  private traceDiamond(g: Phaser.GameObjects.Graphics, cell: GridCoord): void {
    const [top, right, bottom, left] = this.projection.diamond(cell);
    g.beginPath();
    g.moveTo(top.x, top.y);
    g.lineTo(right.x, right.y);
    g.lineTo(bottom.x, bottom.y);
    g.lineTo(left.x, left.y);
    g.closePath();
  }
}
