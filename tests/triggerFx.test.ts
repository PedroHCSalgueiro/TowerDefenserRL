import { describe, expect, it } from 'vitest';
import renderConfig from '../src/data/render.json';
import {
  ChainModel,
  DamageNumberModel,
  PulseModel,
  flashedTowers,
  type TowerLookup,
} from '../src/render/fx/triggerFx';
import type { SimEvent } from '../src/sim/engine/events';

const fx = renderConfig.triggerFx;

/** Torres de 1 a 99 na casa (id, 0), cor = id. */
const towerAt: TowerLookup = (id) => (id > 0 && id < 100 ? { x: id, y: 0, color: id } : null);

function explosion(towerId: number, damage: number, trigger = true): SimEvent {
  return { type: 'areaExploded', tick: 1, towerId, x: 5, y: 5, radius: 1, trigger, damage };
}

function fired(
  towerId: number,
  chainId: number,
  chainLength: number,
  originTowerId: number | null = 1,
  visible = true,
): SimEvent {
  return {
    type: 'triggerFired',
    tick: 1,
    towerId,
    sourceTowerId: originTowerId,
    when: 'onFire',
    effect: 'explosion',
    depth: 1,
    chainId,
    originTowerId,
    visible,
    chainLength,
    copiedFromTowerId: null,
  };
}

describe('pulsos dos gatilhos', () => {
  it('cada efeito vira linha da torre ao destino; tiro normal em área e auto-ativação não', () => {
    const model = new PulseModel(fx.pulse);
    model.add(
      [
        { type: 'towerActivated', tick: 1, towerId: 3, sourceTowerId: 2, depth: 1 },
        { type: 'towerActivated', tick: 1, towerId: 4, sourceTowerId: 4, depth: 1 },
        explosion(5, 10),
        explosion(6, 10, false),
        {
          type: 'lightningStruck',
          tick: 1,
          towerId: 7,
          points: [
            { x: 1, y: 1 },
            { x: 2, y: 2 },
          ],
          damage: 5,
        },
        { type: 'lineFired', tick: 1, towerId: 8, x: 8, y: 0, toX: 8, toY: 4, damage: 9 },
        { ...fired(9, 1, 1), copiedFromTowerId: 10 } as SimEvent,
      ],
      towerAt,
    );
    expect(model.pulses.map((p) => [p.from, p.to, p.color])).toEqual([
      [{ x: 2, y: 0, color: 2 }, { x: 3, y: 0, color: 3 }, 2],
      [{ x: 5, y: 0, color: 5 }, { x: 5, y: 5 }, 5],
      [{ x: 7, y: 0, color: 7 }, { x: 1, y: 1 }, 7],
      [{ x: 1, y: 1 }, { x: 2, y: 2 }, 7],
      [{ x: 8, y: 0, color: 8 }, { x: 8, y: 4 }, 8],
      [{ x: 10, y: 0, color: 10 }, { x: 9, y: 0, color: 9 }, 9],
    ]);
    expect(model.pulses.every((p) => p.msLeft === fx.pulse.durationMs)).toBe(true);
  });

  it('no máximo 64 linhas: numa avalanche ficam as mais recentes', () => {
    expect(fx.pulse.maxActive).toBe(64);
    const model = new PulseModel(fx.pulse);
    const many = Array.from({ length: 50 }, (_, i) => explosion((i % 90) + 1, 1));
    model.add(many, towerAt);
    expect(model.pulses).toHaveLength(50);
    const avalanche = Array.from({ length: 3000 }, (_, i) => explosion((i % 90) + 1, 1));
    model.add(avalanche, towerAt);
    expect(model.pulses).toHaveLength(64);
    // As últimas do quadro, na ordem.
    expect(model.pulses.at(-1)!.from).toMatchObject({ x: (2999 % 90) + 1 });
    expect(model.pulses[0]!.from).toMatchObject({ x: ((3000 - 64) % 90) + 1 });
  });

  it('somem depois da duração', () => {
    const model = new PulseModel(fx.pulse);
    model.add([explosion(5, 1)], towerAt);
    model.advance(fx.pulse.durationMs - 1);
    expect(model.pulses).toHaveLength(1);
    model.advance(1);
    expect(model.pulses).toHaveLength(0);
  });

  it('flash: só gatilhos visíveis, uma vez por torre', () => {
    expect(flashedTowers([fired(3, 1, 1), fired(3, 1, 2), fired(4, 2, 0, 1, false)])).toEqual([3]);
  });
});

describe('números de dano agregados', () => {
  it('um número por efeito de gatilho, só acima de 30; tiro normal não', () => {
    const model = new DamageNumberModel(fx.numbers);
    expect(fx.numbers.minDamage).toBe(30);
    model.add([
      explosion(5, 30),
      explosion(5, 31),
      explosion(5, 500, false),
      {
        type: 'lightningStruck',
        tick: 1,
        towerId: 7,
        points: [{ x: 1, y: 2 }],
        damage: 40,
      },
      { type: 'lineFired', tick: 1, towerId: 8, x: 0, y: 0, toX: 4, toY: 2, damage: 90 },
    ]);
    expect(model.numbers.map((n) => [n.at, n.value])).toEqual([
      [{ x: 5, y: 5 }, 31],
      [{ x: 1, y: 2 }, 40],
      [{ x: 2, y: 1 }, 90],
    ]);
  });

  it('no máximo 20 na tela: os mais novos ficam', () => {
    expect(fx.numbers.maxActive).toBe(20);
    const model = new DamageNumberModel(fx.numbers);
    model.add(Array.from({ length: 15 }, (_, i) => explosion(1, 100 + i)));
    model.add(Array.from({ length: 10 }, (_, i) => explosion(1, 200 + i)));
    expect(model.numbers).toHaveLength(20);
    expect(model.numbers[0]!.value).toBe(105);
    expect(model.numbers.at(-1)!.value).toBe(209);
    // Ids crescentes e únicos: a view prende cada número a um texto.
    const ids = model.numbers.map((n) => n.id);
    expect(new Set(ids).size).toBe(20);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });

  it('N desliga: some tudo e nada entra; liga de novo', () => {
    const model = new DamageNumberModel(fx.numbers);
    model.add([explosion(1, 100)]);
    expect(model.toggle()).toBe(false);
    expect(model.numbers).toEqual([]);
    model.add([explosion(1, 100)]);
    expect(model.numbers).toEqual([]);
    expect(model.toggle()).toBe(true);
    model.add([explosion(1, 100)]);
    expect(model.numbers).toHaveLength(1);
  });
});

describe('contador de cadeia', () => {
  const config = { minLength: 3, maxLabels: 2, lingerMs: 100 };

  it('aparece quando passa de 3 gatilhos visíveis, sobre a origem', () => {
    const model = new ChainModel(config);
    model.add([fired(2, 1, 1, 7), fired(2, 1, 2, 7), fired(2, 1, 3, 7)]);
    expect(model.labels()).toEqual([]);
    model.add([fired(4, 1, 4, 7)]);
    expect(model.labels()).toEqual([{ chainId: 1, originTowerId: 7, length: 4, alive: true }]);
  });

  it('dura enquanto a cadeia está viva e mais um instante; depois some', () => {
    const model = new ChainModel(config);
    model.add([fired(4, 1, 5, 7)]);
    model.advance(500, new Set([1]));
    expect(model.labels()[0]).toMatchObject({ alive: true });
    model.advance(60, new Set());
    expect(model.labels()[0]).toMatchObject({ alive: false, length: 5 });
    model.advance(60, new Set());
    expect(model.labels()).toEqual([]);
  });

  it('as maiores, uma por origem, até o limite; a do núcleo tem origem null', () => {
    const model = new ChainModel(config);
    model.add([fired(2, 1, 4, 7), fired(2, 2, 9, 7), fired(2, 3, 6, null), fired(2, 4, 5, 8)]);
    expect(model.labels().map((l) => [l.chainId, l.originTowerId, l.length])).toEqual([
      [2, 7, 9],
      [3, null, 6],
    ]);
  });
});
