import { beforeEach, describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { MemoryActionStore } from '../src/actions/store.js';
import { GoogleCalendarOAuthService, MemoryGoogleOAuthStore, type GoogleOAuthHttp } from '../src/integrations/google-calendar.js';

class FakeGoogle implements GoogleOAuthHttp {
  revoked: string[] = [];
  async exchange() { return { refreshToken: 'refresh-secret', accessToken: 'access-token' }; }
  async refresh(refreshToken: string) { expect(refreshToken).toBe('refresh-secret'); return 'refreshed-access'; }
  async calendars() { return [
    { id: 'primary@example.com', summary: 'Main calendar', primary: true, accessRole: 'owner' },
    { id: 'team@example.com', summary: 'Team calendar', primary: false, accessRole: 'writer' }
  ]; }
  async revoke(refreshToken: string) { this.revoked.push(refreshToken); }
}

describe('Google Calendar OAuth onboarding', () => {
  beforeEach(() => {
    config.PUBLIC_BASE_URL = 'https://busios.example';
    config.GOOGLE_OAUTH_CLIENT_ID = 'client-id';
    config.GOOGLE_OAUTH_CLIENT_SECRET = 'client-secret';
    config.APP_ENCRYPTION_KEY = 'test-encryption-key-at-least-32-characters';
  });

  it('binds a one-time expiring PKCE state to a business administrator', async () => {
    const oauthStore = new MemoryGoogleOAuthStore(); oauthStore.memberships.add('user-1:business-1');
    const service = new GoogleCalendarOAuthService(oauthStore, new MemoryActionStore(), new FakeGoogle());
    const authorizationUrl = new URL(await service.connect('business-1', 'user-1'));
    expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorizationUrl.searchParams.get('access_type')).toBe('offline');
    expect(oauthStore.states.size).toBe(1);
    expect([...oauthStore.states.values()][0]?.businessId).toBe('business-1');
  });

  it('captures an encrypted refresh token and rejects callback replay', async () => {
    const oauthStore = new MemoryGoogleOAuthStore(), actions = new MemoryActionStore();
    const service = new GoogleCalendarOAuthService(oauthStore, actions, new FakeGoogle());
    const url = new URL(await service.connect('business-1', 'user-1')); const state = url.searchParams.get('state')!;
    const connected = await service.callback(state, 'authorization-code');
    expect(connected.selectedCalendar.id).toBe('primary@example.com');
    const stored = await actions.getIntegration('business-1', 'google_calendar');
    expect(stored?.calendarSummary).toBe('Main calendar');
    expect(String(stored?.credentialsCiphertext)).not.toContain('refresh-secret');
    await expect(service.callback(state, 'authorization-code')).rejects.toThrow('invalid, expired, or already used');
  });

  it('rejects expired authorization state', async () => {
    const oauthStore = new MemoryGoogleOAuthStore(), service = new GoogleCalendarOAuthService(oauthStore, new MemoryActionStore(), new FakeGoogle());
    const url = new URL(await service.connect('business-1', 'user-1')); const state = url.searchParams.get('state')!;
    const saved = [...oauthStore.states.values()][0]!; saved.expiresAt = new Date(Date.now() - 1).toISOString();
    await expect(service.callback(state, 'authorization-code')).rejects.toThrow('invalid, expired, or already used');
  });

  it('verifies calendar selection and revokes credentials on disconnect', async () => {
    const oauthStore = new MemoryGoogleOAuthStore(), actions = new MemoryActionStore(), google = new FakeGoogle();
    const service = new GoogleCalendarOAuthService(oauthStore, actions, google);
    const url = new URL(await service.connect('business-1', 'user-1'));
    await service.callback(url.searchParams.get('state')!, 'authorization-code');
    expect((await service.selectCalendar('business-1', 'team@example.com')).calendarSummary).toBe('Team calendar');
    await expect(service.selectCalendar('business-1', 'read-only@example.com')).rejects.toThrow('unavailable or not writable');
    await service.disconnect('business-1');
    expect(google.revoked).toEqual(['refresh-secret']);
    expect(await service.status('business-1')).toEqual({ connected: false });
  });
});
