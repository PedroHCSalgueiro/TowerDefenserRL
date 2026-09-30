/**
 * Mede só a simulação (sem renderização), com 1.000 inimigos e 30 torres:
 * - torres do tipo padrão do debug (Básica, sem gatilho), nos dois cenários da T05;
 * - cenário "Cadeia (4 tipos)" da T07: Morteiro, Relé, Obelisco e Ceifador
 *   misturados no bloco perto da entrada, com os inimigos espalhados ou
 *   agrupados na entrada. Da T08 em diante ele roda com os bônus de classe
 *   ativos (nível 2 nas 4 classes); "sem bônus" reproduz a T07 (classes sem
 *   níveis nos dados) e "nível 4" usa 4 tipos de teste a mais para ligar o
 *   nível 4 de todas as classes.
 *
 * Rode com `npm run bench`. Não faz parte do `npm test`: o resultado depende
 * da máquina.
 */

import { it } from 'vitest';
import debugConfig from '../src/data/debug.json';
import engineConfig from '../src/data/engine.json';
import mapData from '../src/data/map.json';
import classesJson from '../src/data/classes.json';
import towersJson from '../src/data/towers.json';
import { stat } from '../src/debug/metrics';
import { loadClassData } from '../src/sim/classes/classData';
import { Simulation } from '../src/sim/engine/simulation';
import { loadMap } from '../src/sim/grid/map';
import type { DebugLayout } from '../src/sim/state';
import { createGameSystems } from '../src/sim/systems';
import { loadTowerData } from '../src/sim/towers/towerData';

const { enemyCount, towerCount, towerType } = debugConfig.defaults;
const { chainScenario } = debugConfig;
const WARMUP_TICKS = 600;
const MEASURED_TICKS = 3000;
const TPS = engineConfig.ticksPerSecond;

/** `bonus`: classes reais; `none`: sem níveis nos dados (= T07); `level4`: 4 tipos de teste a mais. */
type Variant = 'bonus' | 'none' | 'level4';

interface Scenario {
  name: string;
  variant: Variant;
  enemyLayout: DebugLayout;
  towerLayout: DebugLayout;
  towerTypes: string[];
}

const LEVEL4_TYPES = ['testA', 'testB', 'testC', 'testD'];

/** Tipos de teste (só para o bench): com os 4 provisórios, todas as classes chegam a 4 tipos. */
function level4Towers() {
  const raw = JSON.parse(JSON.stringify(towersJson)) as { types: Record<string, unknown> };
  const plain = {
    damage: 5,
    shotsPerSecond: 1,
    range: 3,
    projectileSpeed: 8,
    shot: { kind: 'single' },
    targetMode: 'first',
    trigger: null,
  };
  const classes = [
    ['artillery', 'mechanical'],
    ['arcane', 'shadow'],
    ['mechanical', 'artillery'],
    ['shadow', 'arcane'],
  ];
  LEVEL4_TYPES.forEach((id, i) => {
    raw.types[id] = { name: id, classes: classes[i], ...plain };
  });
  return loadTowerData(raw);
}

function noBonusClasses() {
  const classes = Object.fromEntries(
    Object.entries(classesJson.classes).map(([id, c]) => [id, { ...c, levels: [] }]),
  );
  return loadClassData({ ...classesJson, classes });
}

const SCENARIOS: Scenario[] = [
  {
    name: 'espalhado',
    variant: 'bonus',
    enemyLayout: 'spread',
    towerLayout: 'spread',
    towerTypes: [towerType],
  },
  {
    name: 'agrupado',
    variant: 'bonus',
    enemyLayout: 'clustered',
    towerLayout: 'clustered',
    towerTypes: [towerType],
  },
  ...(
    [
      ['bonus', ''],
      ['none', ' sem bônus'],
      ['level4', ' nível 4'],
    ] as const
  ).flatMap(([variant, suffix]) =>
    (['spread', 'clustered'] as const).map((layout) => ({
      name: `cadeia ${layout === 'spread' ? 'espalhado' : 'agrupado'}${suffix}`,
      variant,
      enemyLayout: layout,
      towerLayout: chainScenario.towerLayout as DebugLayout,
      towerTypes:
        variant === 'level4'
          ? [...chainScenario.towerTypes, ...LEVEL4_TYPES]
          : chainScenario.towerTypes,
    })),
  ),
];

const f = (value: number, digits = 3): string => value.toFixed(digits);

function measure(s: Scenario): string {
  const options =
    s.variant === 'none'
      ? { classes: noBonusClasses() }
      : s.variant === 'level4'
        ? { towers: level4Towers() }
        : {};
  const sim = Simulation.create(
    `bench-${s.enemyLayout}`,
    createGameSystems(loadMap(mapData), options),
  );
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
  const levels = Object.entries(sim.state.classes)
    .map(([id, c]) => `${id} ${c.level}`)
    .join(', ');
  return [
    `${s.name.padEnd(24)} tick médio ${f(avg)} ms | p99 ${f(p99)} ms | máx ${f(max)} ms`,
    `${''.padEnd(24)} gatilhos/tick ${f(triggers.avg, 1)} (pior ${triggers.max}) | prof. máx ${maxDepth} | ` +
      `adiados ${deferredTicks} ticks (fila máx ${maxDeferred}) | descartados ${dropped}`,
    `${''.padEnd(24)} abates/s ${f(kills.avg * TPS, 1)} | pico ${kills.max} abates/tick | ` +
      `projéteis (média) ${f(projectiles / MEASURED_TICKS, 0)}`,
    `${''.padEnd(24)} níveis: ${levels}`,
  ].join('\n');
}

it(`tick com ${enemyCount} inimigos e ${towerCount} torres (${towerType} e cadeia)`, () => {
  const lines = SCENARIOS.map(measure);
  process.stdout.write(`\n${lines.join('\n')}\n`);
});
