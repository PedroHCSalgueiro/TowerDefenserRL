import Phaser from 'phaser';
import engineConfig from '../../data/engine.json';
import mapData from '../../data/map.json';
import { DebugKeys } from '../../debug/DebugKeys';
import { enemyData } from '../../sim/enemies/enemyData';
import { Simulation, SimulationRunner } from '../../sim/engine/simulation';
import { loadMap } from '../../sim/grid/map';
import { createGameSystems } from '../../sim/systems';
import { showDefeatScreen } from '../../ui/defeatScreen';
import { EnemyView } from '../views/EnemyView';
import { GridView } from '../views/GridView';
import { NexusView } from '../views/NexusView';

export class Game extends Phaser.Scene {
  private runner!: SimulationRunner;
  private enemyView!: EnemyView;
  private nexusView!: NexusView;
  private debugKeys!: DebugKeys;
  private removeDefeatScreen: (() => void) | null = null;

  constructor() {
    super('Game');
  }

  create(): void {
    const map = loadMap(mapData);
    // Semente nova a cada run; será exibida no painel de debug.
    const sim = Simulation.create(Date.now().toString(36), createGameSystems(map));
    this.runner = new SimulationRunner(sim);

    const grid = new GridView(this, map);
    this.nexusView = new NexusView(this, grid.projection, map);
    this.enemyView = new EnemyView(this, grid.projection, enemyData);
    this.debugKeys = new DebugKeys(this, sim, Object.keys(enemyData.types));

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.removeDefeatScreen?.();
      this.removeDefeatScreen = null;
    });
  }

  update(_time: number, delta: number): void {
    const events = this.runner.update(delta);
    const state = this.runner.sim.state;

    this.nexusView.handleEvents(events);
    this.nexusView.draw(state, delta);
    this.enemyView.draw(state, this.interpolationAlpha);
    this.debugKeys.refresh();

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
