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
 * arrasto, como o Esc, e não move a tela. Clique curto do direito no mapa:
 * cancela a torre presa ao mouse (teclas 1 a 5).
 *
 * Usa eventos de ponteiro, não de mouse: um `preventDefault` no `pointerdown`
 * (como o do slot da loja) corta os eventos de mouse até soltar. Um 2º botão
 * apertado ou solto com outro já apertado só chega como `pointermove`.
 */

import Phaser from 'phaser';
import renderConfig from '../data/render.json';
import { MouseButton, chordChange, isButtonDown } from '../ui/mouseButtons';
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
  /**
   * O botão direito foi apertado no jogo: o próximo menu de contexto é
   * bloqueado mesmo fora dele (no Windows o menu sai ao soltar, onde o mouse estiver).
   */
  private suppressMenu = false;
  /** Última vista levada para o Phaser (a câmera só é mexida quando ela muda). */
  private applied: CameraView | null = null;

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    if (this.deps.blocked()) return;
    const point = this.canvasPoint(event);
    if (!point) return;
    this.model.wheel(wheelNotches(event.deltaY, event.deltaMode, config.zoom), point);
  };

  /** Primeiro botão apertado (os seguintes chegam no `pointermove`). */
  private readonly onPointerDown = (event: PointerEvent): void => {
    this.suppressMenu = false;
    this.track(event);
    const onMap = event.target === this.canvas;
    // O Phaser bloqueia o foco no aperto do canvas: sem isto, as setas e os
    // atalhos seguiriam no campo do painel de debug usado por último.
    if (onMap && document.activeElement instanceof HTMLElement) document.activeElement.blur();
    this.pressed(event.button, event, onMap);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    this.track(event);
    const change = chordChange(event.button, event.buttons);
    if (change?.pressed) this.pressed(change.button, event, event.target === this.canvas);
    if (!this.gesture.active) return;
    if (!isButtonDown(event.buttons, MouseButton.right)) {
      this.releaseGesture();
      return;
    }
    const point = this.canvasPoint(event);
    if (!point) return;
    const delta = this.gesture.move(point, config.dragThresholdPx);
    this.model.dragBy(delta.x, delta.y);
  };

  /** Todos os botões soltos. */
  private readonly onPointerUp = (): void => {
    this.releaseGesture();
  };

  private readonly onPointerCancel = (): void => {
    this.gesture.cancel();
  };

  private readonly onContextMenu = (event: MouseEvent): void => {
    const inGame = event.target instanceof Node && this.deps.parent.contains(event.target);
    if (inGame || this.suppressMenu) event.preventDefault();
    this.suppressMenu = false;
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (!ARROWS.has(event.key) || isTyping(event.target)) return;
    event.preventDefault(); // a página não rola
    this.heldArrows.add(event.key);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    // No macOS, com o Cmd apertado, o keyup das outras teclas não chega.
    if (event.key === 'Meta') this.heldArrows.clear();
    else this.heldArrows.delete(event.key);
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
    window.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerCancel);
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

  /** Um botão foi apertado (sozinho ou com outro já apertado). */
  private pressed(button: number, event: PointerEvent, onMap: boolean): void {
    if (button === MouseButton.middle) {
      if (onMap && !this.deps.blocked()) this.model.reset();
    } else if (button === MouseButton.right) {
      if (this.deps.parent.contains(event.target as Node)) this.suppressMenu = true;
      // Com o esquerdo apertado, o direito só cancela o arrasto de torre.
      if (isButtonDown(event.buttons, MouseButton.left)) {
        this.deps.cancelDrag();
        return;
      }
      const point = this.canvasPoint(event);
      if (onMap && point && !this.deps.blocked()) this.gesture.press(point);
    }
  }

  private releaseGesture(): void {
    if (this.gesture.release() === 'click' && !this.deps.blocked()) this.deps.onRightClick();
  }

  /** Guarda a posição do mouse (para a borda da tela). */
  private track(event: PointerEvent): void {
    const point = this.canvasPoint(event);
    if (point) this.pointer = point;
  }

  /** Leva a vista para a câmera do Phaser, se ela mudou. */
  private apply(): void {
    const view = this.model.view;
    if (view === this.applied) return;
    this.applied = view;
    this.deps.scene.cameras.main.setZoom(view.zoom).centerOn(view.centerX, view.centerY);
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
    window.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerCancel);
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
