/**
 * Controles da câmera (T25): rodinha (zoom suave no ponto do mouse), botão
 * direito arrastado (move a tela), setas, borda da tela com uma torre na mão
 * e botão do meio (volta ao padrão). A matemática fica em `camera.ts`; aqui
 * entram os eventos do navegador e a câmera do Phaser.
 *
 * A câmera é estado da renderização: não entra no save e não muda a
 * simulação. Ela funciona com o jogo pausado (P), mas não com a ajuda, as
 * cartas de recompensa ou a tela de fim (elas cobrem o mapa).
 *
 * Botão direito no meio de um arrasto de torre (esquerdo apertado): cancela o
 * arrasto, como o Esc, e não move a tela. Clique curto do direito: cancela a
 * torre presa ao mouse (teclas 1 a 5).
 */

import Phaser from 'phaser';
import renderConfig from '../data/render.json';
import {
  CameraModel,
  EdgePan,
  PanGesture,
  arrowDirection,
  clientToCanvas,
  wheelNotches,
  type CameraConfig,
  type CameraView,
  type Rect,
} from './camera';
import type { Point, Size } from './iso';

const config: CameraConfig = renderConfig.camera;
const ARROWS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);
const LEFT_BUTTON_MASK = 1;

export interface CameraControllerDeps {
  scene: Phaser.Scene;
  /** Retângulo do mapa no mundo (`mapWorldBounds`). */
  bounds: Rect;
  /** Elemento que recebe o menu de contexto desligado (o jogo inteiro, com a interface). */
  parent: HTMLElement;
  /** Ajuda, cartas de recompensa ou fim da run cobrindo o mapa: a câmera não mexe. */
  blocked: () => boolean;
  /** Torre na mão (arrasto do mapa, da loja ou teclas 1 a 5): liga a borda da tela. */
  holdingTower: () => boolean;
  /** Botão direito com o esquerdo apertado: cancela o arrasto de torre (mover ou da loja). */
  cancelDrag: () => void;
  /** Clique curto do botão direito no mapa: cancela a torre presa ao mouse. */
  onRightClick: () => void;
}

export class CameraController {
  private readonly deps: CameraControllerDeps;
  private readonly model: CameraModel;
  private readonly canvas: HTMLCanvasElement;
  private readonly viewport: Size;
  private readonly gesture = new PanGesture();
  private readonly edge = new EdgePan();
  private readonly heldArrows = new Set<string>();
  /** Último ponto do mouse, em pixels do canvas (`null` antes do primeiro movimento). */
  private pointer: Point | null = null;

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    if (this.deps.blocked()) return;
    const point = this.canvasPoint(event);
    if (!point) return;
    this.model.wheel(wheelNotches(event.deltaY, event.deltaMode, config.zoom), point);
  };

  private readonly onMouseDown = (event: MouseEvent): void => {
    const onMap = event.target === this.canvas;
    if (event.button === 1 && onMap) {
      event.preventDefault(); // sem a rolagem automática do navegador
      if (!this.deps.blocked()) this.model.reset();
    } else if (event.button === 2) {
      // Com o esquerdo apertado, o direito só cancela o arrasto de torre.
      if ((event.buttons & LEFT_BUTTON_MASK) !== 0) {
        this.deps.cancelDrag();
        return;
      }
      const point = this.canvasPoint(event);
      if (onMap && point && !this.deps.blocked()) this.gesture.press(point);
    }
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    const point = this.canvasPoint(event);
    if (!point) return;
    this.pointer = point;
    if (!this.gesture.active) return;
    const delta = this.gesture.move(point, config.dragThresholdPx);
    this.model.dragBy(delta.x, delta.y);
  };

  private readonly onMouseUp = (event: MouseEvent): void => {
    if (event.button !== 2) return;
    if (this.gesture.release() === 'click' && !this.deps.blocked()) this.deps.onRightClick();
  };

  private readonly onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!ARROWS.has(event.key) || isTyping(event.target)) return;
    event.preventDefault(); // a página não rola
    this.heldArrows.add(event.key);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.heldArrows.delete(event.key);
  };

  private readonly onBlur = (): void => {
    this.heldArrows.clear();
    this.gesture.cancel();
  };

  constructor(deps: CameraControllerDeps) {
    this.deps = deps;
    const camera = deps.scene.cameras.main;
    this.viewport = { width: camera.width, height: camera.height };
    this.model = new CameraModel(config, this.viewport, deps.bounds);
    this.canvas = deps.scene.game.canvas;
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    deps.parent.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    this.apply();
  }

  get view(): CameraView {
    return this.model.view;
  }

  /** Botão direito apertado no mapa: enquanto isso, o esquerdo é ignorado. */
  get panning(): boolean {
    return this.gesture.active;
  }

  /** Ponto do mundo sob o ponto do canvas (pixels do canvas, como `pointer.x`). */
  worldAt(point: Point): Point {
    return this.model.screenToWorld(point);
  }

  /** Ponto do mundo sob o ponto do navegador (`clientX`, `clientY`); `null` sem canvas visível. */
  worldAtClient(clientX: number, clientY: number): Point | null {
    const point = this.clientPoint(clientX, clientY);
    return point && this.model.screenToWorld(point);
  }

  /** Chame a cada quadro com o tempo real (a câmera anda com o jogo pausado). */
  update(deltaMs: number): void {
    const blocked = this.deps.blocked();
    if (blocked) this.gesture.cancel();
    const edgeDir = this.edge.update(
      !blocked && this.deps.holdingTower(),
      this.pointer,
      this.viewport,
      config.edgePan.bandPx,
    );
    if (!blocked) {
      this.model.move(arrowDirection(this.heldArrows), config.keyPanSpeedPx, deltaMs);
      this.model.move(edgeDir, config.edgePan.speedPx, deltaMs);
    }
    this.model.update(deltaMs);
    this.apply();
  }

  /** Leva a vista para a câmera do Phaser. */
  private apply(): void {
    const { zoom, centerX, centerY } = this.model.view;
    this.deps.scene.cameras.main.setZoom(zoom).centerOn(centerX, centerY);
  }

  private canvasPoint(event: MouseEvent): Point | null {
    return this.clientPoint(event.clientX, event.clientY);
  }

  private clientPoint(clientX: number, clientY: number): Point | null {
    const rect = this.canvas.getBoundingClientRect();
    return clientToCanvas(
      clientX,
      clientY,
      { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      { width: this.canvas.width, height: this.canvas.height },
    );
  }

  destroy(): void {
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.deps.parent.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }
}

/** Foco num campo de texto (painel de debug): as setas são do campo. */
function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}
