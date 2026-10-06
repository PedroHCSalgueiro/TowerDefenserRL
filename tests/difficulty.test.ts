/**
 * Marcos da curva de dificuldade (T21). Os números das ondas são provados
 * aqui: se um marco quebrar, ajuste a curva em `waves.json`/`enemies.json`,
 * não o marco.
 */

import { describe, expect, it } from 'vitest';
import type { Simulation } from '../src/sim/engine/simulation';
import { rewardData } from '../src/sim/rewards/rewardData';
import { towerData } from '../src/sim/towers/towerData';
import { goodBotBreak, goodBotReward } from './support/goodBot';
import { alone, cellsByCoverage, playMilestone, type Placed } from './support/milestones';
import {
  botBreak,
  botSim,
  firstReward,
  playRun,
  TOTAL_WAVES,
  type WaveReport,
} from './support/waveBot';

const COMMONS = ['mortar', 'reaper', 'relay'];
const SEEDS = ['s1', 's2', 's3', 's4', 's5', 's6'];
const BOSS_WAVE = 20;
/** Tempo fixo de compra entre as ondas na conta da duração da run (T21). */
const BREAK_SECONDS = 15;
const TICKS_PER_SECOND = 30;

interface RunResult {
  sim: Simulation;
  reports: WaveReport[];
}

type Bot = (sim: Simulation) => void;

function run(seed: string, onBreak: Bot, onReward: Bot, invulnerable = false): RunResult {
  const sim = botSim(seed, invulnerable);
  const reports = playRun(sim, onBreak, onReward);
  return { sim, reports };
}

/** Passou do chefão 20: fechou a onda 20 sem perder. */
function beatBoss20(result: RunResult): boolean {
  return result.sim.state.wave >= BOSS_WAVE;
}

const cache = new Map<string, RunResult>();
function cached(key: string, make: () => RunResult): RunResult {
  let result = cache.get(key);
  if (!result) {
    result = make();
    cache.set(key, result);
  }
  return result;
}
const good = (seed: string) => cached(`bom-${seed}`, () => run(seed, goodBotBreak, goodBotReward));
const simple = (seed: string) => cached(`simples-${seed}`, () => run(seed, botBreak, firstReward));

describe('M1: onda 1', () => {
  it.each(COMMONS)('%s ★1 sozinho limpa a onda 1 sem dano no núcleo', (type) => {
    const result = playMilestone(1, [alone(type)]);
    expect(result.won).toBe(true);
    expect(result.nexusHp).toBe(result.maxNexusHp);
  });

  it('todas as 8 torres ★1 sozinhas limpam a onda 1 sem perder', () => {
    for (const type of Object.keys(towerData.types).filter((t) => towerData.types[t]!.rarity)) {
      expect(playMilestone(1, [alone(type)]).won).toBe(true);
    }
  });
});

describe('M2: onda 5 (elite)', () => {
  it.each(COMMONS)('%s ★1 sozinho sofre dano ou perde', (type) => {
    const result = playMilestone(5, [alone(type)]);
    expect(result.nexusHp).toBeLessThan(result.maxNexusHp);
  });

  it('as 3 comuns ★1 limpam a onda 5 sem dano', () => {
    const cells = cellsByCoverage(3);
    const three = COMMONS.map((type, i) => ({ type, ...cells[i]! }));
    const result = playMilestone(5, three);
    expect(result.won).toBe(true);
    expect(result.nexusHp).toBe(result.maxNexusHp);
  });
});

describe('M3: onda 10 (elite)', () => {
  // Bloco colado nas casas que mais veem o caminho; o Relé no meio.
  const block = (types: string[]): Placed[] => {
    const cells = [
      { x: 8, y: 4 },
      { x: 7, y: 4 },
      { x: 9, y: 4 },
      { x: 8, y: 3 },
      { x: 8, y: 5 },
    ];
    return types.map((type, i) => ({ type, ...cells[i]! }));
  };

  it('3 torres (3 tipos, já com bônus de classe) sofrem dano', () => {
    const result = playMilestone(10, block(['relay', 'mortar', 'reaper']));
    expect(result.towers).toBe(3);
    expect(result.nexusHp).toBeLessThan(result.maxNexusHp);
  });

  it.each([
    [['relay', 'mortar', 'reaper', 'ballista']],
    [['relay', 'mortar', 'reaper', 'ballista', 'clock']],
  ])('4 a 5 tipos com bônus de classe limpam sem dano: %j', (types) => {
    const result = playMilestone(10, block(types));
    expect(result.towers).toBe(types.length);
    expect(result.won).toBe(true);
    expect(result.nexusHp).toBe(result.maxNexusHp);
  });
});

describe('M4: chefão 20', () => {
  it('o bot bom vence o chefão 20 em parte das sementes (1 a 5 de 6)', () => {
    const wins = SEEDS.filter((seed) => beatBoss20(good(seed))).length;
    expect(wins).toBeGreaterThanOrEqual(1);
    expect(wins).toBeLessThanOrEqual(5);
  });

  it('o bot simples não passa do chefão 20 em nenhuma semente', () => {
    for (const seed of SEEDS) {
      const result = simple(seed);
      expect(result.sim.state.status).toBe('lost');
      expect(beatBoss20(result)).toBe(false);
    }
  });
});

describe('M5: chefão 40', () => {
  it('sem trapaça, nenhum bot vence a run', () => {
    for (const seed of SEEDS) {
      for (const result of [good(seed), simple(seed)]) {
        expect(result.sim.state.cheated).toBe(false);
        expect(result.sim.state.status).toBe('lost');
      }
    }
  });
});

describe('duração da run', () => {
  it.each(['duracao', 'dur', 'd2', 'd3'])(
    'bot bom com núcleo invulnerável, em 1x, com 15 s de compra por onda e o tempo inteiro de cada tela de recompensa: 35 a 50 minutos (%s)',
    (seed) => {
      const { sim, reports } = run(seed, goodBotBreak, goodBotReward, true);
      expect(reports).toHaveLength(TOTAL_WAVES);
      expect(sim.state.rewards.taken).toHaveLength(rewardData.waves.length);
      const seconds =
        reports.reduce((sum, r) => sum + r.ticks, 0) / TICKS_PER_SECOND +
        reports.length * BREAK_SECONDS +
        sim.state.rewards.taken.length * rewardData.chooseSeconds;
      expect(seconds / 60).toBeGreaterThanOrEqual(35);
      expect(seconds / 60).toBeLessThanOrEqual(50);
    },
  );
});
