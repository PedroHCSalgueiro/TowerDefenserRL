/** Versão da build (hash curto do commit) no canto da tela, para os relatos de bug (T17). */

export function showVersionLabel(parent: HTMLElement, version: string): () => void {
  const label = document.createElement('div');
  label.className = 'version-label';
  label.textContent = `v ${version}`;
  parent.append(label);
  return () => label.remove();
}
