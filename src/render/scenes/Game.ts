import Phaser from 'phaser';
import debugConfig from '../../data/debug.json';
import engineConfig from '../../data/engine.json';
import renderConfig from '../../data/render.json';
import uiConfig from '../../data/ui.json';
import mapData from '../../data/map.json';
import { DebugPanel } from '../../debug/DebugPanel';
import { PerfMonitor } from '../../debug/PerfMonitor';
import { triggerFxDisabled } from '../../debug/flags';
import { resolveSeed, runLink } from '../../debug/seed';
import { DebugGate } from '../../debug/unlock';
import { enemyData } from '../../sim/enemies/enemyData';
import type { SimEvent } from '../../sim/engine/events';
import { Simulation, SimulationRunner } from '../../sim/engine/simulation';
import type { RunState } from '../../sim/state';
import { loadMap, type GridMap } from '../../sim/grid/map';
import { createGameSystems } from '../../sim/systems';
import { classData } from '../../sim/classes/classData';
import type { Tower } from '../../sim/towers/placement';
import { getTowerType, towerData } from '../../sim/towers/towerData';
import { affectedNeighbors } from '../../sim/triggers/neighborhood';
import { previewKey, purchasePreview, type PurchasePreview } from '../../ui/classPreview';
import { ClassPanel } from '../../ui/classPanel';
import { NexusPanel } from '../../ui/nexusPanel';
import { canPlaceAt } from '../../ui/shopModel';
import { ShopController } from '../../ui/shopController';
import { TowerDragController } from '../../ui/towerDragController';
import { canDropAt } from '../../ui/towerDragModel';
import { describeTower } from '../../ui/towerInfo';
import { TowerTooltip } from '../../ui/towerTooltip';
import { showEndScreen } from '../../ui/endScreen';
import { HelpScreen } from '../../ui/helpScreen';
import { summarizeRun } from '../../ui/runReport';
import { showVersionLabel } from '../../ui/versionLabel';
import { WaveAnnounce, waveAnnouncementFor } from '../../ui/waveAnnounce';
import { LinkHint, linkHintLines } from '../../ui/linkHint';
import { previewLinks, type LinkPreview } from '../../sim/triggers/links';
import { LinkPreviewView } from '../views/LinkPreviewView';
import { Tutorial } from '../../ui/tutorial';
import { WaveHud } from '../../ui/waveHud';
import { defaultWaveSchedules } from '../../ui/waveHudModel';
import { CarryView } from '../views/CarryView';
import { EnemyView } from '../views/EnemyView';
import { GridView } from '../views/GridView';
import { HoverView } from '../views/HoverView';
import { NexusView } from '../views/NexusView';
import { ProjectileView } from '../views/ProjectileView';
import { TowerView } from '../views/TowerView';
import { TriggerFxView } from '../views/TriggerFxView';

export class Game extends Phaser.Scene {
  private runner!: SimulationRunner;
  private grid!: GridView;
  private enemyView!: EnemyView;
  private nexusView!: NexusView;
  private towerView!: TowerView;
  private projectileView!: ProjectileView;
  private triggerFx!: TriggerFxView;
  /** `?fx=0` desliga os efeitos dos gatilhos (só para medir o custo deles). */
  private triggerFxOn = true;
  private hoverView!: HoverView;
  private monitor!: PerfMonitor;
  private panel!: DebugPanel;
  private gate!: DebugGate;
  private help!: HelpScreen;
  private classPanel!: ClassPanel;
  private nexusPanel!: NexusPanel;
  private shop!: ShopController;
  private tooltip!: TowerTooltip;
  private carryView!: CarryView;
  private linkView!: LinkPreviewView;
  private linkHint!: LinkHint;
  private towerDrag!: TowerDragController;
  private waveHud!: WaveHud;
  private waveAnnounce!: WaveAnnounce;
  private tutorial!: Tutorial;
  private map!: GridMap;
  private removeEndScreen: (() => void) | null = null;

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
    this.hoverView = new HoverView(this, grid.projection, towerData);
    this.triggerFx = new TriggerFxView(this, grid.projection, map, towerData);
    this.triggerFxOn = !triggerFxDisabled(window.location.search);
    // N liga e desliga os números de dano dos gatilhos (T16).
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      if (event.key.toLowerCase() === uiConfig.triggerFx.numbersToggleKey) {
        this.triggerFx.toggleNumbers();
      }
    };
    window.addEventListener('keydown', onKeyDown);

    this.monitor = new PerfMonitor(
      this.game,
      () => this.runner.clock.droppedTicks,
      () => this.runner.sim.state.triggers.lastTick,
    );
    this.runner.profiler = this.monitor;
    // Build de playtest: painel e trapaças só com Ctrl+Shift+D ou `?debug=1` (T17).
    this.gate = new DebugGate(import.meta.env.DEV, window.location.search);
    this.panel = new DebugPanel(this.game.canvas.parentElement ?? document.body, {
      game: this.game,
      runner: this.runner,
      monitor: this.monitor,
      enemyTypes: Object.keys(enemyData.types),
      towerTypes: Object.entries(towerData.types).map(([id, type]) => ({ id, name: type.name })),
      hoveredCell: () => grid.hoveredCell,
      selectedCell: () => grid.selectedCell,
      gate: this.gate,
    });

    const overlayParent = this.game.canvas.parentElement ?? document.body;
    this.classPanel = new ClassPanel(overlayParent);
    // A pausa congela tudo, inclusive compras: as ações do jogador são ignoradas.
    const paused = () => this.runner.paused;
    const evolveNexus = () => {
      if (!paused()) this.runner.sim.enqueue({ type: 'evolveNexus' });
    };
    this.nexusPanel = new NexusPanel(overlayParent, evolveNexus);
    this.tooltip = new TowerTooltip(overlayParent);
    this.waveHud = new WaveHud(overlayParent, {
      onCall: () => {
        if (!paused()) this.runner.sim.enqueue({ type: 'callWave' });
      },
      onCycleSpeed: () => this.runner.clock.cycleSpeed(),
      onTogglePause: () => {
        this.runner.paused = !this.runner.paused;
      },
    });
    this.help = new HelpScreen({
      parent: overlayParent,
      paused,
      setPaused: (value) => {
        this.runner.paused = value;
      },
      debugUnlocked: () => this.gate.unlocked,
    });
    this.waveHud.appendControl(this.help.toggleButton);
    this.waveAnnounce = new WaveAnnounce(overlayParent);
    this.tutorial = new Tutorial(overlayParent);
    const removeVersion = showVersionLabel(overlayParent, __APP_VERSION__);
    this.carryView = new CarryView(this, grid.projection, towerData);
    this.linkView = new LinkPreviewView(this, grid.projection);
    this.linkHint = new LinkHint(overlayParent);
    this.shop = new ShopController({
      parent: overlayParent,
      map,
      state: () => this.runner.sim.state,
      enqueue: (command) => {
        if (!paused()) this.runner.sim.enqueue(command);
      },
      evolveNexus,
      paused,
      selectedCell: () => grid.selectedCell,
      cellAtClient: (x, y) => grid.cellAtClient(x, y),
    });
    const cellOf = (towerId: number) => {
      const tower = this.runner.sim.state.towers.find((t) => t.id === towerId);
      return tower ? { x: tower.x, y: tower.y } : null;
    };
    this.towerDrag = new TowerDragController({
      parent: overlayParent,
      map,
      state: () => this.runner.sim.state,
      paused,
      enqueue: (command) => {
        if (!paused()) this.runner.sim.enqueue(command);
      },
      cellAtClient: (x, y) => grid.cellAtClient(x, y),
      // A seleção acompanha a torre arrastada (vender com S e o alcance).
      onStart: (towerId) => grid.select(cellOf(towerId)),
      onLocked: (towerId) => {
        const cell = cellOf(towerId);
        if (cell) this.towerView.showLocked(towerId, cell);
      },
    });
    // Clique no mapa com a torre presa ao mouse (teclas 1 a 5) posiciona; sem
    // ela, apertar sobre uma torre pode virar um arrasto para mover (T15).
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
      if (!pointer.leftButtonDown()) return;
      const cell = grid.cellAt(pointer);
      if (this.shop.carrying) {
        this.shop.clickCell(cell);
        return;
      }
      const tower = cell ? this.towerUnderPointer(this.runner.sim.state, cell) : undefined;
      const event = pointer.event as PointerEvent;
      if (tower) this.towerDrag.press(tower, event.clientX, event.clientY);
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.removeEndScreen?.();
      this.removeEndScreen = null;
      window.removeEventListener('keydown', onKeyDown);
      this.triggerFx.destroy();
      this.hoverView.destroy();
      this.waveHud.destroy();
      this.waveAnnounce.destroy();
      this.tutorial.destroy();
      this.linkHint.destroy();
      this.help.destroy();
      removeVersion();
      this.panel.destroy();
      this.gate.destroy();
      this.classPanel.destroy();
      this.nexusPanel.destroy();
      this.shop.destroy();
      this.tooltip.destroy();
      this.carryView.destroy();
      this.towerDrag.destroy();
      this.monitor.destroy();
    });
  }

  update(_time: number, delta: number): void {
    const events = this.runner.update(delta);
    const state = this.runner.sim.state;
    // Pausado, as animações da renderização também param.
    const frameDelta = this.runner.paused ? 0 : delta;

    this.nexusView.handleEvents(events);
    this.projectileView.handleEvents(events);
    this.towerView.handleEvents(events);
    this.handleMoveEvents(events);
    this.towerView.draw(state, this.grid.selectedCell);
    this.nexusView.draw(state, frameDelta);
    this.enemyView.draw(state, this.interpolationAlpha);
    this.projectileView.draw(state, this.interpolationAlpha, frameDelta);
    if (this.triggerFxOn) {
      this.triggerFx.handleEvents(state, events);
      this.triggerFx.draw(state, frameDelta);
    }
    this.monitor.recordCounts(state.enemies.activeCount, state.projectiles.activeCount);
    this.panel.update();
    this.classPanel.update(state.classes);
    this.nexusPanel.update(state);
    this.waveHud.update(state, { speed: this.runner.clock.speed, paused: this.runner.paused });
    this.waveAnnounce.update(
      waveAnnouncementFor(events, defaultWaveSchedules, enemyData),
      performance.now(),
    );
    this.tutorial.update(state, performance.now());
    this.shop.update();
    this.towerDrag.update();
    const carrying = this.shop.carrying;
    const dragging = this.towerDrag.dragging;
    const hovered = this.grid.hoveredCell;
    this.updateTooltip(state, carrying !== null || dragging !== null, hovered);
    let links: LinkPreview | null = null;
    let purchase: PurchasePreview | null = null;
    if (dragging) {
      // Mover: verde se a casa está livre ou tem outra torre (troca), vermelho se não.
      const valid = canDropAt(this.map, hovered);
      this.carryView.draw(dragging.towerType, hovered, valid);
      const moving = state.towers.find((t) => t.id === dragging.towerId);
      if (valid && hovered && moving) {
        // Na troca, a outra torre vai para a casa de onde esta saiu.
        const towers = state.towers.map((t) =>
          t !== moving && t.x === hovered.x && t.y === hovered.y
            ? { ...t, x: moving.x, y: moving.y }
            : t,
        );
        links = previewLinks(
          { towers },
          { type: moving.type, star: moving.star, ...hovered, movingId: moving.id },
          towerData,
          classData,
          this.map,
        );
      }
    } else {
      const valid = hovered !== null && canPlaceAt(state, this.map, hovered);
      this.carryView.draw(carrying?.towerType ?? null, hovered, valid);
      if (carrying) {
        purchase = purchasePreview(state.towers, carrying.towerType, towerData, classData);
        if (valid && hovered && !purchase?.fusion) {
          links = previewLinks(
            state,
            { type: carrying.towerType, star: 1, ...hovered, movingId: null },
            towerData,
            classData,
            this.map,
          );
        }
      }
    }
    this.linkView.draw(links);
    this.linkHint.update(carrying || dragging ? linkHintLines(links, purchase) : []);

    if (state.status !== 'playing' && !this.removeEndScreen) {
      this.help.close();
      this.removeEndScreen = showEndScreen(
        this.game.canvas.parentElement ?? document.body,
        summarizeRun(state, {
          version: __APP_VERSION__,
          totalWaves: defaultWaveSchedules.length,
          ticksPerSecond: engineConfig.ticksPerSecond,
          towerName: (type) => getTowerType(towerData, type).name,
          link: runLink(window.location.href, state.seed, debugConfig.panel.unlockParam),
        }),
        () => this.scene.restart(),
      );
    }
  }

  /**
   * Mover (T15): a seleção acompanha a torre que estava selecionada, também
   * na troca; uma recusa por trava da simulação mostra o mesmo aviso da tentativa.
   */
  private handleMoveEvents(events: readonly SimEvent[]): void {
    for (const event of events) {
      if (event.type === 'towerMoved') {
        const selected = this.grid.selectedCell;
        if (!selected) continue;
        if (selected.x === event.fromX && selected.y === event.fromY) {
          this.grid.select({ x: event.x, y: event.y });
        } else if (
          event.swappedWithId !== null &&
          selected.x === event.x &&
          selected.y === event.y
        ) {
          this.grid.select({ x: event.fromX, y: event.fromY });
        }
      } else if (event.type === 'moveRefused' && event.reason === 'locked') {
        this.towerDrag.showLocked(event.towerId);
      }
    }
  }

  /**
   * Janela "o que esta torre faz": slot da loja sob o mouse ou torre do mapa
   * (sem torre presa ao mouse). No slot, a prévia da compra (classes ou
   * fusão); na torre, com a janela aberta, o alcance e as vizinhas que ela afeta.
   */
  private updateTooltip(
    state: Readonly<RunState>,
    carrying: boolean,
    hovered: { x: number; y: number } | null,
  ): void {
    let type: string | null = null;
    let star = 1;
    let key: string | null = null;
    let tower: Tower | null = null;
    let purchase = null;
    const shopType = this.shop.hoveredTowerType;
    if (shopType !== null) {
      type = shopType;
      purchase = purchasePreview(state.towers, shopType, towerData, classData);
      key = `loja:${shopType}:${previewKey(purchase)}`;
    } else if (!carrying && hovered && this.tooltip.pointerOverCanvas) {
      tower = this.towerUnderPointer(state, hovered) ?? null;
      if (tower) {
        type = tower.type;
        star = tower.star;
        key = `torre:${tower.id}:${tower.star}`;
      }
    }
    this.tooltip.update(
      type === null ? null : describeTower(getTowerType(towerData, type), star, classData, type),
      key,
      performance.now(),
      purchase,
    );
    const shown = tower !== null && this.tooltip.visible ? tower : null;
    this.hoverView.draw(shown, shown ? affectedNeighbors(state, shown, towerData, classData) : []);
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
