import { describe, expect, it } from 'vitest';
import { classData } from '../src/sim/classes/classData';
import { createRunState, type RunState } from '../src/sim/state';
import { createTower, type Tower } from '../src/sim/towers/placement';
import { towerData } from '../src/sim/towers/towerData';
import { affectedNeighbors } from '../src/sim/triggers/neighborhood';
import { purchasePreview } from '../src/ui/classPreview';

function add(state: RunState, type: string, x: number, y: number, star = 1): Tower {
  const tower = createTower(state.nextEntityId++, type, { x, y });
  tower.star = star;
  state.towers.push(tower);
  return tower;
}

const ids = (list: readonly Tower[]) => list.map((t) => t.id);

describe('hover da torre: vizinhas que ela afeta', () => {
  it('Relé ★1: as 4 de lado; diagonal e longe ficam de fora', () => {
    const state = createRunState('hover');
    const relay = add(state, 'relay', 5, 5);
    const right = add(state, 'mortar', 6, 5);
    const up = add(state, 'reaper', 5, 4);
    add(state, 'mortar', 6, 6); // diagonal
    add(state, 'mortar', 7, 5); // a 2 casas
    expect(ids(affectedNeighbors(state, relay, towerData, classData))).toEqual([right.id, up.id]);
  });

  it('com a Arcana nível 2: 8 casas (diagonais entram); nível 4: quadrado 5×5', () => {
    const state = createRunState('hover');
    const relay = add(state, 'relay', 5, 5);
    const right = add(state, 'mortar', 6, 5);
    const diagonal = add(state, 'mortar', 6, 6);
    const far = add(state, 'mortar', 7, 7);
    state.classes.arcane!.level = 1;
    expect(ids(affectedNeighbors(state, relay, towerData, classData))).toEqual([
      right.id,
      diagonal.id,
    ]);
    state.classes.arcane!.level = 2;
    expect(ids(affectedNeighbors(state, relay, towerData, classData))).toEqual([
      right.id,
      diagonal.id,
      far.id,
    ]);
  });

  it('Relé ★3: a cruz até 2 casas entra, a diagonal não', () => {
    const state = createRunState('hover');
    const relay = add(state, 'relay', 5, 5, 3);
    const cross = add(state, 'mortar', 7, 5);
    const crossUp = add(state, 'mortar', 5, 3);
    add(state, 'mortar', 6, 6);
    add(state, 'mortar', 8, 5);
    expect(ids(affectedNeighbors(state, relay, towerData, classData))).toEqual([
      cross.id,
      crossUp.id,
    ]);
  });

  it('Espelho, Relógio e Obelisco destacam; Morteiro, Ceifador, Carrasco e Balista não', () => {
    const state = createRunState('hover');
    const center = { x: 5, y: 5 };
    const neighbor = add(state, 'basic', 6, 5);
    for (const type of ['mirror', 'clock', 'obelisk']) {
      const tower = add(state, type, center.x, center.y);
      expect(ids(affectedNeighbors(state, tower, towerData, classData))).toEqual([neighbor.id]);
      state.towers.pop();
    }
    for (const type of ['mortar', 'reaper', 'executioner', 'ballista']) {
      const tower = add(state, type, center.x, center.y);
      expect(affectedNeighbors(state, tower, towerData, classData)).toEqual([]);
      state.towers.pop();
    }
  });
});

describe('hover da loja: prévia das classes', () => {
  it('tipo novo: cada classe antes → depois, e o nível que acende', () => {
    const state = createRunState('loja');
    add(state, 'obelisk', 0, 0); // Arcana 1, Sombria 1
    expect(purchasePreview(state.towers, 'relay', towerData, classData)).toEqual({
      fusion: null,
      classes: ['Arcana 1/2 → 2/2 (ativa nível 2)', 'Mecânica 0/2 → 1/2'],
    });
  });

  it('nível 4 também acende; tipos repetidos contam uma vez', () => {
    const state = createRunState('loja');
    add(state, 'obelisk', 0, 0);
    add(state, 'relay', 1, 0);
    add(state, 'relay', 2, 0, 2);
    add(state, 'mirror', 3, 0);
    expect(purchasePreview(state.towers, 'ballista', towerData, classData)!.classes).toEqual([
      'Artilharia 0/2 → 1/2',
      'Arcana 3/4 → 4/4 (ativa nível 4)',
    ]);
  });

  it('funde: mostra a estrela nova e as classes não mudam', () => {
    const state = createRunState('loja');
    add(state, 'relay', 0, 0);
    expect(purchasePreview(state.towers, 'relay', towerData, classData)).toEqual({
      fusion: '★2↑',
      classes: [],
    });
    add(state, 'relay', 1, 0, 2);
    expect(purchasePreview(state.towers, 'relay', towerData, classData)!.fusion).toBe('★3↑');
  });

  it('o tipo já está no mapa e não funde: nada muda, sem prévia', () => {
    const state = createRunState('loja');
    add(state, 'relay', 0, 0, 2);
    expect(purchasePreview(state.towers, 'relay', towerData, classData)).toBeNull();
  });
});
