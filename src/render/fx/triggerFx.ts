/**
 * Modelos do feedback visual dos gatilhos (T16), sem Phaser, para testar
 * direto. Tudo em coordenadas da grade; a view converte para a tela.
 *
 * - **Pulsos:** uma linha da torre que disparou o gatilho até o destino
 *   (vizinha ativada, ponto da explosão, alvos do raio, linha perfurante,
 *   vizinha copiada). No máximo `maxActive` ao mesmo tempo, as mais recentes.
 * - **Flash:** a torre que disparou um gatilho com efeito visível pisca.
 * - **Números:** a soma do dano de cada explosão, raio ou linha de gatilho,
 *   só acima de `minDamage`, no máximo `maxActive` na tela.
 * - **Cadeias:** "Cadeia xN!" sobre a torre que começou (ou o núcleo), para
 *   as cadeias com mais de `minLength` gatilhos visíveis; no máximo
 *   `maxLabels`, as maiores, uma por origem.
 */

import type { SimEvent } from '../../sim/engine/events';

export interface GridPoint {
  x: number;
  y: number;
}

/** O que os modelos precisam saber de uma torre (pelo id): casa e cor. */
export interface TowerLookup {
  (towerId: number): { x: number; y: number; color: number } | null;
}

export interface Pulse {
  from: GridPoint;
  to: GridPoint;
  color: number;
  msLeft: number;
}

export interface PulseConfig {
  durationMs: number;
  maxActive: number;
}

/** Os segmentos de linha de um evento de gatilho (vazio se o evento não desenha linha). */
function segmentsOf(event: SimEvent, towerAt: TowerLookup): Omit<Pulse, 'msLeft'>[] {
  switch (event.type) {
    case 'towerActivated': {
      if (event.sourceTowerId === event.towerId) return [];
      const from = towerAt(event.sourceTowerId);
      const to = towerAt(event.towerId);
      return from && to ? [{ from, to, color: from.color }] : [];
    }
    case 'areaExploded': {
      if (!event.trigger) return [];
      const from = towerAt(event.towerId);
      return from ? [{ from, to: { x: event.x, y: event.y }, color: from.color }] : [];
    }
    case 'lightningStruck': {
      const tower = towerAt(event.towerId);
      if (!tower) return [];
      const list: Omit<Pulse, 'msLeft'>[] = [];
      let from: GridPoint = tower;
      for (const point of event.points) {
        list.push({ from, to: point, color: tower.color });
        from = point;
      }
      return list;
    }
    case 'lineFired': {
      const tower = towerAt(event.towerId);
      if (!tower) return [];
      return [{ from: tower, to: { x: event.toX, y: event.toY }, color: tower.color }];
    }
    case 'triggerFired': {
      if (event.copiedFromTowerId === null) return [];
      const from = towerAt(event.copiedFromTowerId);
      const to = towerAt(event.towerId);
      return from && to ? [{ from, to, color: to.color }] : [];
    }
    default:
      return [];
  }
}

/**
 * Pulsos ativos. `add` lê os eventos do quadro de trás para a frente e só
 * monta os `maxActive` segmentos mais recentes: numa avalanche chegam
 * milhares de eventos por quadro.
 */
export class PulseModel {
  pulses: Pulse[] = [];
  private readonly config: PulseConfig;

  constructor(config: PulseConfig) {
    this.config = config;
  }

  add(events: readonly SimEvent[], towerAt: TowerLookup): void {
    const { maxActive, durationMs } = this.config;
    const fresh: Pulse[] = [];
    for (let i = events.length - 1; i >= 0 && fresh.length < maxActive; i--) {
      const segments = segmentsOf(events[i]!, towerAt);
      for (let j = segments.length - 1; j >= 0 && fresh.length < maxActive; j--) {
        fresh.push({ ...segments[j]!, msLeft: durationMs });
      }
    }
    if (fresh.length === 0) return;
    fresh.reverse();
    const kept = Math.max(0, maxActive - fresh.length);
    this.pulses = [...this.pulses.slice(this.pulses.length - kept), ...fresh];
  }

  /** Avança o tempo e tira os pulsos que acabaram. */
  advance(deltaMs: number): void {
    for (const pulse of this.pulses) pulse.msLeft -= deltaMs;
    this.pulses = this.pulses.filter((p) => p.msLeft > 0);
  }
}

/** Torres que disparam um gatilho visível no quadro (cada uma uma vez, na ordem). */
export function flashedTowers(events: readonly SimEvent[]): number[] {
  const seen = new Set<number>();
  for (const event of events) {
    if (event.type === 'triggerFired' && event.visible) seen.add(event.towerId);
  }
  return [...seen];
}

export interface DamageNumber {
  /** Id crescente: a view prende cada número a um texto só (não refaz o texto). */
  id: number;
  at: GridPoint;
  value: number;
  msLeft: number;
}

export interface NumberConfig {
  /** Só aparece se a soma passar deste valor. */
  minDamage: number;
  maxActive: number;
  durationMs: number;
}

/** Soma do dano de um efeito de gatilho (0 = não é efeito de gatilho com número). */
function damageOf(event: SimEvent): number {
  switch (event.type) {
    case 'areaExploded':
      return event.trigger ? event.damage : 0;
    case 'lightningStruck':
      return event.points.length > 0 ? event.damage : 0;
    case 'lineFired':
      return event.damage;
    default:
      return 0;
  }
}

/** Ponto do número: a explosão, o primeiro alvo do raio ou o meio da linha. */
function pointOf(event: SimEvent): GridPoint {
  switch (event.type) {
    case 'areaExploded':
      return { x: event.x, y: event.y };
    case 'lightningStruck':
      return event.points[0]!;
    case 'lineFired':
      return { x: (event.x + event.toX) / 2, y: (event.y + event.toY) / 2 };
    default:
      return { x: 0, y: 0 };
  }
}

/**
 * Números de dano agregados por efeito. Os mais novos ficam: acima de
 * `maxActive`, os mais antigos saem. Desligado (tecla N), nada entra e os
 * da tela somem.
 */
export class DamageNumberModel {
  numbers: DamageNumber[] = [];
  enabled = true;
  private readonly config: NumberConfig;
  private nextId = 1;

  constructor(config: NumberConfig) {
    this.config = config;
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    if (!this.enabled) this.numbers = [];
    return this.enabled;
  }

  add(events: readonly SimEvent[]): void {
    if (!this.enabled) return;
    const { maxActive, minDamage, durationMs } = this.config;
    const fresh: DamageNumber[] = [];
    for (let i = events.length - 1; i >= 0 && fresh.length < maxActive; i--) {
      const event = events[i]!;
      const value = damageOf(event);
      if (value > minDamage) fresh.push({ id: 0, at: pointOf(event), value, msLeft: durationMs });
    }
    if (fresh.length === 0) return;
    fresh.reverse();
    for (const n of fresh) n.id = this.nextId++;
    const kept = Math.max(0, maxActive - fresh.length);
    this.numbers = [...this.numbers.slice(this.numbers.length - kept), ...fresh];
  }

  advance(deltaMs: number): void {
    for (const n of this.numbers) n.msLeft -= deltaMs;
    this.numbers = this.numbers.filter((n) => n.msLeft > 0);
  }
}

export interface ChainConfig {
  /** O rótulo aparece quando a cadeia passa deste número de gatilhos visíveis. */
  minLength: number;
  maxLabels: number;
  /** Quanto o rótulo e o anel ficam depois que a cadeia termina. */
  lingerMs: number;
}

export interface ChainLabel {
  chainId: number;
  /** Torre que começou a cadeia; `null` = núcleo (sem anel). */
  originTowerId: number | null;
  length: number;
  /** A cadeia ainda está viva (fila ou projétil no ar). */
  alive: boolean;
}

interface TrackedChain {
  originTowerId: number | null;
  length: number;
  /** Tempo desde que a cadeia terminou (0 enquanto está viva). */
  deadMs: number;
}

/**
 * Acompanha as cadeias que passam de `minLength`. A cadeia está viva enquanto
 * aparece em `RunState.triggers.chains`; depois disso fica `lingerMs`.
 */
export class ChainModel {
  private readonly config: ChainConfig;
  private readonly chains = new Map<number, TrackedChain>();

  constructor(config: ChainConfig) {
    this.config = config;
  }

  add(events: readonly SimEvent[]): void {
    for (const event of events) {
      if (event.type !== 'triggerFired' || !event.visible) continue;
      if (event.chainLength <= this.config.minLength) continue;
      const tracked = this.chains.get(event.chainId);
      if (tracked) {
        tracked.length = event.chainLength;
        tracked.deadMs = 0;
      } else {
        this.chains.set(event.chainId, {
          originTowerId: event.originTowerId,
          length: event.chainLength,
          deadMs: 0,
        });
      }
    }
  }

  /** `liveIds`: ids em `RunState.triggers.chains` agora. */
  advance(deltaMs: number, liveIds: ReadonlySet<number>): void {
    for (const [id, chain] of this.chains) {
      if (liveIds.has(id)) {
        chain.deadMs = 0;
        continue;
      }
      chain.deadMs += deltaMs;
      if (chain.deadMs > this.config.lingerMs) this.chains.delete(id);
    }
  }

  /** Os rótulos a mostrar: as maiores cadeias, uma por origem, no máximo `maxLabels`. */
  labels(): ChainLabel[] {
    const best = new Map<number | null, ChainLabel>();
    for (const [chainId, chain] of this.chains) {
      const current = best.get(chain.originTowerId);
      if (
        !current ||
        chain.length > current.length ||
        (chain.length === current.length && chainId > current.chainId)
      ) {
        best.set(chain.originTowerId, {
          chainId,
          originTowerId: chain.originTowerId,
          length: chain.length,
          alive: chain.deadMs === 0,
        });
      }
    }
    return [...best.values()]
      .sort((a, b) => b.length - a.length || b.chainId - a.chainId)
      .slice(0, this.config.maxLabels);
  }
}
