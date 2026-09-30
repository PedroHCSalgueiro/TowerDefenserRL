import { describe, expect, it } from 'vitest';
import economyJson from '../src/data/economy.json';
import { createGoldSystem, interestFor, waveBonusFor } from '../src/sim/economy/economy';
import { economyData, loadEconomyData } from '../src/sim/economy/economyData';
import { enemyData } from '../src/sim/enemies/enemyData';
import type { SimEvent } from '../src/sim/engine/events';
import { Simulation } from '../src/sim/engine/simulation';
import { createRunState, type RunState } from '../src/sim/state';
import { freeCells, shopSim, stepOnce } from './support/shopSim';

describe('dados da economia', () => {
  it('carrega os números aprovados', () => {
    expect(economyData.startingGold).toBe(10);
    expect(economyData.interest).toEqual({ percent: 10, cap: 15 });
    expect(economyData.waveBonus).toEqual({ base: 10, perWave: 1 });
    expect(economyData.shop.slots).toBe(5);
    expect(economyData.shop.rerollCost).toBe(4);
    expect(economyData.shop.sellRefundPercent).toBe(70);
    expect(economyData.shop.prices).toEqual({ common: 10, uncommon: 15, rare: 25 });
    expect(economyData.shop.rarityChances).toHaveLength(5);
    expect(economyData.shop.rarityChances[0]).toEqual({ common: 70, uncommon: 25, rare: 5 });
    expect(economyData.shop.rarityChances[4]).toEqual({ common: 30, uncommon: 40, rare: 30 });
  });

  it('recusa chances que não somam 100 e preço inválido', () => {
    const bad = structuredClone(economyJson);
    bad.shop.rarityChances[2] = { common: 50, uncommon: 35, rare: 10 };
    expect(() => loadEconomyData(bad)).toThrow(/somar 100/);
    const noPrice = structuredClone(economyJson) as unknown as { shop: { prices: unknown } };
    noPrice.shop.prices = { common: 10, uncommon: 15 };
    expect(() => loadEconomyData(noPrice)).toThrow(/prices/);
  });
});

describe('juros e bônus', () => {
  it('10% do ouro guardado, arredondado para baixo', () => {
    expect(interestFor(economyData, 0)).toBe(0);
    expect(interestFor(economyData, 9)).toBe(0);
    expect(interestFor(economyData, 10)).toBe(1);
    expect(interestFor(economyData, 59)).toBe(5);
    expect(interestFor(economyData, 99)).toBe(9);
  });

  it('tem teto de 15, atingido com 150 guardados', () => {
    expect(interestFor(economyData, 149)).toBe(14);
    expect(interestFor(economyData, 150)).toBe(15);
    expect(interestFor(economyData, 100000)).toBe(15);
  });

  it('bônus de fim de onda: 10 + 1 por número da onda', () => {
    expect(waveBonusFor(economyData, 1)).toBe(11);
    expect(waveBonusFor(economyData, 5)).toBe(15);
  });
});

describe('fim de onda (comando endWave)', () => {
  it('juros primeiro sobre o ouro guardado, depois o bônus', () => {
    const sim = shopSim();
    sim.state.gold = 100;
    sim.state.reportedGold = 100;
    sim.enqueue({ type: 'endWave' });
    const events = stepOnce(sim);
    // 100 + 10 de juros + 11 de bônus. Se o bônus viesse antes, os juros seriam 11.
    expect(sim.state.gold).toBe(121);
    expect(sim.state.wave).toBe(1);
    expect(events.find((e) => e.type === 'waveEnded')).toEqual({
      type: 'waveEnded',
      tick: 1,
      wave: 1,
      interest: 10,
      bonus: 11,
      gold: 121,
    });
  });

  it('o contador começa em 0: a primeira onda paga 11 e a segunda, 12', () => {
    const sim = shopSim();
    expect(sim.state.wave).toBe(0);
    sim.state.gold = 0;
    sim.state.reportedGold = 0;
    sim.enqueue({ type: 'endWave' });
    stepOnce(sim);
    expect(sim.state.gold).toBe(11);
    sim.enqueue({ type: 'endWave' });
    stepOnce(sim);
    // 11 de juros = 1, mais o bônus de 12.
    expect(sim.state.gold).toBe(11 + 1 + 12);
    expect(sim.state.wave).toBe(2);
  });

  it('respeita o teto de juros', () => {
    const sim = shopSim();
    sim.state.gold = 1000;
    sim.state.reportedGold = 1000;
    sim.enqueue({ type: 'endWave' });
    stepOnce(sim);
    expect(sim.state.gold).toBe(1000 + 15 + 11);
  });
});

describe('ouro por abate', () => {
  it('cada inimigo morto paga o gold dele, inclusive os mortos pelo núcleo', () => {
    const sim = shopSim();
    const before = sim.state.gold;
    const kills = [
      { type: 'common', towerId: 3 },
      { type: 'armored', towerId: null },
      { type: 'flying', towerId: 3 },
    ];
    const events = stepOnceWithKills(sim, kills);
    const expected = kills.reduce((sum, k) => sum + enemyData.types[k.type]!.gold, 0);
    expect(expected).toBe(5);
    expect(sim.state.gold).toBe(before + expected);
    expect(events.filter((e) => e.type === 'goldChanged')).toHaveLength(1);
  });

  it('goldChanged sai no máximo uma vez por tick, com o saldo final', () => {
    const sim = shopSim();
    const kills = Array.from({ length: 400 }, () => ({ type: 'armored', towerId: 1 }));
    const events = stepOnceWithKills(sim, kills);
    const changes = events.filter((e) => e.type === 'goldChanged');
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ gold: 10 + 800, delta: 800 });
  });

  it('sem mudança de saldo, não emite goldChanged', () => {
    const sim = shopSim();
    expect(stepOnce(sim).some((e) => e.type === 'goldChanged')).toBe(false);
  });

  it('compra e venda também informam o saldo uma vez', () => {
    const sim = shopSim();
    const cell = freeCells(1)[0]!;
    const slot = sim.state.shop.slots.findIndex((id) => id !== null);
    sim.enqueue({ type: 'buyTower', slot, x: cell.x, y: cell.y });
    sim.enqueue({ type: 'rerollShop' });
    const events = stepOnce(sim);
    expect(events.filter((e) => e.type === 'goldChanged').length).toBeLessThanOrEqual(1);
  });
});

describe('save', () => {
  it('o estado novo nasce coerente', () => {
    const state = createRunState('x');
    expect(state.gold).toBe(10);
    expect(state.reportedGold).toBe(10);
    expect(state.wave).toBe(0);
    expect(state.nexus.level).toBe(1);
    expect(state.shop.slots).toHaveLength(5);
  });
});

/** Um tick em que os abates acontecem (o sistema de ouro lê os eventos do tick). */
function stepOnceWithKills(
  sim: ReturnType<typeof shopSim>,
  kills: { type: string; towerId: number | null }[],
) {
  // Injeta os abates como um sistema extra antes do sistema de ouro: usa o
  // mesmo caminho que a simulação (eventos do tick).
  const injected = kills.map((k, i) => ({
    type: 'enemyKilled' as const,
    tick: sim.state.tick + 1,
    enemyId: 1000 + i,
    enemyType: k.type,
    towerId: k.towerId,
    x: 0,
    y: 0,
    weight: 1,
  }));
  const systems = injectSystems(sim, injected);
  systems.step();
  return systems.drainEvents();
}

/** Simulação só com o sistema de ouro, mais um sistema que emite os abates dados. */
function injectSystems(sim: ReturnType<typeof shopSim>, kills: SimEvent[]): Simulation {
  return new Simulation(sim.state as RunState, [
    (ctx) => {
      for (const k of kills) ctx.emit(k);
    },
    createGoldSystem(enemyData),
  ]);
}
