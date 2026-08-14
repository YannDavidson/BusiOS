# Marisol Voice Foundation

Marisol answers each business through its own Twilio voice-enabled number. The inbound `To` number is the tenant-routing key; an unassigned or inactive number fails closed. The first greeting explicitly identifies Marisol as an AI receptionist.

## Twilio configuration

For every business number, configure:

- **A call comes in:** `POST https://YOUR_DOMAIN/webhooks/twilio/voice`
- **Call status changes:** `POST https://YOUR_DOMAIN/webhooks/twilio/voice/status`

The application generates the speech-turn callback at `/webhooks/twilio/voice/gather`. All three endpoints validate `X-Twilio-Signature` outside tests.

## Provision a business

After running migration 004, add one `voice_agent_settings` row and one `voice_numbers` row. Use E.164 phone numbers. FAQ content is an array such as:

```json
[
  {
    "question": "What are your hours?",
    "answer": "We are open Monday through Saturday from 9 AM to 6 PM.",
    "keywords": ["hours", "open", "closing"]
  }
]
```

Greetings, FAQ answers, fallback text, transfer number, and language are tenant-specific. Only approved FAQ answers are spoken. Appointment requests are explicitly simulation-only until a calendar adapter returns a verified receipt.

## Call lifecycle

`call_sessions` stores Twilio `CallSid`, tenant, status, transcript, and Diego's summary. `call_actions` stores FAQ responses, captured messages, simulated appointments, transfers, and fallbacks. Terminal status callbacks ask Diego to create a factual summary and write an auditable `marisol.call.summary` event for the Business Brain.

Do not enable recording by default. Recording, outbound AI calls, marketing, and sensitive-data workflows require separate consent, retention, and jurisdiction-specific policies.
