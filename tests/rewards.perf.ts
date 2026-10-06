/**
 * Medição da T24 (recompensas de escolha), fora do `npm test` (`npm run bench`):
 * - vida do chefão 20: com recompensas, quantas sementes o bot bom passa do
 *   chefão 20 (as 6 do teste do M4 e as 12 do bench) e onde quem passa
 *   morre; o bot simples também. A vida muda só no `EnemyData` deste teste.
 * - com e sem recompensas (vida atual): onda alcançada, ouro ganho, ouro
 *   gasto no reroll das cartas, ouro das cadeias e maior cadeia;
 * - núcleo invulnerável até a 40: ouro sobrando, nível e torres nas ondas
 *   20, 25, 30 e 35 e o ouro das cadeias por onda.
 *
 * "Ouro de cadeia possível": quanto a "Cadeia lucrativa" pagaria nas cadeias
 * da run (gatilhos visíveis em x10, x20...) depois da onda 5, escolhida ou não.
 */

import { it } from 'vitest';
import { enemyData, type EnemyData } from '../src/sim/enemies/enemyData';
import type { Simulation } from '../src/sim/engine/simulation';
import { goodBotBreak, goodBotReward, REWARD_PRIORITY, rewardPolicy } from './support/goodBot';
import { rewardData } from '../src/sim/rewards/rewardData';
import {
  botBreak,
  botSim,
  firstReward,
  noRewards,
  playRun,
  TOTAL_WAVES,
  type WaveReport,
} from './support/waveBot';

const SEEDS = Array.from({ length: 12 }, (_, i) => `s${i + 1}`);
const TEST_SEEDS = SEEDS.slice(0, 6);
const BOSS_HP = [1800, 2200, 2600, 3000];
const BOSS_WAVE = 20;
const CHECKPOINTS = [20, 25, 30, 35];
/** A "Cadeia lucrativa" só pode valer depois da primeira tela (onda 5). */
const FIRST_REWARD_WAVE = 5;
const CHAIN_EVERY = 10;
const LONG_TIMEOUT = 900_000;

/** `bom-cadeia`: o bot bom com a "Cadeia lucrativa" no topo da ordem (para medir o ouro de cadeia real). */
type Bot = 'bom' | 'simples' | 'bom-cadeia';

const chainFirst = rewardPolicy([
  'chainGold',
  ...REWARD_PRIORITY.filter((id) => id !== 'chainGold'),
]);

interface Result {
  seed: string;
  status: string;
  /** Ondas fechadas. */
  wave: number;
  reports: WaveReport[];
  rewards: string[];
  goldEarned: number;
  rerollGold: number;
  chainGold: number;
  longestChain: number;
  /** Ouro que a "Cadeia lucrativa" pagaria depois da onda 5, por onda. */
  potentialChainGold: Map<number, number>;
}

function enemiesWithBossHp(hp: number): EnemyData {
  return { ...enemyData, types: { ...enemyData.types, boss: { ...enemyData.types.boss!, hp } } };
}

function play(
  seed: string,
  bot: Bot,
  options: { rewards: boolean; bossHp?: number; invulnerable?: boolean },
): Result {
  const sim: Simulation = botSim(seed, options.invulnerable ?? false, {
    enemies: options.bossHp === undefined ? enemyData : enemiesWithBossHp(options.bossHp),
    ...(options.rewards ? {} : { rewards: noRewards }),
  });
  const potential = new Map<number, number>();
  sim.on('triggerFired', (event) => {
    const wave = sim.state.wave + 1;
    if (wave <= FIRST_REWARD_WAVE || !event.visible || event.chainLength % CHAIN_EVERY !== 0) {
      return;
    }
    potential.set(wave, (potential.get(wave) ?? 0) + 1);
  });
  const reports =
    bot === 'simples'
      ? playRun(sim, botBreak, firstReward)
      : playRun(sim, goodBotBreak, bot === 'bom' ? goodBotReward : chainFirst);
  const { state } = sim;
  return {
    seed,
    status: state.status,
    wave: state.wave,
    reports,
    rewards: state.rewards.taken.map((t) => (t.classId ? `${t.id}:${t.classId}` : t.id)),
    goldEarned: state.stats.goldEarned,
    rerollGold: state.stats.rewardRerollGold,
    chainGold: state.stats.chainGold,
    longestChain: state.stats.longestChain,
    potentialChainGold: potential,
  };
}

const sum = (values: Iterable<number>): number => [...values].reduce((a, b) => a + b, 0);
const avg = (values: number[]): string =>
  values.length === 0 ? '—' : (sum(values) / values.length).toFixed(1);
const range = (values: number[]): string =>
  values.length === 0 ? '—' : `${Math.min(...values)}–${Math.max(...values)} (${avg(values)})`;

/** Morte de quem passou do chefão 20 (onda em que perdeu; "venceu" se fechou a 40). */
function deathWave(r: Result): string {
  if (r.status === 'won') return 'venceu';
  return r.status === 'lost' ? String(r.wave + 1) : `parou na ${r.wave}`;
}

it(
  'vida do chefão 20 com recompensas',
  () => {
    const lines = [
      'vida | bom c/ recomp.: passa 20 (6 do teste) | (12 do bench) | morte de quem passa | bom s/ recomp. (12) | simples c/ recomp. (12)',
    ];
    for (const hp of BOSS_HP) {
      const good = SEEDS.map((seed) => play(seed, 'bom', { rewards: true, bossHp: hp }));
      const plain = SEEDS.map((seed) => play(seed, 'bom', { rewards: false, bossHp: hp }));
      const simple = SEEDS.map((seed) => play(seed, 'simples', { rewards: true, bossHp: hp }));
      const passed = good.filter((r) => r.wave >= BOSS_WAVE);
      const inTest = passed.filter((r) => TEST_SEEDS.includes(r.seed));
      lines.push(
        [
          hp,
          `${inTest.length} de 6 (${inTest.map((r) => r.seed).join(' ') || '—'})`,
          `${passed.length} de 12`,
          passed.map((r) => `${r.seed}→${deathWave(r)}`).join(' ') || '—',
          `${plain.filter((r) => r.wave >= BOSS_WAVE).length} de 12`,
          `${simple.filter((r) => r.wave >= BOSS_WAVE).length} de 12 (${
            simple
              .filter((r) => r.wave >= BOSS_WAVE)
              .map((r) => `${r.seed}→${deathWave(r)}`)
              .join(' ') || '—'
          })`,
        ].join(' | '),
      );
    }
    console.log(lines.join('\n'));
  },
  LONG_TIMEOUT,
);

it(
  'com e sem recompensas (vida atual do chefão)',
  () => {
    const lines: string[] = [];
    for (const rewards of [false, true]) {
      const results = SEEDS.map((seed) => play(seed, 'bom', { rewards }));
      lines.push(`--- bot bom ${rewards ? 'COM' : 'SEM'} recompensas (12 sementes)`);
      lines.push(`onda alcançada: ${range(results.map((r) => r.wave + 1))}`);
      const passed = results.filter((r) => r.wave >= BOSS_WAVE);
      lines.push(
        `passam do chefão 20: ${passed.length} de 12; morte: ${passed.map((r) => `${r.seed}→${deathWave(r)}`).join(' ') || '—'}`,
      );
      lines.push(`ouro ganho: ${range(results.map((r) => r.goldEarned))}`);
      if (!rewards) continue;
      lines.push(`ouro no reroll das cartas: ${range(results.map((r) => r.rerollGold))}`);
      lines.push(
        'semente | onda | cartas escolhidas | reroll | maior cadeia | ouro de cadeia (real / possível) | % do ouro ganho',
      );
      for (const r of results) {
        const possible = sum(r.potentialChainGold.values());
        lines.push(
          [
            r.seed,
            r.wave + 1,
            r.rewards.join(', '),
            r.rerollGold,
            r.longestChain,
            `${r.chainGold} / ${possible}`,
            `${((100 * r.chainGold) / Math.max(1, r.goldEarned)).toFixed(1)}% / ${((100 * possible) / Math.max(1, r.goldEarned)).toFixed(1)}%`,
          ].join(' | '),
        );
      }
    }
    console.log(lines.join('\n'));
  },
  LONG_TIMEOUT,
);

it(
  'núcleo invulnerável até a 40, com e sem recompensas',
  () => {
    const lines: string[] = [];
    for (const rewards of [false, true]) {
      const results = SEEDS.map((seed) => play(seed, 'bom', { rewards, invulnerable: true }));
      lines.push(`--- invulnerável, bot bom ${rewards ? 'COM' : 'SEM'} recompensas (12 sementes)`);
      lines.push(`ouro ganho até a 40: ${range(results.map((r) => r.goldEarned))}`);
      if (rewards) {
        lines.push(`ouro no reroll das cartas: ${range(results.map((r) => r.rerollGold))}`);
      }
      lines.push('onda | nível | torres | ouro sobrando');
      for (const wave of CHECKPOINTS) {
        const at = results.map((r) => r.reports[wave - 1]!);
        lines.push(
          [
            wave,
            range(at.map((w) => w.nexusLevel)),
            range(at.map((w) => w.towers)),
            range(at.map((w) => w.gold)),
          ].join(' | '),
        );
      }
      if (!rewards) continue;
      lines.push(
        'semente | maior cadeia | ouro de cadeia real / possível | % do ouro ganho (real / possível) | onda com mais ouro de cadeia possível',
      );
      for (const r of results) {
        const possible = sum(r.potentialChainGold.values());
        let topWave = 0;
        for (const [wave, gold] of r.potentialChainGold) {
          if (gold > (r.potentialChainGold.get(topWave) ?? 0)) topWave = wave;
        }
        lines.push(
          [
            r.seed,
            r.longestChain,
            `${r.chainGold} / ${possible}`,
            `${((100 * r.chainGold) / r.goldEarned).toFixed(1)}% / ${((100 * possible) / r.goldEarned).toFixed(1)}%`,
            topWave === 0 ? '—' : `${topWave} (${r.potentialChainGold.get(topWave)})`,
          ].join(' | '),
        );
      }
      lines.push('ouro de cadeia possível por onda (média das 12 sementes), ondas 6 a 40:');
      const perWave: string[] = [];
      for (let wave = FIRST_REWARD_WAVE + 1; wave <= TOTAL_WAVES; wave++) {
        perWave.push(`${wave}:${avg(results.map((r) => r.potentialChainGold.get(wave) ?? 0))}`);
      }
      lines.push(perWave.join(' '));
    }
    console.log(lines.join('\n'));
  },
  LONG_TIMEOUT,
);

it(
  'Cadeia lucrativa escolhida sempre que aparece (bot bom, núcleo invulnerável e run normal)',
  () => {
    const lines: string[] = [];
    for (const invulnerable of [true, false]) {
      const results = SEEDS.map((seed) =>
        play(seed, 'bom-cadeia', { rewards: true, invulnerable }),
      );
      lines.push(
        `--- Cadeia lucrativa no topo da ordem, ${invulnerable ? 'núcleo invulnerável até a 40' : 'run normal'}`,
      );
      lines.push(
        'semente | onda | escolhida na onda | maior cadeia | ouro de cadeia | ouro ganho | % | onda com mais ouro de cadeia',
      );
      for (const r of results) {
        const at = r.reports.findIndex((w) => w.chainGold > 0);
        const pick = r.rewards.indexOf('chainGold');
        let top = 0;
        let topGold = 0;
        r.reports.forEach((w, i) => {
          const gold = w.chainGold - (i > 0 ? r.reports[i - 1]!.chainGold : 0);
          if (gold > topGold) {
            top = w.wave;
            topGold = gold;
          }
        });
        lines.push(
          [
            r.seed,
            r.wave + 1,
            pick < 0 ? 'não saiu' : String(rewardData.waves[pick]),
            r.longestChain,
            r.chainGold,
            r.goldEarned,
            `${((100 * r.chainGold) / r.goldEarned).toFixed(1)}%`,
            top === 0 ? '—' : `${top} (${topGold})${at < 0 ? '' : ''}`,
          ].join(' | '),
        );
      }
      if (invulnerable) {
        lines.push('ouro de cadeia por onda (média das 12 sementes), ondas 6 a 40:');
        const perWave: string[] = [];
        for (let wave = FIRST_REWARD_WAVE + 1; wave <= TOTAL_WAVES; wave++) {
          const gold = results.map(
            (r) => r.reports[wave - 1]!.chainGold - r.reports[wave - 2]!.chainGold,
          );
          perWave.push(`${wave}:${avg(gold)}`);
        }
        lines.push(perWave.join(' '));
      }
    }
    console.log(lines.join('\n'));
  },
  LONG_TIMEOUT,
);
