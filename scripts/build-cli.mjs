import { build } from 'vite';

await build({
  configFile: false,
  publicDir: false,
  logLevel: 'warn',
  build: {
    ssr: 'lib/repolens/cli.ts',
    target: 'node20',
    outDir: 'dist-cli',
    emptyOutDir: true,
    minify: false,
    rollupOptions: { output: { format: 'es', entryFileNames: 'cli.mjs' } },
  },
  ssr: { external: ['typescript', 'fflate'] },
});

