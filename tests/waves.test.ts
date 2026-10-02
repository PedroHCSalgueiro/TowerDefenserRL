import { describe, expect, it } from 'vitest';
import engineConfig from '../src/data/engine.json';
import wavesJson from '../src/data/waves.json';
import { enemyData, getEnemyType } from '../src/sim/enemies/enemyData';
import type { SimEvent } from '../src/sim/engine/events';
import { Simulation } from '../src/sim/engine/simulation';
import { RUN_STATE_VERSION, deserializeRunState, type RunState } from '../src/sim/state';
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
const ELITE_WAVES = [5, 10, 15, 25, 30, 35];
const BOSS_WAVES: Record<number, string> = { 20: 'boss', 40: 'bossFinal' };
const TYPE_ORDER = ['common', 'fast', 'armored', 'flying'];

type Wave = WaveData['waves'][number];

function totalOf(wave: Wave): number {
  return wave.enemies.reduce((sum, g) => sum + g.count, 0);
}

function normalOf(wave: Wave): number {
  return wave.enemies
    .filter((g) => !g.elite && !getEnemyType(enemyData, g.type).boss)
    .reduce((sum, g) => sum + g.count, 0);
}

function elitesOf(wave: Wave): number {
  return wave.enemies.filter((g) => g.elite).reduce((sum, g) => sum + g.count, 0);
}

function typesOf(wave: Wave): Set<string> {
  return new Set(wave.enemies.filter((g) => !g.elite).map((g) => g.type));
}

function ofType<K extends SimEvent['type']>(events: SimEvent[], type: K) {
  return events.filter((e): e is Extract<SimEvent, { type: K }> => e.type === type);
}

describe('dados das ondas (T21: 40 ondas em fila única)', () => {
  it('40 ondas; a onda 1 tem 6 comuns, 0,7× de vida e um inimigo a cada 2,5 s', () => {
    expect(waveData.waves).toHaveLength(40);
    expect(waveData.waves[0]).toEqual({
      hpMultiplier: 0.7,
      spawnSeconds: 2.5,
      enemies: [{ type: 'common', count: 6, elite: false }],
    });
  });

  it('sem pulsos: cada onda é só a fila (vida, intervalo e grupos)', () => {
    for (const wave of wavesJson.waves) {
      expect(Object.keys(wave).sort()).toEqual(['enemies', 'hpMultiplier', 'spawnSeconds']);
    }
    expect('timing' in wavesJson).toBe(false);
  });

  it('a vida cresce a cada onda (curva composta) e o intervalo nunca cresce da 6 em diante, com piso de 0,25 s', () => {
    for (let i = 1; i < waveData.waves.length; i++) {
      const [prev, wave] = [waveData.waves[i - 1]!, waveData.waves[i]!];
      expect(wave.hpMultiplier).toBeGreaterThan(prev.hpMultiplier);
      if (i >= 6) expect(wave.spawnSeconds).toBeLessThanOrEqual(prev.spawnSeconds);
      expect(wave.spawnSeconds).toBeGreaterThanOrEqual(0.25);
    }
    // Devagar no começo, rápido no fim.
    const h = waveData.waves.map((w) => w.hpMultiplier);
    expect(h[9]! - h[0]!).toBeLessThan(h[39]! - h[30]!);
  });

  it('começo: onda 1 com 2,5 s (M1) e ondas 2 a 5 com intervalo fixo de 1,8 s', () => {
    expect(waveData.waves.slice(0, 5).map((w) => w.spawnSeconds)).toEqual([
      2.5, 1.8, 1.8, 1.8, 1.8,
    ]);
  });

  it('a quantidade cresce nas ondas normais (as de elite e de chefão têm escolta menor)', () => {
    const normal = waveData.waves
      .map((w, i) => ({ n: i + 1, total: totalOf(w) }))
      .filter(({ n }) => !ELITE_WAVES.includes(n) && !(n in BOSS_WAVES));
    for (let i = 1; i < normal.length; i++) {
      expect(normal[i]!.total).toBeGreaterThanOrEqual(normal[i - 1]!.total);
    }
    expect(totalOf(waveData.waves[39]!)).toBeGreaterThan(100);
  });

  it('entrada dos tipos: rápido na 4, blindado na 8, voador na 12', () => {
    const first = (type: string) =>
      waveData.waves.findIndex((w) => w.enemies.some((g) => g.type === type)) + 1;
    expect(first('common')).toBe(1);
    expect(first('fast')).toBe(4);
    expect(first('armored')).toBe(8);
    expect(first('flying')).toBe(12);
    for (const [i, wave] of waveData.waves.entries()) {
      for (const type of typesOf(wave)) {
        if (getEnemyType(enemyData, type).boss) continue;
        expect(TYPE_ORDER).toContain(type);
        expect(i + 1).toBeGreaterThanOrEqual(first(type));
      }
    }
  });

  it('elites só nas ondas 5, 10, 15, 25, 30 e 35 (e na 40), poucos, com tipos já liberados', () => {
    const withElites = waveData.waves.map((w, i) => (elitesOf(w) > 0 ? i + 1 : 0)).filter(Boolean);
    expect(withElites).toEqual([...ELITE_WAVES, 40]);
    for (const n of ELITE_WAVES) {
      const wave = waveData.waves[n - 1]!;
      expect(elitesOf(wave)).toBeGreaterThanOrEqual(2);
      expect(elitesOf(wave)).toBeLessThanOrEqual(8);
      // Escolta pequena: metade dos inimigos de uma onda normal vizinha.
      expect(normalOf(wave)).toBeLessThan(normalOf(waveData.waves[n]!));
      const unlocked = new Set(waveData.waves.slice(0, n).flatMap((w) => [...typesOf(w)]));
      for (const g of wave.enemies.filter((e) => e.elite)) expect(unlocked).toContain(g.type);
    }
  });

  it('chefões: boss só na 20 e bossFinal só na 40, um de cada, no meio da fila', () => {
    for (const [i, wave] of waveData.waves.entries()) {
      const bosses = wave.enemies.filter((g) => getEnemyType(enemyData, g.type).boss);
      const expected = BOSS_WAVES[i + 1];
      if (!expected) {
        expect(bosses).toEqual([]);
        continue;
      }
      expect(bosses).toEqual([{ type: expected, count: 1, elite: false }]);
      const queue = buildWaveSchedule(wave, TICKS).entries.map((e) => e.type);
      const at = queue.indexOf(expected);
      expect(at).toBeGreaterThan(queue.length / 4);
      expect(at).toBeLessThan((queue.length * 3) / 4);
    }
  });

  it('chefões em enemies.json: boss (2.500) e bossFinal (12.000), ouro 0, boss', () => {
    expect(getEnemyType(enemyData, 'boss')).toEqual({
      hp: 2500,
      speed: 0.5,
      armor: 30,
      nexusDamage: 0,
      gold: 0,
      movement: 'ground',
      boss: true,
    });
    expect(getEnemyType(enemyData, 'bossFinal')).toEqual({
      hp: 12000,
      speed: 0.45,
      armor: 40,
      nexusDamage: 0,
      gold: 0,
      movement: 'ground',
      boss: true,
    });
  });

  it('elite em enemies.json: vida ×6, velocidade ×0,8 e 5 de dano no núcleo', () => {
    expect(enemyData.elite).toEqual({ hpMultiplier: 6, speedMultiplier: 0.8, nexusDamage: 5 });
  });

  it('recusa dados ruins com erro claro, inclusive o formato antigo com pulsos', () => {
    const bad = (mutate: (raw: Record<string, unknown> & typeof wavesJson) => void) => {
      const raw = JSON.parse(JSON.stringify(wavesJson)) as Record<string, unknown> &
        typeof wavesJson;
      mutate(raw);
      return () => loadWaveData(raw, enemyData);
    };
    expect(bad(() => undefined)).not.toThrow();
    expect(bad((r) => (r.waves[0]!.enemies[0]!.type = 'dragão'))).toThrow(/desconhecido/);
    expect(bad((r) => (r.waves[0]!.enemies[0]!.count = 0))).toThrow(/inteiro positivo/);
    expect(bad((r) => (r.waves[0]!.enemies = []))).toThrow(/enemies/);
    expect(bad((r) => (r.waves[0]!.spawnSeconds = 0))).toThrow(/spawnSeconds/);
    expect(bad((r) => (r.waves[0]!.hpMultiplier = -1))).toThrow(/hpMultiplier/);
    expect(bad((r) => ((r.waves[0]!.enemies[0] as Record<string, unknown>).elite = 'sim'))).toThrow(
      /elite/,
    );
    expect(
      bad((r) => (r.waves[0]!.enemies[0] = { type: 'boss', count: 1, elite: true } as never)),
    ).toThrow(/chefão/);
    expect(bad((r) => (r.timing = { massSpawnSeconds: 0.15 }))).toThrow(/formato antigo/);
    expect(bad((r) => ((r.waves[0] as Record<string, unknown>).pulses = []))).toThrow(/pulsos/);
    expect(bad((r) => (r.maxActiveEnemies = 0))).toThrow(/maxActiveEnemies/);
    expect(bad((r) => (r.waves = []))).toThrow(/nenhuma onda/);
  });
});

describe('lista de nascimentos (fila única)', () => {
  it('onda 1: um comum a cada 2,5 s, o primeiro no tick da chamada', () => {
    const { entries } = buildWaveSchedule(waveData.waves[0]!, TICKS);
    expect(entries.map((e) => e.tick)).toEqual([0, 75, 150, 225, 300, 375]);
    expect(entries.every((e) => e.type === 'common' && !e.elite)).toBe(true);
  });

  it('a ordem segue os dados, sem pausas: os ticks andam sempre o mesmo intervalo', () => {
    for (const wave of waveData.waves) {
      const { entries, hpMultiplier } = buildWaveSchedule(wave, TICKS);
      expect(entries).toHaveLength(totalOf(wave));
      expect(hpMultiplier).toBe(wave.hpMultiplier);
      const expected = wave.enemies.flatMap((g) =>
        Array.from({ length: g.count }, () => `${g.type}${g.elite ? '*' : ''}`),
      );
      expect(entries.map((e) => `${e.type}${e.elite ? '*' : ''}`)).toEqual(expected);
      const step = wave.spawnSeconds * TICKS;
      for (let k = 1; k < entries.length; k++) {
        const gap = entries[k]!.tick - entries[k - 1]!.tick;
        expect(Math.abs(gap - step)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('a fila longa não acumula erro de arredondamento (onda 40)', () => {
    const wave = waveData.waves[39]!;
    const { entries } = buildWaveSchedule(wave, TICKS);
    const span = entries[entries.length - 1]!.tick;
    expect(Math.abs(span - (entries.length - 1) * wave.spawnSeconds * TICKS)).toBeLessThanOrEqual(
      1,
    );
  });
});

/** Ondas pequenas para o mapa de teste: 2 caminhantes; depois o chefão de teste. */
const smallWaves: WaveData = {
  maxActiveEnemies: 1000,
  waves: [
    { hpMultiplier: 1, spawnSeconds: 0.25, enemies: [{ type: 'walker', count: 2, elite: false }] },
    {
      hpMultiplier: 2,
      spawnSeconds: 0.25,
      enemies: [
        { type: 'walker', count: 1, elite: false },
        { type: 'titan', count: 1, elite: false },
      ],
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
    expect(sim.state.waves.active).toEqual([
      { wave: 1, startTick: 1, spawned: 1, bossesKilled: 0, earlyBonus: 0 },
    ]);
    expect(activeEnemies(sim.state)).toHaveLength(1);
  });

  it('a onda fecha sozinha pelo endWave quando todos nasceram e nenhum está vivo', () => {
    const sim = smallWaveSim();
    const goldBefore = sim.state.gold;
    sim.enqueue({ type: 'callWave' });
    const events = runUntil(sim, () => sim.state.waves.active.length === 0 && sim.state.tick > 1);
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
    const events = runUntil(sim, () => sim.state.waves.active.length === 0 && sim.state.tick > 1);
    expect(sim.state.stats.kills).toBe(2);
    expect(ofType(events, 'waveEnded')[0]!.interest).toBe(5);
  });

  it('a onda com chefão só é chamada com o mapa limpo: onda ativa ou inimigo vivo recusam', () => {
    const sim = smallWaveSim();
    sim.enqueue({ type: 'callWave' });
    stepOnce(sim);
    // A próxima (2) tem chefão: com a onda 1 ativa, é recusada.
    sim.enqueue({ type: 'callWave' });
    expect(ofType(stepOnce(sim), 'callWaveRefused')).toEqual([
      expect.objectContaining({ reason: 'active' }),
    ]);
    runUntil(sim, () => sim.state.waves.active.length === 0);
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
    runUntil(sim, () => sim.state.waves.active[0]?.spawned === 2);
    const [walker, titan] = activeEnemies(sim.state).sort((a, b) => a.id - b.id);
    expect(walker!.maxHp).toBe(testEnemies.types.walker!.hp * 2);
    expect(titan!.maxHp).toBe(testEnemies.types.titan!.hp);
  });

  it('o multiplicador da onda vale no mapa real (onda 2: comum com 30 × o da onda 2)', () => {
    const sim = shopSim('vida');
    sim.enqueue({ type: 'endWave' });
    sim.enqueue({ type: 'callWave' });
    stepOnce(sim);
    expect(activeEnemies(sim.state)[0]!.maxHp).toBeCloseTo(30 * waveData.waves[1]!.hpMultiplier, 9);
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
    const events = runUntil(sim, () => sim.state.waves.active.length === 0 && sim.state.tick > 1);
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
    expect(sim.state.waves.active).toEqual([]);
    expect(sim.state.wave).toBe(1);
    expect(sim.state.enemies.activeCount).toBe(0);
    expect(sim.state.gold).toBe(gold + ended.interest + ended.bonus);
    expect(ofType(events, 'enemyKilled')).toHaveLength(0);
    // A próxima chamada é a onda 2.
    sim.enqueue({ type: 'callWave' });
    expect(ofType(stepOnce(sim), 'waveStarted')[0]!.wave).toBe(2);
  });

  it('"Pular para onda 40" fecha as ondas 1 a 39 pelo endWave; depois da última, nada muda', () => {
    const sim = shopSim('pular');
    sim.enqueue({ type: 'debugSkipToWave', wave: 40 });
    const events = stepOnce(sim);
    expect(ofType(events, 'waveEnded').map((e) => e.wave)).toEqual(
      Array.from({ length: 39 }, (_, i) => i + 1),
    );
    expect(sim.state.wave).toBe(39);
    expect(buildWaveHudModel(sim.state).label).toBe('Onda 40/40');
    sim.enqueue({ type: 'callWave' });
    stepOnce(sim);
    expect(sim.state.waves.active.length).toBeGreaterThan(0);
    // Com onda ativa, pular não faz nada.
    sim.enqueue({ type: 'debugSkipToWave', wave: 40 });
    stepOnce(sim);
    expect(sim.state.wave).toBe(39);
    // Encerrar a última onda pelo debug não é vitória, e depois dela não há mais o que encerrar.
    sim.enqueue({ type: 'endWave' });
    stepOnce(sim);
    expect(sim.state.status).toBe('playing');
    sim.enqueue({ type: 'endWave' });
    expect(ofType(stepOnce(sim), 'waveEnded')).toHaveLength(0);
    expect(sim.state.wave).toBe(40);
  });

  it.each([
    [20, 'boss', 2500],
    [40, 'bossFinal', 12000],
  ])('o chefão real da onda %i (%s) nasce com a vida dos dados', (wave, type, hp) => {
    const sim = shopSim(`chefao-${wave}`);
    sim.enqueue({ type: 'debugSkipToWave', wave });
    sim.enqueue({ type: 'debugSetNexusInvulnerable', value: true });
    sim.enqueue({ type: 'callWave' });
    for (let i = 0; i < 3000 && !activeEnemies(sim.state).some((e) => e.type === type); i++) {
      sim.step();
    }
    const boss = activeEnemies(sim.state).find((e) => e.type === type)!;
    expect(boss.maxHp).toBe(hp);
    expect(boss.elite).toBe(false);
    const escort = activeEnemies(sim.state).find((e) => e.type === 'common' && !e.elite)!;
    expect(escort.maxHp).toBeCloseTo(30 * waveData.waves[wave - 1]!.hpMultiplier, 9);
  });
});

describe('HUD das ondas', () => {
  it('mostra a onda, o que falta e se dá para chamar', () => {
    const sim = shopSim('hud');
    expect(buildWaveHudModel(sim.state)).toEqual({
      label: 'Onda 1/40',
      detail: 'Pronta para chamar',
      pendingBonus: '',
      callLabel: 'Chamar onda (Espaço)',
      canCall: true,
    });
    sim.enqueue({ type: 'callWave' });
    stepOnce(sim);
    // 1 nasceu e está vivo, 5 faltam nascer; a onda 2 pode vir antecipada (1 ativa → +5).
    expect(buildWaveHudModel(sim.state)).toMatchObject({
      label: 'Onda 1/40',
      detail: 'Restam 6',
      callLabel: 'Chamar antecipada (+5)',
      canCall: true,
    });
    // Pausado, não chama.
    expect(buildWaveHudModel(sim.state, true).canCall).toBe(false);
  });

  it('chefão: com inimigo vivo no mapa, pede para limpar', () => {
    const sim = shopSim('hud-chefao');
    sim.enqueue({ type: 'debugSkipToWave', wave: 20 });
    sim.enqueue({ type: 'debugSpawnEnemies', count: 2, enemyType: 'common', layout: 'spread' });
    stepOnce(sim);
    expect(buildWaveHudModel(sim.state)).toMatchObject({
      label: 'Onda 20/40',
      detail: 'Limpe o mapa (2)',
      canCall: false,
    });
  });
});

describe('save com ondas', () => {
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
    expect(a.state.waves.active.length).toBeGreaterThan(0);
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
    for (let i = 0; i < 3000 && a.state.waves.active.length > 0; i++) a.step();
    expect(a.state.waves.active).toEqual([]);
    const b = Simulation.restore(a.serialize(), createGameSystems(realMap));
    for (const sim of [a, b]) {
      sim.enqueue({ type: 'callWave' });
      for (let i = 0; i < 400; i++) sim.step();
    }
    expect(b.serialize()).toBe(a.serialize());
  });

  it('recusa save sem as ondas ou sem as estatísticas, e aceita a vitória', () => {
    const good = JSON.parse(midWave().serialize()) as RunState;
    expect(good.version).toBe(RUN_STATE_VERSION);
    expect(() => deserializeRunState(JSON.stringify(good))).not.toThrow();
    const noWaves = { ...good, waves: undefined };
    expect(() => deserializeRunState(JSON.stringify(noWaves))).toThrow(/inválido/);
    const badSpawned = {
      ...good,
      waves: { ...good.waves, active: [{ ...good.waves.active[0]!, spawned: -1 }] },
    };
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
    expect(schedules).toHaveLength(40);
    expect(schedules.reduce((sum, s) => sum + s.entries.length, 0)).toBe(
      waveData.waves.reduce((sum, w) => sum + totalOf(w), 0),
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
    expect(boss.hp).toBeLessThan(boss.maxHp * 0.1);
    expect(ofType(events, 'enemyKilled')).toHaveLength(0);
  });
});
