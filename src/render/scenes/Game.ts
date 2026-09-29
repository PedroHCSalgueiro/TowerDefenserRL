import Phaser from 'phaser';
import engineConfig from '../../data/engine.json';
import mapData from '../../data/map.json';
import { DebugPanel } from '../../debug/DebugPanel';
import { PerfMonitor } from '../../debug/PerfMonitor';
import { resolveSeed } from '../../debug/seed';
import { enemyData } from '../../sim/enemies/enemyData';
import { Simulation, SimulationRunner } from '../../sim/engine/simulation';
import { loadMap } from '../../sim/grid/map';
import { createGameSystems } from '../../sim/systems';
import { showDefeatScreen } from '../../ui/defeatScreen';
import { EnemyView } from '../views/EnemyView';
import { GridView } from '../views/GridView';
import { NexusView } from '../views/NexusView';
import { ProjectileView } from '../views/ProjectileView';
import { TowerView } from '../views/TowerView';

export class Game extends Phaser.Scene {
  private runner!: SimulationRunner;
  private enemyView!: EnemyView;
  private nexusView!: NexusView;
  private towerView!: TowerView;
  private projectileView!: ProjectileView;
  private monitor!: PerfMonitor;
  private panel!: DebugPanel;
  private removeDefeatScreen: (() => void) | null = null;

  constructor() {
    super('Game');
  }

  create(): void {
    const map = loadMap(mapData);
    // `?seed=abc` fixa a semente (inclusive ao jogar de novo); sem ela, sorteia.
    const seed = resolveSeed(window.location.search, () => Date.now().toString(36));
    const sim = Simulation.create(seed, createGameSystems(map));
    this.runner = new SimulationRunner(sim);

    const grid = new GridView(this, map);
    this.towerView = new TowerView(this, grid.projection);
    this.nexusView = new NexusView(this, grid.projection, map);
    this.enemyView = new EnemyView(this, grid.projection, enemyData);
    this.projectileView = new ProjectileView(this, grid.projection);

    this.monitor = new PerfMonitor(this.game, () => this.runner.clock.droppedTicks);
    this.runner.profiler = this.monitor;
    this.panel = new DebugPanel(this.game.canvas.parentElement ?? document.body, {
      game: this.game,
      runner: this.runner,
      monitor: this.monitor,
      enemyTypes: Object.keys(enemyData.types),
      hoveredCell: () => grid.hoveredCell,
      selectedCell: () => grid.selectedCell,
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.removeDefeatScreen?.();
      this.removeDefeatScreen = null;
      this.panel.destroy();
      this.monitor.destroy();
    });
  }

  update(_time: number, delta: number): void {
    const events = this.runner.update(delta);
    const state = this.runner.sim.state;

    this.nexusView.handleEvents(events);
    this.towerView.draw(state);
    this.nexusView.draw(state, delta);
    this.enemyView.draw(state, this.interpolationAlpha);
    this.projectileView.draw(state, this.interpolationAlpha);
    this.monitor.recordCounts(state.enemies.activeCount, state.projectiles.activeCount);
    this.panel.update();

    if (state.status === 'lost' && !this.removeDefeatScreen) {
      this.removeDefeatScreen = showDefeatScreen(
        this.game.canvas.parentElement ?? document.body,
        { seconds: state.tick / engineConfig.ticksPerSecond, seed: state.seed },
        () => this.scene.restart(),
      );
    }
  }

  /** Fator de interpolação entre o tick anterior e o atual, em [0, 1). */
  get interpolationAlpha(): number {
    return this.runner.alpha;
  }
}
