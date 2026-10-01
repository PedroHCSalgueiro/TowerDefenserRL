import { describe, expect, it } from 'vitest';
import economyJson from '../src/data/economy.json';
import engineConfig from '../src/data/engine.json';
import wavesJson from '../src/data/waves.json';
import { earlyBonusFor, killGoldMultiplierFor, waveBonusFor } from '../src/sim/economy/economy';
import { economyData, loadEconomyData } from '../src/sim/economy/economyData';
import { damageEnemy } from '../src/sim/enemies/damage';
import { enemyData, type EnemyData } from '../src/sim/enemies/enemyData';
import { FixedStepClock } from '../src/sim/engine/clock';
import type { SimEvent } from '../src/sim/engine/events';
import { Simulation, SimulationRunner, type System } from '../src/sim/engine/simulation';
import type { Enemy } from '../src/sim/enemies/pool';
import type { RunState } from '../src/sim/state';
import { createGameSystems } from '../src/sim/systems';
import { loadWaveData, type WaveData } from '../src/sim/waves/waveData';
import { buildWaveHudModel, formatMultiplier } from '../src/ui/waveHudModel';
import {
  activeEnemies,
  blindNexus,
  makeState,
  smallMap,
  testEnemies,
  TPS,
} from './support/enemySim';
import { realMap, shopSim, stepOnce } from './support/shopSim';

function ofType<K extends SimEvent['type']>(events: SimEvent[], type: K) {
  return events.filter((e): e is Extract<SimEvent, { type: K }> => e.type === type);
}

/** Inimigos de teste: `slow` (1 ouro, 28 s para atravessar o mapa pequeno) e o chefão `titan`. */
const stackEnemies: EnemyData = {
  armor: testEnemies.armor,
  types: {
    ...testEnemies.types,
    slow: {
      hp: 10,
      speed: 0.25,
      armor: 0,
      nexusDamage: 1,
      gold: 1,
      movement: 'ground',
      boss: false,
    },
  },
};

const slow = (count: number) => ({
  hpMultiplier: 1,
  pulses: [],
  mass: [{ type: 'slow', count }],
});

/** Ondas 1 a 6 de inimigos lentos (um a cada 2 ticks) e a 7 com o chefão. */
function stackWaves(maxActiveEnemies = 1000): WaveData {
  return {
    maxActiveEnemies,
    timing: { pulseSpawnSeconds: 0.5, pulsePauseSeconds: 1, massSpawnSeconds: 0.25 },
    waves: [
      slow(3),
      slow(2),
      slow(2),
      slow(1),
      slow(1),
      slow(1),
      { hpMultiplier: 1, pulses: [], mass: [{ type: 'titan', count: 1 }] },
    ],
  };
}

/**
 * Partida no mapa pequeno com um "matador" de teste logo depois dos
 * nascimentos: a cada tick, mata (com `enemyKilled` e ouro) os inimigos que
 * `kill` escolher. Núcleo cego: ninguém mais mata.
 */
function stackSim(maxActiveEnemies?: number, state: RunState = makeState('pilha', blindNexus)) {
  const control: { kill: (enemy: Enemy) => boolean; limit: number } = {
    kill: () => false,
    limit: Infinity,
  };
  const killer: System = (ctx) => {
    let left = control.limit;
    for (const enemy of ctx.state.enemies.slots) {
      if (left <= 0) break;
      if (enemy.active && control.kill(enemy)) {
        damageEnemy(ctx, stackEnemies, enemy, 1e12, null, { ignoreArmor: true });
        left--;
      }
    }
  };
  const systems = createGameSystems(smallMap, {
    enemies: stackEnemies,
    nexus: blindNexus,
    waves: stackWaves(maxActiveEnemies),
    ticksPerSecond: TPS,
  });
  // Depois das ações e dos nascimentos, antes do ouro e do fim das ondas.
  systems.splice(2, 0, killer);
  const sim = new Simulation(state, systems);
  return { sim, control };
}

function call(sim: Simulation, times = 1): SimEvent[] {
  for (let i = 0; i < times; i++) sim.enqueue({ type: 'callWave' });
  return stepOnce(sim);
}

function run(sim: Simulation, ticks: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) events.push(...stepOnce(sim));
  return events;
}

const activeNumbers = (state: Readonly<RunState>) => state.waves.active.map((w) => w.wave);

describe('dados da T14', () => {
  it('economy.json: bônus antecipado 50% e multiplicador 0,5 por onda com teto 3', () => {
    expect(economyData.earlyCall).toEqual({ bonusPercent: 50 });
    expect(economyData.killGoldMultiplier).toEqual({ perExtraWave: 0.5, max: 3 });
  });

  it('waves.json: até 1.000 inimigos ativos', () => {
    expect(wavesJson.maxActiveEnemies).toBe(1000);
  });

  it('recusa dados ruins', () => {
    const noEarly = structuredClone(economyJson) as Record<string, unknown>;
    delete noEarly.earlyCall;
    expect(() => loadEconomyData(noEarly)).toThrow(/earlyCall/);
    const badMult = structuredClone(economyJson);
    badMult.killGoldMultiplier.max = 0.5;
    expect(() => loadEconomyData(badMult)).toThrow(/killGoldMultiplier/);
    const badLimit = { ...structuredClone(wavesJson), maxActiveEnemies: 0 };
    expect(() => loadWaveData(badLimit, enemyData)).toThrow(/maxActiveEnemies/);
  });

  it('bônus antecipado: metade do bônus da onda, para baixo (onda 5 → 15 → 7)', () => {
    expect(waveBonusFor(economyData, 5)).toBe(15);
    expect(earlyBonusFor(economyData, 5)).toBe(7);
    expect(earlyBonusFor(economyData, 2)).toBe(6);
  });

  it('multiplicador: 1 onda ×1; 2 ×1,5; 3 ×2; 4 ×2,5; 5 ou mais ×3', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 9].map((n) => killGoldMultiplierFor(economyData, n))).toEqual([
      1, 1, 1.5, 2, 2.5, 3, 3, 3,
    ]);
    expect(formatMultiplier(1.5)).toBe('x1,5!');
    expect(formatMultiplier(2)).toBe('x2!');
  });
});

describe('chamada antecipada', () => {
  it('com outra onda ativa é antecipada; o bônus só é pago quando aquela onda fecha', () => {
    const { sim, control } = stackSim();
    expect(ofType(call(sim), 'waveStarted')[0]).toMatchObject({
      wave: 1,
      early: false,
      earlyBonus: 0,
    });
    expect(ofType(call(sim), 'waveStarted')[0]).toMatchObject({
      wave: 2,
      early: true,
      earlyBonus: 6,
    });
    expect(sim.state.waves.active.map((w) => w.earlyBonus)).toEqual([0, 6]);
    run(sim, 10); // todos nasceram
    const goldBefore = sim.state.gold;
    // Mata a onda 2 inteira: ela está limpa, mas espera a 1 fechar, sem bônus.
    control.kill = (e) => e.wave === 2;
    let events = run(sim, 2);
    expect(ofType(events, 'waveEnded')).toHaveLength(0);
    expect(activeNumbers(sim.state)).toEqual([1, 2]);
    // Só o ouro dos 2 abates, com as 2 ondas vivas (×1,5).
    expect(sim.state.gold).toBe(goldBefore + 3);
    // Mata a onda 1: as duas fecham no mesmo tick, em ordem, cada uma com o seu endWave.
    control.kill = (e) => e.wave === 1;
    events = run(sim, 1);
    const ended = ofType(events, 'waveEnded');
    expect(ended.map((e) => [e.wave, e.bonus, e.earlyBonus])).toEqual([
      [1, 11, 0],
      [2, 12, 6],
    ]);
    expect(ofType(events, 'shopChanged').filter((e) => e.reason === 'newWave')).toHaveLength(2);
    expect(sim.state.wave).toBe(2);
    expect(sim.state.waves.active).toEqual([]);
    // Ordem dentro do fechamento: juros sobre o ouro guardado, bônus, bônus antecipado.
    const second = ended[1]!;
    expect(second.gold - ended[0]!.gold).toBe(second.interest + 12 + 6);
  });

  it('o bônus antecipado se perde na derrota', () => {
    const { sim } = stackSim();
    sim.state.nexus.hp = 1;
    call(sim);
    call(sim);
    const events = run(sim, 400);
    expect(sim.state.status).toBe('lost');
    expect(ofType(events, 'waveEnded')).toHaveLength(0);
    expect(sim.state.gold).toBe(10);
  });

  it('as ondas sem chefão empilham; a onda com chefão exige o mapa limpo', () => {
    const { sim, control } = stackSim();
    const started = ofType(call(sim, 7), 'waveStarted');
    expect(started.map((e) => e.wave)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(started.map((e) => e.early)).toEqual([false, true, true, true, true, true]);
    expect(ofType(call(sim), 'callWaveRefused')[0]!.reason).toBe('active');
    control.kill = () => true;
    run(sim, 20);
    expect(sim.state.wave).toBe(6);
    sim.enqueue({ type: 'spawnEnemy', enemyType: 'slow' });
    control.kill = () => false;
    expect(ofType(call(sim), 'callWaveRefused')[0]!.reason).toBe('enemies');
    control.kill = () => true;
    run(sim, 1);
    expect(ofType(call(sim), 'waveStarted')[0]).toMatchObject({ wave: 7, early: false });
  });

  it('no jogo real: as ondas 1 a 9 juntas num tick só; a 10 é recusada', () => {
    const sim = shopSim('pilha-real');
    const events = call(sim, 10);
    expect(ofType(events, 'waveStarted').map((e) => e.wave)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(ofType(events, 'callWaveRefused')[0]!.reason).toBe('active');
    expect(buildWaveHudModel(sim.state)).toMatchObject({
      label: 'Ondas 1–9 de 10',
      multiplier: 'x3!',
      pendingBonus: `+${[2, 3, 4, 5, 6, 7, 8, 9].reduce((s, w) => s + earlyBonusFor(economyData, w), 0)} ao limpar`,
      callLabel: 'Chefão: limpe o mapa',
      canCall: false,
    });
  });

  it('inimigo do debug não segura o fechamento da onda', () => {
    const { sim, control } = stackSim();
    sim.enqueue({ type: 'spawnEnemy', enemyType: 'slow' });
    call(sim);
    run(sim, 6);
    control.kill = (e) => e.wave === 1;
    run(sim, 1);
    expect(sim.state.wave).toBe(1);
    expect(activeEnemies(sim.state).map((e) => e.wave)).toEqual([0]);
  });
});

describe('multiplicador do ouro de abate', () => {
  it('conta as ondas com inimigo vivo ou por nascer; a onda limpa esperando a anterior não conta', () => {
    const { sim, control } = stackSim();
    call(sim);
    expect(sim.state.waves.goldMultiplier).toBe(1);
    call(sim);
    expect(sim.state.waves.goldMultiplier).toBe(1.5);
    call(sim);
    expect(sim.state.waves.goldMultiplier).toBe(2);
    run(sim, 10);
    control.kill = (e) => e.wave === 2;
    run(sim, 1);
    control.kill = () => false;
    run(sim, 1);
    expect(activeNumbers(sim.state)).toEqual([1, 2, 3]);
    expect(sim.state.waves.goldMultiplier).toBe(1.5);
    expect(buildWaveHudModel(sim.state, false, [], economyData, stackEnemies).multiplier).toBe(
      'x1,5!',
    );
  });

  it('teto ×3 com 5 ou mais ondas', () => {
    const { sim } = stackSim();
    call(sim, 5);
    expect(sim.state.waves.goldMultiplier).toBe(3);
    call(sim);
    expect(sim.state.waves.active).toHaveLength(6);
    expect(sim.state.waves.goldMultiplier).toBe(3);
  });

  it('a fração acumula: com ×1,5, dois inimigos de 1 ouro rendem 1 e depois 2', () => {
    const { sim, control } = stackSim();
    call(sim);
    call(sim);
    run(sim, 2);
    const gold = sim.state.gold;
    control.limit = 1;
    control.kill = (e) => e.wave === 1;
    run(sim, 1);
    expect(sim.state.gold).toBe(gold + 1);
    expect(sim.state.waves.goldFraction).toBe(0.5);
    run(sim, 1);
    expect(sim.state.gold).toBe(gold + 3);
    expect(sim.state.waves.goldFraction).toBe(0);
  });

  it('vale para qualquer abate, inclusive do debug, e só para o ouro de abate', () => {
    const { sim, control } = stackSim();
    sim.enqueue({ type: 'spawnEnemy', enemyType: 'slow' });
    call(sim, 3);
    expect(sim.state.waves.goldMultiplier).toBe(2);
    const gold = sim.state.gold;
    control.kill = (e) => e.wave === 0;
    run(sim, 1);
    expect(sim.state.gold).toBe(gold + 2);
  });
});

describe('fila invisível acima do limite de inimigos ativos', () => {
  it('com limite 2, os próximos esperam na entrada e nascem na ordem quando abre espaço', () => {
    const { sim, control } = stackSim(2);
    const spawnedWaves: number[] = [];
    const record = (events: SimEvent[]) => {
      for (const e of ofType(events, 'enemySpawned')) {
        spawnedWaves.push(sim.state.enemies.slots.find((s) => s.id === e.enemyId)!.wave);
      }
    };
    record(call(sim)); // onda 1: vence nos ticks 1, 3, 5
    record(call(sim)); // onda 2: vence nos ticks 2, 4
    record(run(sim, 10));
    expect(sim.state.enemies.activeCount).toBe(2);
    expect(spawnedWaves).toEqual([1, 2]);
    // Abre uma vaga por tick: nascem pela ordem de vencimento (1: tick 3, 2: tick 4, 1: tick 5).
    control.limit = 1;
    control.kill = () => true;
    for (let i = 0; i < 5; i++) {
      record(stepOnce(sim));
      expect(sim.state.enemies.activeCount).toBeLessThanOrEqual(2);
    }
    expect(spawnedWaves).toEqual([1, 2, 1, 2, 1]);
  });
});

describe('debug "Encerrar onda" com ondas empilhadas', () => {
  it('fecha todas em ordem, sem ouro de abate, pagando os bônus antecipados', () => {
    const sim = shopSim('encerrar-pilha');
    call(sim, 3);
    for (let i = 0; i < 100; i++) sim.step();
    sim.drainEvents();
    const gold = sim.state.gold;
    sim.enqueue({ type: 'endWave' });
    const events = stepOnce(sim);
    const ended = ofType(events, 'waveEnded');
    expect(ended.map((e) => [e.wave, e.earlyBonus])).toEqual([
      [1, 0],
      [2, 6],
      [3, 6],
    ]);
    expect(ofType(events, 'enemyKilled')).toHaveLength(0);
    expect(sim.state.enemies.activeCount).toBe(0);
    expect(sim.state.waves.active).toEqual([]);
    const paid = ended.reduce((s, e) => s + e.interest + e.bonus + e.earlyBonus, 0);
    expect(sim.state.gold).toBe(gold + paid);
    expect(ofType(call(sim), 'waveStarted')[0]!.wave).toBe(4);
  });
});

describe('save com ondas empilhadas', () => {
  it('retomar no meio de 4 ondas empilhadas dá o mesmo estado que seguir jogando', () => {
    const a = Simulation.create('save-pilha', createGameSystems(realMap));
    a.enqueue({
      type: 'debugSpawnTowers',
      count: 8,
      towerTypes: ['mortar', 'reaper'],
      layout: 'spread',
    });
    call(a, 4);
    for (let i = 0; i < 300; i++) a.step();
    expect(a.state.waves.active.length).toBeGreaterThan(1);
    const b = Simulation.restore(a.serialize(), createGameSystems(realMap));
    for (let i = 0; i < 1500; i++) {
      a.step();
      b.step();
    }
    expect(b.serialize()).toBe(a.serialize());
  });

  it('recusa ondas fora de ordem e fração inválida', () => {
    const sim = shopSim('save-pilha-ruim');
    call(sim, 3);
    const good = JSON.parse(sim.serialize()) as RunState;
    expect(good.version).toBe(11);
    const swapped = structuredClone(good);
    swapped.waves.active.reverse();
    expect(() => Simulation.restore(JSON.stringify(swapped))).toThrow(/inválido/);
    const badFraction = structuredClone(good);
    badFraction.waves.goldFraction = 1;
    expect(() => Simulation.restore(JSON.stringify(badFraction))).toThrow(/inválido/);
  });
});

describe('velocidade e pausa', () => {
  it('Q: 1x → 2x → 3x → 1x', () => {
    const clock = new FixedStepClock(engineConfig);
    expect([clock.cycleSpeed(), clock.cycleSpeed(), clock.cycleSpeed()]).toEqual([2, 3, 1]);
  });

  it('pausado, nenhum tick roda e o tempo não acumula', () => {
    const runner = new SimulationRunner(shopSim('pausa'));
    runner.paused = true;
    runner.update(5000);
    expect(runner.sim.state.tick).toBe(0);
    runner.paused = false;
    runner.update(1000 / engineConfig.ticksPerSecond);
    expect(runner.sim.state.tick).toBe(1);
  });

  it('velocidade e pausa não mudam o resultado da simulação (ondas empilhadas)', () => {
    const TOTAL = 1800;
    /** Comandos por tick, múltiplos de 6 para caírem entre quadros em 1x, 2x e 3x. */
    const plan = new Map<number, number>([
      [0, 2],
      [300, 2],
      [600, 1],
    ]);
    const setup = (sim: Simulation) =>
      sim.enqueue({
        type: 'debugSpawnTowers',
        count: 10,
        towerTypes: ['mortar', 'reaper', 'ballista'],
        layout: 'spread',
      });
    const enqueuePlanned = (sim: Simulation, done: Set<number>) => {
      const { tick } = sim.state;
      if (done.has(tick)) return;
      done.add(tick);
      for (let i = 0; i < (plan.get(tick) ?? 0); i++) sim.enqueue({ type: 'callWave' });
    };

    const reference = Simulation.create('velocidade', createGameSystems(realMap));
    setup(reference);
    const referenceDone = new Set<number>();
    while (reference.state.tick < TOTAL) {
      enqueuePlanned(reference, referenceDone);
      reference.step();
    }

    const frame = 1000 / engineConfig.ticksPerSecond;
    for (const speed of [1, 2, 3]) {
      const runner = new SimulationRunner(
        Simulation.create('velocidade', createGameSystems(realMap)),
        { ...engineConfig, maxTicksPerFrame: 1000 },
      );
      runner.clock.setSpeed(speed);
      setup(runner.sim);
      const done = new Set<number>();
      let frames = 0;
      while (runner.sim.state.tick < TOTAL) {
        enqueuePlanned(runner.sim, done);
        // Pausa de 20 quadros a cada 50.
        runner.paused = frames % 50 >= 30;
        runner.update(frame);
        frames++;
      }
      expect(runner.sim.state.tick).toBe(TOTAL);
      expect(runner.sim.serialize()).toBe(reference.serialize());
    }
  });
});
