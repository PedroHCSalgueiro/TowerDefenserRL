/**
 * Mede só a simulação (sem renderização), com 1.000 inimigos e 30 torres:
 * - torres do tipo padrão do debug (Básica, sem gatilho), nos dois cenários da T05;
 * - cenário "Cadeia (4 tipos)" da T07: Morteiro, Relé, Obelisco e Ceifador
 *   misturados no bloco perto da entrada, com os inimigos espalhados ou
 *   agrupados na entrada.
 *
 * Rode com `npm run bench`. Não faz parte do `npm test`: o resultado depende
 * da máquina.
 */

import { it } from 'vitest';
import debugConfig from '../src/data/debug.json';
import engineConfig from '../src/data/engine.json';
import mapData from '../src/data/map.json';
import { stat } from '../src/debug/metrics';
import { Simulation } from '../src/sim/engine/simulation';
import { loadMap } from '../src/sim/grid/map';
import type { DebugLayout } from '../src/sim/state';
import { createGameSystems } from '../src/sim/systems';

const { enemyCount, towerCount, towerType } = debugConfig.defaults;
const { chainScenario } = debugConfig;
const WARMUP_TICKS = 600;
const MEASURED_TICKS = 3000;
const TPS = engineConfig.ticksPerSecond;

interface Scenario {
  name: string;
  enemyLayout: DebugLayout;
  towerLayout: DebugLayout;
  towerTypes: string[];
}

const SCENARIOS: Scenario[] = [
  { name: 'espalhado', enemyLayout: 'spread', towerLayout: 'spread', towerTypes: [towerType] },
  {
    name: 'agrupado',
    enemyLayout: 'clustered',
    towerLayout: 'clustered',
    towerTypes: [towerType],
  },
  ...(['spread', 'clustered'] as const).map((layout) => ({
    name: `cadeia ${layout === 'spread' ? 'espalhado' : 'agrupado'}`,
    enemyLayout: layout,
    towerLayout: chainScenario.towerLayout as DebugLayout,
    towerTypes: chainScenario.towerTypes,
  })),
];

const f = (value: number, digits = 3): string => value.toFixed(digits);

function measure(s: Scenario): string {
  const sim = Simulation.create(`bench-${s.enemyLayout}`, createGameSystems(loadMap(mapData)));
  sim.enqueue({ type: 'debugSetNexusInvulnerable', value: true });
  sim.enqueue({
    type: 'debugSpawnTowers',
    count: towerCount,
    towerTypes: s.towerTypes,
    layout: s.towerLayout,
  });
  sim.enqueue({ type: 'debugSetStress', stress: { count: enemyCount, layout: s.enemyLayout } });
  for (let i = 0; i < WARMUP_TICKS; i++) {
    sim.step();
    sim.drainEvents();
  }

  const durations: number[] = [];
  const fired: number[] = [];
  const killsPerTick: number[] = [];
  let projectiles = 0;
  let maxDepth = 0;
  let deferredTicks = 0;
  let maxDeferred = 0;
  const droppedBefore = sim.state.triggers.droppedTotal;
  for (let i = 0; i < MEASURED_TICKS; i++) {
    const start = performance.now();
    sim.step();
    const events = sim.drainEvents();
    durations.push(performance.now() - start);

    const t = sim.state.triggers.lastTick;
    fired.push(t.fired);
    maxDepth = Math.max(maxDepth, t.maxDepth);
    if (t.deferred > 0) deferredTicks++;
    maxDeferred = Math.max(maxDeferred, t.deferred);
    projectiles += sim.state.projectiles.activeCount;
    let kills = 0;
    for (const e of events) if (e.type === 'enemyKilled') kills++;
    killsPerTick.push(kills);
  }
  const { avg, max } = stat(durations);
  const p99 = [...durations].sort((a, b) => a - b)[Math.floor(durations.length * 0.99)]!;
  const kills = stat(killsPerTick);
  const triggers = stat(fired);
  const dropped = sim.state.triggers.droppedTotal - droppedBefore;
  return [
    `${s.name.padEnd(17)} tick médio ${f(avg)} ms | p99 ${f(p99)} ms | máx ${f(max)} ms`,
    `${''.padEnd(17)} gatilhos/tick ${f(triggers.avg, 1)} (pior ${triggers.max}) | prof. máx ${maxDepth} | ` +
      `adiados ${deferredTicks} ticks (fila máx ${maxDeferred}) | descartados ${dropped}`,
    `${''.padEnd(17)} abates/s ${f(kills.avg * TPS, 1)} | pico ${kills.max} abates/tick | ` +
      `projéteis (média) ${f(projectiles / MEASURED_TICKS, 0)}`,
  ].join('\n');
}

it(`tick com ${enemyCount} inimigos e ${towerCount} torres (${towerType} e cadeia)`, () => {
  const lines = SCENARIOS.map(measure);
  process.stdout.write(`\n${lines.join('\n')}\n`);
});
