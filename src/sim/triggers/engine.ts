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
 * Recompensas (T24, lidas a cada tick): trava de ativação menor ("Fluxo
 * arcano"), morte de elite ou chefão ×3 para a Sombria ("Colheita sombria")
 * e +1 de ouro a cada 10 gatilhos visíveis de uma cadeia ("Cadeia lucrativa").
 *
 * **Cadeia (T16):** cada fato de fora do motor (tiro normal, morte) abre uma
 * cadeia nova, com id sequencial (`TriggerState.nextChainId`), alocada só se
 * o fato puser alguma entrada na fila; a origem é a torre que atirou ou que
 * matou (`null` = núcleo). Tudo que nasce de uma entrada herda a cadeia dela:
 * fatos novos, explosões da execução, sobras para o tick seguinte e os
 * projéteis dos tiros de ativação e extras (a morte causada por eles continua
 * a cadeia). `ChainRecord.length` conta só os gatilhos com efeito visível;
 * a maior cadeia vai para `RunState.stats.longestChain`. Uma cadeia sai de
 * `TriggerState.chains` quando não sobra entrada dela na fila nem projétil
 * dela no ar.
 *
 * Não existe loop infinito: toda entrada vem de um tiro normal (limitado pela
 * cadência), de uma ativação (no máximo 1 por `activationCooldownSeconds`
 * por torre) ou de uma morte (cada inimigo morre uma vez). Os tiros extras do
 * disparo múltiplo não contam como tiro. Não há sorteio: empates vão para o
 * menor id.
 */

import { killWeight, neighborhoodRadius, reducedTriggerCount } from '../classes/bonuses';
import { classData, type ClassData } from '../classes/classData';
import { getEnemyType, type EnemyData } from '../enemies/enemyData';
import { earnGold } from '../economy/gold';
import { rewardMods } from '../rewards/mods';
import { chainGoldAt } from '../rewards/rewards';
import type { SimEventOf } from '../engine/events';
import type { System, TickContext } from '../engine/simulation';
import type { SpatialIndex } from '../spatial/spatialIndex';
import type { Tower } from '../towers/placement';
import type { TargetScores } from '../towers/targeting';
import { findTowerTarget } from '../towers/systems';
import { clampStar } from '../towers/stars';
import { getTowerType, type TowerData, type TowerType } from '../towers/towerData';
import { resolveCopies, runBlast, runEffect, type EffectEnv } from './effects';
import { isNeighbor, isReachNeighbor } from './neighborhood';
import { triggerAt, type EffectKind, type TriggerRules, type TriggerStar } from './triggerData';
import type {
  ChainMark,
  ChainRecord,
  PendingTrigger,
  TriggerState,
  TriggerTickStats,
} from './triggerState';

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
  /** Trava de ativação do tick (a dos dados ou a do bônus "Fluxo arcano"). */
  activationCooldownTicks: number;
  readonly unlimitedLineLength: number;
  private readonly rules: TriggerRules;
  private readonly ticksPerSecond: number;

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

  /** Cadeias vivas, por id (montadas de `TriggerState.chains` a cada tick). */
  private readonly chains = new Map<number, ChainRecord>();
  /** Ids das cadeias vivas no fim do tick (reaproveitado). */
  private readonly liveChains = new Set<number>();
  /** Cadeia das entradas que vão para a fila agora (`chainId` 0 = abrir uma nova). */
  private readonly mark: ChainMark = { chainId: 0, originTowerId: null };

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
    this.ticksPerSecond = deps.ticksPerSecond;
    this.activationCooldownTicks = this.cooldownTicksFor(this.rules.activationCooldownSeconds);
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
      list = this.sorted.filter(
        (t) => t !== tower && isReachNeighbor(tower, t, this.rules.neighborhood, radius, reach),
      );
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

  private cooldownTicksFor(seconds: number): number {
    return Math.max(1, Math.round(seconds * this.ticksPerSecond));
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
    this.chains.clear();
    for (const chain of triggers.chains) this.chains.set(chain.id, chain);

    // Sobras do tick anterior já estão na frente; os fatos deste tick entram atrás.
    let cursor = this.convertFacts(0, 1, 1, false);
    let processed = 0;
    while (this.head < this.queue.length) {
      const entry = this.queue[this.head]!;
      if (entry.tickDepth > this.rules.maxChainDepthPerTick) break;
      if (processed >= this.rules.maxActivationsPerTick) break;
      this.head++;
      processed++;
      this.mark.chainId = entry.chainId;
      this.mark.originTowerId = entry.originTowerId;
      this.execute(entry);
      cursor = this.convertFacts(cursor, entry.depth + 1, entry.tickDepth + 1, true);
    }

    if (this.head > 0) this.queue.splice(0, this.head);
    this.head = 0;
    for (const entry of this.queue) entry.tickDepth = 1;
    stats.deferred = this.queue.length;
    this.pruneChains(ctx);
    this.tick = null;
  }

  /** Guarda em `TriggerState.chains` só as cadeias com entrada na fila ou projétil no ar. */
  private pruneChains(ctx: TickContext): void {
    const triggers = ctx.state.triggers;
    if (this.chains.size === 0) {
      triggers.chains = [];
      return;
    }
    // A fila pode ter milhares de entradas de poucas cadeias: entradas vizinhas
    // costumam ser da mesma cadeia, e a busca para quando todas foram achadas.
    const live = this.liveChains;
    live.clear();
    const total = this.chains.size;
    let last = 0;
    for (const entry of this.queue) {
      if (entry.chainId === last) continue;
      last = entry.chainId;
      live.add(last);
      if (live.size === total) break;
    }
    if (live.size < total) {
      for (const projectile of ctx.state.projectiles.slots) {
        if (projectile.active && projectile.chainId > 0) live.add(projectile.chainId);
      }
    }
    // O Map guarda a ordem de inserção: as do save (em ordem) e depois as novas (ids crescentes).
    const kept: ChainRecord[] = [];
    for (const chain of this.chains.values()) if (live.has(chain.id)) kept.push(chain);
    triggers.chains = kept;
    this.chains.clear();
  }

  /** A cadeia `id`, criando o registro se ainda não existir. */
  private chainRecord(id: number, originTowerId: number | null): ChainRecord {
    let chain = this.chains.get(id);
    if (!chain) {
      chain = { id, originTowerId, length: 0 };
      this.chains.set(id, chain);
    }
    return chain;
  }

  /** Marca dos fatos de fora do motor: a cadeia do projétil, se houver; senão, uma nova. */
  private markFact(chainId: number, originTowerId: number | null): void {
    this.mark.chainId = chainId;
    this.mark.originTowerId = originTowerId;
  }

  /** Índices do tick: torres por id, torres com gatilho e vizinhanças. */
  private prepare(ctx: TickContext): void {
    const towers = ctx.state.towers;
    this.activationCooldownTicks = this.cooldownTicksFor(
      rewardMods(ctx.state).activationCooldownSeconds ?? this.rules.activationCooldownSeconds,
    );
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
    const mark = this.mark;
    if (mark.chainId === 0) {
      mark.chainId = this.state.nextChainId++;
      this.chainRecord(mark.chainId, mark.originTowerId);
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
      chainId: mark.chainId,
      originTowerId: mark.originTowerId,
    });
  }

  /**
   * Transforma os eventos a partir de `from` em entradas; devolve o novo
   * cursor. `inherit`: os fatos nasceram da entrada que acabou de executar e
   * ficam na cadeia dela (`this.mark`); senão, cada fato abre a própria.
   */
  private convertFacts(from: number, depth: number, tickDepth: number, inherit: boolean): number {
    const events = this.ctx.tickEvents;
    for (let i = from; i < events.length; i++) {
      const event = events[i]!;
      switch (event.type) {
        case 'towerFired':
          if (event.shot === 'extra') break;
          if (!inherit) this.markFact(0, event.towerId);
          this.onShot(event.towerId, depth, tickDepth);
          break;
        case 'towerActivated': {
          const armed = this.armedById.get(event.towerId);
          if (armed?.star.when.kind === 'onActivated') {
            if (!inherit) this.markFact(0, event.sourceTowerId);
            this.enqueue(armed, event.sourceTowerId, 1, depth, tickDepth, null);
          }
          break;
        }
        case 'enemyKilled':
          if (!inherit) {
            // Morte por tiro de um gatilho: continua a cadeia que disparou o tiro.
            if (event.chainId > 0) {
              this.chainRecord(event.chainId, event.originTowerId);
              this.markFact(event.chainId, event.originTowerId);
            } else {
              this.markFact(0, event.towerId);
            }
          }
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
    const eliteOrBoss = event.elite || getEnemyType(this.enemies, event.enemyType).boss;
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
          tower.triggerCounter += this.weightFor(armed, killerType, event.weight, eliteOrBoss);
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
            const weight = this.weightFor(armed, killerType, event.weight, eliteOrBoss);
            this.enqueue(armed, killer.id, weight, depth, tickDepth, event);
          }
          break;
        default:
          break;
      }
    }
  }

  /** Peso da morte para o contador ou as cargas de `armed`, com o bônus da Sombria. */
  private weightFor(
    armed: Armed,
    killerType: TowerType | null,
    base: number,
    eliteOrBoss: boolean,
  ): number {
    return killWeight(this.classes, this.ctx.state, armed.type, killerType, base, eliteOrBoss);
  }

  private execute(entry: PendingTrigger): void {
    const armed = this.armedById.get(entry.towerId);
    // A torre saiu do mapa (ou trocou de tipo) desde que a entrada foi criada.
    if (!armed) return;
    const { tower, type, star } = armed;
    const own = star.effect;

    if (entry.blastRadius > 0) {
      this.fired(armed, entry, 'explosion', true, null);
      runBlast(this, tower, type, entry);
      return;
    }

    if (own.kind === 'copyLast') {
      const copies = resolveCopies(this, tower, own);
      // Nada para copiar: o gatilho disparou, mas não há efeito (não conta na cadeia).
      if (copies.length === 0) this.fired(armed, entry, 'copyLast', false, null);
      for (const { effect, fromTowerId } of copies) {
        this.fired(armed, entry, effect.kind, true, fromTowerId);
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

    // O raio em cadeia só é visível se sair: ganhar carga sem soltar não conta na cadeia.
    const charging = own.kind === 'chargeLightning';
    const event = this.fired(armed, entry, own.kind, !charging, null);
    if (runEffect(this, tower, type, own, entry, false)) {
      tower.lastEffect = { effect: own, seq: this.state.nextSeq++ };
      if (charging) this.countVisible(event, entry);
    }
  }

  /**
   * Registra um gatilho executado: evento e contadores. Devolve o evento, que
   * pode virar visível depois do efeito (`countVisible`).
   */
  private fired(
    armed: Armed,
    entry: PendingTrigger,
    effect: EffectKind,
    visible: boolean,
    copiedFromTowerId: number | null,
  ): SimEventOf<'triggerFired'> {
    const { ctx } = this;
    const chain = this.chainRecord(entry.chainId, entry.originTowerId);
    const event: SimEventOf<'triggerFired'> = {
      type: 'triggerFired',
      tick: ctx.state.tick,
      towerId: armed.tower.id,
      sourceTowerId: entry.sourceTowerId,
      when: armed.star.when.kind,
      effect,
      depth: entry.depth,
      chainId: chain.id,
      originTowerId: chain.originTowerId,
      visible: false,
      chainLength: chain.length,
      copiedFromTowerId,
    };
    ctx.emit(event);
    if (visible) this.countVisible(event, entry);
    this.stats.fired++;
    if (entry.depth > this.stats.maxDepth) this.stats.maxDepth = entry.depth;
    return event;
  }

  /**
   * O gatilho teve efeito visível: conta na cadeia (o "x7") e na maior cadeia
   * da run. Com o bônus "Cadeia lucrativa" (T24), cada 10 gatilhos visíveis
   * da cadeia rendem ouro (no ouro ganho).
   */
  private countVisible(event: SimEventOf<'triggerFired'>, entry: PendingTrigger): void {
    const chain = this.chainRecord(entry.chainId, entry.originTowerId);
    chain.length++;
    event.visible = true;
    event.chainLength = chain.length;
    const { state } = this.ctx;
    const stats = state.stats;
    if (chain.length > stats.longestChain) stats.longestChain = chain.length;
    const gold = chainGoldAt(state, chain.length);
    if (gold > 0) {
      earnGold(state, gold);
      stats.chainGold += gold;
      this.ctx.emit({
        type: 'chainGold',
        tick: state.tick,
        chainId: chain.id,
        chainLength: chain.length,
        gold,
      });
    }
  }
}

export function createTriggerSystem(deps: TriggerSystemDeps): System {
  const engine = new TriggerEngine(deps);
  return (ctx) => engine.run(ctx);
}
