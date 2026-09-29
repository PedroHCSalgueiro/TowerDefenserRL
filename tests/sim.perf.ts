/**
 * Mede só a simulação (sem renderização): 1.000 inimigos + 30 torres de teste,
 * nos dois cenários da T05. Rode com `npm run bench`. Não faz parte do
 * `npm test`: o resultado depende da máquina.
 */

import { it } from 'vitest';
import debugConfig from '../src/data/debug.json';
import mapData from '../src/data/map.json';
import { stat } from '../src/debug/metrics';
import { Simulation } from '../src/sim/engine/simulation';
import { loadMap } from '../src/sim/grid/map';
import type { DebugLayout } from '../src/sim/state';
import { createGameSystems } from '../src/sim/systems';

const { enemyCount, towerCount } = debugConfig.defaults;
const WARMUP_TICKS = 600;
const MEASURED_TICKS = 3000;

function measure(layout: DebugLayout): string {
  const sim = Simulation.create(`bench-${layout}`, createGameSystems(loadMap(mapData)));
  sim.enqueue({ type: 'debugSetNexusInvulnerable', value: true });
  sim.enqueue({ type: 'debugSpawnTowers', count: towerCount, layout });
  sim.enqueue({ type: 'debugSetStress', stress: { count: enemyCount, layout } });
  for (let i = 0; i < WARMUP_TICKS; i++) {
    sim.step();
    sim.drainEvents();
  }

  const durations: number[] = [];
  let projectiles = 0;
  let kills = 0;
  for (let i = 0; i < MEASURED_TICKS; i++) {
    const start = performance.now();
    sim.step();
    const events = sim.drainEvents();
    durations.push(performance.now() - start);
    projectiles += sim.state.projectiles.activeCount;
    kills += events.filter((e) => e.type === 'enemyKilled').length;
  }
  const { avg, max } = stat(durations);
  const p99 = [...durations].sort((a, b) => a - b)[Math.floor(durations.length * 0.99)]!;
  return (
    `${layout.padEnd(9)} tick médio ${avg.toFixed(3)} ms | p99 ${p99.toFixed(3)} ms | ` +
    `máx ${max.toFixed(3)} ms | projéteis (média) ${(projectiles / MEASURED_TICKS).toFixed(0)} | ` +
    `abates/s ${((kills / MEASURED_TICKS) * 30).toFixed(1)}`
  );
}

it(`tick com ${enemyCount} inimigos e ${towerCount} torres`, () => {
  const lines = (['spread', 'clustered'] as const).map(measure);
  process.stdout.write(`\n${lines.join('\n')}\n`);
});
