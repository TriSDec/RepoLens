import type { InputFile } from './types';

// A small polyglot project (React + TypeScript, a Python API, a Go worker) with deliberate problems,
// so the sample shows what RepoLens finds. The credential-shaped values are assembled at runtime so
// this repository never contains a secret-looking literal.
const FAKE_AWS_ID = ['AKIA', 'J3Q7ZK2M5XW4N6PB'].join('');
const FAKE_SMTP_PASSWORD = ['qwer', 'asdf', 'zxcv', 'tyui'].join(' ');

const duplicate = `export function formatMoney(value: number, currency = 'USD') {\n  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value);\n}\n`;

const complexShipping = `export function shippingCost(region: string, weight: number, express: boolean, member: boolean, oversize: boolean) {
  let cost = 0;
  if (region === 'us') {
    if (weight < 1) cost = 4;
    else if (weight < 5) cost = 8;
    else if (weight < 20) cost = 15;
    else cost = 30;
  } else if (region === 'eu') {
    if (weight < 1) cost = 7;
    else if (weight < 5) cost = 12;
    else if (weight < 20) cost = 22;
    else cost = 45;
  } else if (region === 'asia') {
    cost = weight < 2 ? 14 : weight < 10 ? 26 : 60;
  } else {
    cost = 80;
  }
  if (express && (region === 'us' || region === 'eu')) cost *= 1.5;
  else if (express) cost *= 2;
  if (member && !express) cost *= 0.9;
  if (oversize || weight > 40) { cost += 25; if (region !== 'us' && weight > 40) cost += 40; }
  for (const surcharge of [1, 2, 3]) { if (surcharge > weight) break; cost += 0.1; }
  return member ? Math.min(cost, 99) : cost;
}
`;

const source: Record<string, string> = {
    // ---- web (React + TypeScript) ----
    'web/src/main.tsx': `import { App } from './App';\nimport './styles.css';\nimport { createRoot } from 'react-dom/client';\ncreateRoot(document.getElementById('root')!).render(<App />);`,
    'web/src/App.tsx': `import { Dashboard } from './components/Dashboard';\nimport { Sidebar } from './components/Sidebar';\nimport { Toast } from './components/Toast';\nimport { useSession } from './hooks/useSession';\nexport function App() { const session = useSession(); return <main><Sidebar /><Dashboard user={session.user} /><Toast /></main>; }`,
    'web/src/components/Dashboard.tsx': `import { MetricCard } from './MetricCard';\nimport { ActivityFeed } from './ActivityFeed';\nimport { Chart } from './Chart';\nimport { Table } from './Table';\nimport { useMetrics } from '../hooks/useMetrics';\nexport function Dashboard({user}: {user: string}) { const metrics = useMetrics(); return <section><h1>{user}</h1><MetricCard value={metrics.total} /><Chart /><Table rows={[]} /><ActivityFeed /></section>; }`,
    'web/src/components/Sidebar.tsx': `import { Button } from './Button';\nimport { useSession } from '../hooks/useSession';\nexport function Sidebar() { const s = useSession(); return <aside><span>{s.user}</span><Button label="Sign out" /></aside>; }`,
    'web/src/components/MetricCard.tsx': `import { formatMoney } from '../utils/format';\nimport type { Metric } from '../types';\nexport function MetricCard({value}: {value: Metric['value']}) { return <article>{formatMoney(value)}</article>; }`,
    'web/src/components/ActivityFeed.tsx': `import { useMetrics } from '../hooks/useMetrics';\nimport { formatDate } from '../utils/date';\nimport { Markdown } from './Markdown';\nexport function ActivityFeed() { const m = useMetrics(); return <p>{formatDate(new Date())}: {m.total} events <Markdown html="" /></p>; }`,
    'web/src/components/Chart.tsx': `import { useMetrics } from '../hooks/useMetrics';\nimport { colors } from '../utils/colors';\nexport function Chart() { const m = useMetrics(); return <svg><rect fill={colors.primary} width={m.total} height={30} /></svg>; }`,
    'web/src/components/Button.tsx': `import { colors } from '../utils/colors';\nexport function Button({label}: {label: string}) { return <button style={{color: colors.primary}}>{label}</button>; }`,
    'web/src/components/Table.tsx': `import { Button } from './Button';\nimport { formatMoney } from '../utils/format';\nexport function Table({rows}: {rows: number[]}) { return <table>{rows.map(r => <tr key={r}><td>{formatMoney(r)}</td><td><Button label="Open" /></td></tr>)}</table>; }`,
    'web/src/components/Toast.tsx': `import { useDebounce } from '../hooks/useDebounce';\nexport function Toast() { const visible = useDebounce(true, 200); return visible ? <div role="status">Saved</div> : null; }`,
    'web/src/components/Markdown.tsx': `export function Markdown({html}: {html: string}) { return <div dangerouslySetInnerHTML={{__html: html}} />; }`,
    'web/src/hooks/useSession.ts': `import { session } from '../store/session';\nexport const useSession = () => session;`,
    'web/src/hooks/useMetrics.ts': `import { api } from '../services/api';\nimport { cache } from '../services/cache';\nexport function useMetrics() { return cache.get('metrics') || {total: 240}; }\nexport const refresh = () => api('/metrics');`,
    'web/src/hooks/useDebounce.ts': `export function useDebounce<T>(value: T, ms: number): T { void ms; return value; }\nexport function useThrottle<T>(value: T, ms: number): T { void ms; return value; }\nexport function usePrevious<T>(value: T): T { return value; }`,
    'web/src/services/api.ts': `import { cache } from './cache';\nimport { getToken } from '../store/session';\nimport { config } from '../config';\nexport async function api(path: string) { const response = await fetch(config.apiUrl + path, {headers: {Authorization: getToken()}}); const data = await response.json(); cache.set(path, data); return data; }`,
    'web/src/services/cache.ts': `import { api } from './api';\nconst entries = new Map<string, any>();\nexport const cache = {get: (key: string) => entries.get(key), set: (key: string, value: any) => entries.set(key, value)};\nexport const refreshCache = (key: string) => api(key);`,
    'web/src/services/analytics.ts': `import _ from 'lodash';\nimport { config } from '../config';\nexport function track(event: string, payload: Record<string, unknown>) {\n  const handler = eval('(' + config.hook + ')');\n  return handler(_.cloneDeep(payload), event);\n}`,
    'web/src/store/session.ts': `export const session = {user: 'Alex Morgan', token: ''};\nexport const getToken = () => session.token;`,
    'web/src/utils/format.ts': duplicate,
    'web/src/utils/formatLegacy.ts': duplicate,
    'web/src/utils/date.ts': `export function formatDate(date: Date) { return new Intl.DateTimeFormat('en-US').format(date); }`,
    'web/src/utils/colors.ts': `export const colors = {primary: '#8b72f8', success: '#48caaa', warning: '#efb35f'};`,
    'web/src/utils/shipping.ts': complexShipping,
    'web/src/types.ts': `export type Metric = {value: number; label: string};`,
    'web/src/config.ts': `export const config = {apiUrl: '/api', hook: '(p) => p'};`,
    'web/src/styles.css': `:root { color-scheme: dark; font-family: system-ui; }\nbody { margin: 0; background: #101019; }`,
    'web/src/legacy/OldDashboard.tsx': `import { formatMoney } from '../utils/formatLegacy';\nexport function OldDashboard() { return <div>{formatMoney(1)}</div>; }`,
    'web/src/__tests__/format.test.ts': `import { formatMoney } from '../utils/format';\nimport { formatDate } from '../utils/date';\ntest('formats', () => { expect(formatMoney(1)).toBe('$1.00'); expect(formatDate(new Date(0))).toBeTruthy(); });`,
    'web/src/__tests__/Chart.test.tsx': `import { Chart } from '../components/Chart';\ntest('renders', () => { expect(Chart).toBeDefined(); });`,
    'web/package.json': JSON.stringify({ name: 'orbit-web', version: '1.0.0', dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0', moment: '^2.30.0' }, devDependencies: { typescript: '^5.6.0' } }, null, 2),
    'web/tsconfig.json': JSON.stringify({ compilerOptions: { jsx: 'react-jsx', strict: true } }, null, 2),

    // ---- api (Python) ----
    'api/main.py': `from fastapi import FastAPI\nfrom api.routers import auth, metrics, reports\nfrom api.services import db\n\napp = FastAPI()\napp.include_router(auth.router)\napp.include_router(metrics.router)\napp.include_router(reports.router)\ndb.connect()\n`,
    'api/config.py': `import os\n\nAWS_ACCESS_KEY_ID = "${FAKE_AWS_ID}"\nSMTP_PASSWORD = "${FAKE_SMTP_PASSWORD}"\nDATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///dev.db")\n`,
    'api/models.py': `from dataclasses import dataclass\nfrom api.services.db import Session\n\n@dataclass\nclass User:\n    id: int\n    email: str\n\n    def save(self, session: Session) -> None:\n        session.add(self)\n`,
    'api/routers/auth.py': `from fastapi import APIRouter\nfrom api.models import User\nfrom api.services import db, mailer\n\nrouter = APIRouter()\n\n@router.post("/login")\ndef login(email: str):\n    user = db.find_user(email)\n    if user is None:\n        mailer.notify_unknown(email)\n        return {"ok": False}\n    return {"ok": True, "id": user.id}\n`,
    'api/routers/metrics.py': `from fastapi import APIRouter\nfrom api.services import db, cache\n\nrouter = APIRouter()\n\n@router.get("/metrics")\ndef metrics():\n    return cache.remember("metrics", lambda: db.totals())\n`,
    'api/routers/reports.py': `import pickle\nfrom fastapi import APIRouter\nfrom api.services import db\nfrom api.utils import legacy\n\nrouter = APIRouter()\n\n@router.post("/reports/import")\ndef import_report(blob: bytes):\n    report = pickle.loads(blob)\n    return legacy.normalise(report, db.totals())\n`,
    'api/services/db.py': `from api import config\nfrom api.models import User\n\nclass Session:\n    def add(self, obj): ...\n\ndef connect(): return config.DATABASE_URL\ndef find_user(email: str): return User(1, email)\ndef totals(): return {"total": 240}\n`,
    'api/services/cache.py': `_store = {}\n\ndef remember(key, make):\n    if key not in _store:\n        _store[key] = make()\n    return _store[key]\n`,
    'api/services/mailer.py': `import smtplib\nfrom api import config\n\ndef notify_unknown(email: str) -> None:\n    with smtplib.SMTP("localhost") as smtp:\n        smtp.login("alerts", config.SMTP_PASSWORD)\n`,
    'api/utils/legacy.py': `def normalise(report, totals):\n    return {**report, **totals}\n`,
    'api/utils/dates.py': `from datetime import date\n\ndef today_iso() -> str:\n    return date.today().isoformat()\n`,
    'api/tests/test_auth.py': `from api.routers import auth\n\ndef test_login_unknown():\n    assert auth.login("nobody@example.com")["ok"] in (True, False)\n`,

    // ---- worker (Go) ----
    'worker/go.mod': `module example.com/orbit/worker\n\ngo 1.22\n`,
    'worker/main.go': `package main\n\nimport (\n\t"fmt"\n\t"example.com/orbit/worker/internal/queue"\n\t"example.com/orbit/worker/internal/store"\n)\n\nfunc main() {\n\tfmt.Println(queue.Next(), store.Save("job"))\n}\n`,
    'worker/internal/queue/queue.go': `package queue\n\nimport "example.com/orbit/worker/internal/store"\n\nfunc Next() string { return store.Load() }\n`,
    'worker/internal/store/store.go': `package store\n\nfunc Save(job string) bool { return job != "" }\nfunc Load() string { return "job" }\n`,
};

export const demoFiles: InputFile[] = Object.entries(source).map(([path, content]) => ({ path, content, size: new TextEncoder().encode(content).length }));
