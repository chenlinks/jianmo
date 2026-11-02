export interface TextMatch { start: number; end: number; range?: Range }

export function findText(text: string, query: string, caseSensitive = false): TextMatch[] {
  if (!query) return [];
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? 'gu' : 'giu');
  return Array.from(text.matchAll(pattern), match => ({ start: match.index!, end: match.index! + match[0].length }));
}

export function replaceText(text: string, matches: TextMatch[], replacement: string): string {
  let result = ''; let offset = 0;
  for (const match of matches) {
    result += text.slice(offset, match.start) + replacement; offset = match.end;
  }
  return result + text.slice(offset);
}

export function findInDocument(root: HTMLElement, query: string, caseSensitive = false, editableOnly = false): TextMatch[] {
  let text = '';
  const nodes: { node: Text; start: number; end: number }[] = [];
  function visit(node: Node) {
    if (node.nodeType === 3) {
      const value = node.textContent ?? '';
      nodes.push({ node: node as Text, start: text.length, end: text.length + value.length }); text += value;
    } else if (node.nodeType === 1) {
      const element = node as Element;
      if (element.matches('style,script,[aria-hidden=true],.mermaid-error')) return;
      // Rendered formulas and diagrams are backed by separate source attributes.
      // Treat them as boundaries when replacing so visible text cannot corrupt them.
      if (editableOnly && element.matches('[contenteditable=false],.math-node,svg,img')) { text += '\n'; return; }
      const block = element.matches('p,div,h1,h2,h3,h4,h5,h6,li,pre,blockquote,tr,th,td,br');
      if (block && text && !text.endsWith('\n')) text += '\n';
      element.childNodes.forEach(visit);
      if (block && !text.endsWith('\n')) text += '\n';
    }
  }
  visit(root);
  let firstIndex = 0; let lastIndex = 0;
  return findText(text, query, caseSensitive).flatMap(match => {
    while (firstIndex < nodes.length && nodes[firstIndex].end <= match.start) firstIndex++;
    while (lastIndex < nodes.length && nodes[lastIndex].end < match.end) lastIndex++;
    const first = nodes[firstIndex]; const last = nodes[lastIndex];
    if (!first || !last || first.start > match.start || last.start > match.end) return [];
    const range = root.ownerDocument.createRange();
    range.setStart(first.node, match.start - first.start); range.setEnd(last.node, match.end - last.start);
    return [{ ...match, range }];
  });
}

export function replaceInDocument(root: HTMLElement, query: string, replacement: string, caseSensitive = false, index?: number): number {
  const matches = findInDocument(root, query, caseSensitive, true);
  const selected = index === undefined ? matches : matches.slice(index, index + 1);
  for (const match of selected.reverse()) {
    const range = match.range!;
    const nodes: Text[] = [];
    if (range.startContainer === range.endContainer) nodes.push(range.startContainer as Text);
    else {
      const walker = root.ownerDocument.createTreeWalker(range.commonAncestorContainer, 4); let node: Node | null;
      while ((node = walker.nextNode())) if (range.intersectsNode(node)) nodes.push(node as Text);
    }
    // Edit text nodes in place to retain links, emphasis and surrounding structure.
    for (const node of nodes) {
      const start = node === range.startContainer ? range.startOffset : 0;
      const end = node === range.endContainer ? range.endOffset : node.length;
      node.replaceData(start, end - start, node === range.startContainer ? replacement : '');
    }
  }
  return selected.length;
}
