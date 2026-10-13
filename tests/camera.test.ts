import { describe, expect, it } from 'vitest';
import mapData from '../src/data/map.json';
import renderConfig from '../src/data/render.json';
import {
  CameraModel,
  EdgePan,
  PanGesture,
  arrowDirection,
  clampView,
  clientToCanvas,
  edgeDirection,
  fitZoom,
  mapWorldBounds,
  screenToWorld,
  wheelNotches,
  worldToScreen,
  zoomAround,
  zoomLimits,
  type CameraConfig,
  type CameraView,
  type Rect,
} from '../src/render/camera';
import { IsoProjection, type Point } from '../src/render/iso';
import { loadMap, type GridCoord, type GridMap } from '../src/sim/grid/map';

const config: CameraConfig = renderConfig.camera;
const tile = renderConfig.tile;
const viewport = { width: 1280, height: 720 };
const map = loadMap(mapData);
const projection = IsoProjection.centered(map, tile, viewport);
const bounds = mapWorldBounds(projection, map);

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function allCells(m: { width: number; height: number }): GridCoord[] {
  const cells: GridCoord[] = [];
  for (let y = 0; y < m.height; y++) {
    for (let x = 0; x < m.width; x++) cells.push({ x, y });
  }
  return cells;
}

/** Roda a animação até parar (com quadros de 16 ms). */
function settle(camera: CameraModel, maxFrames = 1000): void {
  for (let i = 0; i < maxFrames && camera.animating; i++) camera.update(16);
}

/** Retângulo do mundo que aparece na tela. */
function visibleWorld(view: CameraView): Rect {
  const topLeft = screenToWorld(view, viewport, { x: 0, y: 0 });
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: viewport.width / view.zoom,
    height: viewport.height / view.zoom,
  };
}

/** Mapa quadrado de `size` casas, com a mesma casa e a mesma tela do jogo. */
function squareMap(size: number): { map: GridMap; projection: IsoProjection; bounds: Rect } {
  const m = loadMap({
    id: `teste-${size}`,
    width: size,
    height: size,
    path: [
      { x: 0, y: 0 },
      { x: size - 1, y: 0 },
    ],
  });
  const p = IsoProjection.centered(m, tile, viewport);
  return { map: m, projection: p, bounds: mapWorldBounds(p, m) };
}

const EPS = 1e-6;

describe('câmera: dados e limites', () => {
  it('os números estão em render.json → camera, com mínimo ≤ padrão ≤ máximo', () => {
    expect(config.zoom.min).toBe(0.75);
    expect(config.zoom.default).toBe(1);
    expect(config.zoom.max).toBe(3);
    expect(config.zoom.wheelStep).toBe(1.2);
    expect(config.marginPx).toBe(180);
    expect(config.keyPanSpeedPx).toBe(800);
    expect(config.resetMs).toBe(200);
    expect(config.edgePan).toEqual({ bandPx: 32, speedPx: 600 });
  });

  it('o retângulo do mapa 14×14 no mundo é a caixa do losango, centralizada na tela', () => {
    expect(bounds.width).toBe(((map.width + map.height) * tile.width) / 2);
    expect(bounds.height).toBe(((map.width + map.height) * tile.height) / 2);
    expect(bounds.x + bounds.width / 2).toBe(viewport.width / 2);
    expect(bounds.y + bounds.height / 2).toBe(viewport.height / 2);
    // Toda casa fica dentro do retângulo.
    for (const cell of allCells(map)) {
      for (const v of projection.diamond(cell)) {
        expect(v.x).toBeGreaterThanOrEqual(bounds.x);
        expect(v.x).toBeLessThanOrEqual(bounds.x + bounds.width);
        expect(v.y).toBeGreaterThanOrEqual(bounds.y);
        expect(v.y).toBeLessThanOrEqual(bounds.y + bounds.height);
      }
    }
  });

  it('zoom padrão = enquadramento de hoje: a tela e o mundo coincidem, mapa centralizado', () => {
    const camera = new CameraModel(config, viewport, bounds);
    expect(camera.zoomLimits).toEqual({ min: 0.75, default: 1, max: 3 });
    expect(camera.view).toEqual({ zoom: 1, centerX: 640, centerY: 360 });
    for (const p of [
      { x: 0, y: 0 },
      { x: 333, y: 517 },
      { x: 1280, y: 720 },
    ]) {
      expect(camera.screenToWorld(p)).toEqual(p);
      expect(camera.worldToScreen(p)).toEqual(p);
    }
  });

  it('a rodinha não passa do mínimo (0,75) nem do máximo (3)', () => {
    const camera = new CameraModel(config, viewport, bounds);
    camera.wheel(-50, { x: 640, y: 360 });
    settle(camera);
    expect(camera.view.zoom).toBe(3);
    camera.wheel(50, { x: 640, y: 360 });
    settle(camera);
    expect(camera.view.zoom).toBe(0.75);
  });

  it('cada dente multiplica o zoom por 1,2 (positivo afasta, negativo aproxima)', () => {
    const camera = new CameraModel(config, viewport, bounds);
    camera.wheel(-1, { x: 640, y: 360 });
    settle(camera);
    expect(camera.view.zoom).toBeCloseTo(1.2, 9);
    camera.wheel(-2, { x: 640, y: 360 });
    settle(camera);
    expect(camera.view.zoom).toBeCloseTo(1.2 ** 3, 9);
    camera.wheel(1, { x: 640, y: 360 });
    settle(camera);
    expect(camera.view.zoom).toBeCloseTo(1.2 ** 2, 9);
  });

  it('no máximo, a tela não passa da margem de 180 px além do mapa, em nenhum lado', () => {
    const camera = new CameraModel(config, viewport, bounds);
    camera.wheel(-50, { x: 640, y: 360 });
    settle(camera);
    const margin = config.marginPx / 3;
    for (const [dx, dy] of [
      [1e5, 0],
      [-1e5, 0],
      [0, 1e5],
      [0, -1e5],
      [1e5, 1e5],
      [-1e5, -1e5],
    ] as const) {
      camera.dragBy(dx, dy);
      const seen = visibleWorld(camera.view);
      expect(seen.x).toBeGreaterThanOrEqual(bounds.x - margin - EPS);
      expect(seen.y).toBeGreaterThanOrEqual(bounds.y - margin - EPS);
      expect(seen.x + seen.width).toBeLessThanOrEqual(bounds.x + bounds.width + margin + EPS);
      expect(seen.y + seen.height).toBeLessThanOrEqual(bounds.y + bounds.height + margin + EPS);
    }
    // Arrastado até o canto de cima à esquerda: a borda do mapa fica a 180 px de tela da borda.
    camera.dragBy(1e5, 1e5);
    const corner = camera.worldToScreen({ x: bounds.x, y: bounds.y });
    expect(corner.x).toBeCloseTo(config.marginPx, 6);
    expect(corner.y).toBeCloseTo(config.marginPx, 6);
  });

  it('com o mapa menor que a tela (mais a margem), o eixo fica centralizado e não anda', () => {
    const camera = new CameraModel(config, viewport, bounds);
    camera.wheel(5, { x: 100, y: 100 });
    settle(camera);
    expect(camera.view.zoom).toBe(0.75);
    camera.dragBy(500, -500);
    expect(camera.view.centerX).toBe(640);
    expect(camera.view.centerY).toBe(360);
  });

  it('no zoom 1 a tela não anda na horizontal e anda até 44 px na vertical', () => {
    const camera = new CameraModel(config, viewport, bounds);
    camera.dragBy(500, 500);
    expect(camera.view.centerX).toBe(640);
    // (448 + 2 × 180 − 720) / 2 = 44 px de folga para cada lado.
    expect(camera.view.centerY).toBeCloseTo(360 - 44, 9);
    camera.dragBy(0, -1000);
    expect(camera.view.centerY).toBeCloseTo(360 + 44, 9);
  });

  it('clampView limita o zoom e centraliza um eixo menor que a tela', () => {
    const limits = { min: 0.75, default: 1, max: 3 };
    expect(
      clampView({ zoom: 10, centerX: 640, centerY: 360 }, bounds, viewport, 0, limits).zoom,
    ).toBe(3);
    expect(
      clampView({ zoom: 0.1, centerX: 9999, centerY: -9999 }, bounds, viewport, 0, limits),
    ).toEqual({ zoom: 0.75, centerX: 640, centerY: 360 });
  });
});

describe('câmera: zoom em volta de um ponto', () => {
  const anchors: Point[] = [
    { x: 640, y: 360 },
    { x: 200, y: 150 },
    { x: 1100, y: 600 },
    { x: 0, y: 720 },
  ];

  it('zoomAround mantém parado o ponto do mundo sob o mouse (mínimo, padrão e máximo)', () => {
    const start: CameraView = { zoom: 1.5, centerX: 700, centerY: 300 };
    for (const anchor of anchors) {
      const before = screenToWorld(start, viewport, anchor);
      for (const zoom of [0.75, 1, 3]) {
        const after = zoomAround(start, zoom, anchor, viewport);
        const world = screenToWorld(after, viewport, anchor);
        expect(after.zoom).toBe(zoom);
        expect(world.x).toBeCloseTo(before.x, 9);
        expect(world.y).toBeCloseTo(before.y, 9);
      }
    }
  });

  it('o zoom suave aproxima no ponto do mouse: a casa sob o mouse continua sob o mouse', () => {
    for (const anchor of [
      { x: 640, y: 360 },
      { x: 500, y: 300 },
      { x: 760, y: 420 },
    ]) {
      const camera = new CameraModel(config, viewport, bounds);
      const target = camera.screenToWorld(anchor);
      camera.wheel(-6, anchor); // 1 → 2,99
      for (let frame = 0; frame < 60 && camera.animating; frame++) {
        camera.update(16);
        const world = camera.screenToWorld(anchor);
        expect(world.x).toBeCloseTo(target.x, 6);
        expect(world.y).toBeCloseTo(target.y, 6);
      }
      expect(camera.animating).toBe(false);
      expect(camera.view.zoom).toBeCloseTo(1.2 ** 6, 9);
    }
  });

  it('o zoom suave chega a ~95% do caminho em smoothMs e depois encosta no alvo', () => {
    const camera = new CameraModel(config, viewport, bounds);
    camera.wheel(-4, { x: 640, y: 360 });
    const target = 1.2 ** 4;
    const frames = config.zoom.smoothMs / 10;
    for (let i = 0; i < frames; i++) camera.update(10);
    const progress = Math.log(camera.view.zoom) / Math.log(target);
    expect(progress).toBeGreaterThan(0.94);
    expect(progress).toBeLessThan(1);
    expect(camera.animating).toBe(true);
    settle(camera);
    expect(camera.view.zoom).toBe(target);
  });

  it('dentes seguidos durante a animação somam no alvo', () => {
    const camera = new CameraModel(config, viewport, bounds);
    camera.wheel(-1, { x: 640, y: 360 });
    camera.update(16);
    camera.wheel(-1, { x: 640, y: 360 });
    settle(camera);
    expect(camera.view.zoom).toBeCloseTo(1.44, 9);
  });
});

describe('câmera: volta ao padrão (botão do meio)', () => {
  it('volta ao zoom padrão com o mapa centralizado, com animação de 200 ms', () => {
    const camera = new CameraModel(config, viewport, bounds);
    camera.wheel(-6, { x: 900, y: 200 });
    settle(camera);
    camera.dragBy(-300, 120);
    const moved = camera.view;
    expect(moved.zoom).toBeCloseTo(1.2 ** 6, 6);

    camera.reset();
    camera.update(config.resetMs / 2);
    const middle = camera.view;
    expect(middle.zoom).toBeLessThan(moved.zoom);
    expect(middle.zoom).toBeGreaterThan(1);
    expect(camera.animating).toBe(true);

    camera.update(config.resetMs / 2);
    expect(camera.animating).toBe(false);
    expect(camera.view).toEqual(camera.defaultView());
    expect(camera.view).toEqual({ zoom: 1, centerX: 640, centerY: 360 });
  });

  it('a volta parte do zoom mínimo também', () => {
    const camera = new CameraModel(config, viewport, bounds);
    camera.wheel(10, { x: 100, y: 600 });
    settle(camera);
    camera.reset();
    settle(camera);
    expect(camera.view).toEqual({ zoom: 1, centerX: 640, centerY: 360 });
  });

  it('mexer na câmera durante a volta interrompe a animação', () => {
    const camera = new CameraModel(config, viewport, bounds);
    camera.wheel(-6, { x: 640, y: 360 });
    settle(camera);
    camera.reset();
    camera.update(50);
    camera.dragBy(10, 0);
    expect(camera.animating).toBe(false);
    const stopped = camera.view;
    camera.update(500);
    expect(camera.view).toEqual(stopped);
  });
});

describe('câmera: tela → casa', () => {
  /** Vistas a testar: zoom mínimo, padrão e máximo, parado e deslocado. */
  function views(): { name: string; camera: CameraModel }[] {
    const out: { name: string; camera: CameraModel }[] = [];
    for (const notches of [10, 0, -10]) {
      for (const drag of [
        { x: 0, y: 0 },
        { x: 250, y: -130 },
        { x: -400, y: 220 },
      ]) {
        const camera = new CameraModel(config, viewport, bounds);
        if (notches !== 0) camera.wheel(notches, { x: 400, y: 250 });
        settle(camera);
        camera.dragBy(drag.x, drag.y);
        out.push({ name: `zoom ${camera.view.zoom} arrasto ${drag.x},${drag.y}`, camera });
      }
    }
    return out;
  }

  it('cobre o mínimo, o padrão e o máximo, e o máximo deslocado anda de verdade', () => {
    const all = views();
    expect(new Set(all.map((v) => v.camera.view.zoom))).toEqual(new Set([0.75, 1, 3]));
    const maxMoved = all.filter((v) => v.camera.view.zoom === 3).map((v) => v.camera.view);
    expect(new Set(maxMoved.map((v) => `${v.centerX},${v.centerY}`)).size).toBe(3);
  });

  it('o centro de cada casa na tela volta para a mesma casa, em todos os zooms e deslocamentos', () => {
    for (const { name, camera } of views()) {
      for (const cell of allCells(map)) {
        const screen = camera.worldToScreen(projection.toScreen(cell));
        expect(projection.toGrid(camera.screenToWorld(screen), map), name).toEqual(cell);
      }
    }
  });

  it('logo dentro de cada vértice do losango (na tela) continua na mesma casa', () => {
    for (const { name, camera } of views()) {
      for (const cell of allCells(map)) {
        const center = camera.worldToScreen(projection.toScreen(cell));
        for (const vertex of projection.diamond(cell)) {
          const v = camera.worldToScreen(vertex);
          expect(projection.toGrid(camera.screenToWorld(lerp(center, v, 0.98)), map), name).toEqual(
            cell,
          );
        }
      }
    }
  });

  it('com o canvas esticado pelo navegador, o ponto do navegador cai na mesma casa', () => {
    // Canvas de 1280×720 mostrado em 1600×900 a partir de (40, 30).
    const rect = { x: 40, y: 30, width: 1600, height: 900 };
    for (const { name, camera } of views()) {
      for (const cell of [
        { x: 0, y: 0 },
        { x: 7, y: 7 },
        { x: 13, y: 2 },
        { x: 4, y: 12 },
      ]) {
        const screen = camera.worldToScreen(projection.toScreen(cell));
        const client = { x: 40 + screen.x * 1.25, y: 30 + screen.y * 1.25 };
        const canvas = clientToCanvas(client.x, client.y, rect, viewport)!;
        expect(canvas.x).toBeCloseTo(screen.x, 9);
        expect(canvas.y).toBeCloseTo(screen.y, 9);
        expect(projection.toGrid(camera.screenToWorld(canvas), map), name).toEqual(cell);
      }
    }
    expect(clientToCanvas(10, 10, { x: 0, y: 0, width: 0, height: 0 }, viewport)).toBeNull();
  });

  it('worldToScreen e screenToWorld são inversas', () => {
    const view: CameraView = { zoom: 2.3, centerX: 512, centerY: 401 };
    const p = { x: 123.5, y: 678.25 };
    const back = screenToWorld(view, viewport, worldToScreen(view, viewport, p));
    expect(back.x).toBeCloseTo(p.x, 9);
    expect(back.y).toBeCloseTo(p.y, 9);
  });
});

describe('câmera: mapa que cresce', () => {
  it('mapa 40×40: o padrão e o mínimo descem até o mapa inteiro caber na tela', () => {
    const big = squareMap(40);
    const fit = fitZoom(big.bounds, viewport);
    expect(fit).toBe(0.5); // 2.560×1.280 no mundo
    const camera = new CameraModel(config, viewport, big.bounds);
    expect(camera.zoomLimits).toEqual({ min: 0.5, default: 0.5, max: 3 });
    // No padrão (e no mínimo) o mapa inteiro aparece.
    const seen = visibleWorld(camera.view);
    expect(seen.x).toBeLessThanOrEqual(big.bounds.x + EPS);
    expect(seen.y).toBeLessThanOrEqual(big.bounds.y + EPS);
    expect(seen.x + seen.width).toBeGreaterThanOrEqual(big.bounds.x + big.bounds.width - EPS);
    expect(seen.y + seen.height).toBeGreaterThanOrEqual(big.bounds.y + big.bounds.height - EPS);
    // Afastar ao máximo não passa do zoom que mostra o mapa todo.
    camera.wheel(30, { x: 640, y: 360 });
    settle(camera);
    expect(camera.view.zoom).toBe(0.5);
    // Aproximar e voltar ao padrão.
    camera.wheel(-30, { x: 640, y: 360 });
    settle(camera);
    expect(camera.view.zoom).toBe(3);
    camera.reset();
    settle(camera);
    expect(camera.view).toEqual(camera.defaultView());
    expect(camera.view.zoom).toBe(0.5);
  });

  it('mapa 40×40 no zoom máximo: tela → casa continua certa nos cantos do mapa', () => {
    const big = squareMap(40);
    const camera = new CameraModel(config, viewport, big.bounds);
    camera.wheel(-30, { x: 640, y: 360 });
    settle(camera);
    for (const drag of [
      { x: 1e5, y: 1e5 },
      { x: -1e5, y: 1e5 },
      { x: -1e5, y: -1e5 },
    ]) {
      camera.dragBy(drag.x, drag.y);
      for (const cell of allCells(big.map)) {
        const screen = camera.worldToScreen(big.projection.toScreen(cell));
        if (screen.x < 0 || screen.y < 0 || screen.x > 1280 || screen.y > 720) continue;
        expect(big.projection.toGrid(camera.screenToWorld(screen), big.map)).toEqual(cell);
      }
    }
  });

  it('mapa um pouco maior que a tela: o padrão desce e o mínimo continua 0,75', () => {
    const medium = squareMap(22); // 1.408×704
    const limits = zoomLimits(config.zoom, medium.bounds, viewport);
    expect(limits.default).toBeCloseTo(1280 / 1408, 9);
    expect(limits.min).toBe(0.75);
    expect(limits.max).toBe(3);
  });

  it('setBounds (o mapa cresceu) refaz os limites e mantém a vista dentro deles', () => {
    const camera = new CameraModel(config, viewport, bounds);
    camera.wheel(10, { x: 640, y: 360 });
    settle(camera);
    expect(camera.view.zoom).toBe(0.75);
    const big = squareMap(40);
    camera.setBounds(big.bounds);
    expect(camera.zoomLimits.min).toBe(0.5);
    expect(camera.view.zoom).toBe(0.75);
    camera.wheel(10, { x: 640, y: 360 });
    settle(camera);
    expect(camera.view.zoom).toBe(0.5);
  });
});

describe('câmera: setas, borda e botão direito', () => {
  it('setas: as opostas se anulam', () => {
    expect(arrowDirection(new Set(['ArrowRight']))).toEqual({ x: 1, y: 0 });
    expect(arrowDirection(new Set(['ArrowLeft', 'ArrowUp']))).toEqual({ x: -1, y: -1 });
    expect(arrowDirection(new Set(['ArrowLeft', 'ArrowRight', 'ArrowDown']))).toEqual({
      x: 0,
      y: 1,
    });
    expect(arrowDirection(new Set(['a', 's']))).toEqual({ x: 0, y: 0 });
  });

  it('setas andam 800 px de tela por segundo em qualquer zoom (diagonal normalizada)', () => {
    for (const notches of [-3, -6]) {
      const camera = new CameraModel(config, viewport, bounds);
      camera.wheel(notches, { x: 640, y: 360 });
      settle(camera);
      // Um ponto do mundo no centro da tela anda 80 px para a esquerda em 100 ms.
      const world = camera.screenToWorld({ x: 640, y: 360 });
      camera.move({ x: 1, y: 0 }, config.keyPanSpeedPx, 100);
      const after = camera.worldToScreen(world);
      expect(after.x).toBeCloseTo(640 - 80, 6);
      expect(after.y).toBeCloseTo(360, 6);
      // Na diagonal, o deslocamento total também é 80 px.
      const world2 = camera.screenToWorld({ x: 640, y: 360 });
      camera.move({ x: -1, y: -1 }, config.keyPanSpeedPx, 100);
      const after2 = camera.worldToScreen(world2);
      expect(Math.hypot(after2.x - 640, after2.y - 360)).toBeCloseTo(80, 6);
    }
  });

  it('arrastar com o direito: o mundo acompanha o mouse', () => {
    const camera = new CameraModel(config, viewport, bounds);
    camera.wheel(-6, { x: 640, y: 360 });
    settle(camera);
    const world = camera.screenToWorld({ x: 600, y: 300 });
    camera.dragBy(40, -25);
    const after = camera.worldToScreen(world);
    expect(after.x).toBeCloseTo(640, 6);
    expect(after.y).toBeCloseTo(275, 6);
  });

  it('borda: direção por eixo, e fora da tela conta como borda', () => {
    const band = config.edgePan.bandPx;
    expect(edgeDirection({ x: 640, y: 360 }, viewport, band)).toEqual({ x: 0, y: 0 });
    expect(edgeDirection({ x: 10, y: 360 }, viewport, band)).toEqual({ x: -1, y: 0 });
    expect(edgeDirection({ x: 1275, y: 715 }, viewport, band)).toEqual({ x: 1, y: 1 });
    expect(edgeDirection({ x: 2000, y: -50 }, viewport, band)).toEqual({ x: 1, y: -1 });
  });

  it('borda com a torre na mão: só anda depois que o mouse saiu da faixa uma vez', () => {
    const band = config.edgePan.bandPx;
    const edge = new EdgePan();
    const bottom = { x: 640, y: 710 };
    // Arrasto da loja: começa colado na borda de baixo, não anda.
    expect(edge.update(true, bottom, viewport, band)).toEqual({ x: 0, y: 0 });
    expect(edge.update(true, { x: 640, y: 500 }, viewport, band)).toEqual({ x: 0, y: 0 });
    // Depois de sair da faixa, voltar para a borda anda.
    expect(edge.update(true, bottom, viewport, band)).toEqual({ x: 0, y: 1 });
    // Sem torre na mão, nunca anda e desarma.
    expect(edge.update(false, bottom, viewport, band)).toEqual({ x: 0, y: 0 });
    expect(edge.update(true, bottom, viewport, band)).toEqual({ x: 0, y: 0 });
    expect(edge.update(true, null, viewport, band)).toEqual({ x: 0, y: 0 });
  });

  it('borda move a câmera a 600 px de tela por segundo', () => {
    const camera = new CameraModel(config, viewport, bounds);
    camera.wheel(-6, { x: 640, y: 360 });
    settle(camera);
    const world = camera.screenToWorld({ x: 640, y: 360 });
    camera.move({ x: 0, y: -1 }, config.edgePan.speedPx, 50);
    expect(camera.worldToScreen(world).y).toBeCloseTo(360 + 30, 6);
  });

  it('botão direito: abaixo do limiar é clique; acima, arrasta desde o aperto', () => {
    const threshold = config.dragThresholdPx;
    const gesture = new PanGesture();
    expect(gesture.active).toBe(false);
    expect(gesture.release()).toBeNull();

    gesture.press({ x: 100, y: 100 });
    expect(gesture.active).toBe(true);
    expect(gesture.move({ x: 103, y: 104 }, threshold)).toEqual({ x: 0, y: 0 });
    expect(gesture.panning).toBe(false);
    expect(gesture.release()).toBe('click');
    expect(gesture.active).toBe(false);

    gesture.press({ x: 100, y: 100 });
    expect(gesture.move({ x: 110, y: 100 }, threshold)).toEqual({ x: 10, y: 0 });
    expect(gesture.panning).toBe(true);
    expect(gesture.move({ x: 112, y: 95 }, threshold)).toEqual({ x: 2, y: -5 });
    expect(gesture.release()).toBe('drag');

    gesture.press({ x: 0, y: 0 });
    gesture.cancel();
    expect(gesture.active).toBe(false);
    expect(gesture.move({ x: 50, y: 50 }, threshold)).toEqual({ x: 0, y: 0 });
  });

  it('rodinha: pixels, linhas e páginas viram dentes', () => {
    expect(wheelNotches(100, 0, config.zoom)).toBe(1);
    expect(wheelNotches(-250, 0, config.zoom)).toBe(-2.5);
    expect(wheelNotches(3, 1, config.zoom)).toBe(1);
    expect(wheelNotches(-1, 2, config.zoom)).toBe(-1);
  });
});
