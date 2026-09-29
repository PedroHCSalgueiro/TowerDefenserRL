import { describe, expect, it } from 'vitest';
import debugConfig from '../src/data/debug.json';
import {
  emptyTriggerSamples,
  evaluateGate,
  stat,
  summarize,
  summarizeTriggers,
  worstFps,
  type PerfSummary,
} from '../src/debug/metrics';
import { formatReport, type PerfReport } from '../src/debug/perfReport';
import { linkWithSeed, resolveSeed, seedFromSearch } from '../src/debug/seed';

describe('métricas de desempenho', () => {
  it('média e máximo', () => {
    expect(stat([1, 5, 3])).toEqual({ avg: 3, max: 5 });
    expect(stat([])).toEqual({ avg: 0, max: 0 });
  });

  it('piores 1%: média dos quadros mais longos, em FPS', () => {
    const frames = Array<number>(198).fill(1000 / 60);
    frames.push(50, 25); // 200 quadros: os piores 1% são estes 2
    expect(worstFps(frames, 0.01)).toBeCloseTo(1000 / 37.5, 10);
    // Sempre pelo menos 1 quadro.
    expect(worstFps([10, 20], 0.01)).toBeCloseTo(50, 10);
    expect(worstFps([], 0.01)).toBe(0);
  });

  it('contadores de gatilhos: média e pior tick, profundidade, adiados e descartados', () => {
    expect(
      summarizeTriggers({
        fired: [0, 10, 50, 20],
        maxDepth: [0, 3, 9, 2],
        deferred: [0, 0, 4, 1],
        dropped: [0, 0, 2, 0],
      }),
    ).toEqual({
      avgFired: 20,
      maxFired: 50,
      maxDepth: 9,
      maxDeferred: 4,
      deferredTicks: 2,
      dropped: 2,
    });
    expect(summarizeTriggers(emptyTriggerSamples())).toEqual({
      avgFired: 0,
      maxFired: 0,
      maxDepth: 0,
      maxDeferred: 0,
      deferredTicks: 0,
      dropped: 0,
    });
  });

  it('FPS médio pelo tempo total, e ticks por segundo', () => {
    const s = summarize(
      {
        frameMs: [10, 30], // 2 quadros em 40 ms
        tickMs: [1, 2, 3, 2],
        renderMs: [4, 6],
        viewsMs: [1, 1],
        triggers: emptyTriggerSamples(),
      },
      0,
      0.01,
    );
    expect(s.avgFps).toBeCloseTo(50, 10);
    expect(s.seconds).toBeCloseTo(0.04, 10);
    expect(s.ticksPerSecond).toBeCloseTo(100, 10);
    expect(s.tick).toEqual({ avg: 2, max: 3 });
    expect(s.render).toEqual({ avg: 5, max: 6 });
    expect(s.lowFps).toBeCloseTo(1000 / 30, 10);
  });

  const good: PerfSummary = {
    seconds: 20,
    frames: 1200,
    avgFps: 60,
    lowFps: 50,
    frame: { avg: 16.7, max: 22 },
    tick: { avg: 1.5, max: 5 },
    ticksPerSecond: 30,
    render: { avg: 3, max: 6 },
    views: { avg: 2, max: 4 },
    droppedTicks: 0,
    triggers: {
      avgFired: 12.5,
      maxFired: 40,
      maxDepth: 6,
      maxDeferred: 0,
      deferredTicks: 0,
      dropped: 0,
    },
  };
  const gate = debugConfig.perf.gate;

  it('portão aprovado: FPS ≥ 58, piores 1% ≥ 45, tick ≤ 4 ms, nada descartado', () => {
    expect(gate).toEqual({ minAvgFps: 58, minLowFps: 45, maxAvgTickMs: 4, maxDroppedTicks: 0 });
    expect(evaluateGate(good, gate)).toEqual({ pass: true, failures: [] });
    expect(
      evaluateGate({ ...good, avgFps: 58, lowFps: 45, tick: { avg: 4, max: 9 } }, gate).pass,
    ).toBe(true);
  });

  it('portão reprovado lista cada motivo', () => {
    const result = evaluateGate(
      { ...good, avgFps: 57.9, lowFps: 40, tick: { avg: 4.1, max: 9 }, droppedTicks: 3 },
      gate,
    );
    expect(result.pass).toBe(false);
    expect(result.failures).toHaveLength(4);
  });

  it('o relatório em texto traz os números e o veredito', () => {
    const report: PerfReport = {
      meta: {
        speed: 3,
        layout: 'clustered',
        stressCount: 1000,
        towers: 30,
        towerTypes: 'Morteiro+Relé+Obelisco+Ceifador',
        seed: 'abc',
        date: '2026-09-29T00:00:00.000Z',
        userAgent: 'teste',
        viewport: '1280x720',
        devicePixelRatio: 1,
        renderer: 'WebGL',
      },
      summary: { ...good, ticksPerSecond: 90 },
      gate: evaluateGate(good, gate),
      expectedTicksPerSecond: 90,
      avgEnemies: 1000,
      avgProjectiles: 42,
    };
    const text = formatReport(report);
    expect(text).toContain(
      '3x · agrupado · 1000 inimigos · 30 torres (Morteiro+Relé+Obelisco+Ceifador) — PASSOU',
    );
    expect(text).toContain('FPS médio 60.0 | piores 1% 50.0');
    expect(text).toContain('90.0 ticks/s (esperado 90) | descartados 0');
    expect(text).toContain('Semente abc');
    expect(text).toContain(
      'Gatilhos: 12.5/tick (pior 40) | prof. máx 6 | adiados: 0 ticks (fila máx 0) | descartados 0',
    );
  });
});

describe('semente pela URL', () => {
  it('lê ?seed=, ignorando espaços e valor vazio', () => {
    expect(seedFromSearch('?seed=abc')).toBe('abc');
    expect(seedFromSearch('?x=1&seed=%20minha%20semente%20')).toBe('minha semente');
    expect(seedFromSearch('?seed=')).toBeNull();
    expect(seedFromSearch('')).toBeNull();
  });

  it('sem o parâmetro, continua sorteada', () => {
    expect(resolveSeed('?seed=fixa', () => 'sorteada')).toBe('fixa');
    expect(resolveSeed('?outra=1', () => 'sorteada')).toBe('sorteada');
  });

  it('monta o link com a semente, preservando os outros parâmetros', () => {
    expect(linkWithSeed('http://localhost:4173/?x=1', 'k9 z')).toBe(
      'http://localhost:4173/?x=1&seed=k9+z',
    );
    expect(linkWithSeed('http://localhost:4173/?seed=velha', 'nova')).toBe(
      'http://localhost:4173/?seed=nova',
    );
  });
});
