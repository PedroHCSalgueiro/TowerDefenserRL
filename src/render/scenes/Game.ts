import Phaser from 'phaser';
import { Simulation, SimulationRunner } from '../../sim/engine/simulation';

export class Game extends Phaser.Scene {
  private runner!: SimulationRunner;

  constructor() {
    super('Game');
  }

  create(): void {
    // Semente nova a cada run; será exibida no painel de debug.
    this.runner = new SimulationRunner(Simulation.create(Date.now().toString(36)));
  }

  update(_time: number, delta: number): void {
    this.runner.update(delta);
  }

  /** Fator de interpolação entre o tick anterior e o atual, em [0, 1). */
  get interpolationAlpha(): number {
    return this.runner.alpha;
  }
}
