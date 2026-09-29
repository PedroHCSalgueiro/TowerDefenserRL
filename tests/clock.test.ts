import { describe, expect, it } from 'vitest';
import engineConfig from '../src/data/engine.json';
import { FixedStepClock, lerp, type EngineConfig } from '../src/sim/engine/clock';

const config: EngineConfig = { ticksPerSecond: 30, speeds: [1, 2, 3], maxTicksPerFrame: 1000 };

describe('FixedStepClock', () => {
  it('usa os valores de src/data/engine.json', () => {
    expect(engineConfig.ticksPerSecond).toBe(30);
    expect(engineConfig.speeds).toEqual([1, 2, 3]);
  });

  it('roda 30 ticks em 1 segundo a 1x', () => {
    const clock = new FixedStepClock(config);
    expect(clock.advance(1000)).toBe(30);
  });

  it('velocidade multiplica os ticks: 2x = 60, 3x = 90', () => {
    const clock = new FixedStepClock(config);
    clock.setSpeed(2);
    expect(clock.advance(1000)).toBe(60);
    clock.setSpeed(3);
    expect(clock.advance(1000)).toBe(90);
  });

  it('soma quadros de 60 FPS sem perder ticks', () => {
    const clock = new FixedStepClock(config);
    let ticks = 0;
    for (let i = 0; i < 600; i++) ticks += clock.advance(1000 / 60);
    expect(ticks).toBe(300);
  });

  it('carrega a fração do tick para o quadro seguinte', () => {
    const clock = new FixedStepClock(config);
    expect(clock.advance(20)).toBe(0);
    expect(clock.alpha).toBeCloseTo(0.6);
    expect(clock.advance(20)).toBe(1);
    expect(clock.alpha).toBeCloseTo(0.2);
  });

  it('alpha fica sempre em [0, 1)', () => {
    const clock = new FixedStepClock(config);
    for (let i = 0; i < 500; i++) {
      clock.advance(7 + (i % 13));
      expect(clock.alpha).toBeGreaterThanOrEqual(0);
      expect(clock.alpha).toBeLessThan(1);
    }
  });

  it('limita os ticks por quadro e descarta o excedente', () => {
    const clock = new FixedStepClock({ ...config, maxTicksPerFrame: 5 });
    expect(clock.advance(10_000)).toBe(5);
    expect(clock.alpha).toBeLessThan(1);
    expect(clock.advance(1000 / 30)).toBe(1);
  });

  it('conta os ticks descartados pelo teto', () => {
    const clock = new FixedStepClock({ ...config, maxTicksPerFrame: 5 });
    clock.advance(1000 / 30);
    expect(clock.droppedTicks).toBe(0);
    clock.advance(10_000); // 300 devidos, 5 rodam
    expect(clock.droppedTicks).toBe(295);
    clock.setSpeed(3);
    clock.advance(100); // 9 devidos, 5 rodam
    expect(clock.droppedTicks).toBe(299);
  });

  it('ignora delta zero, negativo ou inválido', () => {
    const clock = new FixedStepClock(config);
    expect(clock.advance(0)).toBe(0);
    expect(clock.advance(-50)).toBe(0);
    expect(clock.advance(Number.NaN)).toBe(0);
    expect(clock.alpha).toBe(0);
  });

  it('rejeita velocidade fora da lista', () => {
    const clock = new FixedStepClock(config);
    expect(() => clock.setSpeed(4)).toThrow(RangeError);
    expect(clock.speed).toBe(1);
  });
});

describe('lerp', () => {
  it('interpola entre dois valores', () => {
    expect(lerp(10, 20, 0)).toBe(10);
    expect(lerp(10, 20, 0.5)).toBe(15);
    expect(lerp(10, 20, 1)).toBe(20);
  });
});
