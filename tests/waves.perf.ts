/**
 * Medições da T13 (`npm run bench`), só para relatar no Diário:
 * - duração de cada onda em 1x numa run do bot (torres do bot matando);
 * - descartes da fila de gatilhos e avalanche da Balista ★3 com as ondas
 *   reais, usando a cadeia de 8 tipos do debug (30 torres no bloco perto da
 *   entrada, núcleo invulnerável, sem comprar nada).
 */

import { describe, it } from 'vitest';
import debugConfig from '../src/data/debug.json';
import engineConfig from '../src/data/engine.json';
import type { Simulation } from '../src/sim/engine/simulation';
import { botSim, playRun, type WaveReport } from './support/waveBot';

const TPS = engineConfig.ticksPerSecond;
const SEEDS = ['bot-1', 'bot-2', 'bot-3', 'bot-4', 'bot-5'];
const CHAIN = debugConfig.fullScenario.towerTypes;

function seconds(ticks: number): string {
  return (ticks / TPS).toFixed(1);
}

function chainRun(towerTypes: string[], star: number): WaveReport[] {
  const sim = botSim(`cadeia-${star}-${towerTypes.length}`, true);
  sim.enqueue({
    type: 'debugSpawnTowers',
    count: debugConfig.defaults.towerCount,
    towerTypes,
    layout: 'clustered',
    star,
  });
  sim.step();
  // A cadeia não compra nada: a pausa entre ondas fica vazia.
  return playRun(sim, (_: Simulation) => {});
}

function table(title: string, reports: WaveReport[]): void {
  console.log(`\n${title}`);
  console.log(
    'onda | s | abates | pico abates/tick | gatilhos/tick (pico) | prof. máx | descartados',
  );
  for (const r of reports) {
    console.log(
      `${r.wave} | ${seconds(r.ticks)} | ${r.kills} | ${r.peakKillsPerTick} | ` +
        `${r.peakTriggersPerTick} | ${r.maxDepth} | ${r.dropped}`,
    );
  }
}

describe('T13: ondas reais', () => {
  it('duração das ondas na run do bot (1x)', () => {
    const rows: string[][] = [];
    const outcomes: string[] = [];
    for (const seed of SEEDS) {
      const sim = botSim(seed);
      const reports = playRun(sim);
      outcomes.push(
        `${seed}: ${sim.state.status} na onda ${sim.state.wave}, núcleo ${sim.state.nexus.hp}/` +
          `${sim.state.nexus.maxHp}, nível ${sim.state.nexus.level}, ${sim.state.towers.length} torres ` +
          `(${sim.state.towers.map((t) => `${t.type}★${t.star}`).join(', ')}), ` +
          `tempo ${seconds(sim.state.tick)} s, abates ${sim.state.stats.kills}`,
      );
      reports.forEach((r, i) => (rows[i] ??= []).push(seconds(r.ticks)));
      table(`Bot ${seed}`, reports);
    }
    console.log('\nDuração por onda (s), uma coluna por semente:');
    rows.forEach((row, i) => console.log(`onda ${i + 1}: ${row.join(' | ')}`));
    console.log(outcomes.join('\n'));
  });

  it('cadeia de 8 tipos nas ondas reais (★1 e ★3), com e sem a Balista', () => {
    for (const star of [1, 3]) {
      table(`Cadeia 8 tipos ★${star}`, chainRun(CHAIN, star));
    }
    table(
      'Cadeia sem a Balista ★3',
      chainRun(
        CHAIN.filter((t) => t !== 'ballista'),
        3,
      ),
    );
  });
});
