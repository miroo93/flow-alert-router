import http from 'node:http';
import { performance } from 'node:perf_hooks';

const HOST = '127.0.0.1';
const PORT = 8080;
const agent = new http.Agent({ keepAlive: true, maxSockets: 16 });

function req(method: string, path: string, body?: unknown): Promise<number> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? '' : JSON.stringify(body);
    const r = http.request(
      { host: HOST, port: PORT, method, path, agent, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } },
      (res) => { res.resume(); res.on('end', () => resolve(res.statusCode ?? 0)); }
    );
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

const services = ['payment-api', 'payment-worker', 'auth-service', 'billing', 'search-api'];
const severities = ['critical', 'warning', 'info'] as const;

async function main() {
  await req('POST', '/reset');
  for (let i = 0; i < 100; i++) {
    const svcGlob = i % 3 === 0 ? '*' : `${services[i % services.length]!.split('-')[0]}-*`;
    const sev = severities[i % 3];
    await req('POST', '/routes', {
      id: `r${i}`, priority: (i % 20) + 1,
      conditions: { severity: [sev], service: [svcGlob] },
      target: { type: 'slack', channel: `#r${i}` },
      suppression_window_seconds: i % 2 === 0 ? 0 : 60,
    });
  }
  const alerts = Array.from({ length: 1000 }, (_, i) => ({
    id: `a${i}`, severity: severities[i % 3], service: services[i % services.length],
    group: 'g', timestamp: new Date(Date.UTC(2026, 3, 20, 0, 0, i)).toISOString(),
  }));
  const start = performance.now();
  await Promise.all(alerts.map((a) => req('POST', '/alerts', a)));
  const elapsed_ms = performance.now() - start;
  console.log(`elapsed_ms=${elapsed_ms.toFixed(1)}`);
  process.exit(elapsed_ms < 2000 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
