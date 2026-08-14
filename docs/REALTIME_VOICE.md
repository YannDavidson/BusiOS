# Realtime Voice

Realtime voice is opt-in for each tenant. When `voice_agent_settings.realtime_enabled` is false, PR #7's signed TwiML speech-gathering flow remains active. When enabled, the inbound webhook returns `<Connect><Stream>` and Twilio opens a signed bidirectional WebSocket to BusiOS.

## Audio bridge

- Twilio inbound: base64 μ-law, 8 kHz
- Gemini Live inbound: raw signed 16-bit PCM, 16 kHz
- Gemini Live outbound: raw signed 16-bit PCM, 24 kHz
- Twilio outbound: base64 μ-law, 8 kHz

BusiOS performs deterministic transcoding in memory and does not record raw audio. Input and output transcriptions are appended to the existing call session for Diego's terminal summary.

## Turn-taking and resilience

Gemini automatic voice activity detection is enabled with start-of-activity interruption. When Gemini reports an interruption, BusiOS sends Twilio `clear` to discard buffered model audio. Every output chunk receives a Twilio `mark` for playback accounting.

Gemini session resumption handles are retained in memory. A GoAway or unexpected upstream close gets one resumable reconnect attempt. A second failure closes the stream safely and records an `upstream_error` event; Twilio's normal status callback completes the call lifecycle.

## Tenant limits

Each business controls:

- `max_duration_seconds` (30–900)
- `max_turns` (1–100)
- `max_audio_seconds` (combined input and output, 30–1800)
- `max_latency_ms` (250–2000; bounds audio retained during reconnect)
- `live_voice`

Limit events and final usage totals are persisted in `realtime_voice_events`. These controls bound latency, cost, and runaway sessions. Cloud Run request timeout must be at least the configured maximum call duration.

## Activation

1. Run migration 005.
2. Confirm the PR #7 number and settings rows exist.
3. Set conservative limits and a supported Gemini Live voice.
4. Set `realtime_enabled=true` for one test tenant only.
5. Call the business number and verify `call_sessions`, `realtime_voice_events`, transcripts, and the terminal Diego summary.

Gemini Live is a preview API. Keep the TwiML fallback enabled operationally and activate tenants gradually.
