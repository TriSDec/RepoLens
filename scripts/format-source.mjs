import ts from 'typescript';
import {readFile,writeFile} from 'node:fs/promises';
const printer=ts.createPrinter({newLine:ts.NewLineKind.LineFeed});
for(const path of ['app/page.tsx','components/repolens-graph.tsx',...['types','input','analyze','analyzer.worker','demo'].map(n=>`lib/repolens/${n}.ts`)]){
 const source=ts.createSourceFile(path,await readFile(path,'utf8'),ts.ScriptTarget.Latest,true,path.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 await writeFile(path,printer.printFile(source));
}
