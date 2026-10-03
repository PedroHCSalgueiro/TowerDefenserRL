import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../src/sim/engine/events';
import { economyData, loadEconomyData } from '../src/sim/economy/economyData';
import economyJson from '../src/data/economy.json';
import { releaseAllEnemies } from '../src/sim/enemies/pool';
import { Simulation } from '../src/sim/engine/simulation';
import { createGameSystems } from '../src/sim/systems';
import { earlyBonusWindow } from '../src/sim/waves/waves';
import { buildWaveHudModel, defaultWaveSchedules } from '../src/ui/waveHudModel';
import { realMap, shopSim, stepOnce } from './support/shopSim';

function ofType<K extends SimEvent['type']>(events: SimEvent[], type: K) {
  return events.filter((e): e is Extract<SimEvent, { type: K }> => e.type === type);
}

/** Roda até a onda mais recente ter `spawned` nascimentos (sem passar). */
function runUntilSpawned(sim: Simulation, spawned: number): void {
  for (let i = 0; i < 5000; i++) {
    const newest = sim.state.waves.active[sim.state.waves.active.length - 1]!;
    if (newest.spawned >= spawned) return;
    sim.step();
  }
  throw new Error('não chegou');
}

function callNext(sim: Simulation): Extract<SimEvent, { type: 'waveStarted' }> {
  sim.enqueue({ type: 'callWave' });
  return ofType(stepOnce(sim), 'waveStarted')[0]!;
}

describe('janela do bônus de chamada antecipada (T23)', () => {
  it('75% em economy.json, validado no carregamento', () => {
    expect(economyData.earlyCall.windowPercent).toBe(75);
    const bad = (windowPercent: unknown) => () =>
      loadEconomyData({ ...economyJson, earlyCall: { perActiveWave: 5, windowPercent } });
    expect(bad(75)).not.toThrow();
    expect(bad(0)).toThrow(/windowPercent/);
    expect(bad(101)).toThrow(/windowPercent/);
    expect(bad(undefined)).toThrow(/windowPercent/);
  });

  it('onda 1 (6 inimigos): com 4 nascidos ainda dá bônus; com 5 (≥ 75%) a chamada sai sem bônus', () => {
    const before = shopSim('janela-antes');
    callNext(before);
    runUntilSpawned(before, 4);
    expect(before.state.waves.active[0]!.spawned).toBe(4);
    expect(callNext(before)).toMatchObject({ wave: 2, early: true, earlyBonus: 5 });

    const after = shopSim('janela-depois');
    callNext(after);
    runUntilSpawned(after, 5);
    expect(callNext(after)).toMatchObject({ wave: 2, early: true, earlyBonus: 0 });
    // Fora da janela a onda vem igual; só o bônus some.
    expect(after.state.waves.active.map((w) => [w.wave, w.earlyBonus])).toEqual([
      [1, 0],
      [2, 0],
    ]);
  });

  it('conta nascimento, não morte: tirar todos os nascidos do mapa não reabre a janela', () => {
    const sim = shopSim('janela-mortos');
    callNext(sim);
    runUntilSpawned(sim, 5);
    releaseAllEnemies(sim.state.enemies);
    expect(sim.state.enemies.activeCount).toBe(0);
    expect(earlyBonusWindow(sim.state, defaultWaveSchedules, economyData)).toMatchObject({
      open: false,
      remaining: 0,
    });
    expect(callNext(sim)).toMatchObject({ wave: 2, earlyBonus: 0 });
  });

  it('empilhadas: vale a onda mais recente, e o valor continua 5 × ondas ativas', () => {
    const sim = shopSim('janela-pilha');
    callNext(sim);
    runUntilSpawned(sim, 5); // a onda 1 já passou dos 75%
    expect(callNext(sim)).toMatchObject({ wave: 2, earlyBonus: 0 });
    // A mais recente agora é a 2, com 1 nascido: a janela reabre.
    expect(callNext(sim)).toMatchObject({ wave: 3, earlyBonus: 10 });
    expect(callNext(sim)).toMatchObject({ wave: 4, earlyBonus: 15 });
    runUntilSpawned(sim, 6); // a onda 4 (8 inimigos) chega a 75%
    expect(callNext(sim)).toMatchObject({ wave: 5, earlyBonus: 0 });
  });

  it('o bônus da chamada continua pago só quando a onda fecha (antes da janela fechar não muda)', () => {
    const sim = shopSim('janela-pago');
    callNext(sim);
    runUntilSpawned(sim, 2);
    const started = callNext(sim);
    expect(started.earlyBonus).toBe(5);
    expect(sim.state.waves.active[1]!.earlyBonus).toBe(5);
  });

  it('save no meio da onda: retomar e chamar dá o mesmo bônus', () => {
    for (const spawned of [4, 5]) {
      const a = shopSim(`janela-save-${spawned}`);
      callNext(a);
      runUntilSpawned(a, spawned);
      const b = Simulation.restore(a.serialize(), createGameSystems(realMap));
      expect(callNext(b)).toEqual(callNext(a));
      expect(b.serialize()).toBe(a.serialize());
    }
  });

  it('HUD: dentro da janela "Chamar antecipada (+5)" e "bônus por mais N inimigos"; fora, "sem bônus"', () => {
    const sim = shopSim('janela-hud');
    callNext(sim);
    expect(buildWaveHudModel(sim.state)).toMatchObject({
      callLabel: 'Chamar antecipada (+5)',
      bonusWindow: { text: 'bônus por mais 4 inimigos', spent: 0.2 },
      canCall: true,
    });
    runUntilSpawned(sim, 4);
    expect(buildWaveHudModel(sim.state).bonusWindow).toEqual({
      text: 'bônus por mais 1 inimigo',
      spent: 0.8,
    });
    runUntilSpawned(sim, 5);
    expect(buildWaveHudModel(sim.state)).toMatchObject({
      callLabel: 'Chamar próxima onda (sem bônus)',
      bonusWindow: null,
      canCall: true,
    });
  });
});
