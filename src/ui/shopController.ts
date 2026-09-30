/**
 * Controles da loja: arrastar do slot até uma casa, teclas 1 a 5 (a torre
 * fica presa ao mouse; clique posiciona, Esc cancela), R para rerolar e S
 * para vender a torre selecionada. Tudo vira comando da simulação; o ouro só
 * é cobrado pela simulação, quando a torre é posicionada.
 *
 * Arrastar: soltar numa casa inválida (ou fora do mapa) cancela sem cobrar.
 * Um clique curto no slot também "pega" a torre, como as teclas.
 * Slot cuja compra funde com uma torre do mapa (T11): o clique, o arrasto
 * ou a tecla compram na hora, sem pegar a torre.
 * Slot que precisaria de casa nova com o mapa no limite de torres (T12): não
 * pega a torre, e a torre já presa é cancelada se o limite encher.
 */

import { classData } from '../sim/classes/classData';
import { economyData } from '../sim/economy/economyData';
import type { GridCoord, GridMap } from '../sim/grid/map';
import type { RunState, SimCommand } from '../sim/state';
import { towerData } from '../sim/towers/towerData';
import { buildShopModel, canPlaceAt, shopModelKey, type ShopModel } from './shopModel';
import { ShopPanel } from './shopPanel';

/** Distância, em pixels, que separa um clique curto de um arrasto. */
const DRAG_THRESHOLD_PX = 6;

export interface ShopControllerDeps {
  parent: HTMLElement;
  map: GridMap;
  state: () => Readonly<RunState>;
  enqueue: (command: SimCommand) => void;
  /** Tecla E: pede a evolução do núcleo (o painel do núcleo faz o mesmo pelo botão). */
  evolveNexus: () => void;
  selectedCell: () => GridCoord | null;
  /** Casa sob um ponto da tela (coordenadas do navegador); `null` fora do mapa. */
  cellAtClient: (clientX: number, clientY: number) => GridCoord | null;
}

interface Carry {
  slot: number;
  /** `true` enquanto o botão do mouse ainda está apertado desde o slot. */
  dragging: boolean;
  startX: number;
  startY: number;
  moved: boolean;
}

export class ShopController {
  private readonly deps: ShopControllerDeps;
  private readonly panel: ShopPanel;
  private carry: Carry | null = null;
  private key = '';

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
    const slotKey = /^[1-5]$/.test(event.key) ? Number(event.key) - 1 : -1;
    if (slotKey >= 0) this.pickUp(slotKey, false);
    else if (event.key === 'r' || event.key === 'R') this.reroll();
    else if (event.key === 's' || event.key === 'S') this.sell();
    else if (event.key === 'e' || event.key === 'E') this.deps.evolveNexus();
    else if (event.key === 'Escape') this.cancel();
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    const carry = this.carry;
    if (!carry?.dragging) return;
    if (
      Math.hypot(event.clientX - carry.startX, event.clientY - carry.startY) > DRAG_THRESHOLD_PX
    ) {
      carry.moved = true;
    }
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    const carry = this.carry;
    if (!carry?.dragging) return;
    carry.dragging = false;
    if (!carry.moved) return; // clique curto no slot: a torre segue presa ao mouse
    const cell = this.deps.cellAtClient(event.clientX, event.clientY);
    if (cell && canPlaceAt(this.deps.state(), this.deps.map, cell)) this.buy(carry.slot, cell);
    else this.carry = null; // soltou numa casa inválida: cancela sem cobrar
  };

  constructor(deps: ShopControllerDeps) {
    this.deps = deps;
    this.panel = new ShopPanel(deps.parent, {
      onSlotPointerDown: (slot, event) => {
        if (event.button !== 0) return;
        this.pickUp(slot, true, event);
      },
      onReroll: () => this.reroll(),
      onSell: () => this.sell(),
    });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
  }

  /** Slot preso ao mouse (`null` = nenhum), para a cena desenhar a torre fantasma. */
  get carrying(): { slot: number; towerType: string } | null {
    const towerType = this.carry ? this.deps.state().shop.slots[this.carry.slot] : null;
    return this.carry && typeof towerType === 'string'
      ? { slot: this.carry.slot, towerType }
      : null;
  }

  /** Torre do slot sob o mouse na loja (`null` = nenhuma), para a janela de informações. */
  get hoveredTowerType(): string | null {
    const slot = this.panel.hoveredSlot;
    return slot === null ? null : (this.deps.state().shop.slots[slot] ?? null);
  }

  /** Clique no mapa com a torre presa ao mouse: posiciona se a casa serve. */
  clickCell(cell: GridCoord | null): void {
    const carry = this.carry;
    if (!carry || carry.dragging) return;
    if (cell && canPlaceAt(this.deps.state(), this.deps.map, cell)) this.buy(carry.slot, cell);
    // Casa inválida: a torre continua presa (Esc cancela).
  }

  private pickUp(slot: number, dragging: boolean, event?: PointerEvent): void {
    const model = this.model();
    const entry = model.slots[slot];
    if (!entry || entry.towerType === null || !entry.affordable || entry.blockedByLimit) {
      this.carry = null;
      return;
    }
    if (entry.fuseStar !== null) {
      // A compra funde com uma torre do mapa: acontece na hora, sem posicionar.
      this.deps.enqueue({ type: 'buyTower', slot });
      this.carry = null;
      return;
    }
    this.carry = {
      slot,
      dragging,
      startX: event?.clientX ?? 0,
      startY: event?.clientY ?? 0,
      moved: false,
    };
  }

  private buy(slot: number, cell: GridCoord): void {
    this.deps.enqueue({ type: 'buyTower', slot, x: cell.x, y: cell.y });
    this.carry = null;
  }

  private cancel(): void {
    this.carry = null;
  }

  private reroll(): void {
    if (this.model().canReroll) this.deps.enqueue({ type: 'rerollShop' });
  }

  private sell(): void {
    const target = this.model().sell;
    if (target) this.deps.enqueue({ type: 'sellTower', towerId: target.towerId });
  }

  private model(): ShopModel {
    return buildShopModel(
      this.deps.state(),
      this.deps.selectedCell(),
      economyData,
      towerData,
      classData,
    );
  }

  /** Chame a cada quadro: só refaz o DOM quando algo mudou. */
  update(): void {
    // A torre presa some se o slot foi trocado ou o ouro acabou.
    if (this.carry && !this.carrying) this.carry = null;
    const carryingEntry = this.carry ? this.model().slots[this.carry.slot] : null;
    if (
      this.carry &&
      carryingEntry &&
      (!carryingEntry.affordable || carryingEntry.blockedByLimit)
    ) {
      this.carry = null;
    }
    const model = this.model();
    const carrySlot = this.carry?.slot ?? null;
    const key = shopModelKey(model, carrySlot);
    if (key === this.key) return;
    this.key = key;
    this.panel.render(model, carrySlot);
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.panel.destroy();
  }
}
