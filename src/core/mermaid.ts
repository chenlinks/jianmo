let library: Promise<typeof import('mermaid')['default']> | undefined;
let sequence = 0;
const pending = new WeakMap<HTMLElement, Promise<void>>();

function loadMermaid() {
  return library ??= import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true,
      theme: 'default', flowchart: { htmlLabels: false }, fontFamily: 'Segoe UI, Microsoft YaHei, sans-serif' });
    return mermaid;
  }).catch(error => { library = undefined; throw error; });
}

export async function renderDiagrams(root: HTMLElement): Promise<void> {
  await Promise.all(Array.from(root.querySelectorAll<HTMLElement>('.mermaid-node[data-mermaid]')).map(node => {
    if (pending.has(node)) return pending.get(node);
    if (node.dataset.rendered) return;
    const job = renderNode(root, node); pending.set(node, job); return job;
  }));
}

async function renderNode(root: HTMLElement, node: HTMLElement) {
  const source = node.dataset.mermaid!;
  const container = document.createElement('div');
  container.className = 'mermaid-render-workspace';
  try {
    const mermaid = await loadMermaid();
    if (!root.contains(node)) return;
    document.body.append(container);
    const { svg } = await mermaid.render(`jianmo-diagram-${++sequence}`, source, container);
    if (!root.contains(node) || node.dataset.mermaid !== source) return;
    node.innerHTML = svg; node.dataset.rendered = 'true';
  } catch {
    if (!root.contains(node)) return;
    node.dataset.rendered = 'error';
    const error = document.createElement('p'); error.className = 'mermaid-error';
    error.textContent = '图表未能解析，请双击检查 Mermaid 源码。'; node.prepend(error);
  } finally { container.remove(); pending.delete(node); }
}
