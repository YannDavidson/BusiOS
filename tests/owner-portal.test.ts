import { describe, expect, it } from 'vitest';
import { MemoryPortalStore, OwnerPortalService } from '../src/portal/service.js';

function setup() { const store = new MemoryPortalStore(); store.users.set('owner-token-that-is-long-enough', { id: 'owner-1', email: 'owner@example.com' }); store.users.set('member-token-that-is-long-enough', { id: 'member-1' }); return { store, service: new OwnerPortalService(store) }; }

describe('owner portal', () => {
  it('atomically creates an owner-scoped business workspace', async () => {
    const { service } = setup(); const business = await service.create('owner-token-that-is-long-enough', 'Keli Hair Studio');
    expect(business.role).toBe('owner'); expect((await service.list('owner-token-that-is-long-enough'))[0]?.name).toBe('Keli Hair Studio');
  });
  it('prevents users outside a tenant from reading its dashboard', async () => {
    const { service } = setup(); const business = await service.create('owner-token-that-is-long-enough', 'Keli Hair Studio');
    await expect(service.dashboard('member-token-that-is-long-enough', business.id)).rejects.toThrow('Business access required');
  });
  it('allows an owner to configure Marisol and the agent team', async () => {
    const { service } = setup(); const business = await service.create('owner-token-that-is-long-enough', 'Keli Hair Studio');
    await service.saveVoice('owner-token-that-is-long-enough', business.id, { businessName: 'Keli Hair Studio', language: 'es', greeting: 'Gracias por llamar.', fallbackMessage: 'Puedo tomar un mensaje.' });
    await service.saveAgents('owner-token-that-is-long-enough', business.id, { enabled: ['DIEGO', 'MARISOL'] });
    const dashboard = await service.dashboard('owner-token-that-is-long-enough', business.id);
    expect(dashboard.voice?.language).toBe('es'); expect(dashboard.agents.enabled).toEqual(['DIEGO', 'MARISOL']);
  });
  it('rejects malformed business and language settings', async () => {
    const { service } = setup(); await expect(service.create('owner-token-that-is-long-enough', 'x')).rejects.toThrow('2–120');
    const business = await service.create('owner-token-that-is-long-enough', 'Valid Business');
    await expect(service.saveVoice('owner-token-that-is-long-enough', business.id, { businessName: 'Valid', language: 'fr', greeting: 'Bonjour' })).rejects.toThrow('Unsupported language');
    await expect(service.saveAgents('owner-token-that-is-long-enough', business.id, { enabled: ['MARISOL'] })).rejects.toThrow('include Diego');
  });
});
