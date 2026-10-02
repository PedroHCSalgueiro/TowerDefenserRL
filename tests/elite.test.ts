import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../src/sim/engine/events';
import { Simulation } from '../src/sim/engine/simulation';
import { createGameSystems } from '../src/sim/systems';
import type { WaveData } from '../src/sim/waves/waveData';
import { waveData } from '../src/sim/waves/waveData';
import {
  activeEnemies,
  blindNexus,
  makeState,
  smallMap,
  testEnemies,
  TPS,
} from './support/enemySim';
import { shopSim } from './support/shopSim';

/** Onda 1: um caminhante normal e um elite, na mesma fila; multiplicador 2. A 2 só segura a run. */
const eliteWaves: WaveData = {
  maxActiveEnemies: 1000,
  waves: [
    {
      hpMultiplier: 2,
      spawnSeconds: 1 / TPS,
      enemies: [
        { type: 'walker', count: 1, elite: false },
        { type: 'walker', count: 1, elite: true },
      ],
    },
    { hpMultiplier: 1, spawnSeconds: 1, enemies: [{ type: 'walker', count: 1, elite: false }] },
  ],
};

function eliteSim(): Simulation {
  return new Simulation(
    makeState('elite', blindNexus),
    createGameSystems(smallMap, {
      enemies: testEnemies,
      nexus: blindNexus,
      waves: eliteWaves,
      ticksPerSecond: TPS,
    }),
  );
}

function bothSpawned(): { sim: Simulation; events: SimEvent[] } {
  const sim = eliteSim();
  sim.enqueue({ type: 'callWave' });
  const events: SimEvent[] = [];
  for (let i = 0; i < 2; i++) {
    sim.step();
    events.push(...sim.drainEvents());
  }
  return { sim, events };
}

describe('inimigo elite (T21)', () => {
  it('nasce com a vida do tipo × multiplicador da onda × 6, marcado como elite', () => {
    const { sim } = bothSpawned();
    const [normal, elite] = activeEnemies(sim.state).sort((a, b) => a.id - b.id);
    expect(normal!.elite).toBe(false);
    expect(normal!.maxHp).toBe(10 * 2);
    expect(elite!.elite).toBe(true);
    expect(elite!.maxHp).toBe(10 * 2 * 6);
    expect(elite!.hp).toBe(elite!.maxHp);
    expect(elite!.type).toBe('walker');
  });

  it('anda a 0,8 da velocidade do tipo', () => {
    const { sim } = bothSpawned();
    const [normal, elite] = activeEnemies(sim.state).sort((a, b) => a.id - b.id);
    const [d0, e0] = [normal!.distance, elite!.distance];
    for (let i = 0; i < 4; i++) sim.step();
    expect(normal!.distance - d0).toBeCloseTo((2 / TPS) * 4, 9);
    expect(elite!.distance - e0).toBeCloseTo((2 * 0.8 * 4) / TPS, 9);
  });

  it('no núcleo, causa 5 de dano (o caminhante normal causa 2)', () => {
    const sim = eliteSim();
    const hp = sim.state.nexus.hp;
    sim.enqueue({ type: 'callWave' });
    sim.step();
    const damages: number[] = [];
    for (let i = 0; i < 400 && sim.state.waves.active.length > 0; i++) {
      sim.step();
      for (const e of sim.drainEvents()) if (e.type === 'enemyReachedNexus') damages.push(e.damage);
    }
    expect(damages).toEqual([2, 5]);
    expect(sim.state.nexus.hp).toBe(hp - 7);
  });

  it('o slot reaproveitado perde a marca de elite', () => {
    const sim = eliteSim();
    sim.enqueue({ type: 'callWave' });
    sim.step();
    for (let i = 0; i < 400 && sim.state.waves.active.length > 0; i++) sim.step();
    expect(sim.state.enemies.activeCount).toBe(0);
    sim.enqueue({ type: 'spawnEnemy', enemyType: 'walker' });
    sim.enqueue({ type: 'spawnEnemy', enemyType: 'walker' });
    sim.step();
    expect(activeEnemies(sim.state).map((e) => e.elite)).toEqual([false, false]);
  });

  it('o save guarda a marca de elite: retomar dá o mesmo estado', () => {
    const { sim } = bothSpawned();
    const restored = Simulation.restore(
      sim.serialize(),
      createGameSystems(smallMap, {
        enemies: testEnemies,
        nexus: blindNexus,
        waves: eliteWaves,
        ticksPerSecond: TPS,
      }),
    );
    expect(activeEnemies(restored.state).some((e) => e.elite)).toBe(true);
    for (let i = 0; i < 20; i++) {
      sim.step();
      restored.step();
    }
    expect(restored.serialize()).toBe(sim.serialize());
  });

  it('no jogo real, a onda 5 traz os elites com a vida da onda × 6', () => {
    const sim = shopSim('elite-real');
    sim.enqueue({ type: 'debugSkipToWave', wave: 5 });
    sim.enqueue({ type: 'debugSetNexusInvulnerable', value: true });
    sim.enqueue({ type: 'callWave' });
    for (let i = 0; i < 600 && !activeEnemies(sim.state).some((e) => e.elite); i++) sim.step();
    const elite = activeEnemies(sim.state).find((e) => e.elite)!;
    expect(elite.maxHp).toBeCloseTo(30 * waveData.waves[4]!.hpMultiplier * 6, 9);
  });
});
