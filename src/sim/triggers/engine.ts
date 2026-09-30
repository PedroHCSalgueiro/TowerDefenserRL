/**
 * Motor de gatilhos, o último sistema do tick.
 *
 * 1. **Fatos:** lê os eventos do tick (`ctx.tickEvents`), na ordem em que
 *    foram emitidos: `towerFired` (tiro normal ou de ativação),
 *    `towerActivated` e `enemyKilled`. Cada fato vira entradas na fila para
 *    as torres cujo "quando" ele cumpre; se servir para várias torres, elas
 *    entram em ordem de id. Contadores "a cada N" andam aqui.
 * 2. **Fila FIFO** (`RunState.triggers.queue`): a entrada da frente executa o
 *    "o quê" da torre, e os fatos gerados por essa execução entram no fim,
 *    com profundidade + 1.
 * 3. **Limites:** o tick para quando a entrada da frente passa de
 *    `maxChainDepthPerTick` ou quando `maxActivationsPerTick` entradas já
 *    rodaram. O resto fica na fila, na mesma ordem, e vai primeiro no tick
 *    seguinte (com a profundidade do tick zerada). Acima de `maxQueueSize`,
 *    entradas novas são descartadas (as mais novas) e contadas.
 *
 * Cada torre usa o gatilho da estrela dela (`Tower.star`). A explosão de uma
 * execução do Carrasco ★3 é uma entrada própria da fila (`blastRadius` > 0):
 * conta no orçamento e na profundidade, como qualquer gatilho.
 *
 * Bônus de classe (`RunState.classes`, lidos por torre a cada tick): a
 * Mecânica reduz o N dos "a cada N"; a Arcana amplia a vizinhança de quem a
 * tem; a Sombria multiplica o peso das mortes para as torres Sombria.
 *
 * Não existe loop infinito: toda entrada vem de um tiro normal (limitado pela
 * cadência), de uma ativação (no máximo 1 por `activationCooldownSeconds`
 * por torre) ou de uma morte (cada inimigo morre uma vez). Os tiros extras do
 * disparo múltiplo não contam como tiro. Não há sorteio: empates vão para o
 * menor id.
 */

import { killWeight, neighborhoodRadius, reducedTriggerCount } from '../classes/bonuses';
import { classData, type ClassData } from '../classes/classData';
import type { EnemyData } from '../enemies/enemyData';
import type { SimEventOf } from '../engine/events';
import type { System, TickContext } from '../engine/simulation';
import type { SpatialIndex } from '../spatial/spatialIndex';
import type { Tower } from '../towers/placement';
import type { TargetScores } from '../towers/targeting';
import { findTowerTarget } from '../towers/systems';
import { clampStar } from '../towers/stars';
import { getTowerType, type TowerData, type TowerType } from '../towers/towerData';
import { resolveCopies, runBlast, runEffect, type EffectEnv } from './effects';
import { triggerAt, type EffectKind, type TriggerRules, type TriggerStar } from './triggerData';
import type { PendingTrigger, TriggerState, TriggerTickStats } from './triggerState';

export interface TriggerSystemDeps {
  readonly index: SpatialIndex;
  readonly enemies: EnemyData;
  readonly towers: TowerData;
  /** Padrão: os dados de `classes.json`. */
  readonly classes?: ClassData;
  readonly scores: TargetScores;
  readonly ticksPerSecond: number;
}

/** Torre com gatilho, já com o tipo e a estrela resolvidos para o tick. */
interface Armed {
  tower: Tower;
  type: TowerType;
  star: TriggerStar;
  /** Contagem do "a cada N" neste tick, já com o desconto da Mecânica (0 = sem contagem). */
  count: number;
  /** Raio da vizinhança quadrada dada pela Arcana (0 = vizinhança dos dados). */
  neighborRadius: number;
}

/**
 * `b` é vizinha de `a`? Com bônus de raio, é o quadrado de lado 2·raio+1 em
 * volta de `a`; sem ele, a vizinhança dos dados (4 lados ou 8 com diagonais).
 */
function isNeighbor(a: Tower, b: Tower, neighborhood: 4 | 8, radius: number): boolean {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  if (radius > 0) return dx + dy > 0 && Math.max(dx, dy) <= radius;
  return neighborhood === 4 ? dx + dy === 1 : Math.max(dx, dy) === 1;
}

function inRange(armed: Armed, x: number, y: number): boolean {
  const dx = x - armed.tower.x;
  const dy = y - armed.tower.y;
  return dx * dx + dy * dy <= armed.type.range * armed.type.range;
}

class TriggerEngine implements EffectEnv {
  readonly index: SpatialIndex;
  readonly enemies: EnemyData;
  readonly towers: TowerData;
  readonly classes: ClassData;
  readonly scores: TargetScores;
  readonly activationCooldownTicks: number;
  readonly unlimitedLineLength: number;
  private readonly rules: TriggerRules;

  // Montados a cada tick a partir do estado (nada disso vai para o save).
  private tick: TickContext | null = null;
  private sorted: Tower[] = [];
  private readonly armedById = new Map<number, Armed>();
  private readonly towerById = new Map<number, Tower>();
  private armed: Armed[] = [];
  /** Torres com gatilho que escutam abates ("morre no alcance", "a cada N abates", "vizinha abate"). */
  private killListeners: Armed[] = [];
  private readonly neighborCache = new Map<number, Tower[]>();
  private readonly reachCache = new Map<number, Tower[]>();

  private queue: PendingTrigger[] = [];
  private head = 0;
  private stats!: TriggerTickStats;
  private state!: TriggerState;

  constructor(deps: TriggerSystemDeps) {
    this.index = deps.index;
    this.enemies = deps.enemies;
    this.towers = deps.towers;
    this.classes = deps.classes ?? classData;
    this.scores = deps.scores;
    this.rules = deps.towers.triggers;
    this.activationCooldownTicks = Math.max(
      1,
      Math.round(this.rules.activationCooldownSeconds * deps.ticksPerSecond),
    );
    this.unlimitedLineLength = this.rules.unlimitedLineLength;
  }

  get ctx(): TickContext {
    return this.tick!;
  }

  neighborsOf(tower: Tower): readonly Tower[] {
    let list = this.neighborCache.get(tower.id);
    if (!list) {
      const radius = this.armedById.get(tower.id)?.neighborRadius ?? this.radiusOf(tower);
      list = this.sorted.filter(
        (t) => t !== tower && isNeighbor(tower, t, this.rules.neighborhood, radius),
      );
      this.neighborCache.set(tower.id, list);
    }
    return list;
  }

  reachNeighborsOf(tower: Tower, reach: number): readonly Tower[] {
    const key = tower.id * 16 + reach;
    let list = this.reachCache.get(key);
    if (!list) {
      const radius = this.armedById.get(tower.id)?.neighborRadius ?? this.radiusOf(tower);
      list = this.sorted.filter((t) => {
        if (t === tower) return false;
        if (isNeighbor(tower, t, this.rules.neighborhood, radius)) return true;
        const dx = Math.abs(tower.x - t.x);
        const dy = Math.abs(tower.y - t.y);
        return (dx === 0 || dy === 0) && dx + dy <= reach;
      });
      this.reachCache.set(key, list);
    }
    return list;
  }

  enqueueBlast(
    tower: Tower,
    x: number,
    y: number,
    radius: number,
    percent: number,
    entry: PendingTrigger,
  ): void {
    const armed = this.armedById.get(tower.id);
    if (!armed) return;
    this.enqueue(
      armed,
      tower.id,
      1,
      entry.depth + 1,
      entry.tickDepth + 1,
      { x, y },
      radius,
      percent,
    );
  }

  private radiusOf(tower: Tower): number {
    const type = getTowerType(this.towers, tower.type);
    return neighborhoodRadius(this.classes, this.ctx.state, type);
  }

  run(ctx: TickContext): void {
    const triggers = ctx.state.triggers;
    const stats = triggers.lastTick;
    stats.fired = 0;
    stats.maxDepth = 0;
    stats.deferred = 0;
    stats.dropped = 0;

    this.prepare(ctx);
    if (this.armed.length === 0 && triggers.queue.length === 0) return;

    this.tick = ctx;
    this.state = triggers;
    this.stats = stats;
    this.queue = triggers.queue;
    this.head = 0;

    // Sobras do tick anterior já estão na frente; os fatos deste tick entram atrás.
    let cursor = this.convertFacts(0, 1, 1);
    let processed = 0;
    while (this.head < this.queue.length) {
      const entry = this.queue[this.head]!;
      if (entry.tickDepth > this.rules.maxChainDepthPerTick) break;
      if (processed >= this.rules.maxActivationsPerTick) break;
      this.head++;
      processed++;
      this.execute(entry);
      cursor = this.convertFacts(cursor, entry.depth + 1, entry.tickDepth + 1);
    }

    if (this.head > 0) this.queue.splice(0, this.head);
    this.head = 0;
    for (const entry of this.queue) entry.tickDepth = 1;
    stats.deferred = this.queue.length;
    this.tick = null;
  }

  /** Índices do tick: torres por id, torres com gatilho e vizinhanças. */
  private prepare(ctx: TickContext): void {
    const towers = ctx.state.towers;
    this.sorted = towers.length > 1 ? [...towers].sort((a, b) => a.id - b.id) : [...towers];
    this.towerById.clear();
    this.armedById.clear();
    this.neighborCache.clear();
    this.reachCache.clear();
    this.armed = [];
    this.killListeners = [];
    for (const tower of this.sorted) {
      this.towerById.set(tower.id, tower);
      const type = getTowerType(this.towers, tower.type);
      if (!type.trigger) continue;
      const star = triggerAt(type.trigger, clampStar(type, tower.star));
      const when = star.when;
      const baseCount =
        when.kind === 'everyNShots'
          ? when.shots
          : when.kind === 'everyNKillsInRange'
            ? when.kills
            : 0;
      const armed: Armed = {
        tower,
        type,
        star,
        count: baseCount > 0 ? reducedTriggerCount(this.classes, ctx.state, type, baseCount) : 0,
        neighborRadius: neighborhoodRadius(this.classes, ctx.state, type),
      };
      this.armed.push(armed);
      this.armedById.set(tower.id, armed);
      if (
        when.kind === 'enemyDiesInRange' ||
        when.kind === 'everyNKillsInRange' ||
        when.kind === 'neighborKills'
      ) {
        this.killListeners.push(armed);
      }
    }
  }

  private enqueue(
    armed: Armed,
    sourceTowerId: number | null,
    weight: number,
    depth: number,
    tickDepth: number,
    point: { x: number; y: number } | null,
    blastRadius = 0,
    blastPercent = 0,
  ): void {
    if (this.queue.length - this.head >= this.rules.maxQueueSize) {
      this.stats.dropped++;
      this.state.droppedTotal++;
      return;
    }
    this.queue.push({
      towerId: armed.tower.id,
      sourceTowerId,
      weight,
      depth,
      tickDepth,
      hasPoint: point !== null,
      x: point?.x ?? 0,
      y: point?.y ?? 0,
      blastRadius,
      blastPercent,
    });
  }

  /** Transforma os eventos a partir de `from` em entradas; devolve o novo cursor. */
  private convertFacts(from: number, depth: number, tickDepth: number): number {
    const events = this.ctx.tickEvents;
    for (let i = from; i < events.length; i++) {
      const event = events[i]!;
      switch (event.type) {
        case 'towerFired':
          if (event.shot !== 'extra') this.onShot(event.towerId, depth, tickDepth);
          break;
        case 'towerActivated': {
          const armed = this.armedById.get(event.towerId);
          if (armed?.star.when.kind === 'onActivated') {
            this.enqueue(armed, event.sourceTowerId, 1, depth, tickDepth, null);
          }
          break;
        }
        case 'enemyKilled':
          this.onKill(event, depth, tickDepth);
          break;
      }
    }
    return events.length;
  }

  /** Tiro normal ou de ativação da torre. */
  private onShot(towerId: number, depth: number, tickDepth: number): void {
    const armed = this.armedById.get(towerId);
    if (!armed) return;
    const { tower, star } = armed;
    let enqueued = false;
    if (star.when.kind === 'onFire') {
      this.enqueue(armed, tower.id, 1, depth, tickDepth, null);
      enqueued = true;
    } else if (star.when.kind === 'everyNShots') {
      // Contador acima do novo N (a Mecânica baixou o N): completa neste fato, não sozinho.
      tower.triggerCounter++;
      while (tower.triggerCounter >= armed.count) {
        tower.triggerCounter -= armed.count;
        this.enqueue(armed, tower.id, 1, depth, tickDepth, null);
        enqueued = true;
      }
    }
    // Cargas cheias esperando alvo: o raio sai no próximo tiro da própria torre.
    const effect = star.effect;
    if (!enqueued && effect.kind === 'chargeLightning' && tower.charges >= effect.charges) {
      this.enqueue(armed, tower.id, 0, depth, tickDepth, null);
    }
  }

  /** Um inimigo morreu: "morre no alcance", "a cada N abates no alcance" e "vizinha abate". */
  private onKill(event: SimEventOf<'enemyKilled'>, depth: number, tickDepth: number): void {
    const killer = event.towerId === null ? undefined : this.towerById.get(event.towerId);
    const killerType = killer ? getTowerType(this.towers, killer.type) : null;
    for (const armed of this.killListeners) {
      const when = armed.star.when;
      switch (when.kind) {
        case 'enemyDiesInRange':
          if (inRange(armed, event.x, event.y)) {
            this.enqueue(armed, event.towerId, 1, depth, tickDepth, event);
          }
          break;
        case 'everyNKillsInRange': {
          if (!inRange(armed, event.x, event.y)) break;
          const { tower } = armed;
          tower.triggerCounter += this.weightFor(armed, killerType, event.weight);
          while (tower.triggerCounter >= armed.count) {
            tower.triggerCounter -= armed.count;
            this.enqueue(armed, event.towerId, 1, depth, tickDepth, event);
          }
          break;
        }
        case 'neighborKills':
          if (
            killer &&
            isNeighbor(armed.tower, killer, this.rules.neighborhood, armed.neighborRadius)
          ) {
            const weight = this.weightFor(armed, killerType, event.weight);
            this.enqueue(armed, killer.id, weight, depth, tickDepth, event);
          }
          break;
        default:
          break;
      }
    }
  }

  /** Peso da morte para o contador ou as cargas de `armed`, com o bônus da Sombria. */
  private weightFor(armed: Armed, killerType: TowerType | null, base: number): number {
    return killWeight(this.classes, this.ctx.state, armed.type, killerType, base);
  }

  private execute(entry: PendingTrigger): void {
    const armed = this.armedById.get(entry.towerId);
    // A torre saiu do mapa (ou trocou de tipo) desde que a entrada foi criada.
    if (!armed) return;
    const { tower, type, star } = armed;
    const own = star.effect;

    if (entry.blastRadius > 0) {
      this.fired(armed, entry, 'explosion');
      runBlast(this, tower, type, entry);
      return;
    }

    if (own.kind === 'copyLast') {
      const effects = resolveCopies(this, tower, own);
      // Nada para copiar: o gatilho disparou, mas não há efeito.
      if (effects.length === 0) this.fired(armed, entry, 'copyLast');
      for (const effect of effects) {
        this.fired(armed, entry, effect.kind);
        if (runEffect(this, tower, type, effect, entry, true)) {
          tower.lastEffect = { effect, seq: this.state.nextSeq++ };
        }
      }
      return;
    }

    // Descarga de carga guardada: sem carga suficiente ou sem alvo, não faz nada.
    if (entry.weight === 0 && own.kind === 'chargeLightning') {
      if (tower.charges < own.charges) return;
      if (!findTowerTarget(this.index, this.ctx.state, tower, type, this.scores)) return;
    }

    this.fired(armed, entry, own.kind);
    if (runEffect(this, tower, type, own, entry, false)) {
      tower.lastEffect = { effect: own, seq: this.state.nextSeq++ };
    }
  }

  /** Registra um gatilho executado: evento e contadores. */
  private fired(armed: Armed, entry: PendingTrigger, effect: EffectKind): void {
    const { ctx } = this;
    ctx.emit({
      type: 'triggerFired',
      tick: ctx.state.tick,
      towerId: armed.tower.id,
      sourceTowerId: entry.sourceTowerId,
      when: armed.star.when.kind,
      effect,
      depth: entry.depth,
    });
    this.stats.fired++;
    if (entry.depth > this.stats.maxDepth) this.stats.maxDepth = entry.depth;
  }
}

export function createTriggerSystem(deps: TriggerSystemDeps): System {
  const engine = new TriggerEngine(deps);
  return (ctx) => engine.run(ctx);
}
