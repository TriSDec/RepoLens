// Bundles the analysis engine, the 3D maths and the CSP builder for tests: ES modules, with
// the TypeScript compiler and Next kept external.
import { build } from 'vite';

await build({
  configFile: false,
  publicDir: false,
  logLevel: 'warn',
  build: {
    ssr: true,
    target: 'node20',
    outDir: '.test-build',
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      input: { lib: 'lib/repolens/index.ts', map3d: 'lib/map3d.ts', csp: 'proxy.ts', scan: 'lib/scan.ts', gitignore: 'lib/gitignore.ts' },
      output: { format: 'es', entryFileNames: '[name].mjs' },
    },
  },
  ssr: { external: ['typescript', 'fflate', 'next', 'next/server'] },
});
