/**
 * Relatório da curva (T21), fora do `npm test`: tabela das 40 ondas, duração e
 * ouro acumulado com o bot bom (núcleo invulnerável), descartes da fila de
 * gatilhos, pico de inimigos vivos e o resultado dos bots em várias sementes.
 */

import { it } from 'vitest';
import engineConfig from '../src/data/engine.json';
import { buildWaveSchedule } from '../src/sim/waves/schedule';
import { waveData } from '../src/sim/waves/waveData';
import { rewardData } from '../src/sim/rewards/rewardData';
import { goodBotBreak, goodBotReward } from './support/goodBot';
import { botBreak, botSim, firstReward, playRun } from './support/waveBot';

const TPS = engineConfig.ticksPerSecond;
const LETTER: Record<string, string> = {
  common: 'C',
  fast: 'R',
  armored: 'B',
  flying: 'V',
  boss: 'Chefão',
  bossFinal: 'Chefão final',
};

it('curva das 40 ondas', () => {
  const sim = botSim('dur', true);
  const reports = playRun(sim, goodBotBreak, goodBotReward);
  const lines = [
    'onda | qtd | elites | vida× | interv. | tipos | duração | ouro acum. | pico vivos | descartes',
  ];
  for (const [i, wave] of waveData.waves.entries()) {
    const entries = buildWaveSchedule(wave, TPS).entries;
    const elites = entries.filter((e) => e.elite).length;
    const types = [...new Set(entries.map((e) => LETTER[e.type] ?? e.type))].join(' ');
    const r = reports[i]!;
    lines.push(
      [
        i + 1,
        entries.length,
        elites,
        wave.hpMultiplier,
        wave.spawnSeconds,
        types,
        `${Math.round(r.ticks / TPS)} s`,
        r.goldEarned,
        r.peakEnemies,
        r.dropped,
      ].join(' | '),
    );
  }
  const seconds = reports.reduce((s, r) => s + r.ticks, 0) / TPS;
  lines.push(
    `total: ${(seconds / 60).toFixed(1)} min de ondas + ${(reports.length * 15) / 60} min de compra`,
  );
  console.log(lines.join('\n'));
});

it('bots em várias sementes', () => {
  const lines: string[] = [];
  for (const seed of ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10', 's11', 's12']) {
    const out: string[] = [seed];
    for (const [name, brk, reward] of [
      ['bom', goodBotBreak, goodBotReward],
      ['simples', botBreak, firstReward],
    ] as const) {
      const sim = botSim(seed);
      const reports = playRun(sim, brk, reward);
      const at20 = reports[Math.min(19, reports.length - 1)]!;
      out.push(
        `${name}: ${sim.state.status} na onda ${reports.length}, ouro até a 20 ${at20.goldEarned}, núcleo ${sim.state.nexus.level}, ${sim.state.towers.map((t) => `${t.type}★${t.star}`).join(' ')}`,
      );
    }
    lines.push(out.join(' | '));
  }
  for (const seed of ['duracao', 'dur', 'd2', 'd3']) {
    const sim = botSim(seed, true);
    const reports = playRun(sim, goodBotBreak, goodBotReward);
    // 15 s de compra por onda e o tempo inteiro de cada tela de recompensa (T24).
    const min =
      reports.reduce((s, r) => s + r.ticks, 0) / TPS / 60 +
      reports.length * 0.25 +
      (sim.state.rewards.taken.length * rewardData.chooseSeconds) / 60;
    lines.push(
      `duração ${seed}: ${min.toFixed(1)} min; ondas 1–5: ${reports
        .slice(0, 5)
        .map((r) => `${Math.round(r.ticks / TPS)} s`)
        .join(', ')}`,
    );
  }
  console.log(lines.join('\n'));
});
