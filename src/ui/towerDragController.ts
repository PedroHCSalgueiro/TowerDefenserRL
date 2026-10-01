/**
 * Controles de mover torres (T15): o botão é apertado sobre uma torre do
 * mapa (a cena avisa por `press`), e o arrasto é acompanhado pela janela
 * (`pointermove`/`pointerup`), como o arrasto dos slots da loja. A decisão
 * fica no `TowerDrag`; aqui só entram o DOM e a mensagem de "travada".
 */

import uiConfig from '../data/ui.json';
import type { GridCoord, GridMap } from '../sim/grid/map';
import type { RunState, SimCommand } from '../sim/state';
import { TowerDrag } from './towerDragModel';

const { thresholdPx, lockedMessageMs } = uiConfig.towerDrag;

export interface TowerDragDeps {
  parent: HTMLElement;
  map: GridMap;
  state: () => Readonly<RunState>;
  paused: () => boolean;
  enqueue: (command: SimCommand) => void;
  /** Casa sob um ponto da tela (coordenadas do navegador); `null` fora do mapa. */
  cellAtClient: (clientX: number, clientY: number) => GridCoord | null;
  /** O arrasto começou: a cena seleciona a torre (a seleção acompanha a torre). */
  onStart: (towerId: number) => void;
  /** Tentou arrastar com onda ativa: a cena treme a torre e mostra o cadeado. */
  onLocked: (towerId: number) => void;
}

export class TowerDragController {
  private readonly deps: TowerDragDeps;
  private readonly drag = new TowerDrag();
  private readonly message: HTMLElement;
  private pressedTowerId: number | null = null;
  private hideTimer: number | null = null;

  private readonly onPointerMove = (event: PointerEvent): void => {
    const result = this.drag.pointerMove(
      this.deps.state(),
      event.clientX,
      event.clientY,
      thresholdPx,
    );
    if (result === 'started') this.deps.onStart(this.pressedTowerId!);
    else if (result === 'locked') this.showLocked(this.pressedTowerId!);
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    const cell = this.deps.cellAtClient(event.clientX, event.clientY);
    const command = this.drag.release(this.deps.state(), this.deps.map, cell);
    this.pressedTowerId = null;
    if (command && !this.deps.paused()) this.deps.enqueue(command);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') this.drag.cancel();
  };

  constructor(deps: TowerDragDeps) {
    this.deps = deps;
    this.message = document.createElement('div');
    this.message.className = 'locked-message';
    this.message.textContent = uiConfig.texts.towersLocked;
    this.message.hidden = true;
    deps.parent.appendChild(this.message);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('keydown', this.onKeyDown);
  }

  /** Torre sendo arrastada (para o fantasma e para esconder a janela de informações). */
  get dragging(): { towerId: number; towerType: string } | null {
    return this.drag.dragging;
  }

  /** Botão esquerdo apertado sobre a torre (coordenadas do navegador). */
  press(tower: { id: number; type: string }, clientX: number, clientY: number): void {
    if (this.drag.begin(this.deps.state(), this.deps.paused(), tower, clientX, clientY)) {
      this.pressedTowerId = tower.id;
    }
  }

  /**
   * Mostra a trava: a torre treme, o cadeado aparece e a mensagem também.
   * Vem da tentativa de arrastar ou de um `moveRefused` da simulação.
   */
  showLocked(towerId: number): void {
    this.deps.onLocked(towerId);
    this.message.hidden = false;
    if (this.hideTimer !== null) window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => {
      this.message.hidden = true;
      this.hideTimer = null;
    }, lockedMessageMs);
  }

  /** Chame a cada quadro: cancela o arrasto na pausa, ao chamar onda ou se a torre sumir. */
  update(): void {
    if (this.drag.update(this.deps.state(), this.deps.paused())) this.pressedTowerId = null;
  }

  destroy(): void {
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('keydown', this.onKeyDown);
    if (this.hideTimer !== null) window.clearTimeout(this.hideTimer);
    this.message.remove();
  }
}
