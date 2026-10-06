/**
 * Apoio aos testes do motor de gatilhos: torres de teste com gatilho (montadas
 * pelo carregador de verdade) e uma simulação só com projéteis, torres e
 * gatilhos, com os inimigos parados onde foram colocados.
 *
 * Com `place()`, todo inimigo está na distância 0 da rota: na mira "primeiro"
 * todos empatam e o alvo normal é o de menor id dentro do alcance.
 */

import { classData, type ClassData } from '../../src/sim/classes/classData';
import type { SimEvent, SimEventOf, SimEventType } from '../../src/sim/engine/events';
import { Simulation, type System } from '../../src/sim/engine/simulation';
import { createProjectileSystem } from '../../src/sim/projectiles/systems';
import { SpatialIndex } from '../../src/sim/spatial/spatialIndex';
import type { RunState } from '../../src/sim/state';
import { createTowerSystem } from '../../src/sim/towers/systems';
import { createTargetScores } from '../../src/sim/towers/targeting';
import type { TowerData, TowerType } from '../../src/sim/towers/towerData';
import { createTriggerSystem } from '../../src/sim/triggers/engine';
import { parseTrigger, type TriggerRules } from '../../src/sim/triggers/triggerData';
import { TPS, makeState, testEnemies } from './enemySim';
import { smallRoutes, testTowers, testTriggerRules } from './towerSim';

/** Torre de teste: a Flecha (dano 6, 2 tiros/s, alcance 1,5) com o gatilho pedido. */
export function armedType(
  when: string,
  effect: string,
  params: Record<string, number | boolean> = {},
  base: Partial<TowerType> = {},
): TowerType {
  return {
    ...testTowers.types.arrow!,
    ...base,
    trigger: parseTrigger('teste', { when, do: effect, stars: [params] }),
  };
}

/** Tipos de torre dos testes de gatilho (além de `arrow` e `bomb`, sem gatilho). */
export const triggerTypes: Record<string, TowerType> = {
  ...testTowers.types,
  /** A cada 3 tiros, +2 tiros extras. */
  counter: armedType('everyNShots', 'multiShot', { shots: 3, extraShots: 2 }),
  /** Ao disparar, ativa as vizinhas. */
  relay: armedType('onFire', 'activateNeighbors', { maxTargets: 4 }),
  /** Ao ser ativada, ativa as vizinhas. */
  echo: armedType('onActivated', 'activateNeighbors', { maxTargets: 4 }),
  /** Ao ser ativada, explode no alvo normal (raio 0,5, 50%). */
  bang: armedType('onActivated', 'explosion', { radius: 0.5, damagePercent: 50 }),
  /** Inimigo morre no alcance: explosão no ponto da morte (raio 0,5, 50% de 6 = 3). */
  reaper: armedType('enemyDiesInRange', 'explosion', { radius: 0.5, damagePercent: 50 }),
  /** A cada 2 abates no alcance: explosão (raio 0,5, 100%). */
  collector: armedType('everyNKillsInRange', 'explosion', {
    kills: 2,
    radius: 0.5,
    damagePercent: 100,
  }),
  /** Vizinha abate: +1 carga; com 3, raio em 3 inimigos (salto 1 casa, 100%). */
  obelisk: armedType('neighborKills', 'chargeLightning', {
    charges: 3,
    targets: 3,
    jumpRadius: 1,
    damagePercent: 100,
  }),
  /** Ao disparar: linha perfurante (meia-largura 0,25, 100%). Alcance 2. */
  piercer: armedType('onFire', 'pierceLine', { halfWidth: 0.25, damagePercent: 100 }, { range: 2 }),
  /** Ao disparar: executa quem está abaixo de 15% (abate duplo). */
  executioner: armedType('onFire', 'execute', { hpPercent: 15, killWeight: 2 }),
  /** Vizinha abate: copia o último gatilho de uma vizinha. Dano base 10. */
  mimic: armedType('neighborKills', 'copyLast', {}, { damage: 10 }),
  /** Ao ser ativada: copia o último gatilho de uma vizinha. Dano base 10. */
  mimicOnActivate: armedType('onActivated', 'copyLast', {}, { damage: 10 }),
};

export function triggerData(rules: Partial<TriggerRules> = {}): TowerData {
  return {
    projectileRetargetRadius: testTowers.projectileRetargetRadius,
    triggers: { ...testTriggerRules, ...rules },
    types: triggerTypes,
  };
}

/**
 * Projéteis, torres e gatilhos, com os inimigos parados. `before` roda antes
 * de tudo (para emitir fatos sintéticos, por exemplo). Sem o sistema de
 * classes: os níveis de bônus são os de `state.classes`, escolhidos pelo teste.
 */
export function triggerSim(
  state: RunState = makeState(),
  data: TowerData = triggerData(),
  before: System[] = [],
  classes: ClassData = classData,
): Simulation {
  const index = new SpatialIndex(1);
  const scores = createTargetScores(smallRoutes, testEnemies);
  return new Simulation(state, [
    ...before,
    createProjectileSystem(testEnemies, index, data.projectileRetargetRadius, TPS),
    createTowerSystem(index, data, scores, TPS, classes),
    createTriggerSystem({
      index,
      enemies: testEnemies,
      towers: data,
      classes,
      scores,
      ticksPerSecond: TPS,
    }),
  ]);
}

/** Emite os fatos pedidos no tick `tick` (fatos sintéticos para os "quando"). */
export function factsAt(tick: number, facts: SimEvent[]): System {
  return (ctx) => {
    if (ctx.state.tick !== tick) return;
    for (const fact of facts) ctx.emit({ ...fact, tick });
  };
}

export function ofType<K extends SimEventType>(events: SimEvent[], type: K): SimEventOf<K>[] {
  return events.filter((e): e is SimEventOf<K> => e.type === type);
}

/** Resumo dos `triggerFired`: "torre:efeito@profundidade". */
export function firedSummary(events: SimEvent[], names: Record<number, string>): string[] {
  return ofType(events, 'triggerFired').map(
    (e) => `${names[e.towerId] ?? e.towerId}:${e.effect}@${e.depth}`,
  );
}

/** `enemyKilled` sintético (o inimigo não precisa existir). `elite`: morte de elite (T24). */
export function killFact(
  x: number,
  y: number,
  towerId: number | null,
  weight = 1,
  enemyId = 9999,
  elite = false,
): SimEvent {
  return {
    type: 'enemyKilled',
    tick: 0,
    enemyId,
    enemyType: 'walker',
    towerId,
    x,
    y,
    elite,
    weight,
    chainId: 0,
    originTowerId: null,
  };
}
