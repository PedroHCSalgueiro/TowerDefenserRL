/**
 * Mede o desempenho quadro a quadro, separando:
 * - tick da simulação (via `TickProfiler`, injetado no `SimulationRunner`);
 * - views: atualização da cena sem os ticks (pré-passo → pós-passo − ticks);
 * - render: envio do quadro pelo Phaser (pós-passo → pós-render). O tempo de
 *   GPU não entra: o navegador não o expõe de forma simples;
 * - intervalo entre quadros (dá o FPS e os piores 1%).
 *
 * Mantém um resumo "ao vivo" (janela curta) e faz gravações com aquecimento.
 */

import Phaser from 'phaser';
import debugConfig from '../data/debug.json';
import type { TickProfiler } from '../sim/engine/simulation';
import { summarize, type PerfSamples, type PerfSummary } from './metrics';

const { perf } = debugConfig;
const MS_PER_SECOND = 1000;

class SampleSet implements PerfSamples {
  frameMs: number[] = [];
  tickMs: number[] = [];
  renderMs: number[] = [];
  viewsMs: number[] = [];
  enemies = 0;
  projectiles = 0;
  countFrames = 0;
}

export interface RecordingResult {
  summary: PerfSummary;
  avgEnemies: number;
  avgProjectiles: number;
}

interface Recording {
  phase: 'warmup' | 'recording';
  /** Fim da fase atual (performance.now). */
  until: number;
  droppedAtStart: number;
  samples: SampleSet;
  onDone: (result: RecordingResult) => void;
}

export class PerfMonitor implements TickProfiler {
  private readonly events: Phaser.Events.EventEmitter;
  private readonly droppedTicks: () => number;
  private live = new SampleSet();
  private liveUntil = 0;
  private liveDroppedAtStart = 0;
  private lastLive: PerfSummary | null = null;
  private recording: Recording | null = null;

  private lastFrameStart = -1;
  private stepStart = 0;
  private stepEnd = 0;
  private ticksThisFrame = 0;

  constructor(game: Phaser.Game, droppedTicks: () => number) {
    this.events = game.events;
    this.droppedTicks = droppedTicks;
    this.events.on(Phaser.Core.Events.PRE_STEP, this.onPreStep, this);
    this.events.on(Phaser.Core.Events.POST_STEP, this.onPostStep, this);
    this.events.on(Phaser.Core.Events.POST_RENDER, this.onPostRender, this);
  }

  destroy(): void {
    this.events.off(Phaser.Core.Events.PRE_STEP, this.onPreStep, this);
    this.events.off(Phaser.Core.Events.POST_STEP, this.onPostStep, this);
    this.events.off(Phaser.Core.Events.POST_RENDER, this.onPostRender, this);
    this.recording = null;
  }

  now(): number {
    return performance.now();
  }

  recordTick(durationMs: number): void {
    this.ticksThisFrame += durationMs;
    this.live.tickMs.push(durationMs);
    if (this.recording?.phase === 'recording') this.recording.samples.tickMs.push(durationMs);
  }

  /** Contagem de entidades do quadro (para as médias do relatório). */
  recordCounts(enemies: number, projectiles: number): void {
    const samples = this.recording?.phase === 'recording' ? this.recording.samples : null;
    if (!samples) return;
    samples.enemies += enemies;
    samples.projectiles += projectiles;
    samples.countFrames++;
  }

  /** Resumo da última janela ao vivo completa (`null` antes da primeira). */
  get liveSummary(): PerfSummary | null {
    return this.lastLive;
  }

  get isRecording(): boolean {
    return this.recording !== null;
  }

  /** Fase e segundos restantes da gravação em andamento. */
  get recordingStatus(): { phase: 'warmup' | 'recording'; secondsLeft: number } | null {
    const rec = this.recording;
    if (!rec) return null;
    return { phase: rec.phase, secondsLeft: Math.max(0, (rec.until - this.now()) / MS_PER_SECOND) };
  }

  /** Aquece `warmupSeconds` e depois grava `recordSeconds`. */
  startRecording(onDone: (result: RecordingResult) => void): void {
    this.recording = {
      phase: 'warmup',
      until: this.now() + perf.warmupSeconds * MS_PER_SECOND,
      droppedAtStart: 0,
      samples: new SampleSet(),
      onDone,
    };
  }

  cancelRecording(): void {
    this.recording = null;
  }

  private onPreStep(): void {
    const t = this.now();
    if (this.lastFrameStart >= 0) {
      const frame = t - this.lastFrameStart;
      this.live.frameMs.push(frame);
      if (this.recording?.phase === 'recording') this.recording.samples.frameMs.push(frame);
    }
    this.lastFrameStart = t;
    this.stepStart = t;
    this.ticksThisFrame = 0;
    this.advanceLiveWindow(t);
    this.advanceRecording(t);
  }

  private onPostStep(): void {
    this.stepEnd = this.now();
    const views = Math.max(0, this.stepEnd - this.stepStart - this.ticksThisFrame);
    this.live.viewsMs.push(views);
    if (this.recording?.phase === 'recording') this.recording.samples.viewsMs.push(views);
  }

  private onPostRender(): void {
    const render = this.now() - this.stepEnd;
    this.live.renderMs.push(render);
    if (this.recording?.phase === 'recording') this.recording.samples.renderMs.push(render);
  }

  private advanceLiveWindow(t: number): void {
    if (t < this.liveUntil) return;
    const dropped = this.droppedTicks();
    if (this.live.frameMs.length > 0) {
      this.lastLive = summarize(this.live, dropped - this.liveDroppedAtStart, perf.worstFraction);
    }
    this.live = new SampleSet();
    this.liveUntil = t + perf.liveWindowSeconds * MS_PER_SECOND;
    this.liveDroppedAtStart = dropped;
  }

  private advanceRecording(t: number): void {
    const rec = this.recording;
    if (!rec || t < rec.until) return;
    if (rec.phase === 'warmup') {
      rec.phase = 'recording';
      rec.until = t + perf.recordSeconds * MS_PER_SECOND;
      rec.droppedAtStart = this.droppedTicks();
      return;
    }
    this.recording = null;
    const { samples } = rec;
    const frames = Math.max(1, samples.countFrames);
    rec.onDone({
      summary: summarize(samples, this.droppedTicks() - rec.droppedAtStart, perf.worstFraction),
      avgEnemies: samples.enemies / frames,
      avgProjectiles: samples.projectiles / frames,
    });
  }
}
