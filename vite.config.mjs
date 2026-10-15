export default {
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ['**/src-tauri/**'] } },
  preview: { port: 4173, strictPort: true },
  esbuild: { jsx: 'automatic' },
  build: { target: 'es2022' }
};
