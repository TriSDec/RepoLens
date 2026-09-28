import type { InputFile } from './types';
const duplicate = `export function formatMoney(value: number, currency = 'USD') {\n  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value);\n}\n`;
const source: Record<string, string> = {
    'src/main.tsx': `import { App } from './App';\nimport './styles.css';\nimport { createRoot } from 'react-dom/client';\ncreateRoot(document.getElementById('root')!).render(<App />);`,
    'src/App.tsx': `import { Dashboard } from './components/Dashboard';\nimport { Sidebar } from './components/Sidebar';\nimport { useSession } from './hooks/useSession';\nexport function App() { const session = useSession(); return <main><Sidebar /><Dashboard user={session.user} /></main>; }`,
    'src/components/Dashboard.tsx': `import { MetricCard } from './MetricCard';\nimport { ActivityFeed } from './ActivityFeed';\nimport { Chart } from './Chart';\nimport { useMetrics } from '../hooks/useMetrics';\nexport function Dashboard({user}: {user: string}) { const metrics = useMetrics(); return <section><h1>{user}</h1><MetricCard value={metrics.total} /><Chart /><ActivityFeed /></section>; }`,
    'src/components/Sidebar.tsx': `import { Button } from './Button';\nimport { useSession } from '../hooks/useSession';\nexport function Sidebar() { const s = useSession(); return <aside><span>{s.user}</span><Button label="Sign out" /></aside>; }`,
    'src/components/MetricCard.tsx': `import { formatMoney } from '../utils/format';\nimport type { Metric } from '../types';\nexport function MetricCard({value}: {value: Metric['value']}) { return <article>{formatMoney(value)}</article>; }`,
    'src/components/ActivityFeed.tsx': `import { useMetrics } from '../hooks/useMetrics';\nimport { formatDate } from '../utils/date';\nexport function ActivityFeed() { const m = useMetrics(); return <p>{formatDate(new Date())}: {m.total} events</p>; }`,
    'src/components/Chart.tsx': `import { useMetrics } from '../hooks/useMetrics';\nimport { colors } from '../utils/colors';\nexport function Chart() { const m = useMetrics(); return <svg><rect fill={colors.primary} width={m.total} height={30} /></svg>; }`,
    'src/components/Button.tsx': `import { colors } from '../utils/colors';\nexport function Button({label}: {label: string}) { return <button style={{color: colors.primary}}>{label}</button>; }`,
    'src/hooks/useSession.ts': `import { session } from '../store/session';\nexport const useSession = () => session;`,
    'src/hooks/useMetrics.ts': `import { api } from '../services/api';\nimport { cache } from '../services/cache';\nexport function useMetrics() { return cache.get('metrics') || {total: 240}; }\nexport const refresh = () => api('/metrics');`,
    'src/services/api.ts': `import { cache } from './cache';\nimport { getToken } from '../store/session';\nimport { config } from '../config';\nexport async function api(path: string) { const response = await fetch(config.apiUrl + path, {headers: {Authorization: getToken()}}); const data = await response.json(); cache.set(path, data); return data; }`,
    'src/services/cache.ts': `import { api } from './api';\nconst entries = new Map<string, any>();\nexport const cache = {get: (key: string) => entries.get(key), set: (key: string, value: any) => entries.set(key, value)};\nexport const refreshCache = (key: string) => api(key);`,
    'src/store/session.ts': `export const session = {user: 'Alex Morgan', token: ''};\nexport const getToken = () => session.token;`,
    'src/utils/format.ts': duplicate,
    'src/utils/formatLegacy.ts': duplicate,
    'src/utils/date.ts': `export function formatDate(date: Date) { return new Intl.DateTimeFormat('en-US').format(date); }`,
    'src/utils/colors.ts': `export const colors = {primary: '#8b72f8', success: '#48caaa', warning: '#efb35f'};`,
    'src/types.ts': `export type Metric = {value: number; label: string};`,
    'src/config.ts': `export const config = {apiUrl: '/api'};`,
    'src/styles.css': `:root { color-scheme: dark; font-family: system-ui; }\nbody { margin: 0; background: #101019; }`,
    'src/legacy/OldDashboard.tsx': `import { formatMoney } from '../utils/formatLegacy';\nexport function OldDashboard() { return <div>{formatMoney(120)}</div>; }`,
    'package.json': JSON.stringify({ name: 'orbit-dashboard', version: '1.0.0', dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0', moment: '^2.30.1' } }, null, 2),
    'tsconfig.json': JSON.stringify({ compilerOptions: { jsx: 'react-jsx', strict: true } }, null, 2),
};
export const demoFiles: InputFile[] = Object.entries(source).map(([path, content]) => ({ path, content, size: new TextEncoder().encode(content).length }));
