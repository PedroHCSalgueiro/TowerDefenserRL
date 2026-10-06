import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../src/sim/engine/events';
import { economyData } from '../src/sim/economy/economyData';
import { botSim, noRewards, playRun, TOTAL_WAVES } from './support/waveBot';

describe('run completa jogada pelo bot', () => {
  it('as 40 ondas terminam sem erro (núcleo invulnerável, para chegar ao fim)', () => {
    const sim = botSim('bot-invulneravel', true);
    const reports = playRun(sim);
    expect(reports.map((r) => r.wave)).toEqual(
      Array.from({ length: TOTAL_WAVES }, (_, i) => i + 1),
    );
    expect(sim.state.wave).toBe(TOTAL_WAVES);
    expect(sim.state.waves.active).toEqual([]);
    expect(sim.state.enemies.activeCount).toBe(0);
    // Toda onda termina dentro do teto do bot (nenhuma ficou presa).
    for (const report of reports) expect(report.ticks).toBeLessThan(30 * 60 * 8);
  });

  it('a mesma semente dá a mesma run inteira (determinismo)', () => {
    const a = botSim('bot-determinismo');
    const b = botSim('bot-determinismo');
    const ra = playRun(a);
    const rb = playRun(b);
    expect(rb).toEqual(ra);
    expect(b.serialize()).toBe(a.serialize());
    expect(['won', 'lost']).toContain(a.state.status);
  });

  it('economia da T19: o ouro ganho vem só do fim das ondas (juros, renda e antecipado)', () => {
    // Sem recompensas: a renda e os juros aqui são os da economia pura.
    const sim = botSim('bot-economia', true, { rewards: noRewards });
    const ended: Extract<SimEvent, { type: 'waveEnded' }>[] = [];
    let killed = 0;
    const drain = sim.drainEvents.bind(sim);
    sim.drainEvents = () => {
      const events = drain();
      for (const e of events) {
        if (e.type === 'waveEnded') ended.push(e);
        if (e.type === 'enemyKilled') killed++;
      }
      return events;
    };
    playRun(sim);
    expect(killed).toBeGreaterThan(0);
    expect(ended.map((e) => e.wave)).toEqual(Array.from({ length: TOTAL_WAVES }, (_, i) => i + 1));
    for (const e of ended) {
      expect(e.bonus).toBe(15 + e.wave);
      expect(e.interest).toBeLessThanOrEqual(economyData.interest.cap);
    }
    const fromWaves = ended.reduce((s, e) => s + e.interest + e.bonus + e.earlyBonus, 0);
    expect(sim.state.stats.goldEarned).toBe(fromWaves);
    // Renda das 40 ondas: 15 × 40 + (1 + … + 40) = 1.420; juros somam no máximo 400.
    expect(ended.reduce((s, e) => s + e.bonus, 0)).toBe(1420);
    expect(sim.state.stats.goldEarned).toBeLessThanOrEqual(1420 + 400);
  });
});
