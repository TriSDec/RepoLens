import ts from 'typescript';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
await mkdir('.sites-runtime/checks',{recursive:true});
for(const name of ['types','input','analyze','demo']) {
 const source=await readFile(`lib/repolens/${name}.ts`,'utf8');
 const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/from '(\.\/[^']+)'/g,"from '$1.mjs'");
 await writeFile(`.sites-runtime/checks/${name}.mjs`,output);
}
const {analyze}=await import('../.sites-runtime/checks/analyze.mjs');
const {collectZip,collectFolder,safePath,exclusion}=await import('../.sites-runtime/checks/input.mjs');
const {trace,LIMITS}=await import('../.sites-runtime/checks/types.mjs');
const {demoFiles}=await import('../.sites-runtime/checks/demo.mjs');
const collected=files=>({files,skipped:0,skippedBytes:0,skippedReasons:{}});
const fixture=map=>Object.entries(map).map(([path,content])=>({path,content,size:Buffer.byteLength(content)}));
const inspect=map=>analyze(collected(fixture(map)),'fixture');
const zipBuffer=map=>{const z=zipSync(Object.fromEntries(Object.entries(map).map(([k,v])=>[k,strToU8(v)])));return z.buffer.slice(z.byteOffset,z.byteOffset+z.byteLength);};
await test('Demo produces actual edges, one runtime cycle, duplicates and no false JSX React package flag',()=>{const r=analyze(collected(demoFiles),'demo');assert.equal(r.nodes.length,23);assert.equal(r.findings.filter(f=>f.kind==='cycle').length,1);assert.equal(r.findings.filter(f=>f.kind==='duplicate').length,1);assert.equal(r.findings.filter(f=>f.kind==='syntax').length,0);assert(!r.findings.some(f=>f.kind==='package'&&f.detail.includes('“react”')));assert(r.findings.some(f=>f.kind==='package'&&f.detail.includes('moment')));});
await test('Syntax-aware imports ignore comments and strings; support reexports, require, dynamic literals and type imports',()=>{const r=inspect({'src/main.ts':`// import './ghost';\nconst s = "require('./also-ghost')";\nexport {a} from './a';\nconst b = require('./b');\nimport('./c');\nimport type {T} from './types';`,'src/a.ts':'export const a=1','src/b.ts':'module.exports=2','src/c.ts':'export default 3','src/types.ts':'export type T=string'});assert.equal(r.edges.length,4);assert.equal(r.findings.filter(f=>f.kind==='unresolved').length,0);assert(r.edges.some(e=>e.to==='src/types.ts'&&e.typeOnly));});
await test('Type-only cycles do not count as runtime cycles',()=>{const r=inspect({'a.ts':"import type {B} from './b'; export type A = B;",'b.ts':"import type {A} from './a'; export type B = A;"});assert.equal(r.findings.filter(f=>f.kind==='cycle').length,0);});
await test('Resolves directory indexes, tsconfig aliases, explicit JS-to-TS paths and flags missing files',()=>{const r=inspect({'tsconfig.json':JSON.stringify({compilerOptions:{paths:{'@/*':['src/*']}}}),'src/main.ts':"import '@/lib'; import './util.js'; import './missing';",'src/lib/index.ts':'export const a=1','src/util.ts':'export const b=1'});assert.equal(r.edges.length,2);assert.equal(r.findings.filter(f=>f.kind==='unresolved').length,1);});
await test('Syntax errors have line numbers and computed imports are disclosed',()=>{const r=inspect({'main.ts':"const x = ;\nimport(name);"});assert(r.findings.some(f=>f.kind==='syntax'&&f.line===1));assert(r.findings.some(f=>f.kind==='dynamic'));});
await test('Change impact follows reverse transitive edges and handles cycles',()=>{const e=[{from:'a',to:'b'},{from:'b',to:'c'},{from:'c',to:'b'}];assert.deepEqual([...trace('c',e,'impact')].sort(),['a','b','c']);});
await test('Common secrets and generated files are skipped before reading',async()=>{for(const p of ['repo/.env','repo/.env.local','repo/.git/config','repo/node_modules/pkg/a.ts','repo/private.key','repo/.npmrc','repo/dist/app.js'])assert(exclusion(p));const good=new File(['export const a=1'], 'main.ts');const secret=new File(['not read'],'.env');secret.arrayBuffer=()=>{throw new Error('Secret read attempted')};const r=await collectFolder([good,secret],()=>{});assert.equal(r.files.length,1);assert.equal(r.skipped,1);});
await test('Unsafe ZIP paths and traversal are rejected',()=>{for(const p of ['../secret.ts','repo/../secret.ts','/absolute.ts','C:\\private.ts','x\u0000.ts'])assert.throws(()=>safePath(p));assert.throws(()=>collectZip(zipBuffer({'../bad.ts':'export const a=1'}),()=>{}));});
await test('Normal ZIP projects preserve paths and exclude secrets',()=>{const r=collectZip(zipBuffer({'project/src/main.ts':"import './a'",'project/src/a.ts':'export const a=1','project/.env':'sensitive'}),()=>{});assert.equal(r.files.length,2);assert.equal(r.skipped,1);assert.equal(r.files[0].path,'src/main.ts');assert.equal(analyze(r,'zip').edges.length,1);});
await test('Archive expansion and included-file limits are enforced',()=>{assert.throws(()=>collectZip(zipBuffer({'main.ts':'export const a=1','huge.txt':'x'.repeat(LIMITS.expanded+1)}),()=>{}),/50 MB/);const many=Object.fromEntries(Array.from({length:1001},(_,i)=>[`f${i}.ts`,'export const x=1']));assert.throws(()=>collectZip(zipBuffer(many),()=>{}),/1,000/);});
await test('1,000-file project finishes and preserves every expected edge',()=>{const map=Object.fromEntries(Array.from({length:1000},(_,i)=>[`src/${i===0?'main':`f${i}`}.ts`,i===999?'export const x=1':`import './f${i+1}'; export const x=${i};`]));const r=inspect(map);assert.equal(r.nodes.length,1000);assert.equal(r.edges.length,999);console.log(`1000-file analysis: ${r.duration} ms`);});
if (process.env.REPOLENS_QA_DIR) {
await mkdir(process.env.REPOLENS_QA_DIR,{recursive:true});
await writeFile(`${process.env.REPOLENS_QA_DIR}/project.zip`,new Uint8Array(zipBuffer({'test-project/src/main.ts':"import { helper } from './helper';\nimport './missing';\nconsole.log(helper());",'test-project/src/helper.ts':"import './main';\nexport function helper() { return 'qa-source-canary-72c1'; }",'test-project/.env':'qa-never-read-secret','test-project/package.json':'{"name":"test-project"}'})));

}
