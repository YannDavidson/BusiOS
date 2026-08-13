# Multi-Agent Runtime

The runtime turns the persona registry into a durable, approval-gated operating team. Diego is the Chief Intelligence Officer and the only owner-facing orchestrator. Specialist agents analyze or draft within their domains and return structured results to Diego.

## Lifecycle

1. Diego receives an owner objective.
2. Gemini produces a typed plan with the smallest effective set of specialists.
3. BusiOS persists a `team_run` and its `agent_tasks` before work begins.
4. Consequential, reversible, or restricted assignments put the run in `awaiting_approval`.
5. `APPROVE` moves the run to `running`; `CANCEL` prevents execution.
6. Each specialist returns findings, proposals, assumptions, and confidence.
7. Diego reconciles conflicts and produces one attributed synthesis.
8. The run, tasks, results, and audit events remain available for status and learning.

The current runtime performs analysis and drafting. It deliberately sets `executionReady=false` until a verified integration adapter returns an execution receipt. Owner approval authorizes team analysis; it does not fabricate a customer message, booking, payment, publication, or other external action.

## WhatsApp commands

| Command | Result |
|---|---|
| `TEAM` | Lists Diego and every specialist |
| `PLAN <objective>` | Creates and persists a multi-agent plan |
| `APPROVE` | Runs the pending approved team plan |
| `CANCEL` | Cancels the pending team plan |
| `STATUS` | Shows the latest run and task states |
| `ASK LOLA <question>` | Sends an informational request directly to a specialist |
| `MEMORY` | Summarizes the current Business Brain fields |
| `CORRECT field=value` | Corrects an existing Business Brain field and audits the change |

Spanish aliases include `EQUIPO`, `PLANEAR`, `PREGUNTAR`, `ESTADO`, `CANCELAR`, `MEMORIA`, and `CORREGIR`. Portuguese aliases include `EQUIPE`, `PLANEJAR`, `PERGUNTAR`, `ESTADO`, `CANCELAR`, `MEMÓRIA`, and `CORRIGIR`.

## Production prerequisite

Run `supabase/migrations/003_multi_agent_runtime.sql` before merging the deployment PR. It creates `team_runs`, `agent_tasks`, indexes, RLS, and `conversation_states.pending_run_id`.
