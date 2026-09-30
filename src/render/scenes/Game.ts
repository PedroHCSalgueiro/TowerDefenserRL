import Phaser from 'phaser';
import engineConfig from '../../data/engine.json';
import renderConfig from '../../data/render.json';
import mapData from '../../data/map.json';
import { DebugPanel } from '../../debug/DebugPanel';
import { PerfMonitor } from '../../debug/PerfMonitor';
import { resolveSeed } from '../../debug/seed';
import { enemyData } from '../../sim/enemies/enemyData';
import { Simulation, SimulationRunner } from '../../sim/engine/simulation';
import type { RunState } from '../../sim/state';
import { loadMap, type GridMap } from '../../sim/grid/map';
import { createGameSystems } from '../../sim/systems';
import { classData } from '../../sim/classes/classData';
import type { Tower } from '../../sim/towers/placement';
import { getTowerType, towerData } from '../../sim/towers/towerData';
import { ClassPanel } from '../../ui/classPanel';
import { NexusPanel } from '../../ui/nexusPanel';
import { canPlaceAt } from '../../ui/shopModel';
import { ShopController } from '../../ui/shopController';
import { describeTower } from '../../ui/towerInfo';
import { TowerTooltip } from '../../ui/towerTooltip';
import { showDefeatScreen } from '../../ui/defeatScreen';
import { CarryView } from '../views/CarryView';
import { EnemyView } from '../views/EnemyView';
import { GridView } from '../views/GridView';
import { NexusView } from '../views/NexusView';
import { ProjectileView } from '../views/ProjectileView';
import { TowerView } from '../views/TowerView';

export class Game extends Phaser.Scene {
  private runner!: SimulationRunner;
  private grid!: GridView;
  private enemyView!: EnemyView;
  private nexusView!: NexusView;
  private towerView!: TowerView;
  private projectileView!: ProjectileView;
  private monitor!: PerfMonitor;
  private panel!: DebugPanel;
  private classPanel!: ClassPanel;
  private nexusPanel!: NexusPanel;
  private shop!: ShopController;
  private tooltip!: TowerTooltip;
  private carryView!: CarryView;
  private map!: GridMap;
  private removeDefeatScreen: (() => void) | null = null;

  constructor() {
    super('Game');
  }

  create(): void {
    const map = loadMap(mapData);
    this.map = map;
    // `?seed=abc` fixa a semente (inclusive ao jogar de novo); sem ela, sorteia.
    const seed = resolveSeed(window.location.search, () => Date.now().toString(36));
    const sim = Simulation.create(seed, createGameSystems(map));
    this.runner = new SimulationRunner(sim);

    const grid = new GridView(this, map);
    this.grid = grid;
    // Torres e inimigos na mesma Layer, para a profundidade isométrica (x + y) valer entre eles.
    const units = this.add.layer();
    this.towerView = new TowerView(this, grid.projection, units, towerData);
    this.nexusView = new NexusView(this, grid.projection, map);
    this.enemyView = new EnemyView(this, grid.projection, enemyData, units);
    this.projectileView = new ProjectileView(this, grid.projection);

    this.monitor = new PerfMonitor(
      this.game,
      () => this.runner.clock.droppedTicks,
      () => this.runner.sim.state.triggers.lastTick,
    );
    this.runner.profiler = this.monitor;
    this.panel = new DebugPanel(this.game.canvas.parentElement ?? document.body, {
      game: this.game,
      runner: this.runner,
      monitor: this.monitor,
      enemyTypes: Object.keys(enemyData.types),
      towerTypes: Object.entries(towerData.types).map(([id, type]) => ({ id, name: type.name })),
      hoveredCell: () => grid.hoveredCell,
      selectedCell: () => grid.selectedCell,
    });

    const overlayParent = this.game.canvas.parentElement ?? document.body;
    this.classPanel = new ClassPanel(overlayParent);
    const evolveNexus = () => this.runner.sim.enqueue({ type: 'evolveNexus' });
    this.nexusPanel = new NexusPanel(overlayParent, evolveNexus);
    this.tooltip = new TowerTooltip(overlayParent);
    this.carryView = new CarryView(this, grid.projection, towerData);
    this.shop = new ShopController({
      parent: overlayParent,
      map,
      state: () => this.runner.sim.state,
      enqueue: (command) => this.runner.sim.enqueue(command),
      evolveNexus,
      selectedCell: () => grid.selectedCell,
      cellAtClient: (x, y) => grid.cellAtClient(x, y),
    });
    // Clique no mapa com a torre presa ao mouse (teclas 1 a 5) posiciona.
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
      if (pointer.leftButtonDown()) this.shop.clickCell(grid.cellAt(pointer));
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.removeDefeatScreen?.();
      this.removeDefeatScreen = null;
      this.panel.destroy();
      this.classPanel.destroy();
      this.nexusPanel.destroy();
      this.shop.destroy();
      this.tooltip.destroy();
      this.carryView.destroy();
      this.monitor.destroy();
    });
  }

  update(_time: number, delta: number): void {
    const events = this.runner.update(delta);
    const state = this.runner.sim.state;

    this.nexusView.handleEvents(events);
    this.projectileView.handleEvents(events);
    this.towerView.handleEvents(events);
    this.towerView.draw(state, this.grid.selectedCell);
    this.nexusView.draw(state, delta);
    this.enemyView.draw(state, this.interpolationAlpha);
    this.projectileView.draw(state, this.interpolationAlpha, delta);
    this.monitor.recordCounts(state.enemies.activeCount, state.projectiles.activeCount);
    this.panel.update();
    this.classPanel.update(state.classes);
    this.nexusPanel.update(state);
    this.shop.update();
    const carrying = this.shop.carrying;
    const hovered = this.grid.hoveredCell;
    this.updateTooltip(state, carrying !== null, hovered);
    this.carryView.draw(
      carrying?.towerType ?? null,
      hovered,
      hovered !== null && canPlaceAt(state, this.map, hovered),
    );

    if (state.status === 'lost' && !this.removeDefeatScreen) {
      this.removeDefeatScreen = showDefeatScreen(
        this.game.canvas.parentElement ?? document.body,
        { seconds: state.tick / engineConfig.ticksPerSecond, seed: state.seed },
        () => this.scene.restart(),
      );
    }
  }

  /** Janela "o que esta torre faz": slot da loja sob o mouse ou torre do mapa (sem torre presa ao mouse). */
  private updateTooltip(
    state: Readonly<RunState>,
    carrying: boolean,
    hovered: { x: number; y: number } | null,
  ): void {
    let type: string | null = null;
    let star = 1;
    let key: string | null = null;
    const shopType = this.shop.hoveredTowerType;
    if (shopType !== null) {
      type = shopType;
      key = `loja:${shopType}`;
    } else if (!carrying && hovered && this.tooltip.pointerOverCanvas) {
      const tower = this.towerUnderPointer(state, hovered);
      if (tower) {
        type = tower.type;
        star = tower.star;
        key = `torre:${tower.id}:${tower.star}`;
      }
    }
    this.tooltip.update(
      type === null ? null : describeTower(getTowerType(towerData, type), star, classData),
      key,
      performance.now(),
    );
  }

  /**
   * Torre sob o mouse: a que tem o bloco desenhado sob o ponteiro (a da frente,
   * se houver duas) ou, se não houver, a da casa sob o mouse.
   */
  private towerUnderPointer(
    state: Readonly<RunState>,
    cell: { x: number; y: number },
  ): Tower | undefined {
    const { worldX, worldY } = this.input.activePointer;
    const { width, height } = renderConfig.towers;
    let best: Tower | undefined;
    for (const tower of state.towers) {
      const p = this.grid.projection.toScreen(tower);
      const inside = Math.abs(worldX - p.x) <= width / 2 && worldY <= p.y && worldY >= p.y - height;
      if (inside && (!best || tower.x + tower.y > best.x + best.y)) best = tower;
    }
    return best ?? state.towers.find((t) => t.x === cell.x && t.y === cell.y);
  }

  /** Fator de interpolação entre o tick anterior e o atual, em [0, 1). */
  get interpolationAlpha(): number {
    return this.runner.alpha;
  }
}
