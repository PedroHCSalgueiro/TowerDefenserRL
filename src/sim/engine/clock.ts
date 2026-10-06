/**
 * Relógio de passo fixo.
 *
 * Recebe o tempo real de cada quadro, multiplica pela velocidade (1x/2x/3x)
 * e diz quantos ticks da simulação devem rodar. A duração do tick nunca muda,
 * então o resultado da simulação é o mesmo em qualquer velocidade.
 */

export interface EngineConfig {
  ticksPerSecond: number;
  speeds: readonly number[];
  /** Velocidades extras só do painel de debug (T17); o Q não passa por elas. */
  debugSpeeds?: readonly number[];
  maxTicksPerFrame: number;
}

const MS_PER_SECOND = 1000;
// Tolerância para erro de ponto flutuante ao somar deltas fracionários.
const EPSILON = 1e-9;

export class FixedStepClock {
  // Acumulador em "ms × ticks por segundo": um tick = MS_PER_SECOND unidades.
  // Evita dividir por 1000/30, que não é exato em ponto flutuante.
  private accumulator = 0;
  private currentSpeed: number;
  private dropped = 0;
  private readonly config: EngineConfig;

  constructor(config: EngineConfig) {
    this.config = config;
    const first = config.speeds[0];
    if (first === undefined) {
      throw new Error('EngineConfig.speeds não pode ser vazio');
    }
    this.currentSpeed = first;
  }

  get speed(): number {
    return this.currentSpeed;
  }

  /** A primeira velocidade da lista (1x). */
  get baseSpeed(): number {
    return this.config.speeds[0]!;
  }

  setSpeed(speed: number): void {
    if (!this.config.speeds.includes(speed) && !this.config.debugSpeeds?.includes(speed)) {
      throw new RangeError(`Velocidade inválida: ${speed}`);
    }
    this.currentSpeed = speed;
  }

  /**
   * Passa para a próxima velocidade da lista (depois da última, volta à
   * primeira). Numa velocidade do debug (5x, 10x), volta à primeira.
   */
  cycleSpeed(): number {
    const { speeds } = this.config;
    const next = speeds[(speeds.indexOf(this.currentSpeed) + 1) % speeds.length]!;
    this.currentSpeed = next;
    return next;
  }

  /** Total de ticks descartados pelo teto `maxTicksPerFrame` desde a criação. */
  get droppedTicks(): number {
    return this.dropped;
  }

  get tickDurationMs(): number {
    return MS_PER_SECOND / this.config.ticksPerSecond;
  }

  /**
   * Fração do próximo tick já decorrida, em [0, 1). A renderização desenha
   * em lerp(estadoAnterior, estadoAtual, alpha).
   */
  get alpha(): number {
    return this.accumulator / MS_PER_SECOND;
  }

  /**
   * Avança o tempo real do quadro e devolve quantos ticks rodar. `speed`
   * troca a velocidade só neste quadro (a escolhida fica guardada).
   */
  advance(deltaMs: number, speed = this.currentSpeed): number {
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) {
      return 0;
    }
    this.accumulator += deltaMs * speed * this.config.ticksPerSecond;

    const due = Math.floor(this.accumulator / MS_PER_SECOND + EPSILON);
    // Acima do teto o excedente é descartado (a simulação desacelera em vez
    // de travar o quadro); a fração do tick seguinte é preservada.
    const ticks = Math.min(due, this.config.maxTicksPerFrame);
    this.dropped += due - ticks;
    this.accumulator = Math.max(0, this.accumulator - due * MS_PER_SECOND);
    return ticks;
  }
}

/** Interpolação linear entre o valor do tick anterior e o do atual. */
export function lerp(from: number, to: number, alpha: number): number {
  return from + (to - from) * alpha;
}
