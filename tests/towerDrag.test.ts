import { describe, expect, it } from 'vitest';
import uiJson from '../src/data/ui.json';
import renderJson from '../src/data/render.json';
import { createTower } from '../src/sim/towers/placement';
import { TowerDrag, canDropAt } from '../src/ui/towerDragModel';
import { makeState, smallMap } from './support/enemySim';

const T = uiJson.towerDrag.thresholdPx;

/** Estado com uma torre em (0,0) e outra em (1,0) no mapa pequeno. */
function setup() {
  const state = makeState();
  const a = createTower(1, 'mortar', { x: 0, y: 0 });
  const b = createTower(2, 'relay', { x: 1, y: 0 });
  state.towers.push(a, b);
  return { state, a, b, drag: new TowerDrag() };
}

const lock = (state: ReturnType<typeof makeState>) =>
  state.waves.active.push({ wave: 1, startTick: 0, spawned: 0, bossesKilled: 0, earlyBonus: 0 });

describe('dados do arrasto', () => {
  it('limiar, mensagem e feedback de trava ficam nos dados', () => {
    expect(T).toBeGreaterThan(0);
    expect(uiJson.texts.towersLocked).toBe('Torres travadas durante a onda');
    expect(uiJson.towerDrag.lockedMessageMs).toBeGreaterThan(0);
    expect(renderJson.towers.locked.shakeRepeats).toBeGreaterThan(0);
  });
});

describe('clique x arrasto', () => {
  it('movimento até o limiar continua sendo clique: soltar não gera comando', () => {
    const { state, a, drag } = setup();
    drag.begin(state, false, a, 100, 100);
    expect(drag.pointerMove(state, 100 + T, 100, T)).toBe('none');
    expect(drag.dragging).toBeNull();
    expect(drag.release(state, smallMap, { x: 4, y: 2 })).toBeNull();
  });

  it('acima do limiar vira arrasto e soltar numa casa livre gera moveTower', () => {
    const { state, a, drag } = setup();
    drag.begin(state, false, a, 100, 100);
    expect(drag.pointerMove(state, 100, 100 + T + 1, T)).toBe('started');
    expect(drag.dragging).toEqual({ towerId: a.id, towerType: 'mortar' });
    expect(drag.pointerMove(state, 300, 300, T)).toBe('none'); // já começou
    expect(drag.release(state, smallMap, { x: 4, y: 2 })).toEqual({
      type: 'moveTower',
      towerId: a.id,
      x: 4,
      y: 2,
    });
    expect(drag.dragging).toBeNull();
  });

  it('soltar sobre outra torre gera o comando (a simulação troca)', () => {
    const { state, a, b, drag } = setup();
    drag.begin(state, false, a, 0, 0);
    drag.pointerMove(state, 50, 0, T);
    expect(drag.release(state, smallMap, { x: b.x, y: b.y })).toMatchObject({ x: 1, y: 0 });
  });

  it('casa inválida, fora do mapa ou a própria casa: cancela sem comando', () => {
    for (const cell of [{ x: 2, y: 1 }, smallMap.nexus, null, { x: 0, y: 0 }]) {
      const { state, a, drag } = setup();
      drag.begin(state, false, a, 0, 0);
      drag.pointerMove(state, 50, 0, T);
      expect(drag.release(state, smallMap, cell)).toBeNull();
      expect(drag.dragging).toBeNull();
    }
  });

  it('canDropAt: casa livre ou com torre sim; caminho, núcleo e fora do mapa não', () => {
    expect(canDropAt(smallMap, { x: 4, y: 2 })).toBe(true);
    expect(canDropAt(smallMap, { x: 2, y: 1 })).toBe(false);
    expect(canDropAt(smallMap, smallMap.nexus)).toBe(false);
    expect(canDropAt(smallMap, { x: 9, y: 9 })).toBe(false);
    expect(canDropAt(smallMap, null)).toBe(false);
  });
});

describe('trava, pausa e cancelamentos', () => {
  it('com onda ativa, o clique ainda funciona, mas passar do limiar devolve locked e não arrasta', () => {
    const { state, a, drag } = setup();
    lock(state);
    expect(drag.begin(state, false, a, 0, 0)).toBe(true);
    expect(drag.update(state, false)).toBe(false); // segurando sem mover: ainda é clique
    expect(drag.pointerMove(state, 50, 0, T)).toBe('locked');
    expect(drag.dragging).toBeNull();
    expect(drag.pointerMove(state, 80, 0, T)).toBe('none'); // um aviso por tentativa
    expect(drag.release(state, smallMap, { x: 4, y: 2 })).toBeNull();
  });

  it('pausado não começa nada, em silêncio', () => {
    const { state, a, drag } = setup();
    expect(drag.begin(state, true, a, 0, 0)).toBe(false);
    expect(drag.pointerMove(state, 50, 0, T)).toBe('none');
    expect(drag.release(state, smallMap, { x: 4, y: 2 })).toBeNull();
  });

  it('run encerrada não começa', () => {
    const { state, a, drag } = setup();
    state.status = 'lost';
    expect(drag.begin(state, false, a, 0, 0)).toBe(false);
  });

  it('onda chamada no meio do arrasto cancela', () => {
    const { state, a, drag } = setup();
    drag.begin(state, false, a, 0, 0);
    drag.pointerMove(state, 50, 0, T);
    lock(state);
    expect(drag.update(state, false)).toBe(true);
    expect(drag.dragging).toBeNull();
    expect(drag.release(state, smallMap, { x: 4, y: 2 })).toBeNull();
  });

  it('pausar no meio do arrasto, ou a torre sair do mapa, cancela', () => {
    const paused = setup();
    paused.drag.begin(paused.state, false, paused.a, 0, 0);
    paused.drag.pointerMove(paused.state, 50, 0, T);
    expect(paused.drag.update(paused.state, true)).toBe(true);
    expect(paused.drag.dragging).toBeNull();

    const sold = setup();
    sold.drag.begin(sold.state, false, sold.a, 0, 0);
    sold.drag.pointerMove(sold.state, 50, 0, T);
    sold.state.towers.splice(0, 1);
    expect(sold.drag.update(sold.state, false)).toBe(true);
  });
});
