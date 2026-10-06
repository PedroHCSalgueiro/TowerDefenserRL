import { describe, expect, it } from 'vitest';
import economyJson from '../src/data/economy.json';
import engineConfig from '../src/data/engine.json';
import wavesJson from '../src/data/waves.json';
import { earlyBonusFor } from '../src/sim/economy/economy';
import { economyData, loadEconomyData } from '../src/sim/economy/economyData';
import { damageEnemy } from '../src/sim/enemies/damage';
import { enemyData, type EnemyData } from '../src/sim/enemies/enemyData';
import { FixedStepClock } from '../src/sim/engine/clock';
import type { SimEvent } from '../src/sim/engine/events';
import { Simulation, SimulationRunner, type System } from '../src/sim/engine/simulation';
import type { Enemy } from '../src/sim/enemies/pool';
import { RUN_STATE_VERSION, type RunState } from '../src/sim/state';
import { createGameSystems } from '../src/sim/systems';
import { buildWaveSchedules } from '../src/sim/waves/schedule';
import { loadWaveData, type WaveData } from '../src/sim/waves/waveData';
import { buildWaveHudModel } from '../src/ui/waveHudModel';
import {
  activeEnemies,
  blindNexus,
  makeState,
  smallMap,
  testEnemies,
  TPS,
} from './support/enemySim';
import { realMap, shopSim, stepOnce } from './support/shopSim';
import { noRewards } from './support/waveBot';

function ofType<K extends SimEvent['type']>(events: SimEvent[], type: K) {
  return events.filter((e): e is Extract<SimEvent, { type: K }> => e.type === type);
}

/** Inimigos de teste: `slow` (1 ouro, 28 s para atravessar o mapa pequeno) e o chefão `titan`. */
const stackEnemies: EnemyData = {
  armor: testEnemies.armor,
  elite: testEnemies.elite,
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
  spawnSeconds: 0.25,
  enemies: [{ type: 'slow', count, elite: false }],
});

/** Ondas 1 a 6 de inimigos lentos (um a cada 2 ticks) e a 7 com o chefão. */
function stackWaves(maxActiveEnemies = 1000): WaveData {
  return {
    maxActiveEnemies,
    waves: [
      slow(3),
      slow(2),
      slow(2),
      slow(1),
      slow(1),
      slow(1),
      { hpMultiplier: 1, spawnSeconds: 0.25, enemies: [{ type: 'titan', count: 1, elite: false }] },
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
  // Sem recompensas (T24): aqui só importa o empilhamento.
  const systems = createGameSystems(smallMap, {
    enemies: stackEnemies,
    nexus: blindNexus,
    waves: stackWaves(maxActiveEnemies),
    rewards: noRewards,
    ticksPerSecond: TPS,
  });
  // Depois das ações e dos nascimentos (relógio da recompensa, ações, tempo
  // esgotado e nascimentos), antes do ouro e do fim das ondas.
  systems.splice(4, 0, killer);
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

describe('dados da T14 (bônus antecipado da T19)', () => {
  it('economy.json: bônus antecipado de 5 por onda ativa, sem multiplicador de abate', () => {
    expect(economyData.earlyCall).toEqual({ perActiveWave: 5, windowPercent: 75 });
    expect(economyJson).not.toHaveProperty('killGoldMultiplier');
  });

  it('waves.json: até 1.000 inimigos ativos', () => {
    expect(wavesJson.maxActiveEnemies).toBe(1000);
  });

  it('recusa dados ruins', () => {
    const noEarly = structuredClone(economyJson) as Record<string, unknown>;
    delete noEarly.earlyCall;
    expect(() => loadEconomyData(noEarly)).toThrow(/earlyCall/);
    const oldEarly = structuredClone(economyJson) as Record<string, unknown>;
    oldEarly.earlyCall = { bonusPercent: 50 };
    expect(() => loadEconomyData(oldEarly)).toThrow(/perActiveWave/);
    const negative = structuredClone(economyJson);
    negative.earlyCall.perActiveWave = -1;
    expect(() => loadEconomyData(negative)).toThrow(/earlyCall/);
    const badLimit = { ...structuredClone(wavesJson), maxActiveEnemies: 0 };
    expect(() => loadWaveData(badLimit, enemyData)).toThrow(/maxActiveEnemies/);
  });

  it('bônus antecipado: 5 × ondas já ativas na chamada (0 sem onda ativa)', () => {
    expect([0, 1, 2, 3, 8].map((n) => earlyBonusFor(economyData, n))).toEqual([0, 5, 10, 15, 40]);
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
      earlyBonus: 5,
    });
    expect(sim.state.waves.active.map((w) => w.earlyBonus)).toEqual([0, 5]);
    run(sim, 10); // todos nasceram
    const goldBefore = sim.state.gold;
    // Mata a onda 2 inteira: ela está limpa, mas espera a 1 fechar, sem bônus.
    control.kill = (e) => e.wave === 2;
    let events = run(sim, 2);
    expect(ofType(events, 'waveEnded')).toHaveLength(0);
    expect(activeNumbers(sim.state)).toEqual([1, 2]);
    // Só o ouro dos 2 abates (1 cada nos dados de teste), sem multiplicador.
    expect(sim.state.gold).toBe(goldBefore + 2);
    // Mata a onda 1: as duas fecham no mesmo tick, em ordem, cada uma com o seu endWave.
    control.kill = (e) => e.wave === 1;
    events = run(sim, 1);
    const ended = ofType(events, 'waveEnded');
    expect(ended.map((e) => [e.wave, e.bonus, e.earlyBonus])).toEqual([
      [1, 16, 0],
      [2, 17, 5],
    ]);
    expect(ofType(events, 'shopChanged').filter((e) => e.reason === 'newWave')).toHaveLength(2);
    expect(sim.state.wave).toBe(2);
    expect(sim.state.waves.active).toEqual([]);
    // Ordem dentro do fechamento: juros sobre o ouro guardado, renda, bônus antecipado.
    const second = ended[1]!;
    expect(second.interest).toBe(Math.min(10, Math.floor(ended[0]!.gold / 10)));
    expect(second.gold - ended[0]!.gold).toBe(second.interest + 17 + 5);
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

  it('no jogo real: as ondas 1 a 19 juntas num tick só; a 20 (chefão) é recusada; antecipado soma 855', () => {
    const sim = shopSim('pilha-real');
    const events = call(sim, 20);
    const started = ofType(events, 'waveStarted');
    expect(started.map((e) => e.wave)).toEqual(Array.from({ length: 19 }, (_, i) => i + 1));
    // 5 × (0 + 1 + 2 + … + 18) = 855.
    expect(started.map((e) => e.earlyBonus)).toEqual(Array.from({ length: 19 }, (_, i) => 5 * i));
    expect(ofType(events, 'callWaveRefused')[0]!.reason).toBe('active');
    expect(buildWaveHudModel(sim.state)).toEqual({
      label: 'Ondas 1–19 de 40',
      detail: expect.stringMatching(/^Restam /) as unknown as string,
      pendingBonus: '+855 ao limpar',
      callLabel: 'Chefão: limpe o mapa',
      canCall: false,
      bonusWindow: null,
      upcoming: [
        { wave: 20, kind: 'boss' },
        { wave: 21, kind: 'normal' },
        { wave: 22, kind: 'normal' },
        { wave: 23, kind: 'normal' },
        { wave: 24, kind: 'normal' },
      ],
    });
  });

  it('HUD: o botão mostra o bônus da próxima chamada (+5 com 1 ativa, +10 com 2)', () => {
    const { sim } = stackSim();
    const schedules = buildWaveSchedules(stackWaves(), TPS);
    const hud = () => buildWaveHudModel(sim.state, false, schedules, economyData, stackEnemies);
    expect(hud().callLabel).toBe('Chamar onda (Espaço)');
    call(sim);
    expect(hud().callLabel).toBe('Chamar antecipada (+5)');
    expect(hud().pendingBonus).toBe('');
    call(sim);
    expect(hud().callLabel).toBe('Chamar antecipada (+10)');
    expect(hud().pendingBonus).toBe('+5 ao limpar');
    call(sim);
    expect(hud().pendingBonus).toBe('+15 ao limpar');
  });

  it('onda limpa esperando a anterior fechar ainda conta como ativa (e já nasceu toda: sem bônus, T23)', () => {
    const { sim, control } = stackSim();
    call(sim, 2);
    run(sim, 10);
    control.kill = (e) => e.wave === 2;
    run(sim, 2);
    control.kill = () => false;
    expect(activeNumbers(sim.state)).toEqual([1, 2]);
    // A onda 2 (a mais recente) já nasceu toda: a janela do bônus fechou.
    expect(ofType(call(sim), 'waveStarted')[0]).toMatchObject({
      wave: 3,
      early: true,
      earlyBonus: 0,
    });
    expect(activeNumbers(sim.state)).toEqual([1, 2, 3]);
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

describe('ouro de abate sem multiplicador', () => {
  it('com várias ondas ativas, o abate paga só o gold dos dados (e o estado não guarda multiplicador)', () => {
    const { sim, control } = stackSim();
    sim.enqueue({ type: 'spawnEnemy', enemyType: 'slow' });
    call(sim, 5);
    expect(sim.state.waves).toEqual({ active: expect.any(Array) as unknown });
    const gold = sim.state.gold;
    control.kill = (e) => e.wave === 0;
    run(sim, 1);
    expect(sim.state.gold).toBe(gold + 1);
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
      [2, 5],
      [3, 10],
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

  it('recusa ondas fora de ordem e save de versão antiga (com o multiplicador)', () => {
    const sim = shopSim('save-pilha-ruim');
    call(sim, 3);
    const good = JSON.parse(sim.serialize()) as RunState;
    expect(good.version).toBe(RUN_STATE_VERSION);
    const swapped = structuredClone(good);
    swapped.waves.active.reverse();
    expect(() => Simulation.restore(JSON.stringify(swapped))).toThrow(/inválido/);
    expect(good.waves).not.toHaveProperty('goldMultiplier');
    expect(good.waves).not.toHaveProperty('goldFraction');
    const old = structuredClone(good) as unknown as Record<string, unknown>;
    old.version = 12;
    old.waves = { ...good.waves, goldMultiplier: 2, goldFraction: 0.5 };
    expect(() => Simulation.restore(JSON.stringify(old))).toThrow(/Versão/);
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

    // Sem recompensas: a tela congela os ticks e anda em 1x (testado em rewards.test.ts).
    const systems = () => createGameSystems(realMap, { rewards: noRewards });
    const reference = Simulation.create('velocidade', systems());
    setup(reference);
    const referenceDone = new Set<number>();
    while (reference.state.tick < TOTAL) {
      enqueuePlanned(reference, referenceDone);
      reference.step();
    }

    const frame = 1000 / engineConfig.ticksPerSecond;
    for (const speed of [1, 2, 3]) {
      const runner = new SimulationRunner(Simulation.create('velocidade', systems()), {
        ...engineConfig,
        maxTicksPerFrame: 1000,
      });
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
