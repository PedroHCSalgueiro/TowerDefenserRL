import { describe, expect, it } from 'vitest';
import uiData from '../src/data/ui.json';
import { classData } from '../src/sim/classes/classData';
import { economyData } from '../src/sim/economy/economyData';
import { enemyData } from '../src/sim/enemies/enemyData';
import type { SimEvent } from '../src/sim/engine/events';
import { createRunState, type RunState } from '../src/sim/state';
import { createTower } from '../src/sim/towers/placement';
import { getTowerType, towerData } from '../src/sim/towers/towerData';
import { waveKindOf } from '../src/sim/waves/waves';
import type { LinkPreview } from '../src/sim/triggers/links';
import { linkHintLines } from '../src/ui/linkHint';
import { buildShopModel } from '../src/ui/shopModel';
import { describeTower, towerSummary } from '../src/ui/towerInfo';
import { TutorialModel, tutorialSeen, type TutorialStorage } from '../src/ui/tutorialModel';
import { waveAnnouncementFor } from '../src/ui/waveAnnounce';
import { buildWaveHudModel, defaultWaveSchedules } from '../src/ui/waveHudModel';
import { shopSim, stepOnce } from './support/shopSim';

class MemoryStorage implements TutorialStorage {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

const failing: TutorialStorage = {
  getItem: () => {
    throw new Error('bloqueado');
  },
  setItem: () => {
    throw new Error('bloqueado');
  },
};

function addTower(state: RunState, type: string, x: number, y: number): void {
  state.towers.push(createTower(state.nextEntityId++, type, { x, y }));
}

const AUTO = uiData.tutorial.autoCloseMs;

describe('mini tutorial da primeira partida (T23)', () => {
  it('compra → chama → fim da onda → posições → limite, um cartão por vez', () => {
    const tutorial = new TutorialModel(new MemoryStorage());
    const state = createRunState('tuto');
    expect(tutorial.update(state, 0)).toMatchObject({ id: 'buy', closable: false });
    addTower(state, 'mortar', 5, 5);
    expect(tutorial.update(state, 10)?.id).toBe('call');
    state.waves.active.push({ wave: 1, startTick: 0, spawned: 0, bossesKilled: 0, earlyBonus: 0 });
    expect(tutorial.update(state, 20)).toBeNull();
    // Fim da primeira onda.
    state.waves.active = [];
    state.wave = 1;
    expect(tutorial.update(state, 30)).toMatchObject({ id: 'income', closable: true });
    // Fecha sozinho depois do tempo dos dados.
    expect(tutorial.update(state, 30 + AUTO - 1)?.id).toBe('income');
    expect(tutorial.update(state, 30 + AUTO)).toBeNull();
    addTower(state, 'reaper', 8, 8);
    expect(tutorial.update(state, 40_000)?.id).toBe('positions');
    tutorial.close();
    expect(tutorial.update(state, 40_001)).toBeNull();
    addTower(state, 'relay', 1, 1); // 3 torres = limite do nível 1
    expect(tutorial.update(state, 41_000)?.id).toBe('nexus');
    tutorial.close();
    expect(tutorial.update(state, 41_001)).toBeNull();
    expect(tutorial.over).toBe(true);
  });

  it('aparece uma vez só: com a marca gravada, não volta', () => {
    const storage = new MemoryStorage();
    const first = new TutorialModel(storage);
    first.skip();
    expect(first.update(createRunState('a'), 0)).toBeNull();
    expect(tutorialSeen(storage)).toBe(true);
    expect(new TutorialModel(storage).update(createRunState('b'), 0)).toBeNull();
  });

  it('se o navegador não guarda, o tutorial pode aparecer de novo (sem erro)', () => {
    const tutorial = new TutorialModel(failing);
    expect(tutorial.update(createRunState('x'), 0)?.id).toBe('buy');
    expect(() => tutorial.skip()).not.toThrow();
    expect(new TutorialModel(failing).update(createRunState('y'), 0)?.id).toBe('buy');
    expect(new TutorialModel(null).update(createRunState('z'), 0)?.id).toBe('buy');
  });

  it('os passos de ação terminam com a ação, mesmo sem o cartão ter aparecido', () => {
    const tutorial = new TutorialModel(new MemoryStorage());
    const state = createRunState('rapido');
    addTower(state, 'mortar', 5, 5);
    state.waves.active.push({ wave: 1, startTick: 0, spawned: 0, bossesKilled: 0, earlyBonus: 0 });
    expect(tutorial.update(state, 0)).toBeNull();
  });

  it('o "Ok" não fecha os passos de ação', () => {
    const tutorial = new TutorialModel(new MemoryStorage());
    const state = createRunState('ok');
    tutorial.update(state, 0);
    tutorial.close();
    expect(tutorial.update(state, 1)?.id).toBe('buy');
  });
});

describe('texto perto do mouse com a torre na mão', () => {
  const end = { towerId: 1, x: 0, y: 0 };
  const preview = (kinds: string[]): LinkPreview => ({
    links: kinds.map((kind) => ({ from: end, to: end, kind: kind as 'activates' })),
    neighborCells: [],
  });

  it('"sem ligações aqui", a contagem por tipo, a fusão e a prévia de classes', () => {
    expect(linkHintLines(preview([]), null)).toEqual(['sem ligações aqui']);
    expect(linkHintLines(preview(['activates', 'activates', 'copies']), null)).toEqual([
      'ativa 2 · copia 1',
    ]);
    expect(linkHintLines(null, { fusion: '★2↑', classes: [] })).toEqual(['funde: ★2↑']);
    expect(
      linkHintLines(preview(['charges']), { fusion: null, classes: ['Arcana 1/2 → 2/2'] }),
    ).toEqual(['carga 1', 'Arcana 1/2 → 2/2']);
    expect(linkHintLines(null, null)).toEqual([]);
  });
});

describe('elite e chefão (T23)', () => {
  it('tipo das ondas: elite nas 5/10/15/25/30/35, chefão na 20 e na 40', () => {
    const kinds = defaultWaveSchedules.map((s) => waveKindOf(s, enemyData));
    expect(kinds.flatMap((k, i) => (k === 'elite' ? [i + 1] : []))).toEqual([
      5, 10, 15, 25, 30, 35,
    ]);
    expect(kinds.flatMap((k, i) => (k === 'boss' ? [i + 1] : []))).toEqual([20, 40]);
  });

  it('aviso só na chamada: "Onda de elite" roxo e "CHEFÃO" vermelho', () => {
    const started = (wave: number): SimEvent =>
      ({ type: 'waveStarted', tick: 0, wave, early: false, earlyBonus: 0 }) as SimEvent;
    const at = (events: SimEvent[]) => waveAnnouncementFor(events, defaultWaveSchedules, enemyData);
    expect(at([started(4)])).toBeNull();
    expect(at([started(5)])).toEqual({ kind: 'elite', text: 'Onda de elite' });
    expect(at([started(20)])).toEqual({ kind: 'boss', text: 'CHEFÃO' });
    expect(at([started(40)])).toEqual({ kind: 'boss', text: 'CHEFÃO' });
    expect(at([])).toBeNull();
  });

  it('chamar a onda 10 no jogo real dá o aviso de elite', () => {
    const sim = shopSim('aviso');
    sim.enqueue({ type: 'debugSkipToWave', wave: 10 });
    sim.enqueue({ type: 'callWave' });
    expect(waveAnnouncementFor(stepOnce(sim), defaultWaveSchedules, enemyData)?.kind).toBe('elite');
  });

  it('faixa das próximas 5 ondas, depois das em andamento', () => {
    const sim = shopSim('faixa');
    sim.enqueue({ type: 'debugSkipToWave', wave: 17 });
    stepOnce(sim);
    expect(buildWaveHudModel(sim.state).upcoming).toEqual([
      { wave: 17, kind: 'normal' },
      { wave: 18, kind: 'normal' },
      { wave: 19, kind: 'normal' },
      { wave: 20, kind: 'boss' },
      { wave: 21, kind: 'normal' },
    ]);
    sim.enqueue({ type: 'callWave' });
    stepOnce(sim);
    expect(buildWaveHudModel(sim.state).upcoming.map((u) => u.wave)).toEqual([18, 19, 20, 21, 22]);
  });

  it('no fim da run a faixa encolhe até sumir', () => {
    const sim = shopSim('faixa-fim');
    sim.enqueue({ type: 'debugSkipToWave', wave: 38 });
    stepOnce(sim);
    expect(buildWaveHudModel(sim.state).upcoming).toEqual([
      { wave: 38, kind: 'normal' },
      { wave: 39, kind: 'normal' },
      { wave: 40, kind: 'boss' },
    ]);
  });
});

describe('frases simples das torres (T23)', () => {
  const shopTypes = Object.entries(towerData.types)
    .filter(([, t]) => t.rarity !== null)
    .map(([id]) => id);

  it('toda torre da loja tem frase; as do debug não', () => {
    for (const id of shopTypes) expect(towerSummary(id)).toMatch(/\.$/);
    expect(towerSummary('basic')).toBeNull();
    expect(towerSummary('toString')).toBeNull();
    expect(towerSummary('relay')).toBe('Quando atira, faz as torres encostadas atirarem também.');
    expect(towerSummary('reaper')).toBe('Explode quando um inimigo morre perto.');
  });

  it('a janela da torre traz a frase no topo e mantém a descrição técnica', () => {
    const info = describeTower(getTowerType(towerData, 'relay'), 1, classData, 'relay');
    expect(info.summary).toBe(towerSummary('relay'));
    expect(info.trigger).toMatch(/vizinhas|encostadas|ativa/i);
    expect(describeTower(getTowerType(towerData, 'relay'), 1, classData).summary).toBeNull();
  });

  it('o slot da loja traz a frase', () => {
    const sim = shopSim('frase');
    const model = buildShopModel(sim.state, null, economyData, towerData, classData);
    for (const slot of model.slots) {
      if (slot.towerType) expect(slot.summary).toBe(towerSummary(slot.towerType));
    }
  });
});
