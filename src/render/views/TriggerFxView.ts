/**
 * Feedback visual dos gatilhos (T16), desenhado a partir dos eventos do
 * quadro e dos modelos de `fx/triggerFx.ts`:
 *
 * - pulso (linha que some em `pulse.durationMs`) da torre que disparou até o
 *   destino, na cor da classe principal dela; no máximo `pulse.maxActive`;
 * - flash curto (contorno) na torre que disparou um gatilho visível;
 * - "Cadeia xN!" sobre a torre que começou a cadeia, com um anel enquanto a
 *   cadeia dura (e `lingerMs` depois); a cadeia do núcleo mostra o rótulo
 *   sobre o núcleo, sem anel;
 * - números de dano agregados por efeito (liga e desliga com N).
 *
 * Um Graphics redesenhado por quadro e textos reaproveitados (um pool do
 * tamanho do limite), para o caos do empilhamento não derrubar o FPS.
 */

import Phaser from 'phaser';
import renderConfig from '../../data/render.json';
import type { SimEvent } from '../../sim/engine/events';
import type { GridMap } from '../../sim/grid/map';
import type { RunState } from '../../sim/state';
import type { TowerData } from '../../sim/towers/towerData';
import {
  ChainModel,
  DamageNumberModel,
  PulseModel,
  flashedTowers,
  type TowerLookup,
} from '../fx/triggerFx';
import type { IsoProjection, Point } from '../iso';
import { hexColor } from './color';
import { towerColor } from './TowerView';

const fx = renderConfig.triggerFx;
const towerStyle = renderConfig.towers;
/** Acima das torres e inimigos (a Layer usa x + y), abaixo da torre presa ao mouse. */
const DEPTH = 900_000;

function textStyle(s: {
  fontSize: number;
  color: string;
  strokeColor: string;
  strokeWidth: number;
}): Phaser.Types.GameObjects.Text.TextStyle {
  return {
    fontSize: `${s.fontSize}px`,
    fontStyle: 'bold',
    color: s.color,
    stroke: s.strokeColor,
    strokeThickness: s.strokeWidth,
  };
}

export class TriggerFxView {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly projection: IsoProjection;
  private readonly data: TowerData;
  private readonly nexus: Point;
  private readonly pulses = new PulseModel(fx.pulse);
  private readonly numbers = new DamageNumberModel(fx.numbers);
  private readonly chains = new ChainModel(fx.chain);
  /** Flash por torre: tempo que falta. */
  private readonly flashes = new Map<number, number>();
  private readonly labelTexts: Phaser.GameObjects.Text[] = [];
  /** O que cada rótulo mostra e quando o número mudou (o texto só é refeito a cada `labelRefreshMs`). */
  private readonly labelShown: { chainId: number; length: number; atMs: number }[] = [];
  private readonly numberTexts: Phaser.GameObjects.Text[] = [];
  /** Id do número preso a cada texto (0 = livre): o texto é feito uma vez só. */
  private readonly numberOwner: number[] = [];
  private readonly towers = new Map<number, { x: number; y: number; color: number }>();
  private readonly lookup: TowerLookup = (id) => this.towers.get(id) ?? null;
  private timeMs = 0;

  constructor(scene: Phaser.Scene, projection: IsoProjection, map: GridMap, data: TowerData) {
    this.projection = projection;
    this.data = data;
    this.nexus = projection.toScreen(map.nexus);
    this.g = scene.add.graphics().setDepth(DEPTH);
    for (let i = 0; i < fx.chain.maxLabels; i++) {
      this.labelTexts.push(
        scene.add
          .text(0, 0, '', textStyle(fx.chain))
          .setOrigin(0.5, 1)
          .setDepth(DEPTH + 2)
          .setVisible(false),
      );
      this.labelShown.push({ chainId: 0, length: 0, atMs: 0 });
    }
    for (let i = 0; i < fx.numbers.maxActive; i++) {
      this.numberTexts.push(
        scene.add
          .text(0, 0, '', textStyle(fx.numbers))
          .setOrigin(0.5, 1)
          .setDepth(DEPTH + 1)
          .setVisible(false),
      );
      this.numberOwner.push(0);
    }
  }

  /** Liga ou desliga os números de dano (tecla N); devolve o estado novo. */
  toggleNumbers(): boolean {
    return this.numbers.toggle();
  }

  handleEvents(state: Readonly<RunState>, events: readonly SimEvent[]): void {
    this.syncTowers(state);
    if (events.length === 0) return;
    this.pulses.add(events, this.lookup);
    this.numbers.add(events);
    this.chains.add(events);
    for (const id of flashedTowers(events)) this.flashes.set(id, fx.flash.durationMs);
  }

  draw(state: Readonly<RunState>, deltaMs: number): void {
    this.timeMs += deltaMs;
    const liveIds = new Set<number>();
    for (const chain of state.triggers.chains) liveIds.add(chain.id);
    this.chains.advance(deltaMs, liveIds);

    const g = this.g;
    g.clear();
    this.drawPulses(g);
    this.drawFlashes(g, deltaMs);
    this.drawChains(g);
    this.drawNumbers();
    this.pulses.advance(deltaMs);
    this.numbers.advance(deltaMs);
  }

  /** Casa e cor de cada torre (para os pulsos; as torres podem ter se movido). */
  private syncTowers(state: Readonly<RunState>): void {
    this.towers.clear();
    for (const tower of state.towers) {
      this.towers.set(tower.id, {
        x: tower.x,
        y: tower.y,
        color: towerColor(this.data, tower.type),
      });
    }
  }

  private drawPulses(g: Phaser.GameObjects.Graphics): void {
    const { lineWidth, alpha, durationMs } = fx.pulse;
    for (const pulse of this.pulses.pulses) {
      const a = this.projection.toScreen(pulse.from);
      const b = this.projection.toScreen(pulse.to);
      g.lineStyle(lineWidth, pulse.color, alpha * Math.max(0, pulse.msLeft / durationMs));
      g.lineBetween(a.x, a.y, b.x, b.y);
    }
  }

  /** Contorno claro em volta do bloco da torre, sumindo. */
  private drawFlashes(g: Phaser.GameObjects.Graphics, deltaMs: number): void {
    const { durationMs, color, lineWidth, alpha, padPx } = fx.flash;
    const width = towerStyle.width + padPx * 2;
    const height = towerStyle.height + padPx * 2;
    for (const [id, msLeft] of this.flashes) {
      const tower = this.towers.get(id);
      if (!tower || msLeft <= 0) {
        this.flashes.delete(id);
        continue;
      }
      const p = this.projection.toScreen(tower);
      g.lineStyle(lineWidth, hexColor(color), alpha * (msLeft / durationMs));
      g.strokeRect(p.x - width / 2, p.y - height + padPx, width, height);
      this.flashes.set(id, msLeft - deltaMs);
    }
  }

  private drawChains(g: Phaser.GameObjects.Graphics): void {
    const { chain } = fx;
    const { ring } = chain;
    const labels = this.chains.labels();
    const headTop = towerStyle.height + towerStyle.outlineWidth * 2 + towerStyle.stars.fontSize;
    for (let i = 0; i < this.labelTexts.length; i++) {
      const text = this.labelTexts[i]!;
      const label = labels[i];
      const tower =
        label && label.originTowerId !== null ? this.towers.get(label.originTowerId) : null;
      if (!label || (label.originTowerId !== null && !tower)) {
        text.setVisible(false);
        continue;
      }
      let anchor: Point;
      if (tower) {
        const p = this.projection.toScreen(tower);
        anchor = { x: p.x, y: p.y - headTop - chain.offsetY };
        // Anel no pé da torre: pulsa enquanto a cadeia está viva.
        const pulse = label.alive
          ? 1 + ring.pulseScale * Math.sin((this.timeMs / ring.pulseMs) * Math.PI * 2)
          : 1;
        const size = this.projection.circleSize(ring.radius * pulse);
        g.lineStyle(ring.lineWidth, hexColor(ring.color), ring.alpha);
        g.strokeEllipse(p.x, p.y, size.width, size.height);
      } else {
        anchor = { x: this.nexus.x, y: this.nexus.y - chain.nexusOffsetY };
      }
      // Na avalanche o número sobe a cada quadro: refazer o texto custa caro.
      const shown = this.labelShown[i]!;
      if (
        shown.chainId !== label.chainId ||
        (shown.length !== label.length && this.timeMs - shown.atMs >= chain.labelRefreshMs)
      ) {
        shown.chainId = label.chainId;
        shown.length = label.length;
        shown.atMs = this.timeMs;
        text.setText(chain.text.replace('{n}', String(label.length)));
      }
      text
        .setPosition(anchor.x, anchor.y)
        .setAlpha(label.alive ? 1 : 0.6)
        .setVisible(true);
    }
  }

  /** Cada número fica preso a um texto do pool enquanto vive: o texto é feito uma vez só. */
  private drawNumbers(): void {
    const { durationMs, risePx } = fx.numbers;
    const owner = this.numberOwner;
    const alive = new Set<number>();
    for (const n of this.numbers.numbers) alive.add(n.id);
    for (let i = 0; i < owner.length; i++) {
      if (owner[i] !== 0 && !alive.has(owner[i]!)) {
        owner[i] = 0;
        this.numberTexts[i]!.setVisible(false);
      }
    }
    for (const n of this.numbers.numbers) {
      let slot = owner.indexOf(n.id);
      if (slot < 0) {
        slot = owner.indexOf(0);
        if (slot < 0) continue;
        owner[slot] = n.id;
        this.numberTexts[slot]!.setText(String(Math.round(n.value))).setVisible(true);
      }
      const life = Math.max(0, n.msLeft / durationMs);
      const p = this.projection.toScreen(n.at);
      this.numberTexts[slot]!.setPosition(p.x, p.y - risePx * (1 - life)).setAlpha(life);
    }
  }

  destroy(): void {
    this.g.destroy();
    for (const t of [...this.labelTexts, ...this.numberTexts]) t.destroy();
  }
}
