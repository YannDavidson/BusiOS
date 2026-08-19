# Google ADK Runtime Adapter

PR #14 introduces an opt-in Google Agent Development Kit runtime without replacing BusiOS's durable control plane.

## Architecture

- `src/agents/registry.ts` remains the canonical, version-controlled persona source.
- `src/adk/personas.ts` converts all eight personas into ADK `LlmAgent` definitions.
- Diego is the root coordinator. `ADK_PILOT_AGENTS` controls which specialists are attached as sub-agents.
- The initial pilot is Miguel and Lola. The other definitions exist but cannot be routed until explicitly enabled.
- Supabase remains authoritative for conversations, team runs, tasks, approvals, audit events, and execution receipts.
- Live Knowledge Drive retrieval happens before every planning, specialist, and synthesis call and remains tenant-scoped.
- ADK agents receive no provider credentials. Their only external-action tool creates an approval-pending proposal through `VerifiedActionService`.
- Marisol's Twilio Media Streams and Gemini Live audio path is unchanged.

## Safe rollout

Production deployment sets `ADK_RUNTIME_ENABLED=false`. To pilot ADK after PRs #12 and #13 are merged and deployed:

1. Keep `ADK_RUNTIME_FALLBACK_ENABLED=true`.
2. Set `ADK_PILOT_AGENTS=MIGUEL,LOLA`.
3. Set token prices for the selected Gemini model in `ADK_INPUT_COST_PER_MILLION` and `ADK_OUTPUT_COST_PER_MILLION` if cost estimates are required.
4. Set `ADK_RUNTIME_ENABLED=true` and deploy one test tenant first.
5. Review `adk.evaluation.completed` and `adk.fallback.activated` audit events.
6. Compare routing correctness, structured-output validity, latency, estimated cost, and owner-facing quality with the legacy runtime.

Any ADK exception, invalid route, malformed structured response, or empty response activates the existing Gemini runtime when fallback is enabled. Disable the feature flag to return all traffic to the legacy path without a code rollback.

## Agent Runtime boundary

This PR runs ADK inside the existing Cloud Run service. It does not deploy to Google Agent Runtime. Agent Runtime should be evaluated only after the pilot passes production-equivalent tenant-isolation, action-approval, quality, latency, cost, and fallback tests.

No database migration or new secret is required for PR #14.
