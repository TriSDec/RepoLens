import { build } from 'vite';
await build({configFile:false,publicDir:false,build:{target:'es2022',minify:true,outDir:'public/worker',emptyOutDir:true,lib:{entry:'lib/repolens/analyzer.worker.ts',name:'RepoLensAnalyzer',formats:['iife'],fileName:()=> 'analyzer.js'}}});
