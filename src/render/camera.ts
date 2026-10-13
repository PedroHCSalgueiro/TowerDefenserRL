/**
 * Câmera do mundo (T25): zoom e deslocamento.
 *
 * Matemática pura, sem Phaser, para ser testada no Vitest. A câmera é estado
 * da renderização e da interface: não entra no save e não muda a simulação.
 *
 * O "mundo" é o da projeção isométrica (`iso.ts`): no zoom 1 ele coincide com
 * a tela de hoje. A vista (`CameraView`) é o ponto do mundo no centro da tela
 * e o zoom (pixels de tela por pixel do mundo). Os limites vêm do retângulo
 * do mapa no mundo, com uma margem em pixels de tela (para tirar o mapa de
 * baixo dos painéis), e o zoom padrão e o mínimo descem quando o mapa inteiro
 * não cabe na tela (mapa que cresce em salas).
 */

import type { IsoProjection, Point, Size } from './iso';

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** `render.json` → `camera`. */
export interface CameraConfig {
  readonly zoom: {
    readonly min: number;
    readonly default: number;
    readonly max: number;
    /** Cada dente da rodinha multiplica (ou divide) o zoom por este fator. */
    readonly wheelStep: number;
    /** `deltaY` de um dente quando o navegador manda pixels. */
    readonly wheelNotchPx: number;
    /** `deltaY` de um dente quando o navegador manda linhas. */
    readonly wheelLinesPerNotch: number;
    /** Tempo para o zoom suave chegar a ~95% do alvo. */
    readonly smoothMs: number;
  };
  /** Duração da volta ao padrão (botão do meio). */
  readonly resetMs: number;
  /** Margem além do mapa, em pixels de tela, em cada lado. */
  readonly marginPx: number;
  /** Setas: pixels de tela por segundo. */
  readonly keyPanSpeedPx: number;
  /** Botão direito: acima disto é arrasto da tela; abaixo, clique. */
  readonly dragThresholdPx: number;
  readonly edgePan: {
    /** Faixa da borda da tela, em pixels de tela. */
    readonly bandPx: number;
    /** Pixels de tela por segundo. */
    readonly speedPx: number;
  };
}

export interface CameraView {
  /** Pixels de tela por pixel do mundo. */
  readonly zoom: number;
  /** Ponto do mundo no centro da tela. */
  readonly centerX: number;
  readonly centerY: number;
}

export interface ZoomLimits {
  readonly min: number;
  readonly default: number;
  readonly max: number;
}

const ZERO: Point = { x: 0, y: 0 };
/** Diferença de zoom (em log) abaixo da qual o zoom suave encosta no alvo. */
const ZOOM_SNAP = 0.001;

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Interpolação do zoom em escala logarítmica (cada passo multiplica igual). */
function lerpZoom(a: number, b: number, t: number): number {
  return Math.exp(lerp(Math.log(a), Math.log(b), t));
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

/**
 * Retângulo do mapa no mundo: a caixa dos losangos de todas as casas. A
 * casa (0,0) dá o topo, (w−1,0) a direita, (w−1,h−1) a base e (0,h−1) a esquerda.
 */
export function mapWorldBounds(
  projection: IsoProjection,
  map: { readonly width: number; readonly height: number },
): Rect {
  const top = projection.diamond({ x: 0, y: 0 })[0];
  const right = projection.diamond({ x: map.width - 1, y: 0 })[1];
  const bottom = projection.diamond({ x: map.width - 1, y: map.height - 1 })[2];
  const left = projection.diamond({ x: 0, y: map.height - 1 })[3];
  return { x: left.x, y: top.y, width: right.x - left.x, height: bottom.y - top.y };
}

/** Zoom em que o mapa inteiro cabe na tela. */
export function fitZoom(bounds: Rect, viewport: Size): number {
  return Math.min(viewport.width / bounds.width, viewport.height / bounds.height);
}

/**
 * Limites do zoom para este mapa: o padrão é o menor entre o dos dados e o que
 * cabe o mapa inteiro, e o mínimo também (o jogador sempre consegue ver o mapa todo).
 */
export function zoomLimits(zoom: CameraConfig['zoom'], bounds: Rect, viewport: Size): ZoomLimits {
  const fit = fitZoom(bounds, viewport);
  return {
    min: Math.min(zoom.min, fit),
    default: Math.min(zoom.default, fit),
    max: zoom.max,
  };
}

/** Ponto do mundo sob o ponto da tela. */
export function screenToWorld(view: CameraView, viewport: Size, point: Point): Point {
  return {
    x: view.centerX + (point.x - viewport.width / 2) / view.zoom,
    y: view.centerY + (point.y - viewport.height / 2) / view.zoom,
  };
}

/** Ponto da tela onde aparece o ponto do mundo. */
export function worldToScreen(view: CameraView, viewport: Size, point: Point): Point {
  return {
    x: (point.x - view.centerX) * view.zoom + viewport.width / 2,
    y: (point.y - view.centerY) * view.zoom + viewport.height / 2,
  };
}

/** Troca o zoom mantendo parado o ponto do mundo que está sob `anchor` (tela). */
export function zoomAround(
  view: CameraView,
  zoom: number,
  anchor: Point,
  viewport: Size,
): CameraView {
  const world = screenToWorld(view, viewport, anchor);
  return {
    zoom,
    centerX: world.x - (anchor.x - viewport.width / 2) / zoom,
    centerY: world.y - (anchor.y - viewport.height / 2) / zoom,
  };
}

/**
 * Um eixo do limite: a tela não passa da margem além do mapa. Se a tela é
 * maior que o mapa com a margem, o mapa fica centralizado nesse eixo.
 */
function clampAxis(
  center: number,
  start: number,
  length: number,
  viewportLength: number,
  marginPx: number,
  zoom: number,
): number {
  const margin = marginPx / zoom;
  const half = viewportLength / zoom / 2;
  const lo = start - margin + half;
  const hi = start + length + margin - half;
  return lo >= hi ? start + length / 2 : clamp(center, lo, hi);
}

/** A vista dentro dos limites: zoom entre o mínimo e o máximo e a tela sem sair do mapa. */
export function clampView(
  view: CameraView,
  bounds: Rect,
  viewport: Size,
  marginPx: number,
  limits: ZoomLimits,
): CameraView {
  const zoom = clamp(view.zoom, limits.min, limits.max);
  return {
    zoom,
    centerX: clampAxis(view.centerX, bounds.x, bounds.width, viewport.width, marginPx, zoom),
    centerY: clampAxis(view.centerY, bounds.y, bounds.height, viewport.height, marginPx, zoom),
  };
}

/** Dentes da rodinha num evento `wheel` (positivo = afastar, como o `deltaY`). */
export function wheelNotches(
  deltaY: number,
  deltaMode: number,
  zoom: Pick<CameraConfig['zoom'], 'wheelNotchPx' | 'wheelLinesPerNotch'>,
): number {
  if (deltaMode === 1) return deltaY / zoom.wheelLinesPerNotch; // linhas
  if (deltaMode === 2) return deltaY; // páginas
  return deltaY / zoom.wheelNotchPx; // pixels
}

/** Direção das setas seguradas (`event.key`); as opostas se anulam. */
export function arrowDirection(held: ReadonlySet<string>): Point {
  const x = (held.has('ArrowRight') ? 1 : 0) - (held.has('ArrowLeft') ? 1 : 0);
  const y = (held.has('ArrowDown') ? 1 : 0) - (held.has('ArrowUp') ? 1 : 0);
  return { x, y };
}

/** Direção da borda da tela sob o ponto (−1, 0 ou 1 por eixo); fora da tela conta como borda. */
export function edgeDirection(point: Point, viewport: Size, bandPx: number): Point {
  return {
    x: point.x < bandPx ? -1 : point.x > viewport.width - bandPx ? 1 : 0,
    y: point.y < bandPx ? -1 : point.y > viewport.height - bandPx ? 1 : 0,
  };
}

/** Ponto do navegador (`clientX`, `clientY`) em pixels do canvas, que pode estar esticado. */
export function clientToCanvas(
  clientX: number,
  clientY: number,
  rect: Rect,
  canvas: Size,
): Point | null {
  if (rect.width === 0 || rect.height === 0) return null;
  return {
    x: (clientX - rect.x) * (canvas.width / rect.width),
    y: (clientY - rect.y) * (canvas.height / rect.height),
  };
}

/**
 * Borda da tela com uma torre na mão: move a câmera só depois que o mouse
 * saiu da faixa uma vez (o arrasto da loja começa colado na borda de baixo).
 */
export class EdgePan {
  private armed = false;

  /** Chame a cada quadro; devolve a direção do movimento (0,0 = parado). */
  update(holding: boolean, pointer: Point | null, viewport: Size, bandPx: number): Point {
    if (!holding || pointer === null) {
      this.armed = false;
      return ZERO;
    }
    const dir = edgeDirection(pointer, viewport, bandPx);
    if (dir.x === 0 && dir.y === 0) {
      this.armed = true;
      return ZERO;
    }
    return this.armed ? dir : ZERO;
  }
}

/**
 * Gesto do botão direito: abaixo do limiar é um clique (cancela a torre presa
 * ao mouse); acima, arrasta a tela, e o mundo acompanha o mouse.
 */
export class PanGesture {
  private start: Point | null = null;
  private last: Point = ZERO;
  private dragging = false;

  /** Botão direito apertado (o gesto começou no mapa e não foi solto). */
  get active(): boolean {
    return this.start !== null;
  }

  /** Já passou do limiar: está arrastando a tela. */
  get panning(): boolean {
    return this.dragging;
  }

  press(point: Point): void {
    this.start = point;
    this.last = point;
    this.dragging = false;
  }

  /**
   * Mouse andou com o botão apertado. Devolve quanto a tela anda (pixels de
   * tela); ao passar do limiar, já inclui o caminho desde o aperto.
   */
  move(point: Point, thresholdPx: number): Point {
    const start = this.start;
    if (start === null) return ZERO;
    if (!this.dragging) {
      if (Math.hypot(point.x - start.x, point.y - start.y) <= thresholdPx) return ZERO;
      this.dragging = true;
    }
    const delta = { x: point.x - this.last.x, y: point.y - this.last.y };
    this.last = point;
    return delta;
  }

  /** Botão solto: `click` (não passou do limiar), `drag` ou `null` (sem gesto). */
  release(): 'click' | 'drag' | null {
    if (this.start === null) return null;
    const result = this.dragging ? 'drag' : 'click';
    this.cancel();
    return result;
  }

  cancel(): void {
    this.start = null;
    this.dragging = false;
  }
}

/**
 * Estado da câmera: a vista atual, o zoom suave da rodinha e a volta ao
 * padrão. Toda mudança passa pelos limites. Os tempos são do relógio real
 * (a câmera funciona com o jogo pausado).
 */
export class CameraModel {
  private readonly config: CameraConfig;
  private readonly viewport: Size;
  private bounds: Rect;
  private limits: ZoomLimits;
  private current: CameraView;
  /** Zoom suave: alvo e ponto da tela que fica parado. */
  private zoomTarget: { zoom: number; anchor: Point } | null = null;
  /** Volta ao padrão: vista de partida e tempo passado. */
  private resetAnim: { from: CameraView; elapsedMs: number } | null = null;

  constructor(config: CameraConfig, viewport: Size, bounds: Rect) {
    this.config = config;
    this.viewport = { width: viewport.width, height: viewport.height };
    this.bounds = bounds;
    this.limits = zoomLimits(config.zoom, bounds, this.viewport);
    this.current = this.defaultView();
  }

  get view(): CameraView {
    return this.current;
  }

  get zoomLimits(): ZoomLimits {
    return this.limits;
  }

  /** Zoom suave ou volta ao padrão em andamento. */
  get animating(): boolean {
    return this.zoomTarget !== null || this.resetAnim !== null;
  }

  /** O mapa mudou de tamanho (salas): refaz os limites e mantém a vista dentro deles. */
  setBounds(bounds: Rect): void {
    this.bounds = bounds;
    this.limits = zoomLimits(this.config.zoom, bounds, this.viewport);
    this.zoomTarget = null;
    this.current = this.clamp(this.current);
  }

  /** Zoom padrão com o mapa centralizado. */
  defaultView(): CameraView {
    return this.clamp({
      zoom: this.limits.default,
      centerX: this.bounds.x + this.bounds.width / 2,
      centerY: this.bounds.y + this.bounds.height / 2,
    });
  }

  screenToWorld(point: Point): Point {
    return screenToWorld(this.current, this.viewport, point);
  }

  worldToScreen(point: Point): Point {
    return worldToScreen(this.current, this.viewport, point);
  }

  /** Rodinha: `notches` dentes (positivo = afastar) em volta do ponto `anchor` da tela. */
  wheel(notches: number, anchor: Point): void {
    if (notches === 0) return;
    this.resetAnim = null;
    const base = this.zoomTarget?.zoom ?? this.current.zoom;
    const zoom = clamp(
      base * this.config.zoom.wheelStep ** -notches,
      this.limits.min,
      this.limits.max,
    );
    this.zoomTarget = { zoom, anchor };
  }

  /** Arrasto da tela: o mundo acompanha o mouse (`dx`, `dy` em pixels de tela). */
  dragBy(dx: number, dy: number): void {
    if (dx === 0 && dy === 0) return;
    this.resetAnim = null;
    const { zoom } = this.current;
    this.current = this.clamp({
      zoom,
      centerX: this.current.centerX - dx / zoom,
      centerY: this.current.centerY - dy / zoom,
    });
  }

  /**
   * Anda na direção (`dir`, cada eixo de −1 a 1; a diagonal é normalizada) a
   * `speedPx` pixels de tela por segundo, durante `dtMs`.
   */
  move(dir: Point, speedPx: number, dtMs: number): void {
    const length = Math.hypot(dir.x, dir.y);
    if (length === 0 || dtMs <= 0) return;
    this.resetAnim = null;
    const step = (speedPx * dtMs) / 1000 / length;
    this.dragBy(-dir.x * step, -dir.y * step);
  }

  /** Botão do meio: volta ao padrão com uma animação de `resetMs`. */
  reset(): void {
    this.zoomTarget = null;
    this.resetAnim = { from: this.current, elapsedMs: 0 };
  }

  /** Chame a cada quadro com o tempo real passado. */
  update(dtMs: number): void {
    if (this.zoomTarget) {
      const { zoom: target, anchor } = this.zoomTarget;
      // Aproximação exponencial: ~95% do caminho em `smoothMs`.
      const k = 1 - Math.exp((-3 * Math.max(0, dtMs)) / this.config.zoom.smoothMs);
      let zoom = lerpZoom(this.current.zoom, target, k);
      if (Math.abs(Math.log(zoom / target)) < ZOOM_SNAP) {
        zoom = target;
        this.zoomTarget = null;
      }
      this.current = this.clamp(zoomAround(this.current, zoom, anchor, this.viewport));
    }
    if (this.resetAnim) {
      const anim = this.resetAnim;
      anim.elapsedMs += Math.max(0, dtMs);
      const t = Math.min(1, anim.elapsedMs / this.config.resetMs);
      const to = this.defaultView();
      if (t >= 1) {
        this.current = to;
        this.resetAnim = null;
      } else {
        const e = easeOutCubic(t);
        this.current = this.clamp({
          zoom: lerpZoom(anim.from.zoom, to.zoom, e),
          centerX: lerp(anim.from.centerX, to.centerX, e),
          centerY: lerp(anim.from.centerY, to.centerY, e),
        });
      }
    }
  }

  private clamp(view: CameraView): CameraView {
    return clampView(view, this.bounds, this.viewport, this.config.marginPx, this.limits);
  }
}
