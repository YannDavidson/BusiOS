import { describe, expect, it } from 'vitest';
import type { IntelligenceEngine } from '../src/diego.js';
import { createApp } from '../src/app.js';
import { Orchestrator } from '../src/orchestrator.js';
import { MemoryStore } from '../src/store.js';

const intelligence: IntelligenceEngine = {
  respond: async () => 'ok',
  detectOpportunity: async () => { throw new Error('not used'); }
};

describe('HTTP app', () => {
  it('reports service health', async () => {
    const app = createApp(new Orchestrator(new MemoryStore(), intelligence));
    const server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP server');
    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, service: 'busios-ai' });
    server.close();
  });
});
