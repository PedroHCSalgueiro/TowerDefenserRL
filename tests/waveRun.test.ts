import { describe, expect, it } from 'vitest';
import { botSim, playRun, TOTAL_WAVES } from './support/waveBot';

describe('run completa jogada pelo bot', () => {
  it('as 10 ondas terminam sem erro (núcleo invulnerável, para chegar ao fim)', () => {
    const sim = botSim('bot-invulneravel', true);
    const reports = playRun(sim);
    expect(reports.map((r) => r.wave)).toEqual(
      Array.from({ length: TOTAL_WAVES }, (_, i) => i + 1),
    );
    expect(sim.state.wave).toBe(TOTAL_WAVES);
    expect(sim.state.waves.active).toEqual([]);
    expect(sim.state.enemies.activeCount).toBe(0);
    // Toda onda termina dentro do teto do bot (nenhuma ficou presa).
    for (const report of reports) expect(report.ticks).toBeLessThan(30 * 60 * 5);
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
});
