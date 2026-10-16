# Frontend/backend API contract

The backend defaults to `http://localhost:3002`. Use `Content-Type: application/json`. Authenticated requests send `Authorization: Bearer <Supabase access_token>`. Never send a user ID or token in the request body or URL.

## Health and readiness

- `GET /health`: liveness and non-secret setup flags: `{status, searchConfigured, guestsEnabled, answerMode}`. Does not call providers or prove database readiness.
- `GET /ready`: verifies required server settings and quota-table access. Returns 503 until the migration/settings are ready. No search/model calls.

## Model catalogue and choice

`GET /models` returns `{defaultModelId, canSelect, answerMode, models}`. An optional Bearer token is verified by Supabase; `canSelect` comes from that verified identity. An invalid token returns 401 rather than guest access. Each model has `{id, name, provider: "Groq", preview, available, unavailableReason?, maxInputBytes, maxOutputTokens}`. The backend's explicit approved catalogue contains only GPT-OSS 20B, GPT-OSS 120B, and Qwen 3.8 27B (Preview). Groq serves these models; it is not their creator.

Availability is checked against Groq's active-model metadata with a 60-second cache. Missing candidates remain visible but disabled; arbitrary models returned by Groq are never offered. Listing is not proof of account generation permission. A generation 403/404 temporarily disables that candidate for 60 seconds; errors never switch models. Metadata checks make no generation calls or spend search credits. A failed availability check blocks AI generation until a successful check.

Signed-in users persist their next choice with `PUT /conversations/:id/model`, body `{modelId}`. The server checks the verified owner and approved availability before writing. Response: `{selectedModelId}`. Guests receive 401; other owners receive 404. Model changes reserve no search allowance. The frontend serializes writes and blocks submission while a change is unsaved. Failure offers a manual save retry. An active answer keeps its original model.

New conversations start with `GROQ_MODEL` (currently `openai/gpt-oss-20b`). A user may select a different model before their first message; creation stores that choice. Existing conversations restore `selected_model`. A NULL selection on an older conversation uses the configured default for its next request, without rewriting any historical answer. A retired/unavailable stored ID blocks generation and asks for an explicit available choice.

## Search

### Guest verification session

Check `GET /guest/session` when an unsigned visitor arrives. Send a stored `X-Guest-Pass` header if available. Response: `{verified, verificationRequired, guestId, expiresAt}`. An absent, invalid, expired, or IP-mismatched pass returns `verified: false`; it never grants account access. Development without Turnstile returns `verificationRequired: false` but cannot mint verified passes. Production guests remain disabled without the Turnstile secret.

Render Turnstile with action `search` when verification is required. Exchange its successful token with `POST /guest/session`, body `{turnstileToken}`. The backend calls Siteverify, checks the action and allowed hostname, then returns `{pass, guestId, expiresAt}`. The endpoint uses the shared IP throttle and a ten-second deadline. It reserves no search quota and makes no Tavily/Groq calls.

Store the pass in browser `sessionStorage` and send `X-Guest-Pass` on guest searches. The server signs a random guest ID, IP hash, and fixed two-hour lifetime. Refreshes in the same tab reuse it; expiry, IP changes, or closing the tab require a new check. Every search still reserves durable quotas. Guest quota identity remains based on the IP hash, so a new session ID or cleared storage cannot reset it. Do not log raw Turnstile tokens, passes, or IPs.

On `BOT_SESSION_EXPIRED`, clear the pass and request verification again; do not automatically retry the search. CORS permits the header only from configured frontend origins. Header transport supports separate frontend/backend origins without third-party cookies. `X-Guest-Pass` is bot clearance, not Supabase authentication.

`POST /nuelexity_ask`

```json
{
  "query": "What is retrieval augmented generation?",
  "conversationId": "optional-existing-owned-UUID",
  "modelId": "optional-approved-model-ID",
  "turnstileToken": "guest-verification-token-when-enabled",
  "history": [{"role": "user", "content": "optional guest context"}]
}
```

- `query`: trimmed string, 1–1000 characters. Unknown body fields are rejected. JSON body maximum: 16 KB.
- `conversationId`: signed-in requests only; omitted to create a new thread. History is loaded from the server and checked against the verified owner.
- `modelId`: freezes the choice for this request. Unknown IDs return `UNKNOWN_MODEL` before bot checks, quota reservations, search or generation. A guest may omit it or send the configured default; requesting any other approved ID returns 403 `MODEL_SIGN_IN_REQUIRED`. For signed-in requests, omission uses the saved conversation selection, then the configured default if no selection exists. Existing-thread UI changes are persisted with the PUT endpoint; a request override does not overwrite a newer concurrent selection. No backend restart is required for per-request choices.
- `history`: guest requests only; maximum six plain user/assistant messages of 1000 characters each. Guest conversations are not persisted or automatically imported after sign-in.
- `turnstileToken`: legacy per-search verification remains supported when no `X-Guest-Pass` is sent. The current frontend exchanges this token through `/guest/session` and sends the signed pass instead. Verification requires action `search` and an allowed frontend hostname.
- Both new queries and follow-ups pass the same durable quotas. `POST /nuelexity_ask/follow_up` is an alias requiring conversation/history context.

Before opening a stream, errors use HTTP status codes and JSON. After opening a stream, errors use an `error` SSE event. The frontend must distinguish them.

## Streaming events, protocol v1

Use POST `fetch` and a `ReadableStream` parser rather than `EventSource`, which cannot send the JSON body and Bearer header. Every packet uses `event: name`, `data: JSON`, and a blank line. Network chunks do not correspond to packet boundaries. Heartbeats are SSE comments.

| Event | JSON data | Meaning |
| --- | --- | --- |
| `meta` | `{requestId, conversationId, answerMode, remaining, requestedModelId}` | Thread ID is null for guests; requestedModelId freezes the requested choice, not successful attribution; remaining is personal daily allowance after this reservation |
| `status` | `{stage: "searching" \| "answering"}` | Work phase |
| `sources` | `{sources: [{id, title, url, snippet}]}` | Up to five deduplicated HTTP(S) sources, IDs starting at 1 |
| `delta` | `{text}` | Append text; never replace the entire answer |
| `follow_ups` | `{questions: string[]}` | Zero to three optional contextual suggestions (12–160 characters each), validated from the same completion; no second model call |
| `done` | `{conversationId, model, answerKind}` | The answer finished and signed-in persistence succeeded; model is actual provider-confirmed attribution or null |
| `error` | `{code, message, retryAfter?}` | Terminal failure; keep partial text/sources but show an incomplete state; retryAfter is seconds |

An EOF without `done` or `error` is an interrupted connection, not success. Abort fetch to stop work. Answers are limited to 12,000 characters; Groq output is limited to 1024 tokens. A provider token limit before the explicit answer/footer boundary or missing completion marker is a failure. A token cap confined to the optional footer can retain the confirmed completed answer and omit suggestions. Sources are untrusted; render plain text or sanitized Markdown, never raw HTML. Link citations only to the matching returned source ID. The LLM receives source excerpts, never API keys.

`model` is `{id, name, provider: "Groq", preview}` from the provider-confirmed ID and backend catalogue. Groq must return the exact requested model, a successful finish marker, and `[DONE]`; a mismatch, missing attribution, answer-body token limit or interrupted stream cannot become success. A `length` finish wholly inside the recognized optional footer is accepted only with a nonempty completed answer, the exact confirmed model and `[DONE]`; malformed footer JSON is omitted. Streaming/failed answers never claim successful model attribution. `answerKind` is `ai`, `sources-only`, or `no-sources`. The latter two have `model: null` and explicitly display that no model was used. Historical messages lacking both fields display **Model unknown**, even when the default or catalogue changes.

All candidates share the existing durable account/IP/global request budgets, leases, deadlines and failed-attempt policy. Each generation bounds combined system/user content to 6,000 UTF-8 bytes including a 128-byte framing allowance, plus at most 1,024 output tokens. The prompt builder removes oldest bounded history first, then shortens evidence excerpts; it preserves the question and evidence from every source. A question that cannot fit fails rather than silently replacing its model. This is a conservative input/output bound, not a new token-ledger quota or a guarantee against provider minute limits. Model switching never changes quota subjects. GPT-OSS uses low reasoning effort; Qwen uses none; private reasoning is excluded from UI deltas.

The internal suggestion footer is removed before any visible delta and before persistence, including failure paths. Its delimiter prefixes are buffered across chunks and its metadata buffer is capped at 2,048 characters. The strict payload has at most three `{question,anchor}` entries, validated to plain question strings; anchors must match both the question and bounded context/answer. Invalid, generic, duplicate, previously asked or ungrounded entries are dropped without fallback. Suggestions share the same 1,024 output tokens, typically taking roughly 100–220 English tokens; the prompt aims below 750 answer tokens. No additional model call, quota reservation, retry or token-cap increase occurs. The frontend stages the optional event until `done`, ignores invalid optional payloads, and retains truthful incomplete states for interrupted streams.

## Conversations

- `GET /conversations?offset=0` → `{conversations: [{id,title,created_at,updated_at,selected_model}]}`, 30 per page, newest first. Offset: 0–10000. `/conversation` remains a compatibility alias.
- `GET /conversations/:id` → `{conversation, messages}`. Maximum 60 messages ordered by database sequence.
- `DELETE /conversations/:id` → 204, cascades messages.
- Guests receive 401; a different user's ID receives 404. All IDs are UUIDs.
- Message shape: `{id, role, content, sources, followUps, status, created_at, model, answerKind}`. Roles: `user`/`assistant`. Persisted statuses: `complete`/`failed`. SQL fields are `model` JSONB and `answer_kind`; old rows retain NULL metadata.
- A full thread must be followed by a new search. Saved conversations are private; public sharing is not implemented.

## Errors and quotas

```json
{"error":{"code":"DAILY_LIMIT","message":"Search limit reached. Please wait before trying again."}}
```

Status codes: 400 invalid body/ID/context, 401 auth, 403 origin/bot check, 404 missing or unowned thread, 409 full thread, 413 oversized body, 429 quota/concurrency, 503 service/configuration failure. Timeouts after stream start emit `TIMEOUT`.

429 responses include `Retry-After` seconds. Quota codes include `DAILY_LIMIT`, `IP_DAILY_LIMIT`, `GLOBAL_DAILY_LIMIT`, `GLOBAL_MONTHLY_LIMIT`, `GLOBAL_MINUTE_LIMIT`, and `REQUEST_IN_PROGRESS`. No automatic retry. Failed requests retain reservations once acquired; provider costs may already have occurred.

Model errors include `UNKNOWN_MODEL` (400), `MODEL_SIGN_IN_REQUIRED` (403), `MODEL_UNAVAILABLE`/`MODEL_PERMISSION` (409), `MODEL_RATE_LIMIT` (429), `MODEL_CATALOGUE_UNAVAILABLE`/`ANSWER_UNAVAILABLE` (503), and incomplete/mismatched attribution errors (502). After stream start they use terminal SSE errors, with `retryAfter` when supplied. The UI preserves partial output, restores the draft question and requires a manual new submission. No model or sources-only fallback is automatic.

The additive `202610140001_model_selection.sql` migration is required before serving the updated persistence routes. `/ready` checks its columns with zero-row reads and returns 503 if absent. See [model-selection delivery and adoption](MODEL_SELECTION.md) for exact application/verification steps and the distinction between offline tests and live provider checks.

Empty `/signup` and `/login` endpoints now return 410 with instructions to use Supabase OAuth. The preserved `/requestlity_nuelexity` dummy handler is a separate development artifact; it does not follow this protocol or call providers.
