/**
 * Painel de debug em HTML sobre o canvas. Substitui o texto do canto e as
 * teclas 1 a 4 da T04.
 *
 * Mostra FPS, tempo de tick e de render, os contadores do motor de gatilhos,
 * inimigos, projéteis e torres e a semente; tem o posicionamento de torre na
 * casa selecionada, os comandos de spawn, o modo estresse (inclusive o
 * cenário "Cadeia", com os 4 tipos misturados), o núcleo invulnerável, a
 * velocidade e a gravação de desempenho. Toda ação que muda o jogo passa pela
 * fila de comandos da simulação.
 *
 * T17: trapaças de ouro ("+500 ouro" e "ouro infinito") e velocidades 5x e
 * 10x. Na build de playtest o painel e o F2 só existem depois de liberar o
 * debug (Ctrl+Shift+D ou `?debug=1`, ver `unlock.ts`).
 */

import Phaser from 'phaser';
import debugConfig from '../data/debug.json';
import engineConfig from '../data/engine.json';
import type { SimulationRunner } from '../sim/engine/simulation';
import { patternTowerType } from '../sim/debug/towerCells';
import type { GridCoord } from '../sim/grid/map';
import type { DebugLayout, RunState, SimCommand } from '../sim/state';
import { evaluateGate, type PerfSummary } from './metrics';
import type { PerfMonitor, RecordingResult } from './PerfMonitor';
import { addReport, allReports, clearReports, formatReport, reportTitle } from './perfReport';
import { linkWithSeed } from './seed';
import type { DebugGate } from './unlock';
import './debugPanel.css';

const { defaults, chainScenario, fullScenario, perf, cheats, panel: panelConfig } = debugConfig;

/** Valor da opção "Cadeia" na seleção de torre (não é um id de torre). */
const CHAIN_OPTION = '__chain__';
const FULL_OPTION = '__full__';

/** O painel continua aberto ou fechado depois de reiniciar a cena. */
let panelVisible = true;

export interface DebugPanelDeps {
  game: Phaser.Game;
  runner: SimulationRunner;
  monitor: PerfMonitor;
  enemyTypes: readonly string[];
  towerTypes: readonly { id: string; name: string }[];
  hoveredCell: () => GridCoord | null;
  selectedCell: () => GridCoord | null;
  /** Liberação do debug (sempre liberado no `npm run dev`). */
  gate: DebugGate;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function numberInput(value: number): HTMLInputElement {
  return el('input', { type: 'number', min: '0', step: '1', value: String(value) });
}

function layoutSelect(): HTMLSelectElement {
  return el('select', {}, [
    el('option', { value: 'spread', textContent: 'espalhados' }),
    el('option', { value: 'clustered', textContent: 'agrupados' }),
  ]);
}

/**
 * Lista de tipo de torre: os tipos dos dados e, no fim, "Cadeia", que mistura
 * os tipos do cenário de cadeia pelo padrão das casas. `types()` devolve os
 * tipos escolhidos.
 */
function towerTypeSelect(towerTypes: DebugPanelDeps['towerTypes']): {
  select: HTMLSelectElement;
  isChain: () => boolean;
  types: () => string[];
} {
  const select = el('select', {}, [
    ...towerTypes.map((t) =>
      el('option', { value: t.id, textContent: t.name, selected: t.id === defaults.towerType }),
    ),
    el('option', { value: CHAIN_OPTION, textContent: chainScenario.name }),
    el('option', { value: FULL_OPTION, textContent: fullScenario.name }),
  ]);
  const isChain = (): boolean => select.value === CHAIN_OPTION || select.value === FULL_OPTION;
  const types = (): string[] =>
    select.value === CHAIN_OPTION
      ? [...chainScenario.towerTypes]
      : select.value === FULL_OPTION
        ? [...fullScenario.towerTypes]
        : [select.value];
  return { select, isChain, types };
}

/** Estrela das torres posicionadas pelo debug (a estrela real e a fusão são da T11). */
function starSelect(): HTMLSelectElement {
  return el('select', {}, [
    el('option', { value: '1', textContent: '★1' }),
    el('option', { value: '2', textContent: '★2' }),
    el('option', { value: '3', textContent: '★3' }),
  ]);
}

function button(text: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', { type: 'button', textContent: text });
  b.addEventListener('click', () => {
    onClick();
    // Sem foco no painel, as teclas da loja e o F2 continuam chegando ao jogo.
    b.blur();
  });
  return b;
}

function row(label: string, ...controls: HTMLElement[]): HTMLElement {
  return el('div', { className: 'debug-row' }, [
    el('span', { className: 'debug-label', textContent: label }),
    ...controls,
  ]);
}

function formatCell(cell: GridCoord | null): string {
  return cell ? `(${cell.x}, ${cell.y})` : '—';
}

function formatLive(s: PerfSummary | null): string {
  if (!s) return 'FPS —';
  const t = s.triggers;
  return [
    `FPS ${s.avgFps.toFixed(1)}  piores 1% ${s.lowFps.toFixed(1)}`,
    `Tick ${s.tick.avg.toFixed(2)} / máx ${s.tick.max.toFixed(2)} ms  (${s.ticksPerSecond.toFixed(0)}/s)`,
    `Render ${s.render.avg.toFixed(2)} / máx ${s.render.max.toFixed(2)} ms`,
    `Views ${s.views.avg.toFixed(2)} / máx ${s.views.max.toFixed(2)} ms`,
    `Ticks descartados ${s.droppedTicks}`,
    `Gatilhos ${t.avgFired.toFixed(1)}/tick (máx ${t.maxFired})  prof. máx ${t.maxDepth}`,
    `Adiados máx ${t.maxDeferred}  descartados ${t.dropped}`,
  ].join('\n');
}

/** Tipos das torres no mapa, pelo nome, na ordem em que aparecem. */
function towerTypeNames(state: Readonly<RunState>, names: ReadonlyMap<string, string>): string {
  const seen = new Set(state.towers.map((t) => t.type));
  return [...seen].map((id) => names.get(id) ?? id).join('+') || '—';
}

export class DebugPanel {
  private readonly deps: DebugPanelDeps;
  private readonly root: HTMLElement;
  private readonly stats: HTMLElement;
  private readonly recordStatus: HTMLElement;
  private readonly results: HTMLElement;
  private readonly speedButtons: HTMLButtonElement[] = [];
  private readonly invulnerable: HTMLInputElement;
  private readonly infiniteGold: HTMLInputElement;
  private readonly speeds: readonly number[];
  private readonly removeUnlock: () => void;
  private readonly placeNote: HTMLElement;
  private readonly towerNames: ReadonlyMap<string, string>;
  private nextRefresh = 0;
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== panelConfig.toggleKey || !this.deps.gate.unlocked) return;
    event.preventDefault();
    panelVisible = !panelVisible;
    this.root.hidden = !panelVisible;
  };

  constructor(parent: HTMLElement, deps: DebugPanelDeps) {
    this.deps = deps;
    this.towerNames = new Map(deps.towerTypes.map((t) => [t.id, t.name]));
    this.stats = el('pre', { className: 'debug-stats' });
    this.recordStatus = el('div', { className: 'debug-note' });
    this.results = el('div', { className: 'debug-results' });

    // Velocidade: as do Q (1x a 3x) e as do debug (5x e 10x), fora da fila.
    const speedRow = row('Velocidade');
    this.speeds = [...engineConfig.speeds, ...engineConfig.debugSpeeds];
    for (const speed of this.speeds) {
      const b = button(`${speed}x`, () => {
        deps.runner.clock.setSpeed(speed);
        this.refreshSpeed();
      });
      this.speedButtons.push(b);
      speedRow.append(b);
    }

    // Núcleo invulnerável
    this.invulnerable = el('input', { type: 'checkbox' });
    this.invulnerable.addEventListener('change', () =>
      this.send({ type: 'debugSetNexusInvulnerable', value: this.invulnerable.checked }),
    );

    // Trapaças de ouro (pela fila de comandos; marcam a run como trapaceada).
    const addGold = button(`+${cheats.addGold} ouro`, () =>
      this.send({ type: 'debugAddGold', amount: cheats.addGold }),
    );
    this.infiniteGold = el('input', { type: 'checkbox' });
    this.infiniteGold.addEventListener('change', () =>
      this.send({ type: 'debugSetInfiniteGold', value: this.infiniteGold.checked }),
    );

    // Torre: tipo usado para posicionar e no spawn em massa (o estresse tem o seu).
    const towerType = towerTypeSelect(deps.towerTypes);
    const selectedTypes = towerType.types;
    const towerStar = starSelect();
    this.placeNote = el('div', { className: 'debug-note' });
    const placeTower = button('Posicionar na casa selecionada', () => {
      const cell = deps.selectedCell();
      if (!cell) {
        this.placeNote.textContent = 'Clique numa casa do mapa antes.';
        return;
      }
      this.placeNote.textContent = '';
      const type = patternTowerType(selectedTypes(), cell);
      if (type) {
        const star = Number(towerStar.value);
        this.send({ type: 'placeTower', towerType: type, x: cell.x, y: cell.y, star });
      }
    });

    // Spawn de inimigos
    const enemyType = el('select', {}, [
      el('option', { value: '', textContent: 'misturados' }),
      ...deps.enemyTypes.map((t) => el('option', { value: t, textContent: t })),
    ]);
    const enemyCount = numberInput(defaults.spawnCount);
    const enemyLayout = layoutSelect();
    const spawnEnemies = button('Spawnar', () =>
      this.send({
        type: 'debugSpawnEnemies',
        count: enemyCount.valueAsNumber,
        enemyType: enemyType.value || null,
        layout: enemyLayout.value as DebugLayout,
      }),
    );

    // Spawn de torres
    const towerCount = numberInput(defaults.towerCount);
    const towerLayout = layoutSelect();
    const spawnStar = starSelect();
    const spawnTowers = button('Spawnar', () =>
      this.send({
        type: 'debugSpawnTowers',
        count: towerCount.valueAsNumber,
        towerTypes: selectedTypes(),
        layout: towerLayout.value as DebugLayout,
        star: Number(spawnStar.value),
      }),
    );

    // Cenário de estresse: quantidade e tipo das torres na mesma linha.
    const stressCount = numberInput(defaults.enemyCount);
    const stressTowers = numberInput(defaults.towerCount);
    const stressTowerType = towerTypeSelect(deps.towerTypes);
    const stressStar = starSelect();
    const stressLayout = layoutSelect();
    // Na cadeia, as torres ficam sempre no bloco compacto (precisam se tocar);
    // a disposição escolhida vale só para os inimigos.
    const startScenario = button('Iniciar cenário', () => {
      const layout = stressLayout.value as DebugLayout;
      this.invulnerable.checked = true;
      this.send({ type: 'debugClear' });
      this.send({ type: 'debugSetNexusInvulnerable', value: true });
      this.send({
        type: 'debugSpawnTowers',
        count: stressTowers.valueAsNumber,
        towerTypes: stressTowerType.types(),
        layout: stressTowerType.isChain() ? (chainScenario.towerLayout as DebugLayout) : layout,
        star: Number(stressStar.value),
      });
      this.send({
        type: 'debugSetStress',
        stress: { count: stressCount.valueAsNumber, layout },
      });
    });
    const stopStress = button('Parar estresse', () =>
      this.send({ type: 'debugSetStress', stress: null }),
    );
    const clear = button('Limpar tudo', () => this.send({ type: 'debugClear' }));
    // Fecha a onda atual (juros, bônus e loja nova); com onda em andamento,
    // tira do mapa os inimigos que restam.
    const endWave = button('Encerrar onda', () => this.send({ type: 'endWave' }));
    // Entre ondas: fecha ondas (com juros e bônus) até a próxima ser a escolhida.
    const skipWave = numberInput(20);
    skipWave.min = '1';
    const skipToWave = button('Pular para onda', () =>
      this.send({ type: 'debugSkipToWave', wave: skipWave.valueAsNumber }),
    );

    // Gravação
    const record = button(`Gravar ${perf.recordSeconds} s`, () => this.startRecording());
    const copy = button('Copiar relatórios', () => void this.copyReports());
    const forget = button('Apagar', () => {
      clearReports();
      this.renderResults();
    });

    // Semente
    const copyLink = button('Copiar link com a semente', () => {
      const link = linkWithSeed(window.location.href, deps.runner.sim.state.seed);
      void navigator.clipboard?.writeText(link);
    });

    this.root = el('div', { className: 'debug-panel' }, [
      el('div', {
        className: 'debug-title',
        textContent: `Debug (${panelConfig.toggleKey} mostra/esconde)`,
      }),
      this.stats,
      speedRow,
      row('Núcleo', el('label', {}, [this.invulnerable, ' invulnerável'])),
      row('Ouro', addGold, el('label', {}, [this.infiniteGold, ' ouro infinito'])),
      el('div', { className: 'debug-section', textContent: 'Ondas e economia' }),
      row('', endWave),
      row('', skipToWave, skipWave),
      el('div', { className: 'debug-section', textContent: 'Torre' }),
      row('Tipo', towerType.select, towerStar, placeTower),
      this.placeNote,
      el('div', { className: 'debug-section', textContent: 'Estresse' }),
      row('Inimigos', stressCount, stressLayout),
      row('Torres', stressTowers, stressTowerType.select, stressStar),
      row('', startScenario, stopStress),
      el('div', { className: 'debug-section', textContent: 'Spawn' }),
      row('Inimigos', enemyCount, enemyType, enemyLayout, spawnEnemies),
      row('Torres', towerCount, towerLayout, spawnStar, spawnTowers),
      row('', clear),
      el('div', { className: 'debug-section', textContent: 'Gravação' }),
      row('', record, copy, forget),
      this.recordStatus,
      this.results,
      row('', copyLink),
    ]);
    this.root.hidden = !(deps.gate.unlocked && panelVisible);
    // O atalho secreto mostra o painel na hora.
    this.removeUnlock = deps.gate.onUnlock(() => {
      panelVisible = true;
      this.root.hidden = false;
    });
    // O teclado digitado no painel não chega ao jogo.
    this.root.addEventListener('keydown', (event) => event.stopPropagation());
    window.addEventListener('keydown', this.onKeyDown);
    parent.append(this.root);

    this.refreshSpeed();
    this.renderResults();
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    this.removeUnlock();
    this.root.remove();
  }

  /** Atualiza os números (no máximo a cada `refreshMs`). */
  update(): void {
    const t = performance.now();
    if (t < this.nextRefresh || this.root.hidden) return;
    // A velocidade também muda pela tecla Q e pelo botão do HUD.
    this.refreshSpeed();
    this.nextRefresh = t + panelConfig.refreshMs;

    const { sim } = this.deps.runner;
    const { state } = sim;
    const stress = state.debug.stress;
    this.invulnerable.checked = state.debug.nexusInvulnerable;
    this.infiniteGold.checked = state.debug.infiniteGold;
    this.stats.textContent = [
      formatLive(this.deps.monitor.liveSummary),
      `Inimigos ${state.enemies.activeCount}  Projéteis ${state.projectiles.activeCount}  Torres ${state.towers.length}`,
      `Fila de gatilhos ${state.triggers.queue.length}  descartados (run) ${state.triggers.droppedTotal}`,
      `Estresse ${stress ? `${stress.count} (${stress.layout})` : 'desligado'}`,
      `Núcleo ${Math.ceil(state.nexus.hp)}/${state.nexus.maxHp}`,
      `Semente ${state.seed}  Trapaça ${state.cheated ? 'sim' : 'não'}`,
      `Mouse ${formatCell(this.deps.hoveredCell())}  Seleção ${formatCell(this.deps.selectedCell())}`,
    ].join('\n');

    const status = this.deps.monitor.recordingStatus;
    if (status) {
      const phase = status.phase === 'warmup' ? 'Aquecendo' : 'Gravando';
      this.recordStatus.textContent = `${phase}… ${status.secondsLeft.toFixed(0)} s (não mexa na janela)`;
    }
  }

  private send(command: SimCommand): void {
    this.deps.runner.sim.enqueue(command);
  }

  private refreshSpeed(): void {
    const current = this.deps.runner.clock.speed;
    this.speedButtons.forEach((b, i) => {
      b.classList.toggle('active', this.speeds[i] === current);
    });
  }

  private startRecording(): void {
    const { runner, monitor, game } = this.deps;
    if (monitor.isRecording) return;
    const speed = runner.clock.speed;
    this.recordStatus.textContent = 'Aquecendo…';
    monitor.startRecording((result: RecordingResult) => {
      const { state } = runner.sim;
      const stress = state.debug.stress;
      addReport({
        meta: {
          speed,
          layout: stress?.layout ?? null,
          stressCount: stress?.count ?? null,
          towers: state.towers.length,
          towerTypes: towerTypeNames(state, this.towerNames),
          seed: state.seed,
          date: new Date().toISOString(),
          userAgent: navigator.userAgent,
          viewport: `${game.canvas.width}x${game.canvas.height}`,
          devicePixelRatio: window.devicePixelRatio,
          renderer: game.renderer.type === Phaser.WEBGL ? 'WebGL' : 'Canvas',
        },
        summary: result.summary,
        gate: evaluateGate(result.summary, perf.gate),
        expectedTicksPerSecond: engineConfig.ticksPerSecond * speed,
        avgEnemies: result.avgEnemies,
        avgProjectiles: result.avgProjectiles,
      });
      this.recordStatus.textContent = 'Gravação concluída.';
      this.renderResults();
    });
  }

  private renderResults(): void {
    const reports = allReports();
    this.results.replaceChildren(
      ...reports.map((r) =>
        el('div', { className: r.gate.pass ? 'debug-pass' : 'debug-fail' }, [
          `${r.gate.pass ? '✔' : '✘'} ${reportTitle(r)}: ` +
            `FPS ${r.summary.avgFps.toFixed(1)} / 1% ${r.summary.lowFps.toFixed(1)}, ` +
            `tick ${r.summary.tick.avg.toFixed(2)} ms (máx ${r.summary.tick.max.toFixed(2)})`,
        ]),
      ),
    );
  }

  private async copyReports(): Promise<void> {
    const text = allReports().map(formatReport).join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
      this.recordStatus.textContent = 'Relatórios copiados.';
    } catch {
      // Sem permissão de área de transferência: mostra para copiar à mão.
      console.log(text);
      this.recordStatus.textContent = 'Não consegui copiar; o texto está no console (F12).';
    }
  }
}
