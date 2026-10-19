import type { Health } from '@aw/shared';
import { useEffect, useState } from 'react';
import { apiGet } from './api/client.ts';

export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Health>('/system/health').then(setHealth, (e: unknown) => setError(String(e)));
  }, []);

  if (error !== null) return <p role="alert">后端连接失败：{error}</p>;
  if (health === null) return <p>正在连接后端…</p>;
  return (
    <main>
      <h1>agent-workflow</h1>
      <p data-testid="health">
        后端状态：{health.status} · 版本 {health.appVersion} · Node {health.node}
      </p>
    </main>
  );
}
