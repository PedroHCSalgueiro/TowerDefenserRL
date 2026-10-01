import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';

/**
 * Versão mostrada no canto da tela e no relatório da run (T17): o hash curto
 * do commit. No GitHub Actions vem do `GITHUB_SHA`; no computador, do git.
 */
function appVersion(): string {
  const sha = process.env.GITHUB_SHA;
  if (sha) return sha.slice(0, 7);
  try {
    return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'dev';
  }
}

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/TowerDefenserRL/' : '/',
  define: {
    __APP_VERSION__: JSON.stringify(appVersion()),
  },
});
