import { createApp } from './app.js';
import { assertProductionConfig, config } from './config.js';
import { GeminiDiego } from './diego.js';
import { MultiAgentRuntime } from './team-runtime.js';
import { Orchestrator } from './orchestrator.js';
import { createStore } from './store.js';
import { MarisolVoiceService } from './voice/marisol.js';
import { createVoiceStore } from './voice/store.js';
import { GeminiLiveConnector } from './voice/gemini-live.js';
import { RealtimeVoiceBridge } from './voice/realtime-bridge.js';
import { createActionStore } from './actions/store.js';
import { GoogleCalendarConnector, InternalCrmConnector, TwilioCallbackConnector, TwilioConfirmationConnector } from './actions/connectors.js';
import { VerifiedActionService } from './actions/service.js';
import { createGoogleOAuthStore, GoogleCalendarOAuthService } from './integrations/google-calendar.js';
import { createOwnerPortalService } from './portal/service.js';
import { createStripeBillingService } from './billing/stripe.js';
import { createKnowledgeStore } from './knowledge/store.js';
import { LiveKnowledgeDriveService } from './knowledge/google-drive.js';
import type { TeamIntelligence } from './team-runtime.js';

assertProductionConfig();
const store = createStore();
const diego = new GeminiDiego();
const voiceStore = createVoiceStore();
const actionStore = createActionStore();
const actionService = new VerifiedActionService(actionStore, {
  'calendar.create': new GoogleCalendarConnector(actionStore),
  'crm.upsert': new InternalCrmConnector(actionStore),
  'confirmation.send': new TwilioConfirmationConnector(),
  'callback.place': new TwilioCallbackConnector()
});
const googleCalendar = new GoogleCalendarOAuthService(createGoogleOAuthStore(), actionStore);
const knowledge = new LiveKnowledgeDriveService(createGoogleOAuthStore(), createKnowledgeStore());
let intelligence: TeamIntelligence = diego;
if (config.ADK_RUNTIME_ENABLED) {
  const { AdkTeamIntelligence, FailoverTeamIntelligence } = await import('./adk/runtime.js');
  const adk = new AdkTeamIntelligence(store, actionService);
  intelligence = config.ADK_RUNTIME_FALLBACK_ENABLED ? new FailoverTeamIntelligence(adk, diego, store) : adk;
}
const team = new MultiAgentRuntime(store, intelligence, knowledge);
const app = createApp(new Orchestrator(store, diego, team, knowledge), new MarisolVoiceService(voiceStore, diego), actionService, googleCalendar, createOwnerPortalService(), createStripeBillingService(), knowledge);
const server = createServer(app);
new RealtimeVoiceBridge(voiceStore, new GeminiLiveConnector()).attach(server);
server.listen(config.PORT, () => console.log(`BusiOS listening on :${config.PORT}`));
import { createServer } from 'node:http';
