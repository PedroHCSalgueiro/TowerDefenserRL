/**
 * Medições da T13 e da T14 (`npm run bench`), só para relatar no Diário:
 * - duração de cada onda em 1x numa run do bot (torres do bot matando);
 * - descartes da fila de gatilhos e avalanche da Balista ★3 com as ondas
 *   reais, usando a cadeia de 8 tipos do debug (30 torres no bloco perto da
 *   entrada, núcleo invulnerável, sem comprar nada);
 * - T14: a mesma cadeia com ondas empilhadas (4 e 5 ondas, e as 1 a 9
 *   juntas): descartes, pico de abates por tick, tick médio e máximo, pico
 *   de inimigos ativos e ticks com a fila invisível segurando alguém.
 */

import { describe, it } from 'vitest';
import debugConfig from '../src/data/debug.json';
import engineConfig from '../src/data/engine.json';
import { waveData } from '../src/sim/waves/waveData';
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
  return playRun(sim, () => {});
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

interface StackReport {
  ticks: number;
  kills: number;
  peakKillsPerTick: number;
  dropped: number;
  peakTriggersPerTick: number;
  avgTickMs: number;
  maxTickMs: number;
  peakEnemies: number;
  ticksAtLimit: number;
  gold: number;
}

/** Chama as ondas `from` a `to` no mesmo tick e roda até todas fecharem. */
function stackRun(
  star: number,
  from: number,
  to: number,
  count: number = debugConfig.defaults.towerCount,
  layout: 'clustered' | 'spread' = 'clustered',
): StackReport {
  const sim = botSim(`pilha-${star}-${from}-${to}-${count}-${layout}`, true);
  sim.enqueue({ type: 'debugSpawnTowers', count, towerTypes: CHAIN, layout, star });
  sim.enqueue({ type: 'debugSkipToWave', wave: from });
  sim.step();
  for (let w = from; w <= to; w++) sim.enqueue({ type: 'callWave' });
  const start = sim.state.tick;
  const droppedBefore = sim.state.triggers.droppedTotal;
  const killsBefore = sim.state.stats.kills;
  const goldBefore = sim.state.gold;
  sim.drainEvents();
  const r = { peakKills: 0, peakTriggers: 0, total: 0, max: 0, peakEnemies: 0, atLimit: 0 };
  do {
    const t0 = performance.now();
    sim.step();
    const dt = performance.now() - t0;
    r.total += dt;
    r.max = Math.max(r.max, dt);
    let kills = 0;
    for (const e of sim.drainEvents()) if (e.type === 'enemyKilled') kills++;
    r.peakKills = Math.max(r.peakKills, kills);
    r.peakTriggers = Math.max(r.peakTriggers, sim.state.triggers.lastTick.fired);
    r.peakEnemies = Math.max(r.peakEnemies, sim.state.enemies.activeCount);
    if (sim.state.enemies.activeCount >= waveData.maxActiveEnemies) r.atLimit++;
  } while (sim.state.waves.active.length > 0 && sim.state.tick - start < 30 * 60 * 10);
  const ticks = sim.state.tick - start;
  return {
    ticks,
    kills: sim.state.stats.kills - killsBefore,
    peakKillsPerTick: r.peakKills,
    dropped: sim.state.triggers.droppedTotal - droppedBefore,
    peakTriggersPerTick: r.peakTriggers,
    avgTickMs: r.total / ticks,
    maxTickMs: r.max,
    peakEnemies: r.peakEnemies,
    ticksAtLimit: r.atLimit,
    gold: sim.state.gold - goldBefore,
  };
}

function row(title: string, star: number, r: StackReport): void {
  console.log(
    `${title} | ★${star} | ${seconds(r.ticks)} | ${r.kills} | ${r.peakKillsPerTick} | ` +
      `${r.peakTriggersPerTick} | ${r.dropped} | ${r.avgTickMs.toFixed(3)} | ` +
      `${r.maxTickMs.toFixed(2)} | ${r.peakEnemies} | ${r.ticksAtLimit} | ${r.gold}`,
  );
}

describe('T14: ondas empilhadas', () => {
  it('cadeia de 8 tipos com 4 e 5 ondas empilhadas e com as ondas 1 a 9 juntas', () => {
    console.log(
      '\nempilhamento | ★ | s | abates | pico abates/tick | gatilhos/tick (pico) | descartados | ' +
        'tick médio ms | tick máx ms | pico inimigos | ticks no limite | ouro ganho',
    );
    const stacks: [number, number][] = [
      [1, 4],
      [5, 8],
      [5, 9],
      [1, 9],
    ];
    for (const star of [1, 3]) {
      for (const [from, to] of stacks) {
        row(`ondas ${from}–${to}`, star, stackRun(star, from, to));
      }
    }
    // Menos torres: mais inimigos vivos ao mesmo tempo.
    row('ondas 1–9, 8 torres espalhadas', 1, stackRun(1, 1, 9, 8, 'spread'));
    row('ondas 1–9, sem torres', 1, stackRun(1, 1, 9, 0));
  });
});
