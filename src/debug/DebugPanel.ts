/**
 * Painel de debug em HTML sobre o canvas. Substitui o texto do canto e as
 * teclas 1 a 4 da T04.
 *
 * Mostra FPS, tempo de tick e de render, inimigos e projéteis ativos e a
 * semente; tem os comandos de spawn, o modo estresse, o núcleo invulnerável,
 * a velocidade e a gravação de desempenho. Toda ação que muda o jogo passa
 * pela fila de comandos da simulação.
 */

import Phaser from 'phaser';
import debugConfig from '../data/debug.json';
import engineConfig from '../data/engine.json';
import type { SimulationRunner } from '../sim/engine/simulation';
import type { GridCoord } from '../sim/grid/map';
import type { DebugLayout, SimCommand } from '../sim/state';
import { evaluateGate, type PerfSummary } from './metrics';
import type { PerfMonitor, RecordingResult } from './PerfMonitor';
import { addReport, allReports, clearReports, formatReport, reportTitle } from './perfReport';
import { linkWithSeed } from './seed';
import './debugPanel.css';

const { defaults, perf, panel: panelConfig } = debugConfig;

/** O painel continua aberto ou fechado depois de reiniciar a cena. */
let panelVisible = true;

export interface DebugPanelDeps {
  game: Phaser.Game;
  runner: SimulationRunner;
  monitor: PerfMonitor;
  enemyTypes: readonly string[];
  hoveredCell: () => GridCoord | null;
  selectedCell: () => GridCoord | null;
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

function button(text: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', { type: 'button', textContent: text });
  b.addEventListener('click', onClick);
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
  return [
    `FPS ${s.avgFps.toFixed(1)}  piores 1% ${s.lowFps.toFixed(1)}`,
    `Tick ${s.tick.avg.toFixed(2)} / máx ${s.tick.max.toFixed(2)} ms  (${s.ticksPerSecond.toFixed(0)}/s)`,
    `Render ${s.render.avg.toFixed(2)} / máx ${s.render.max.toFixed(2)} ms`,
    `Views ${s.views.avg.toFixed(2)} / máx ${s.views.max.toFixed(2)} ms`,
    `Descartados ${s.droppedTicks}`,
  ].join('\n');
}

export class DebugPanel {
  private readonly deps: DebugPanelDeps;
  private readonly root: HTMLElement;
  private readonly stats: HTMLElement;
  private readonly recordStatus: HTMLElement;
  private readonly results: HTMLElement;
  private readonly speedButtons: HTMLButtonElement[] = [];
  private readonly invulnerable: HTMLInputElement;
  private nextRefresh = 0;
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== panelConfig.toggleKey) return;
    event.preventDefault();
    panelVisible = !panelVisible;
    this.root.hidden = !panelVisible;
  };

  constructor(parent: HTMLElement, deps: DebugPanelDeps) {
    this.deps = deps;
    this.stats = el('pre', { className: 'debug-stats' });
    this.recordStatus = el('div', { className: 'debug-note' });
    this.results = el('div', { className: 'debug-results' });

    // Velocidade
    const speedRow = row('Velocidade');
    for (const speed of engineConfig.speeds) {
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
    const spawnTowers = button('Spawnar', () =>
      this.send({
        type: 'debugSpawnTowers',
        count: towerCount.valueAsNumber,
        layout: towerLayout.value as DebugLayout,
      }),
    );

    // Cenário de estresse
    const stressCount = numberInput(defaults.enemyCount);
    const stressTowers = numberInput(defaults.towerCount);
    const stressLayout = layoutSelect();
    const startScenario = button('Iniciar cenário', () => {
      const layout = stressLayout.value as DebugLayout;
      this.invulnerable.checked = true;
      this.send({ type: 'debugClear' });
      this.send({ type: 'debugSetNexusInvulnerable', value: true });
      this.send({ type: 'debugSpawnTowers', count: stressTowers.valueAsNumber, layout });
      this.send({
        type: 'debugSetStress',
        stress: { count: stressCount.valueAsNumber, layout },
      });
    });
    const stopStress = button('Parar estresse', () =>
      this.send({ type: 'debugSetStress', stress: null }),
    );
    const clear = button('Limpar tudo', () => this.send({ type: 'debugClear' }));

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
      el('div', { className: 'debug-section', textContent: 'Estresse' }),
      row('Inimigos', stressCount, stressLayout),
      row('Torres', stressTowers),
      row('', startScenario, stopStress),
      el('div', { className: 'debug-section', textContent: 'Spawn' }),
      row('Inimigos', enemyCount, enemyType, enemyLayout, spawnEnemies),
      row('Torres', towerCount, towerLayout, spawnTowers),
      row('', clear),
      el('div', { className: 'debug-section', textContent: 'Gravação' }),
      row('', record, copy, forget),
      this.recordStatus,
      this.results,
      row('', copyLink),
    ]);
    this.root.hidden = !panelVisible;
    // O teclado digitado no painel não chega ao jogo.
    this.root.addEventListener('keydown', (event) => event.stopPropagation());
    window.addEventListener('keydown', this.onKeyDown);
    parent.append(this.root);

    this.refreshSpeed();
    this.renderResults();
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    this.root.remove();
  }

  /** Atualiza os números (no máximo a cada `refreshMs`). */
  update(): void {
    const t = performance.now();
    if (t < this.nextRefresh || this.root.hidden) return;
    this.nextRefresh = t + panelConfig.refreshMs;

    const { sim } = this.deps.runner;
    const { state } = sim;
    const stress = state.debug.stress;
    this.invulnerable.checked = state.debug.nexusInvulnerable;
    this.stats.textContent = [
      formatLive(this.deps.monitor.liveSummary),
      `Inimigos ${state.enemies.activeCount}  Projéteis ${state.projectiles.activeCount}  Torres ${state.debug.towers.length}`,
      `Estresse ${stress ? `${stress.count} (${stress.layout})` : 'desligado'}`,
      `Núcleo ${Math.ceil(state.nexus.hp)}/${state.nexus.maxHp}`,
      `Semente ${state.seed}`,
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
      b.classList.toggle('active', engineConfig.speeds[i] === current);
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
          towers: state.debug.towers.length,
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
