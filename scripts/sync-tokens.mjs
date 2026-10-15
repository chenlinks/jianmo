import { readFileSync, writeFileSync } from 'node:fs';
// The specification generator in design/ is authoritative; never edit this CSS copy.
const source = new URL('../design/design-tokens.css', import.meta.url);
writeFileSync(new URL('../src/styles/tokens.css', import.meta.url), readFileSync(source));
console.log('Design tokens synchronized.');
