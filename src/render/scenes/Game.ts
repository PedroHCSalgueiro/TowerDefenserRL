import Phaser from 'phaser';
import mapData from '../../data/map.json';
import { Simulation, SimulationRunner } from '../../sim/engine/simulation';
import { loadMap } from '../../sim/grid/map';
import { GridView } from '../views/GridView';

export class Game extends Phaser.Scene {
  private runner!: SimulationRunner;

  constructor() {
    super('Game');
  }

  create(): void {
    // Semente nova a cada run; será exibida no painel de debug.
    this.runner = new SimulationRunner(Simulation.create(Date.now().toString(36)));
    new GridView(this, loadMap(mapData));
  }

  update(_time: number, delta: number): void {
    this.runner.update(delta);
  }

  /** Fator de interpolação entre o tick anterior e o atual, em [0, 1). */
  get interpolationAlpha(): number {
    return this.runner.alpha;
  }
}
