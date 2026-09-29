/**
 * Trapaças provisórias de teclado e linha de status (vão para o painel de
 * debug na T05). As teclas 1, 2, 3... spawnam os tipos na ordem de
 * `enemies.json`, sempre pela fila de ações da simulação.
 */

import Phaser from 'phaser';
import renderConfig from '../data/render.json';
import type { Simulation } from '../sim/engine/simulation';

const { debugLabel } = renderConfig;

export class DebugKeys {
  private readonly sim: Simulation;
  private readonly label: Phaser.GameObjects.Text;
  private readonly help: string;

  constructor(scene: Phaser.Scene, sim: Simulation, enemyTypes: readonly string[]) {
    this.sim = sim;
    this.help = enemyTypes.map((type, i) => `${i + 1}=${type}`).join(' ');
    this.label = scene.add.text(debugLabel.x, debugLabel.y + debugLabel.lineHeight, '', {
      fontFamily: 'monospace',
      fontSize: debugLabel.fontSize,
      color: debugLabel.color,
    });

    scene.input.keyboard?.on(Phaser.Input.Keyboard.Events.ANY_KEY_DOWN, (event: KeyboardEvent) => {
      const index = Number.parseInt(event.key, 10) - 1;
      const enemyType = enemyTypes[index];
      if (enemyType !== undefined) {
        this.sim.enqueue({ type: 'spawnEnemy', enemyType });
      }
    });
  }

  refresh(): void {
    const { nexus, enemies, seed } = this.sim.state;
    this.label.setText(
      `Spawn: ${this.help}  Núcleo: ${Math.ceil(nexus.hp)}/${nexus.maxHp}  ` +
        `Inimigos: ${enemies.activeCount}  Semente: ${seed}`,
    );
  }
}
