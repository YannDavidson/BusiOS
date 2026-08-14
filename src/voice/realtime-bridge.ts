import type { Server as HttpServer, IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import twilio from 'twilio';
import WebSocket, { WebSocketServer } from 'ws';
import { config } from '../config.js';
import { mulaw8kToPcm16k, pcm24kToMulaw8k } from './audio-codec.js';
import type { LiveAudioSession, LiveConnector, LiveHandlers } from './gemini-live.js';
import type { VoiceStore } from './store.js';
import type { VoiceNumber } from './types.js';

type TwilioMessage = { event: 'connected' | 'start' | 'media' | 'stop' | 'mark' | 'dtmf'; streamSid?: string; start?: { callSid: string; customParameters?: Record<string, string> }; media?: { payload: string } };

export class RealtimeVoiceBridge {
  private wss = new WebSocketServer({ noServer: true });
  constructor(private store: VoiceStore, private connector: LiveConnector) { this.wss.on('connection', (ws: WebSocket) => this.handle(ws)); }
  attach(server: HttpServer) {
    server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      const path = new URL(request.url ?? '/', 'http://localhost').pathname;
      if (path !== '/webhooks/twilio/voice/stream' || !this.validSignature(request)) { socket.destroy(); return; }
      this.wss.handleUpgrade(request, socket, head, (ws) => this.wss.emit('connection', ws, request));
    });
  }
  private validSignature(request: IncomingMessage) {
    if (config.NODE_ENV === 'test') return true;
    const signature = String(request.headers['x-twilio-signature'] ?? '');
    const base = config.PUBLIC_BASE_URL?.replace(/^http/, 'ws').replace(/\/$/, '');
    return Boolean(base && config.TWILIO_AUTH_TOKEN && twilio.validateRequest(config.TWILIO_AUTH_TOKEN, signature, `${base}${request.url ?? ''}`, {}));
  }
  private handle(ws: WebSocket) {
    let state: StreamState | undefined;
    ws.on('message', async (raw: Buffer) => {
      try {
        const message = JSON.parse(raw.toString()) as TwilioMessage;
        if (message.event === 'start') state = await this.start(ws, message);
        else if (message.event === 'media' && state && message.media?.payload) this.media(state, message.media.payload);
        else if (message.event === 'stop' && state) await this.finish(state, 'closed', { reason: 'twilio_stop' });
      } catch (error) { if (state) await this.fail(state, error); else ws.close(1011, 'Unable to start realtime voice'); }
    });
    ws.on('close', () => { if (state) void this.finish(state, 'closed', { reason: 'websocket_closed' }); });
  }
  private async start(ws: WebSocket, message: TwilioMessage): Promise<StreamState> {
    const callSid = message.start?.callSid, params = message.start?.customParameters ?? {}, to = params.to;
    if (!callSid || !to || !message.streamSid) throw new Error('Missing Twilio stream identity');
    const number = await this.store.findNumber(to);
    if (!number?.realtimeEnabled) throw new Error('Realtime voice is not enabled');
    const state: StreamState = { ws, callSid, streamSid: message.streamSid, number, started: Date.now(), inputAudioSeconds: 0, outputAudioSeconds: 0, turns: 0, reconnects: 0, liveGeneration: 0, closed: false, reconnecting: false, pendingInput: [], pendingInputBytes: 0, inputTranscript: '', outputTranscript: '' };
    state.live = await this.connectLive(state);
    state.timer = setTimeout(() => void this.limit(state, 'duration'), (number.maxDurationSeconds ?? 600) * 1000);
    await this.store.addRealtimeEvent(callSid, number.businessId, 'connected', { streamSid: state.streamSid });
    return state;
  }
  private async connectLive(state: StreamState) {
    const generation = ++state.liveGeneration;
    const handlers: LiveHandlers = {
      audio: (pcm) => this.output(state, pcm),
      interrupted: () => { this.send(state, { event: 'clear', streamSid: state.streamSid }); void this.store.addRealtimeEvent(state.callSid, state.number.businessId, 'interrupted', {}); },
      inputTranscript: (text) => { state.inputTranscript += text; }, outputTranscript: (text) => { state.outputTranscript += text; },
      turnComplete: () => { state.turns++; void this.flushTranscripts(state); if (state.turns >= (state.number.maxTurns ?? 30)) void this.limit(state, 'turns'); },
      resumeHandle: (handle) => { if (generation === state.liveGeneration) state.resumeHandle = handle; },
      goAway: () => { if (generation === state.liveGeneration) void this.reconnect(state); },
      error: (error) => { if (generation === state.liveGeneration) void this.fail(state, error); },
      close: () => { if (!state.closed && generation === state.liveGeneration) void this.reconnect(state); }
    };
    return this.connector.connect(state.number, handlers, state.resumeHandle);
  }
  private media(state: StreamState, payload: string) {
    const mulaw = Buffer.from(payload, 'base64'); state.inputAudioSeconds += mulaw.length / 8000;
    if (state.inputAudioSeconds + state.outputAudioSeconds > (state.number.maxAudioSeconds ?? 900)) { void this.limit(state, 'audio'); return; }
    if (state.closed) return;
    if (!state.live || state.reconnecting) { this.bufferDuringReconnect(state, mulaw); return; }
    state.live.sendAudio(mulaw8kToPcm16k(mulaw));
  }
  private output(state: StreamState, pcm: Buffer) {
    if (state.closed) return;
    state.outputAudioSeconds += pcm.length / 2 / 24000;
    if (state.inputAudioSeconds + state.outputAudioSeconds > (state.number.maxAudioSeconds ?? 900)) { void this.limit(state, 'audio'); return; }
    this.send(state, { event: 'media', streamSid: state.streamSid, media: { payload: pcm24kToMulaw8k(pcm).toString('base64') } });
    this.send(state, { event: 'mark', streamSid: state.streamSid, mark: { name: `audio-${state.turns}-${Date.now()}` } });
  }
  private send(state: StreamState, message: Record<string, unknown>) { if (state.ws.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify(message)); }
  private async flushTranscripts(state: StreamState) { if (state.inputTranscript) await this.store.addTurn(state.callSid, 'caller', state.inputTranscript); if (state.outputTranscript) await this.store.addTurn(state.callSid, 'marisol', state.outputTranscript); state.inputTranscript = ''; state.outputTranscript = ''; }
  private bufferDuringReconnect(state: StreamState, mulaw: Buffer) { const maxBytes = Math.floor(8000 * (state.number.maxLatencyMs ?? 750) / 1000); state.pendingInput.push(mulaw); state.pendingInputBytes += mulaw.length; let dropped = 0; while (state.pendingInputBytes > maxBytes && state.pendingInput.length) { const removed = state.pendingInput.shift(); if (removed) { state.pendingInputBytes -= removed.length; dropped += removed.length; } } if (dropped) void this.store.addRealtimeEvent(state.callSid, state.number.businessId, 'latency_drop', { droppedAudioMs: dropped / 8 }); }
  private async reconnect(state: StreamState) { if (state.closed || state.reconnecting) return; if (state.reconnects >= 1 || !state.resumeHandle) { await this.fail(state, new Error('Gemini Live disconnected')); return; } state.reconnects++; state.reconnecting = true; state.live = undefined; try { state.live = await this.connectLive(state); state.reconnecting = false; for (const chunk of state.pendingInput) state.live.sendAudio(mulaw8kToPcm16k(chunk)); state.pendingInput = []; state.pendingInputBytes = 0; await this.store.addRealtimeEvent(state.callSid, state.number.businessId, 'reconnected', { attempt: state.reconnects }); } catch (error) { state.reconnecting = false; await this.fail(state, error); } }
  private async limit(state: StreamState, limit: string) { if (state.closed) return; await this.store.addRealtimeEvent(state.callSid, state.number.businessId, 'limit_reached', { limit, turns: state.turns, inputAudioSeconds: state.inputAudioSeconds, outputAudioSeconds: state.outputAudioSeconds }); state.ws.close(1000, 'Call limit reached'); await this.finish(state, 'limit_reached', { limit }); }
  private async fail(state: StreamState, error: unknown) { if (state.closed) return; await this.store.addRealtimeEvent(state.callSid, state.number.businessId, 'upstream_error', { message: error instanceof Error ? error.message : String(error) }); state.ws.close(1011, 'Realtime service unavailable'); await this.finish(state, 'upstream_error', {}); }
  private async finish(state: StreamState, type: 'closed' | 'limit_reached' | 'upstream_error', payload: Record<string, unknown>) { if (state.closed) return; state.closed = true; if (state.timer) clearTimeout(state.timer); state.live?.close(); await this.flushTranscripts(state); await this.store.addRealtimeEvent(state.callSid, state.number.businessId, type, { ...payload, durationMs: Date.now() - state.started, turns: state.turns, inputAudioSeconds: state.inputAudioSeconds, outputAudioSeconds: state.outputAudioSeconds }); }
}

interface StreamState { ws: WebSocket; callSid: string; streamSid: string; number: VoiceNumber; live?: LiveAudioSession; started: number; timer?: ReturnType<typeof setTimeout>; inputAudioSeconds: number; outputAudioSeconds: number; turns: number; reconnects: number; liveGeneration: number; resumeHandle?: string; closed: boolean; reconnecting: boolean; pendingInput: Buffer[]; pendingInputBytes: number; inputTranscript: string; outputTranscript: string; }
