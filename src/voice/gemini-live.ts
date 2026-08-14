import { ActivityHandling, GoogleGenAI, Modality, type LiveServerMessage, type Session } from '@google/genai';
import { config } from '../config.js';
import type { VoiceNumber } from './types.js';

export interface LiveHandlers {
  audio(data: Buffer): void; interrupted(): void; inputTranscript(text: string): void;
  outputTranscript(text: string): void; turnComplete(): void; resumeHandle(handle: string): void;
  goAway(): void; error(error: Error): void; close(): void;
}
export interface LiveAudioSession { sendAudio(pcm16k: Buffer): void; close(): void; }
export interface LiveConnector { connect(number: VoiceNumber, handlers: LiveHandlers, resumeHandle?: string): Promise<LiveAudioSession>; }

export class GeminiLiveConnector implements LiveConnector {
  private ai = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });
  async connect(number: VoiceNumber, handlers: LiveHandlers, resumeHandle?: string): Promise<LiveAudioSession> {
    const session: Session = await this.ai.live.connect({
      model: config.GEMINI_LIVE_MODEL,
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: number.liveVoice ?? 'Kore' } } },
        systemInstruction: { parts: [{ text: systemInstruction(number) }] },
        realtimeInputConfig: { activityHandling: ActivityHandling.START_OF_ACTIVITY_INTERRUPTS },
        inputAudioTranscription: {}, outputAudioTranscription: {},
        sessionResumption: { handle: resumeHandle, transparent: true },
        contextWindowCompression: { slidingWindow: {} }
      },
      callbacks: {
        onmessage: (message) => routeMessage(message, handlers),
        onerror: (event) => handlers.error(event.error instanceof Error ? event.error : new Error('Gemini Live error')),
        onclose: () => handlers.close()
      }
    });
    if (!resumeHandle) session.sendClientContent({ turns: `Begin the call now by saying exactly this approved greeting, then listen: ${number.greeting} I am Marisol, the AI receptionist.`, turnComplete: true });
    return { sendAudio: (pcm16k) => session.sendRealtimeInput({ audio: { data: pcm16k.toString('base64'), mimeType: 'audio/pcm;rate=16000' } }), close: () => session.close() };
  }
}

function routeMessage(message: LiveServerMessage, handlers: LiveHandlers) {
  if (message.data) handlers.audio(Buffer.from(message.data, 'base64'));
  if (message.serverContent?.interrupted) handlers.interrupted();
  const input = message.serverContent?.inputTranscription?.text; if (input) handlers.inputTranscript(input);
  const output = message.serverContent?.outputTranscription?.text; if (output) handlers.outputTranscript(output);
  if (message.serverContent?.turnComplete) handlers.turnComplete();
  const resume = message.sessionResumptionUpdate; if (resume?.resumable && resume.newHandle) handlers.resumeHandle(resume.newHandle);
  if (message.goAway) handlers.goAway();
}

function systemInstruction(number: VoiceNumber) {
  return `You are Marisol, the AI Customer Experience and Reception Lead for ${number.businessName}. Speak in ${number.language === 'es' ? 'Spanish' : number.language === 'pt' ? 'Portuguese' : 'English'} unless the caller clearly uses another supported language. Be warm, concise, and natural. Use only these approved FAQs: ${JSON.stringify(number.faqs)}. Never invent prices, hours, availability, policies, or execution. Appointment requests are simulation-only: collect details and clearly say they are not confirmed. Offer human transfer when appropriate. Never take card data, passwords, government IDs, medical details, or other sensitive secrets. Keep each response brief for phone latency.`;
}
