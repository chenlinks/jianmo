import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
registerHooks({
  load(url, context, nextLoad) {
    if (/\.tsx$/.test(url)) return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText };
    if (/\.css(\?raw)?$/.test(url)) return { format: 'module', shortCircuit: true, source: 'export default ' + JSON.stringify(url.endsWith('?raw') ? readFileSync(new URL(url.replace(/\?raw$/, '')), 'utf8') : '') };
    return nextLoad(url, context);
  }
});
