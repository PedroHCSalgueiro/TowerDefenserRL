/**
 * Greybox da grade: losangos para casas livres, caminho, entrada e núcleo,
 * destaque da casa sob o mouse e seleção por clique.
 *
 * Toda posição do mouse passa pela câmera (T25). A casa sob o mouse é
 * recalculada a cada quadro (`update`), porque a câmera anda sem o mouse se
 * mexer (setas, rodinha, borda da tela).
 */

import Phaser from 'phaser';
import renderConfig from '../../data/render.json';
import type { GridCoord, GridMap } from '../../sim/grid/map';
import { isLeftPress } from '../../ui/mouseButtons';
import type { IsoProjection, Point } from '../iso';
import { hexColor } from './color';

const { grid: gridStyle, hover: hoverStyle, selection: selectionStyle } = renderConfig;

/** O que a grade usa da câmera: tela → mundo e se o botão direito está arrastando a tela. */
export interface GridCamera {
  worldAt(point: Point): Point;
  worldAtClient(clientX: number, clientY: number): Point | null;
  readonly panning: boolean;
}

function sameCell(a: GridCoord | null, b: GridCoord | null): boolean {
  return a === b || (a !== null && b !== null && a.x === b.x && a.y === b.y);
}

export class GridView {
  readonly projection: IsoProjection;
  private readonly map: GridMap;
  private readonly scene: Phaser.Scene;
  private readonly camera: GridCamera;
  private readonly overlay: Phaser.GameObjects.Graphics;
  private hovered: GridCoord | null = null;
  private selected: GridCoord | null = null;
  /** O mouse está sobre o canvas (o destaque some quando ele sai). */
  private pointerInside = false;

  constructor(scene: Phaser.Scene, map: GridMap, projection: IsoProjection, camera: GridCamera) {
    this.map = map;
    this.scene = scene;
    this.projection = projection;
    this.camera = camera;

    this.drawMap(scene.add.graphics());
    this.overlay = scene.add.graphics();
    this.refresh();

    scene.input.on(Phaser.Input.Events.POINTER_MOVE, (pointer: Phaser.Input.Pointer) => {
      this.pointerInside = true;
      this.setHovered(this.cellAt(pointer));
    });
    scene.input.on(Phaser.Input.Events.GAME_OUT, () => {
      this.pointerInside = false;
      this.setHovered(null);
    });
    scene.input.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
      if (!isLeftPress(pointer.button, pointer.buttons) || this.camera.panning) return;
      this.selected = this.cellAt(pointer);
      this.refresh();
    });
  }

  /** Chame a cada quadro, depois da câmera: a casa sob o mouse acompanha a câmera. */
  update(): void {
    if (this.pointerInside) this.setHovered(this.cellAt(this.scene.input.activePointer));
  }

  get selectedCell(): GridCoord | null {
    return this.selected;
  }

  /** Seleciona a casa (a seleção acompanha a torre movida, T15). */
  select(cell: GridCoord | null): void {
    if (sameCell(cell, this.selected)) return;
    this.selected = cell && { x: cell.x, y: cell.y };
    this.refresh();
  }

  /** Casa sob o mouse (mostrada no painel de debug). */
  get hoveredCell(): GridCoord | null {
    return this.hovered;
  }

  /** Casa sob o ponteiro do Phaser (`null` fora do mapa), pela câmera. */
  cellAt(pointer: Phaser.Input.Pointer): GridCoord | null {
    return this.projection.toGrid(this.camera.worldAt({ x: pointer.x, y: pointer.y }), this.map);
  }

  /**
   * Casa sob um ponto da tela em coordenadas do navegador. Serve para soltar
   * a torre arrastada de um slot da loja (que é HTML, fora do Phaser).
   */
  cellAtClient(clientX: number, clientY: number): GridCoord | null {
    const world = this.camera.worldAtClient(clientX, clientY);
    return world && this.projection.toGrid(world, this.map);
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
