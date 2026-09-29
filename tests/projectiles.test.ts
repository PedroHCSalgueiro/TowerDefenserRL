import { describe, expect, it } from 'vitest';
import { releaseEnemy, type Enemy } from '../src/sim/enemies/pool';
import type { System } from '../src/sim/engine/simulation';
import type { Projectile } from '../src/sim/projectiles/pool';
import type { RunState } from '../src/sim/state';
import { blindNexus, makeState, place } from './support/enemySim';
import { addTower, onRoute, run, towerSim, towersOnly } from './support/towerSim';

// Raio de troca de alvo das torres de teste: 1 casa. A torre fica em (1, 0),
// com alcance 1,5; o alvo T fica em (1.5, 1), a 1,5 casa do início do caminho.

function activeProjectiles(state: RunState): Projectile[] {
  return state.projectiles.slots.filter((p) => p.active);
}

/** Dispara no alvo T, depois tira T do mapa ("morreu") e trava novos disparos. */
function fireThenKill(state: RunState, target: Enemy): void {
  const sim = towersOnly(state);
  run(sim, 1);
  expect(activeProjectiles(state).map((p) => p.targetId)).toEqual([target.id]);
  releaseEnemy(state.enemies, target);
  state.towers[0]!.cooldownTicks = 99;
}

describe('projétil cujo alvo morreu', () => {
  it('troca uma vez para o mais próximo do ponto da morte, mesmo fora do alcance da torre', () => {
    const state = makeState();
    addTower(state, 'arrow', 1, 0);
    const target = onRoute(state, 'walker', 1.5, 1000); // (1.5, 1)
    const near = place(state, 'brick', 2.25, 1, 1000); // 0,75 da morte; fora do alcance da torre
    const farther = place(state, 'brick', 1.5, 1.9, 1000); // 0,9 da morte
    const sim = towersOnly(state);
    run(sim, 1);
    releaseEnemy(state.enemies, target);
    state.towers[0]!.cooldownTicks = 99;

    run(sim, 1);
    const [projectile] = activeProjectiles(state);
    expect(projectile).toMatchObject({ targetId: near.id, retargeted: true });

    run(sim, 10);
    expect(state.projectiles.activeCount).toBe(0);
    expect(near.hp).toBe(994);
    expect(farther.hp).toBe(1000);
  });

  it('empate na distância ao ponto da morte: vence o menor id', () => {
    const state = makeState();
    addTower(state, 'arrow', 1, 0);
    const filler = place(state, 'brick', 4, 3, 1000); // ocupa o slot 0
    const lowerId = place(state, 'brick', 0.75, 1, 1000); // 0,75 à esquerda da morte
    releaseEnemy(state.enemies, filler);
    const higherId = place(state, 'brick', 2.25, 1, 1000); // 0,75 à direita, no slot 0
    expect(higherId.slot).toBeLessThan(lowerId.slot);
    const target = onRoute(state, 'walker', 1.5, 1000);
    fireThenKill(state, target);

    run(towersOnly(state), 1);
    expect(activeProjectiles(state)[0]).toMatchObject({ targetId: lowerId.id, retargeted: true });
  });

  it('sem ninguém no raio, o projétil some sem causar dano', () => {
    const state = makeState();
    addTower(state, 'arrow', 1, 0);
    const target = onRoute(state, 'walker', 1.5, 1000);
    const outside = place(state, 'brick', 2.6, 1, 1000); // 1,1 da morte
    fireThenKill(state, target);

    run(towersOnly(state), 10);
    expect(state.projectiles.activeCount).toBe(0);
    expect(outside.hp).toBe(1000);
  });

  it('troca só uma vez: se o alvo novo também morrer, o projétil some', () => {
    const state = makeState();
    addTower(state, 'arrow', 1, 0);
    const target = onRoute(state, 'walker', 1.5, 1000);
    const second = place(state, 'brick', 2.25, 1, 1000);
    const third = place(state, 'brick', 2.25, 1.5, 1000); // 0,5 do segundo
    fireThenKill(state, target);
    const sim = towersOnly(state);
    run(sim, 1);
    expect(activeProjectiles(state)[0]).toMatchObject({ targetId: second.id });

    releaseEnemy(state.enemies, second);
    run(sim, 10);
    expect(state.projectiles.activeCount).toBe(0);
    expect(third.hp).toBe(1000);
  });

  it('slot do alvo reaproveitado antes de o projétil perceber: vale o ponto guardado da morte', () => {
    const state = makeState();
    addTower(state, 'arrow', 1, 0);
    const target = onRoute(state, 'walker', 1.5, 1000);
    const near = place(state, 'brick', 2.25, 1, 1000);
    fireThenKill(state, target);
    // Um inimigo novo nasce no mesmo slot, longe do ponto da morte.
    const newcomer = place(state, 'brick', 1.5, 3, 1000);
    expect(newcomer.slot).toBe(target.slot);

    run(towersOnly(state), 10);
    expect(near.hp).toBe(994);
    expect(newcomer.hp).toBe(1000);
  });

  it('morte no mesmo tick, antes dos projéteis: vale onde o alvo morreu, não a posição anterior', () => {
    const state = makeState();
    addTower(state, 'arrow', 1, 0);
    const target = onRoute(state, 'walker', 1.5, 1000); // (1.5, 1)
    // Só alcançável a partir da posição anterior do alvo (0,85 dela; 1,04 do ponto da morte).
    const nearOld = place(state, 'brick', 1.5, 1.85, 1000);
    // Só alcançável a partir do ponto da morte (0,9 dele; 1,08 da posição anterior).
    const nearDeath = place(state, 'brick', 2.1, 1.9, 1000);
    // No 2º tick, antes dos projéteis, o alvo anda até (2.1, 1) e morre ali.
    const moveAndKill: System = (ctx) => {
      if (ctx.state.tick !== 2) return;
      target.x = 2.1;
      releaseEnemy(ctx.state.enemies, target);
    };
    const sim = towersOnly(state, undefined, undefined, [moveAndKill]);
    run(sim, 1);
    state.towers[0]!.cooldownTicks = 99;

    run(sim, 1);
    expect(activeProjectiles(state)[0]).toMatchObject({ targetId: nearDeath.id, retargeted: true });
    run(sim, 10);
    expect(nearDeath.hp).toBe(994);
    expect(nearOld.hp).toBe(1000);
  });

  it('alvo que chega ao núcleo antes do impacto: troca a partir do ponto em que saiu', () => {
    // Partida completa (com movimento). Rota terrestre: 7 casas; núcleo em (1, 3).
    const state = makeState('nexus', blindNexus);
    addTower(state, 'arrow', 1, 2);
    const leaving = onRoute(state, 'walker', 6.6, 1000); // (1.4, 3): chega no 2º tick
    const next = onRoute(state, 'walker', 5.8, 1000); // (2.2, 3): fora do alcance no início
    const sim = towerSim(state);

    const first = run(sim, 1);
    expect(first).toContainEqual({
      type: 'towerFired',
      tick: 1,
      towerId: expect.any(Number),
      targetId: leaving.id,
    });

    const second = run(sim, 1);
    expect(second).toContainEqual({
      type: 'enemyReachedNexus',
      tick: 2,
      enemyId: leaving.id,
      damage: 2,
    });
    // O ponto de saída é o núcleo (1, 3); `next` está em (1.7, 3), a 0,7 dele.
    expect(activeProjectiles(state)[0]).toMatchObject({
      targetId: next.id,
      retargeted: true,
      targetX: expect.closeTo(1.7, 12),
      targetY: 3,
    });

    run(sim, 2);
    expect(next.hp).toBe(994);
  });
});
