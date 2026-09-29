import { describe, expect, it } from 'vitest';
import { EventBus, type SimEventOf } from '../src/sim/engine/events';

describe('EventBus', () => {
  it('entrega os eventos em ordem e esvazia o buffer', () => {
    const bus = new EventBus();
    bus.emit({ type: 'waveStarted', tick: 1, wave: 1 });
    bus.emit({ type: 'enemySpawned', tick: 1, enemyId: 7, enemyType: 'common' });

    expect(bus.drain()).toEqual([
      { type: 'waveStarted', tick: 1, wave: 1 },
      { type: 'enemySpawned', tick: 1, enemyId: 7, enemyType: 'common' },
    ]);
    expect(bus.drain()).toEqual([]);
  });

  it('assinantes recebem só o tipo assinado, no drain', () => {
    const bus = new EventBus();
    const received: SimEventOf<'enemyKilled'>[] = [];
    bus.on('enemyKilled', (event) => received.push(event));

    bus.emit({ type: 'towerFired', tick: 2, towerId: 1, targetId: 3, shot: 'normal' });
    const killed = {
      type: 'enemyKilled',
      tick: 2,
      enemyId: 3,
      enemyType: 'common',
      towerId: 1,
      x: 0,
      y: 0,
      weight: 1,
    } as const;
    bus.emit(killed);
    expect(received).toEqual([]);

    bus.drain();
    expect(received).toEqual([killed]);
  });

  it('cancelar a assinatura para de entregar eventos', () => {
    const bus = new EventBus();
    let count = 0;
    const off = bus.on('waveStarted', () => count++);
    bus.emit({ type: 'waveStarted', tick: 1, wave: 1 });
    bus.drain();
    off();
    bus.emit({ type: 'waveStarted', tick: 2, wave: 2 });
    bus.drain();
    expect(count).toBe(1);
  });
});
