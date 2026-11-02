import hljs from 'highlight.js/lib/common';
import powershell from 'highlight.js/lib/languages/powershell';
import dart from 'highlight.js/lib/languages/dart';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import nginx from 'highlight.js/lib/languages/nginx';
import scala from 'highlight.js/lib/languages/scala';
import groovy from 'highlight.js/lib/languages/groovy';
import protobuf from 'highlight.js/lib/languages/protobuf';
import cmake from 'highlight.js/lib/languages/cmake';
import DOMPurify from 'dompurify';

for (const [name, grammar] of Object.entries({ powershell, dart, dockerfile, nginx, scala, groovy, protobuf, cmake })) hljs.registerLanguage(name, grammar);

// The same language catalog powers rendering and the code editor's suggestions.
export const codeLanguages = [...hljs.listLanguages(), 'html', 'svg', 'vue', 'jsx', 'tsx', 'sh', 'yml', 'toml', 'text', 'mermaid'].sort();
hljs.registerAliases(['vue'], { languageName: 'xml' });

export function highlightCode(code: HTMLElement, language: string | undefined): void {
  // Unknown and unlabeled code remains literal; avoid guessing prose as code.
  if (!language || !hljs.getLanguage(language)) return;
  const source = code.textContent ?? '';
  try {
    code.innerHTML = DOMPurify.sanitize(hljs.highlight(source, { language, ignoreIllegals: true }).value, { ALLOWED_TAGS: ['span'], ALLOWED_ATTR: ['class'] });
    code.classList.add('hljs');
  } catch { code.textContent = source; }
}
