import { describe, expect, it } from 'vitest';
import engineConfig from '../src/data/engine.json';
import wavesJson from '../src/data/waves.json';
import { enemyData, getEnemyType } from '../src/sim/enemies/enemyData';
import type { SimEvent } from '../src/sim/engine/events';
import { Simulation } from '../src/sim/engine/simulation';
import { deserializeRunState, type RunState } from '../src/sim/state';
import { createGameSystems } from '../src/sim/systems';
import { buildWaveSchedule, buildWaveSchedules } from '../src/sim/waves/schedule';
import { loadWaveData, waveData, type WaveData } from '../src/sim/waves/waveData';
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
import { botCells, botMap } from './support/waveBot';
import { buildRoutes } from '../src/sim/enemies/route';

const TICKS = engineConfig.ticksPerSecond;
const SPEC_TOTALS = [10, 16, 24, 32, 42, 55, 70, 90, 130, 61];

function totalOf(wave: WaveData['waves'][number]): number {
  return [...wave.pulses.flat(), ...wave.mass].reduce((sum, g) => sum + g.count, 0);
}

function typesOf(wave: WaveData['waves'][number]): Set<string> {
  return new Set([...wave.pulses.flat(), ...wave.mass].map((g) => g.type));
}

function ofType<K extends SimEvent['type']>(events: SimEvent[], type: K) {
  return events.filter((e): e is Extract<SimEvent, { type: K }> => e.type === type);
}

describe('dados das ondas (especificação aprovada em 30/09)', () => {
  it('10 ondas com os totais da tabela (a 10 é chefão + 60)', () => {
    expect(waveData.waves.map(totalOf)).toEqual(SPEC_TOTALS);
  });

  it('2 ou 3 pulsos de 3 a 8 inimigos e uma massa final', () => {
    for (const wave of waveData.waves) {
      expect(wave.pulses.length).toBeGreaterThanOrEqual(2);
      expect(wave.pulses.length).toBeLessThanOrEqual(3);
      for (const pulse of wave.pulses) {
        const size = pulse.reduce((sum, g) => sum + g.count, 0);
        expect(size).toBeGreaterThanOrEqual(3);
        expect(size).toBeLessThanOrEqual(8);
      }
      expect(wave.mass.length).toBeGreaterThan(0);
    }
  });

  it('intervalos: 0,5 s nos pulsos, 4 s de pausa e 0,15 s na massa', () => {
    expect(waveData.timing).toEqual({
      pulseSpawnSeconds: 0.5,
      pulsePauseSeconds: 4,
      massSpawnSeconds: 0.15,
    });
  });

  it('vida composta: 1,12^(n−1), com a onda 1 em 1,0', () => {
    waveData.waves.forEach((wave, i) => {
      expect(wave.hpMultiplier).toBeCloseTo(1.12 ** i, 2);
    });
    expect(waveData.waves[0]!.hpMultiplier).toBe(1);
  });

  it('arco dos tipos: comuns, rápidos na 3, blindados na 4, voadores na 5, todos na 9', () => {
    const types = waveData.waves.map(typesOf);
    expect([...types[0]!]).toEqual(['common']);
    expect([...types[1]!]).toEqual(['common']);
    expect(types[2]).toEqual(new Set(['common', 'fast']));
    expect(types[3]!.has('armored')).toBe(true);
    expect(types.slice(0, 3).some((t) => t.has('armored'))).toBe(false);
    expect(types[4]!.has('flying')).toBe(true);
    expect(types.slice(0, 4).some((t) => t.has('flying'))).toBe(false);
    expect(types[8]).toEqual(new Set(['common', 'fast', 'armored', 'flying']));
  });

  it('o chefão só aparece na onda 10, uma vez, no meio da massa', () => {
    waveData.waves.slice(0, 9).forEach((wave) => expect(typesOf(wave).has('boss')).toBe(false));
    const last = waveData.waves[9]!;
    expect(last.pulses.flat().some((g) => g.type === 'boss')).toBe(false);
    const mass = last.mass.flatMap((g) => Array<string>(g.count).fill(g.type));
    expect(mass.filter((t) => t === 'boss')).toHaveLength(1);
    const at = mass.indexOf('boss');
    expect(at).toBe(Math.floor(mass.length / 2));
  });

  it('chefão em enemies.json: vida 1.500, velocidade 0,5, armadura 30, ouro 50, boss', () => {
    expect(getEnemyType(enemyData, 'boss')).toMatchObject({
      hp: 1500,
      speed: 0.5,
      armor: 30,
      gold: 50,
      boss: true,
    });
  });

  it('recusa dados ruins com erro claro', () => {
    interface RawWaves {
      timing?: Record<string, number>;
      waves: { hpMultiplier: number; mass: { type: string; count: number }[] }[];
    }
    const bad = (change: (raw: RawWaves) => void) => {
      const raw = structuredClone(wavesJson) as unknown as RawWaves;
      change(raw);
      return () => loadWaveData(raw, enemyData);
    };
    expect(bad(() => {})).not.toThrow();
    expect(bad((r) => (r.waves[0]!.mass[0]!.type = 'dragão'))).toThrow(/desconhecido/);
    expect(bad((r) => (r.waves[0]!.mass[0]!.count = 0))).toThrow(/inteiro positivo/);
    expect(bad((r) => (r.waves[0]!.mass = []))).toThrow(/não vazia/);
    expect(bad((r) => delete r.timing)).toThrow(/timing/);
    expect(bad((r) => (r.timing!.massSpawnSeconds = 0))).toThrow(/timing/);
    expect(bad((r) => (r.waves[0]!.hpMultiplier = 0))).toThrow(/hpMultiplier/);
    expect(bad((r) => (r.waves = []))).toThrow(/nenhuma onda/);
  });
});

describe('lista de nascimentos', () => {
  it('onda 1: pulsos a cada 0,5 s, pausas de 4 s e massa a cada 0,15 s', () => {
    const { entries } = buildWaveSchedule(waveData.waves[0]!, waveData.timing, TICKS);
    // 3 + 3 nos pulsos, 4 na massa.
    expect(entries.map((e) => e.tick)).toEqual([0, 15, 30, 150, 165, 180, 300, 305, 309, 314]);
    expect(entries.every((e) => e.type === 'common')).toBe(true);
  });

  it('a ordem segue os dados, e os ticks nunca voltam', () => {
    for (const [i, wave] of waveData.waves.entries()) {
      const { entries, hpMultiplier } = buildWaveSchedule(wave, waveData.timing, TICKS);
      expect(entries).toHaveLength(SPEC_TOTALS[i]!);
      expect(hpMultiplier).toBe(wave.hpMultiplier);
      const expected = [...wave.pulses.flat(), ...wave.mass].flatMap((g) =>
        Array<string>(g.count).fill(g.type),
      );
      expect(entries.map((e) => e.type)).toEqual(expected);
      for (let k = 1; k < entries.length; k++) {
        expect(entries[k]!.tick).toBeGreaterThan(entries[k - 1]!.tick);
      }
    }
  });

  it('a massa não acumula erro de arredondamento (130 inimigos da onda 9)', () => {
    const wave = waveData.waves[8]!;
    const { entries } = buildWaveSchedule(wave, waveData.timing, TICKS);
    const massSize = wave.mass.reduce((sum, g) => sum + g.count, 0);
    const mass = entries.slice(entries.length - massSize);
    const span = mass[mass.length - 1]!.tick - mass[0]!.tick;
    expect(Math.abs(span - (massSize - 1) * 0.15 * TICKS)).toBeLessThanOrEqual(1);
  });
});

/** Ondas pequenas para o mapa de teste: 2 caminhantes; depois o chefão de teste. */
const smallWaves: WaveData = {
  timing: { pulseSpawnSeconds: 0.5, pulsePauseSeconds: 1, massSpawnSeconds: 0.25 },
  waves: [
    { hpMultiplier: 1, pulses: [], mass: [{ type: 'walker', count: 2 }] },
    {
      hpMultiplier: 2,
      pulses: [[{ type: 'walker', count: 1 }]],
      mass: [{ type: 'titan', count: 1 }],
    },
  ],
};

function smallWaveSim(state: RunState = makeState('ondas', blindNexus)): Simulation {
  return new Simulation(
    state,
    createGameSystems(smallMap, {
      enemies: testEnemies,
      nexus: blindNexus,
      waves: smallWaves,
      ticksPerSecond: TPS,
    }),
  );
}

/** Núcleo que alcança o mapa todo e mata qualquer inimigo de teste num golpe (um por tick). */
function killerSim(state: RunState = makeState('matador', blindNexus)): Simulation {
  return new Simulation(
    state,
    createGameSystems(smallMap, {
      enemies: testEnemies,
      nexus: { ...blindNexus, attack: { damage: 1000, cooldownSeconds: 1 / TPS, range: 100 } },
      waves: smallWaves,
      ticksPerSecond: TPS,
    }),
  );
}

function runUntil(sim: Simulation, done: () => boolean, limit = 2000): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < limit && !done(); i++) {
    sim.step();
    events.push(...sim.drainEvents());
  }
  return events;
}

describe('chamar onda e fim automático', () => {
  it('chamar começa a onda no mesmo tick, com o primeiro inimigo na entrada', () => {
    const sim = smallWaveSim();
    sim.enqueue({ type: 'callWave' });
    const events = stepOnce(sim);
    expect(ofType(events, 'waveStarted')).toEqual([
      expect.objectContaining({ wave: 1, tick: sim.state.tick }),
    ]);
    expect(sim.state.waves).toMatchObject({ active: true, startTick: 1, spawned: 1 });
    expect(activeEnemies(sim.state)).toHaveLength(1);
  });

  it('a onda fecha sozinha pelo endWave quando todos nasceram e nenhum está vivo', () => {
    const sim = smallWaveSim();
    const goldBefore = sim.state.gold;
    sim.enqueue({ type: 'callWave' });
    const events = runUntil(sim, () => !sim.state.waves.active && sim.state.tick > 1);
    const ended = ofType(events, 'waveEnded');
    expect(ended).toHaveLength(1);
    expect(ended[0]).toMatchObject({ wave: 1 });
    expect(ofType(events, 'shopChanged').some((e) => e.reason === 'newWave')).toBe(true);
    expect(sim.state.wave).toBe(1);
    // Os 2 caminhantes chegaram ao núcleo cego: nenhum abate, só juros e bônus.
    expect(sim.state.stats.kills).toBe(0);
    expect(sim.state.gold).toBe(goldBefore + ended[0]!.interest + ended[0]!.bonus);
  });

  it('o ouro do último abate entra antes dos juros', () => {
    const sim = killerSim();
    sim.state.gold = 48; // + 2 abates de 1 ouro = 50 → juros 5 (sem o último, 49 → 4)
    sim.enqueue({ type: 'callWave' });
    const events = runUntil(sim, () => !sim.state.waves.active && sim.state.tick > 1);
    expect(sim.state.stats.kills).toBe(2);
    expect(ofType(events, 'waveEnded')[0]!.interest).toBe(5);
  });

  it('só chama com o mapa limpo: onda ativa ou inimigo vivo recusam', () => {
    const sim = smallWaveSim();
    sim.enqueue({ type: 'callWave' });
    stepOnce(sim);
    sim.enqueue({ type: 'callWave' });
    expect(ofType(stepOnce(sim), 'callWaveRefused')).toEqual([
      expect.objectContaining({ reason: 'active' }),
    ]);
    runUntil(sim, () => !sim.state.waves.active);
    sim.enqueue({ type: 'spawnEnemy', enemyType: 'walker' });
    stepOnce(sim);
    sim.enqueue({ type: 'callWave' });
    expect(ofType(stepOnce(sim), 'callWaveRefused')).toEqual([
      expect.objectContaining({ reason: 'enemies' }),
    ]);
    expect(sim.state.wave).toBe(1);
  });

  it('vida da onda multiplicada; o chefão fica com a vida dos dados', () => {
    const sim = smallWaveSim();
    sim.state.wave = 1; // a próxima é a 2 (multiplicador 2)
    sim.enqueue({ type: 'callWave' });
    runUntil(sim, () => sim.state.waves.spawned === 2);
    const [walker, titan] = activeEnemies(sim.state).sort((a, b) => a.id - b.id);
    expect(walker!.maxHp).toBe(testEnemies.types.walker!.hp * 2);
    expect(titan!.maxHp).toBe(testEnemies.types.titan!.hp);
  });

  it('o multiplicador composto vale no mapa real (onda 2: comum com 30 × 1,12)', () => {
    const sim = shopSim('vida');
    sim.enqueue({ type: 'endWave' });
    sim.enqueue({ type: 'callWave' });
    stepOnce(sim);
    expect(activeEnemies(sim.state)[0]!.maxHp).toBeCloseTo(30 * 1.12, 9);
  });
});

describe('chefão, vitória e derrota', () => {
  it('chefão no núcleo é derrota imediata, com o núcleo cheio', () => {
    const sim = smallWaveSim();
    sim.state.wave = 1;
    sim.enqueue({ type: 'callWave' });
    const events = runUntil(sim, () => sim.state.status !== 'playing');
    expect(sim.state.status).toBe('lost');
    expect(ofType(events, 'bossReachedNexus')).toHaveLength(1);
    expect(ofType(events, 'runLost')).toHaveLength(1);
    expect(ofType(events, 'runWon')).toHaveLength(0);
    // O caminhante (dano 2) chegou antes: o chefão derrubou o resto.
    expect(sim.state.nexus.hp).toBe(0);
  });

  it('com o núcleo invulnerável, o chefão sai do mapa sem derrota (e sem vitória)', () => {
    const sim = smallWaveSim();
    sim.state.wave = 1;
    sim.enqueue({ type: 'debugSetNexusInvulnerable', value: true });
    sim.enqueue({ type: 'callWave' });
    const events = runUntil(sim, () => !sim.state.waves.active && sim.state.tick > 1);
    expect(sim.state.status).toBe('playing');
    expect(ofType(events, 'bossReachedNexus')).toHaveLength(0);
    expect(ofType(events, 'waveEnded')).toHaveLength(1);
    expect(sim.state.wave).toBe(2);
    expect(ofType(events, 'runWon')).toHaveLength(0);
    // Sem ondas restantes, chamar é recusado.
    sim.enqueue({ type: 'callWave' });
    expect(ofType(stepOnce(sim), 'callWaveRefused')[0]!.reason).toBe('over');
  });

  it('vitória: a última onda termina com o chefão morto, depois do endWave', () => {
    const sim = killerSim();
    sim.state.wave = 1;
    sim.enqueue({ type: 'callWave' });
    const events = runUntil(sim, () => sim.state.status !== 'playing');
    expect(sim.state.status).toBe('won');
    const order = events
      .filter((e) => e.type === 'waveEnded' || e.type === 'runWon')
      .map((e) => e.type);
    expect(order).toEqual(['waveEnded', 'runWon']);
    expect(sim.state.wave).toBe(2);
    expect(sim.state.stats.kills).toBe(2);
    // A run fica congelada.
    const tick = sim.state.tick;
    sim.step();
    expect(sim.state.tick).toBe(tick);
  });

  it('abates contam todos os autores, inclusive o núcleo', () => {
    const sim = killerSim();
    sim.enqueue({ type: 'spawnEnemy', enemyType: 'walker' });
    runUntil(sim, () => sim.state.stats.kills === 1, 50);
    expect(sim.state.stats.kills).toBe(1);
  });
});

describe('debug: encerrar e pular ondas', () => {
  it('"Encerrar onda" com onda ativa tira os inimigos, sem ouro de abate, e fecha a onda', () => {
    const sim = shopSim('encerrar');
    sim.enqueue({ type: 'callWave' });
    for (let i = 0; i < 200; i++) sim.step();
    expect(sim.state.enemies.activeCount).toBeGreaterThan(0);
    const gold = sim.state.gold;
    sim.enqueue({ type: 'endWave' });
    const events = stepOnce(sim);
    const ended = ofType(events, 'waveEnded')[0]!;
    expect(sim.state.waves.active).toBe(false);
    expect(sim.state.wave).toBe(1);
    expect(sim.state.enemies.activeCount).toBe(0);
    expect(sim.state.gold).toBe(gold + ended.interest + ended.bonus);
    expect(ofType(events, 'enemyKilled')).toHaveLength(0);
    // A próxima chamada é a onda 2.
    sim.enqueue({ type: 'callWave' });
    expect(ofType(stepOnce(sim), 'waveStarted')[0]!.wave).toBe(2);
  });

  it('"Pular para onda 10" fecha as ondas 1 a 9 pelo endWave; depois da última, nada muda', () => {
    const sim = shopSim('pular');
    sim.enqueue({ type: 'debugSkipToWave', wave: 10 });
    const events = stepOnce(sim);
    expect(ofType(events, 'waveEnded').map((e) => e.wave)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(sim.state.wave).toBe(9);
    expect(buildWaveHudModel(sim.state).label).toBe('Onda 10/10');
    sim.enqueue({ type: 'callWave' });
    stepOnce(sim);
    expect(sim.state.waves.active).toBe(true);
    // Com onda ativa, pular não faz nada.
    sim.enqueue({ type: 'debugSkipToWave', wave: 10 });
    stepOnce(sim);
    expect(sim.state.wave).toBe(9);
    // Encerrar a última onda pelo debug não é vitória, e depois dela não há mais o que encerrar.
    sim.enqueue({ type: 'endWave' });
    stepOnce(sim);
    expect(sim.state.status).toBe('playing');
    sim.enqueue({ type: 'endWave' });
    expect(ofType(stepOnce(sim), 'waveEnded')).toHaveLength(0);
    expect(sim.state.wave).toBe(10);
  });

  it('o chefão real nasce com a vida dos dados na onda 10', () => {
    const sim = shopSim('chefao');
    sim.enqueue({ type: 'debugSkipToWave', wave: 10 });
    sim.enqueue({ type: 'debugSetNexusInvulnerable', value: true });
    sim.enqueue({ type: 'callWave' });
    for (let i = 0; i < 1200 && !activeEnemies(sim.state).some((e) => e.type === 'boss'); i++) {
      sim.step();
    }
    const boss = activeEnemies(sim.state).find((e) => e.type === 'boss')!;
    expect(boss.maxHp).toBe(1500);
    const escort = activeEnemies(sim.state).find((e) => e.type === 'common')!;
    expect(escort.maxHp).toBeCloseTo(30 * waveData.waves[9]!.hpMultiplier, 9);
  });
});

describe('HUD das ondas', () => {
  it('mostra a onda, o que falta e se dá para chamar', () => {
    const sim = shopSim('hud');
    expect(buildWaveHudModel(sim.state)).toEqual({
      label: 'Onda 1/10',
      detail: 'Pronta para chamar',
      canCall: true,
    });
    sim.enqueue({ type: 'callWave' });
    stepOnce(sim);
    // 1 nasceu e está vivo, 9 faltam nascer.
    expect(buildWaveHudModel(sim.state)).toEqual({
      label: 'Onda 1/10',
      detail: 'Restam 10',
      canCall: false,
    });
    sim.enqueue({ type: 'endWave' });
    sim.enqueue({ type: 'debugSpawnEnemies', count: 2, enemyType: 'common', layout: 'spread' });
    stepOnce(sim);
    expect(buildWaveHudModel(sim.state)).toEqual({
      label: 'Onda 2/10',
      detail: 'Limpe o mapa (2)',
      canCall: false,
    });
  });
});

describe('save versão 9 com ondas', () => {
  function midWave(): Simulation {
    const sim = Simulation.create('save', createGameSystems(realMap));
    sim.enqueue({
      type: 'debugSpawnTowers',
      count: 6,
      towerTypes: ['mortar', 'reaper'],
      layout: 'spread',
    });
    sim.enqueue({ type: 'endWave' });
    sim.enqueue({ type: 'callWave' });
    for (let i = 0; i < 250; i++) sim.step();
    return sim;
  }

  it('no meio da onda: retomar dá o mesmo estado que seguir jogando', () => {
    const a = midWave();
    expect(a.state.waves.active).toBe(true);
    const b = Simulation.restore(a.serialize(), createGameSystems(realMap));
    for (let i = 0; i < 900; i++) {
      a.step();
      b.step();
    }
    expect(b.serialize()).toBe(a.serialize());
    expect(a.state.wave).toBeGreaterThanOrEqual(2);
  });

  it('entre ondas: retomar e chamar a próxima dá o mesmo estado', () => {
    const a = midWave();
    for (let i = 0; i < 3000 && a.state.waves.active; i++) a.step();
    expect(a.state.waves.active).toBe(false);
    const b = Simulation.restore(a.serialize(), createGameSystems(realMap));
    for (const sim of [a, b]) {
      sim.enqueue({ type: 'callWave' });
      for (let i = 0; i < 400; i++) sim.step();
    }
    expect(b.serialize()).toBe(a.serialize());
  });

  it('recusa save sem as ondas ou sem as estatísticas, e aceita a vitória', () => {
    const good = JSON.parse(midWave().serialize()) as RunState;
    expect(good.version).toBe(9);
    expect(() => deserializeRunState(JSON.stringify(good))).not.toThrow();
    const noWaves = { ...good, waves: undefined };
    expect(() => deserializeRunState(JSON.stringify(noWaves))).toThrow(/inválido/);
    const badSpawned = { ...good, waves: { ...good.waves, spawned: -1 } };
    expect(() => deserializeRunState(JSON.stringify(badSpawned))).toThrow(/inválido/);
    const noStats = { ...good, stats: undefined };
    expect(() => deserializeRunState(JSON.stringify(noStats))).toThrow(/inválido/);
    const won = { ...good, status: 'won' };
    expect(deserializeRunState(JSON.stringify(won)).status).toBe('won');
  });
});

describe('ondas padrão completas', () => {
  it('a soma das listas bate com o total da run', () => {
    const schedules = buildWaveSchedules(waveData, TICKS);
    expect(schedules.reduce((sum, s) => sum + s.entries.length, 0)).toBe(
      SPEC_TOTALS.reduce((a, b) => a + b, 0),
    );
  });
});

describe('Carrasco contra o chefão real', () => {
  it('não executa o chefão: abaixo do limite, só o golpe crítico de 3% (com armadura)', () => {
    const sim = shopSim('carrasco');
    const cell = botCells(botMap)[0]!;
    sim.enqueue({ type: 'placeTower', towerType: 'executioner', ...cell });
    sim.enqueue({ type: 'spawnEnemy', enemyType: 'boss' });
    stepOnce(sim);
    const boss = activeEnemies(sim.state).find((e) => e.type === 'boss')!;
    // Leva o chefão para o ponto da rota mais perto da torre, com 10% da vida.
    const route = buildRoutes(realMap).ground;
    const probe = { x: 0, y: 0 };
    let best = 0;
    let bestDist = Infinity;
    for (let d = 0; d <= route.length; d += 0.05) {
      route.sampleInto(d, probe);
      const dist = Math.hypot(probe.x - cell.x, probe.y - cell.y);
      if (dist < bestDist) [best, bestDist] = [d, dist];
    }
    boss.distance = best;
    route.sampleInto(best, boss);
    boss.hp = boss.maxHp * 0.1;
    const events: SimEvent[] = [];
    for (let i = 0; i < 60 && !events.some((e) => e.type === 'triggerFired'); i++) {
      events.push(...stepOnce(sim));
    }
    expect(ofType(events, 'triggerFired')[0]).toMatchObject({ effect: 'execute' });
    expect(boss.active).toBe(true);
    expect(boss.hp).toBeGreaterThan(0);
    expect(boss.hp).toBeLessThan(150);
    expect(ofType(events, 'enemyKilled')).toHaveLength(0);
  });
});
