/**
 * Experimento "núcleo com nível infinito": bot bom em 12 sementes, run normal
 * e run com núcleo invulnerável até a onda 40. Roda igual na `main` e no
 * branch do experimento (`npm run bench`), para comparar.
 */

import { it } from 'vitest';
import { goodBotBreak } from './support/goodBot';
import { botCells, botMap, botSim } from './support/waveBot';
import { waveData } from '../src/sim/waves/waveData';

const SEEDS = Array.from({ length: 12 }, (_, i) => `s${i + 1}`);
const CHECKPOINTS = [20, 25, 30, 35, 40];
const FINAL_WAVES = 36;
const MAX_WAVE_TICKS = 30 * 60 * 8;

interface RunSummary {
  wave: number;
  status: string;
  level: number;
  towers: number;
  goldEarned: number;
  gold: number;
  at: Record<number, { level: number; gold: number; towers: number }>;
  peakEnemies: number;
  tickMs: number;
}

function play(seed: string, invulnerable: boolean): RunSummary {
  const sim = botSim(seed, invulnerable);
  const at: RunSummary['at'] = {};
  let peakEnemies = 0;
  let finalMs = 0;
  let finalTicks = 0;
  while (sim.state.status === 'playing' && sim.state.wave < waveData.waves.length) {
    goodBotBreak(sim);
    sim.drainEvents();
    const wave = sim.state.wave + 1;
    sim.enqueue({ type: 'callWave' });
    sim.step();
    for (let i = 0; i < MAX_WAVE_TICKS && sim.state.waves.active.length > 0; i++) {
      if (sim.state.status !== 'playing') break;
      const t0 = performance.now();
      sim.step();
      const dt = performance.now() - t0;
      sim.drainEvents();
      if (wave >= FINAL_WAVES) {
        finalMs += dt;
        finalTicks++;
        peakEnemies = Math.max(peakEnemies, sim.state.enemies.activeCount);
      }
    }
    if (CHECKPOINTS.includes(sim.state.wave) && sim.state.status === 'playing') {
      at[sim.state.wave] = {
        level: sim.state.nexus.level,
        gold: sim.state.gold,
        towers: sim.state.towers.length,
      };
    }
  }
  return {
    wave: sim.state.status === 'lost' ? sim.state.wave + 1 : sim.state.wave,
    status: sim.state.status,
    level: sim.state.nexus.level,
    towers: sim.state.towers.length,
    goldEarned: sim.state.stats.goldEarned,
    gold: sim.state.gold,
    at,
    peakEnemies,
    tickMs: finalTicks ? finalMs / finalTicks : 0,
  };
}

it('núcleo: run normal e invulnerável, 12 sementes', () => {
  const lines = [`casas livres para torre no mapa: ${botCells(botMap).length}`];
  for (const invulnerable of [false, true]) {
    lines.push(invulnerable ? '## invulnerável' : '## normal');
    for (const seed of SEEDS) {
      const r = play(seed, invulnerable);
      const at = CHECKPOINTS.map((w) =>
        r.at[w] ? `${w}:n${r.at[w].level}/t${r.at[w].towers}/o${r.at[w].gold}` : `${w}:-`,
      ).join(' ');
      lines.push(
        `${seed} onda ${r.wave} ${r.status} nível ${r.level} torres ${r.towers} ganho ${r.goldEarned} sobra ${r.gold}` +
          (invulnerable ? ` | ${at} | pico ${r.peakEnemies} tick ${r.tickMs.toFixed(3)} ms` : ''),
      );
    }
  }
  console.log(lines.join('\n'));
});
