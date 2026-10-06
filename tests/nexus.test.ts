import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../src/sim/engine/events';
import { Simulation } from '../src/sim/engine/simulation';
import { createNexusAttackSystem } from '../src/sim/nexus/systems';
import { releaseEnemy } from '../src/sim/enemies/pool';
import {
  TPS,
  activeEnemies,
  blindNexus,
  makeSim,
  makeState,
  place,
  smallMap,
  spawn,
  testEnemies,
  testNexus,
} from './support/enemySim';

function run(sim: Simulation, ticks: number, events: SimEvent[] = []): SimEvent[] {
  for (let i = 0; i < ticks; i++) {
    sim.step();
    events.push(...sim.drainEvents());
  }
  return events;
}

describe('chegada ao núcleo', () => {
  it('causa nexusDamage, remove o inimigo e emite o evento', () => {
    const sim = makeSim(blindNexus);
    spawn(sim, 'brick');
    const events = run(sim, 27);
    expect(activeEnemies(sim.state)).toHaveLength(1);
    expect(sim.state.nexus.hp).toBe(20);

    run(sim, 1, events); // 7 casas a 0,25 por tick = tick 28
    expect(activeEnemies(sim.state)).toHaveLength(0);
    expect(sim.state.enemies.activeCount).toBe(0);
    expect(sim.state.nexus.hp).toBe(18);
    expect(events.filter((e) => e.type === 'enemyReachedNexus')).toEqual([
      { type: 'enemyReachedNexus', tick: 28, enemyId: 1, damage: 2 },
    ]);
  });

  it('vários inimigos chegando no mesmo tick somam o dano', () => {
    const sim = makeSim(blindNexus);
    spawn(sim, 'brick', 3);
    const events = run(sim, 28);
    expect(sim.state.nexus.hp).toBe(14);
    expect(events.filter((e) => e.type === 'enemyReachedNexus')).toHaveLength(3);
    expect(sim.state.status).toBe('playing');
  });

  it('vida zerada = derrota: runLost uma vez, vida presa em 0', () => {
    const state = makeState('lost', blindNexus);
    state.nexus.hp = 3;
    const sim = makeSim(blindNexus, state);
    spawn(sim, 'brick', 2);
    const events = run(sim, 28);
    expect(sim.state.nexus.hp).toBe(0);
    expect(sim.state.status).toBe('lost');
    expect(events.filter((e) => e.type === 'runLost')).toEqual([{ type: 'runLost', tick: 28 }]);
  });

  it('depois da derrota a simulação não avança', () => {
    const state = makeState('frozen', blindNexus);
    state.nexus.hp = 1;
    const sim = makeSim(blindNexus, state);
    spawn(sim, 'brick');
    spawn(sim, 'walker');
    run(sim, 1);
    spawn(sim, 'walker'); // um tick atrás: ainda está no mapa na derrota
    run(sim, 27);
    expect(sim.state.status).toBe('lost');
    expect(sim.state.enemies.activeCount).toBe(1);

    const before = structuredClone(sim.state);
    spawn(sim, 'walker');
    expect(run(sim, 50)).toEqual([]);
    expect({ ...sim.state, commandQueue: [] }).toEqual({ ...before, commandQueue: [] });
  });
});

describe('ataque do núcleo', () => {
  // Núcleo em (1,3), alcance 1,5, dano 4, um ataque por segundo (8 ticks).
  function attackOnly(state = makeState()): Simulation {
    return new Simulation(state, [
      createNexusAttackSystem(smallMap.nexus, testEnemies, testNexus, TPS),
    ]);
  }

  it('mira o inimigo mais próximo dentro do alcance', () => {
    const state = makeState();
    place(state, 'walker', 1, 2); // distância 1
    const near = place(state, 'walker', 1.5, 3); // distância 0,5
    place(state, 'walker', 4, 0); // fora do alcance
    const sim = attackOnly(state);
    const events = run(sim, 1);
    expect(events[0]).toEqual({ type: 'nexusFired', tick: 1, targetId: near.id, x: 1.5, y: 3 });
    expect(near.hp).toBe(6);
  });

  it('empate na distância: vence o menor id, não o menor slot', () => {
    const state = makeState();
    const gone = place(state, 'walker', 4, 0); // id 1, slot 0
    const older = place(state, 'walker', 1, 2); // id 2, slot 1
    releaseEnemy(state.enemies, gone);
    const newer = place(state, 'walker', 2, 3); // id 3, reaproveita o slot 0
    expect(newer.slot).toBe(0);
    const events = run(attackOnly(state), 1);
    expect(events[0]).toMatchObject({ type: 'nexusFired', targetId: older.id });
  });

  it('a borda do alcance conta; sem ninguém no alcance, não ataca', () => {
    const state = makeState();
    const target = place(state, 'walker', 1, 4.5 + 1e-9);
    const sim = attackOnly(state);
    expect(run(sim, 3)).toEqual([]);
    expect(state.nexus.attackCooldownTicks).toBe(0);

    target.y = 4.5; // exatamente 1,5 casa
    expect(run(sim, 1)).toMatchObject([{ type: 'nexusFired', targetId: target.id }]);
  });

  it('respeita o tempo de recarga', () => {
    const state = makeState();
    place(state, 'brick', 1, 2, 1e9);
    const events = run(attackOnly(state), 17);
    expect(events.map((e) => e.tick)).toEqual([1, 9, 17]);
  });

  it('a armadura reduz o dano do núcleo', () => {
    const state = makeState();
    const tank = place(state, 'tank', 1, 2);
    run(attackOnly(state), 1);
    expect(tank.hp).toBeCloseTo(10 - (4 * 100) / 150, 12);
  });

  it('matar devolve o inimigo ao pool e emite enemyKilled sem torre', () => {
    const state = makeState();
    const weak = place(state, 'walker', 1, 2, 3);
    const events = run(attackOnly(state), 1);
    expect(events).toEqual([
      { type: 'nexusFired', tick: 1, targetId: weak.id, x: 1, y: 2 },
      {
        type: 'enemyKilled',
        tick: 1,
        enemyId: weak.id,
        enemyType: 'walker',
        wave: 0,
        towerId: null,
        x: 1,
        y: 2,
        elite: false,
        weight: 1,
        chainId: 0,
        originTowerId: null,
      },
    ]);
    expect(weak.active).toBe(false);
    expect(state.enemies.activeCount).toBe(0);
  });

  it('acerta voadores', () => {
    const state = makeState();
    const flyer = place(state, 'flyer', 0.8, 2.6);
    expect(run(attackOnly(state), 1)).toMatchObject([{ type: 'nexusFired', targetId: flyer.id }]);
  });

  it('na partida, o núcleo mata quem se aproxima antes de chegar', () => {
    // Entra no alcance no tick 22 (distância 5,5). Atacando a cada 2 ticks,
    // o 3º ataque (tick 26) mata o walker antes do tick 28, quando chegaria.
    const fastNexus = { ...testNexus, attack: { ...testNexus.attack, cooldownSeconds: 0.25 } };
    const sim = makeSim(fastNexus);
    spawn(sim, 'walker');
    const events = run(sim, 40);
    expect(events.filter((e) => e.type === 'enemyKilled')).toHaveLength(1);
    expect(events.some((e) => e.type === 'enemyReachedNexus')).toBe(false);
    expect(sim.state.nexus.hp).toBe(20);
  });
});
