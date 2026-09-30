/**
 * Greybox da grade: losangos para casas livres, caminho, entrada e núcleo,
 * destaque da casa sob o mouse e seleção por clique.
 */

import Phaser from 'phaser';
import renderConfig from '../../data/render.json';
import type { GridCoord, GridMap } from '../../sim/grid/map';
import { IsoProjection } from '../iso';
import { hexColor } from './color';

const { grid: gridStyle, hover: hoverStyle, selection: selectionStyle } = renderConfig;

function sameCell(a: GridCoord | null, b: GridCoord | null): boolean {
  return a === b || (a !== null && b !== null && a.x === b.x && a.y === b.y);
}

export class GridView {
  readonly projection: IsoProjection;
  private readonly map: GridMap;
  private readonly scene: Phaser.Scene;
  private readonly overlay: Phaser.GameObjects.Graphics;
  private hovered: GridCoord | null = null;
  private selected: GridCoord | null = null;

  constructor(scene: Phaser.Scene, map: GridMap) {
    this.map = map;
    this.scene = scene;
    const camera = scene.cameras.main;
    this.projection = IsoProjection.centered(map, renderConfig.tile, camera);

    this.drawMap(scene.add.graphics());
    this.overlay = scene.add.graphics();
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

  /** Casa sob o mouse (mostrada no painel de debug). */
  get hoveredCell(): GridCoord | null {
    return this.hovered;
  }

  /** Casa sob o ponteiro do Phaser (`null` fora do mapa). */
  cellAt(pointer: Phaser.Input.Pointer): GridCoord | null {
    return this.projection.toGrid({ x: pointer.worldX, y: pointer.worldY }, this.map);
  }

  /**
   * Casa sob um ponto da tela em coordenadas do navegador. Serve para soltar
   * a torre arrastada de um slot da loja (que é HTML, fora do Phaser).
   */
  cellAtClient(clientX: number, clientY: number): GridCoord | null {
    const { canvas } = this.scene.game;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const x = (clientX - rect.left) * (canvas.width / rect.width);
    const y = (clientY - rect.top) * (canvas.height / rect.height);
    const world = this.scene.cameras.main.getWorldPoint(x, y);
    return this.projection.toGrid({ x: world.x, y: world.y }, this.map);
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

  /** Redesenha só a camada de destaque. */
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
