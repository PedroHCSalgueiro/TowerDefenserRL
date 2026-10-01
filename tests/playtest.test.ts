import { describe, expect, it } from 'vitest';
import debugConfig from '../src/data/debug.json';
import uiConfig from '../src/data/ui.json';
import { runLink, seedFromSearch } from '../src/debug/seed';
import {
  debugUnlocked,
  isUnlockShortcut,
  readSessionUnlock,
  writeSessionUnlock,
} from '../src/debug/unlock';
import { getTowerType, towerData } from '../src/sim/towers/towerData';
import { helpLines } from '../src/ui/helpModel';
import { formatRunReport, summarizeRun, type RunSummary } from '../src/ui/runReport';
import { botSim, playRun, TOTAL_WAVES } from './support/waveBot';

describe('debug escondido na build de playtest', () => {
  const locked = { dev: false, search: '', sessionUnlocked: false };

  it('npm run dev: tudo visível', () => {
    expect(debugUnlocked({ ...locked, dev: true })).toBe(true);
  });

  it('build de playtest: escondido sem atalho nem ?debug=1', () => {
    expect(debugUnlocked(locked)).toBe(false);
    expect(debugUnlocked({ ...locked, search: '?seed=abc' })).toBe(false);
    expect(debugUnlocked({ ...locked, search: '?debug=0' })).toBe(false);
    expect(debugUnlocked({ ...locked, search: '?debug=true' })).toBe(false);
  });

  it('liberado por ?debug=1 ou pelo atalho na sessão', () => {
    expect(debugUnlocked({ ...locked, search: '?debug=1' })).toBe(true);
    expect(debugUnlocked({ ...locked, search: '?seed=abc&debug=1&fx=0' })).toBe(true);
    expect(debugUnlocked({ ...locked, sessionUnlocked: true })).toBe(true);
  });

  it('atalho: Ctrl+Shift+D (maiúscula, minúscula ou pelo código da tecla)', () => {
    const key = { ctrlKey: true, shiftKey: true, altKey: false, metaKey: false };
    expect(isUnlockShortcut({ ...key, key: 'D', code: 'KeyD' })).toBe(true);
    expect(isUnlockShortcut({ ...key, key: 'd', code: 'KeyD' })).toBe(true);
    // Teclado com outro layout: a posição da tecla D vale.
    expect(isUnlockShortcut({ ...key, key: 'x', code: 'KeyD' })).toBe(true);
    expect(isUnlockShortcut({ ...key, shiftKey: false, key: 'd', code: 'KeyD' })).toBe(false);
    expect(isUnlockShortcut({ ...key, ctrlKey: false, key: 'D', code: 'KeyD' })).toBe(false);
    expect(isUnlockShortcut({ ...key, altKey: true, key: 'D', code: 'KeyD' })).toBe(false);
    expect(isUnlockShortcut({ ...key, key: 'F', code: 'KeyF' })).toBe(false);
  });

  it('a liberação vale para a sessão e não quebra sem sessionStorage', () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    } as Storage;
    expect(readSessionUnlock(() => storage)).toBe(false);
    writeSessionUnlock(() => storage);
    expect(data.get(debugConfig.panel.unlockSessionKey)).toBe('1');
    expect(readSessionUnlock(() => storage)).toBe(true);
    const blocked = (): Storage => {
      throw new Error('SecurityError');
    };
    expect(readSessionUnlock(blocked)).toBe(false);
    expect(() => writeSessionUnlock(blocked)).not.toThrow();
  });
});

describe('link da run', () => {
  it('troca a semente, mantém os outros parâmetros e tira o ?debug=1', () => {
    const link = runLink(
      'https://pedrohcsalgueiro.github.io/TowerDefenserRL/?debug=1&seed=velha&fx=0',
      'nova semente',
    );
    const url = new URL(link);
    expect(url.origin + url.pathname).toBe('https://pedrohcsalgueiro.github.io/TowerDefenserRL/');
    expect(seedFromSearch(url.search)).toBe('nova semente');
    expect(url.searchParams.get('fx')).toBe('0');
    expect(url.searchParams.has('debug')).toBe(false);
  });

  it('sem parâmetros: só a semente', () => {
    expect(runLink('https://exemplo.dev/jogo/', 'abc')).toBe('https://exemplo.dev/jogo/?seed=abc');
  });
});

describe('relatório da run', () => {
  const sample: RunSummary = {
    seed: 'abc',
    version: 'f1200bc',
    won: false,
    wave: 7,
    totalWaves: 10,
    seconds: 754.9,
    kills: 812,
    longestChain: 18,
    towers: [
      { name: 'Morteiro', star: 3 },
      { name: 'Relé', star: 1 },
    ],
    nexusLevel: 4,
    goldEarned: 1234,
    cheated: true,
    link: 'https://exemplo.dev/?seed=abc',
  };

  it('formato: uma informação por linha, na ordem combinada', () => {
    expect(formatRunReport(sample)).toBe(
      [
        'Relatório da run',
        'Semente: abc',
        'Versão: f1200bc',
        'Resultado: derrota',
        'Onda alcançada: 7/10',
        'Tempo: 12:34',
        'Abates: 812',
        'Maior cadeia: x18',
        'Torres finais (2): Morteiro ★3, Relé ★1',
        'Núcleo: nível 4',
        'Ouro ganho: 1234',
        'Trapaça: sim',
        'Link: https://exemplo.dev/?seed=abc',
      ].join('\n'),
    );
  });

  it('vitória, sem torres e sem trapaça', () => {
    const text = formatRunReport({ ...sample, won: true, towers: [], cheated: false });
    expect(text).toContain('Resultado: vitória');
    expect(text).toContain('Torres finais (0): nenhuma');
    expect(text).toContain('Trapaça: não');
  });

  it('resumo a partir do estado final de uma run do bot', () => {
    const sim = botSim('bot-relatorio', true);
    playRun(sim);
    const { state } = sim;
    const summary = summarizeRun(state, {
      version: 'abc1234',
      totalWaves: TOTAL_WAVES,
      ticksPerSecond: 30,
      towerName: (type) => getTowerType(towerData, type).name,
      link: 'L',
    });
    expect(summary).toMatchObject({
      seed: 'bot-relatorio',
      version: 'abc1234',
      wave: state.wave,
      totalWaves: TOTAL_WAVES,
      seconds: state.tick / 30,
      kills: state.stats.kills,
      longestChain: state.stats.longestChain,
      nexusLevel: state.nexus.level,
      goldEarned: state.stats.goldEarned,
      // O bot liga o núcleo invulnerável pelo comando de debug.
      cheated: true,
      link: 'L',
    });
    expect(summary.towers).toHaveLength(state.towers.length);
    expect(summary.towers[0]?.name).toBe(getTowerType(towerData, state.towers[0]!.type).name);
    expect(summary.goldEarned).toBeGreaterThan(0);
  });

  it('na derrota, a onda é a mais nova em andamento', () => {
    const sim = botSim('bot-derrota-relatorio');
    sim.enqueue({ type: 'callWave' });
    sim.enqueue({ type: 'callWave' });
    sim.step();
    const summary = summarizeRun(sim.state, {
      version: 'v',
      totalWaves: TOTAL_WAVES,
      ticksPerSecond: 30,
      towerName: (t) => t,
      link: '',
    });
    expect(summary.wave).toBe(2);
    expect(summary.cheated).toBe(false);
  });
});

describe('tela de ajuda', () => {
  const keys = (debug: boolean) => helpLines(debug).map((l) => l.keys);

  it('lista todos os controles atuais', () => {
    expect(keys(false)).toEqual(
      expect.arrayContaining(['1 a 5', 'R', 'S', 'E', 'Espaço', 'Q', 'P', 'N', 'Esc', 'H']),
    );
    expect(keys(false).some((k) => k.startsWith('Arrastar'))).toBe(true);
  });

  it('F2 e Ctrl+Shift+D só aparecem com o debug liberado', () => {
    expect(keys(false)).not.toContain('F2');
    expect(keys(false)).not.toContain('Ctrl+Shift+D');
    expect(keys(true)).toEqual(expect.arrayContaining(['F2', 'Ctrl+Shift+D']));
    expect(helpLines(true).filter((l) => l.debug)).toHaveLength(2);
  });

  it('os textos e a tecla vêm do ui.json e batem com o atalho do debug', () => {
    expect(uiConfig.help.key).toBe('h');
    expect(uiConfig.help.debugControls.map((c) => c.keys)).toEqual([
      debugConfig.panel.toggleKey,
      `Ctrl+Shift+${debugConfig.panel.unlockKey}`,
    ]);
  });
});
