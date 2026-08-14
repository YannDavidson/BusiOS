import { createServer } from 'node:http';
import WebSocket from 'ws';
import { describe, expect, it } from 'vitest';
import { mulaw8kToPcm16k, pcm24kToMulaw8k } from '../src/voice/audio-codec.js';
import { RealtimeVoiceBridge } from '../src/voice/realtime-bridge.js';
import { MemoryVoiceStore } from '../src/voice/store.js';
import type { LiveAudioSession, LiveConnector, LiveHandlers } from '../src/voice/gemini-live.js';

class FakeConnector implements LiveConnector {
  handlers: LiveHandlers[] = []; audio: Buffer[] = []; closes = 0;
  async connect(_number: Parameters<LiveConnector['connect']>[0], handlers: LiveHandlers): Promise<LiveAudioSession> {
    this.handlers.push(handlers);
    return { sendAudio: (pcm) => this.audio.push(pcm), close: () => { this.closes++; } };
  }
}

function number() { return { businessId: 'business-a', phoneNumber: '+15125550100', businessName: 'Keli Hair Studio', language: 'en' as const, greeting: 'Thank you for calling.', fallbackMessage: 'Please leave a message.', active: true, faqs: [], realtimeEnabled: true, maxDurationSeconds: 600, maxTurns: 5, maxAudioSeconds: 60 }; }

describe('realtime voice bridge', () => {
  it('transcodes Twilio and Gemini audio at the required rates', () => {
    const mulaw = Buffer.alloc(160, 0xff);
    expect(mulaw8kToPcm16k(mulaw)).toHaveLength(640);
    expect(pcm24kToMulaw8k(Buffer.alloc(960))).toHaveLength(160);
  });

  it('bridges audio, clears playback on interruption, persists transcripts, and reconnects once', async () => {
    const store = new MemoryVoiceStore(); const configured = number(); store.numbers.set(configured.phoneNumber, configured);
    await store.createSession({ callSid: 'CA1', businessId: configured.businessId, from: '+15550001', to: configured.phoneNumber, language: 'en', status: 'in-progress', turns: [], startedAt: new Date().toISOString() });
    const connector = new FakeConnector(); const server = createServer(); new RealtimeVoiceBridge(store, connector).attach(server);
    await new Promise<void>((resolve) => server.listen(0, resolve)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('Expected TCP server');
    const client = new WebSocket(`ws://127.0.0.1:${address.port}/webhooks/twilio/voice/stream`); const received: string[] = [];
    client.on('message', (data: Buffer) => received.push(data.toString()));
    await event(client, 'open');
    client.send(JSON.stringify({ event: 'start', streamSid: 'MZ1', start: { callSid: 'CA1', customParameters: { to: configured.phoneNumber } } }));
    await until(() => connector.handlers.length === 1);
    client.send(JSON.stringify({ event: 'media', streamSid: 'MZ1', media: { payload: Buffer.alloc(160, 0xff).toString('base64') } }));
    await until(() => connector.audio.length === 1); expect(connector.audio[0]).toHaveLength(640);
    connector.handlers[0]?.inputTranscript('I need an appointment.'); connector.handlers[0]?.outputTranscript('I can prepare a request.');
    connector.handlers[0]?.audio(Buffer.alloc(960)); connector.handlers[0]?.interrupted(); connector.handlers[0]?.turnComplete();
    await until(() => received.some((message) => message.includes('"clear"')));
    expect(received.some((message) => message.includes('"media"'))).toBe(true);
    await until(async () => (await store.getSession('CA1'))?.turns.length === 2);
    connector.handlers[0]?.resumeHandle('resume-1'); connector.handlers[0]?.goAway();
    await until(() => connector.handlers.length === 2);
    await until(() => store.realtimeEvents.some((item) => item.type === 'reconnected'));
    expect(store.realtimeEvents.some((item) => item.type === 'reconnected')).toBe(true);
    client.send(JSON.stringify({ event: 'stop', streamSid: 'MZ1', stop: { callSid: 'CA1' } }));
    await until(() => store.realtimeEvents.some((item) => item.type === 'closed'));
    client.close(); await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});

function event(target: WebSocket, name: string) { return new Promise<void>((resolve) => target.once(name, () => resolve())); }
async function until(check: () => boolean | Promise<boolean>, timeout = 1000) { const started = Date.now(); while (!(await check())) { if (Date.now() - started > timeout) throw new Error('Timed out'); await new Promise((resolve) => setTimeout(resolve, 5)); } }
