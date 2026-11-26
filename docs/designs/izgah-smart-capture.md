# Izgah — Smart capture

*   **Author:** Gorkem Inanc Ozdemir
*   **Status:** Approved
*   **Date:** 2026-11-26

--------------------------------------------------------------------------------

## Overview

Sections are optional when sharing, so most links arrive without one and pile up on the admin's "Unassigned" screen. Search covers titles, descriptions, notes and URL parts, but not what a page actually says.

Smart capture adds three layers, cheapest first:

| Layer | What it does | Needs |
| :--- | :--- | :--- |
| `#section` in the note | `Great intro #frontend` files the link under Frontend. | Nothing |
| History suggestions | "Links from this site went to Frontend 8 times out of 10", similar titles, and the sections earlier shares of the same link used. | Nothing |
| AI enrichment | One structured call per link: section suggestions (existing sections only), a one- or two-sentence neutral summary, search keywords in the team's languages, and the page language. | An admin-provided key (OpenRouter, Anthropic, OpenAI, Gemini) or a local OpenAI-compatible server |

The preview worker also keeps the readable text of each page (at most 20,000 characters), and search indexes it.

This revisits the "no AI" non-goal of [izgah-core.md](./izgah-core.md); see [izgah-roadmap.md](./izgah-roadmap.md).

## Goals

*   Fewer unsectioned links without making sharing slower: the share request still never waits for the network.
*   AI is optional, admin-only, off until configured, and the operator can switch it off.
*   Admins see exactly what leaves the server.
*   Every automatic change says it was automatic and can be undone in one click.
*   No new runtime dependency; still one container.

## Non-goals

*   Freeform tags (unchanged; keywords are hidden search terms, not tags).
*   Models writing or rewriting members' notes.
*   Creating sections automatically.
*   Chat with the library, semantic or vector search, related links (roadmap R9).
*   Suggestions in the browser extension's UI (R6). The `/api/v1/links/check` response already carries them.

## Design

### 1. Pipeline

```
share ──▶ link_shares (+ #section) ──▶ unfurl_jobs ──▶ canonical_resources (+ content_text)
                                                   └─▶ enrichment_jobs ──▶ history suggestions
                                                                        └─▶ AI call (optional) ──▶ resource_enrichments,
                                                                                                   ai_keywords, AI suggestions
```

1.  `createLinkShare` and `updateLinkShare` parse `#section` hashtags synchronously (database only).
2.  When an unfurl job completes or dies, the same transaction upserts an `enrichment_jobs` row for the resource. A new share of an already-unfurled resource also upserts one.
3.  The in-process enrichment worker (same lease and fencing rules as the unfurl worker; `AI_CONCURRENCY`, default 1) computes history suggestions, optionally calls the model, and writes suggestions for the resource's feed-visible shares that have no section and no earlier suggestion.

### 2. `#section` hashtags

*   Tokens matching `#[\p{L}\p{N}][\p{L}\p{N}_-]*` in the note.
*   A token matches a section when its slug (`slugifySectionName`) equals the section's slug or the slug of its name, or is a prefix (at least 3 characters) of exactly one of them. Ambiguous and unknown tokens are left alone.
*   Matched sections are added to the share, never removed. A trailing run of matched hashtags is removed from the note (`Great intro #frontend #css` → `Great intro`); hashtags inside the sentence stay as written.
*   It works the same for the web form, the JavaScript-off form, the extension and `/api/v1`, because it runs in the service layer.
*   Hashtags never make a share silent; silent shares still need an explicit section choice.

### 3. History suggestions

For resource *R* (domain *D*, title *T*), each section *S* gets a score:

| Signal | Score |
| :--- | :--- |
| Another active share of *R* is in *S* | +1.0 |
| Among active, sectioned shares of other resources on *D* (n ≥ 3), *S* has c ≥ 2 of them and c/n ≥ 0.4 | +0.8 × c/n |
| Among up to 10 resources whose title is trigram-similar to *T* (`similarity ≥ 0.35`, at least 2 such neighbours with sections), *S*'s part of the summed similarity | +0.6 × part |

Sections scoring at least 0.45 are suggested, at most 3, best first. Before sharing (the duplicate check) a new URL has no title yet, so only the domain signal and, for known resources, the other signals and stored AI suggestions apply.

Admins can switch history suggestions off on `/admin/ai`.

### 4. Page text

`fetchHtmlMetadata` keeps reading after `</head>` (at most 512 KB of HTML in total) and extracts readable text: the text inside `<article>` or `<main>` when it has at least 500 characters, otherwise the body text. `script`, `style`, `noscript`, `template`, `svg`, `nav`, `header`, `footer`, `aside`, `form`, `button`, `select` and `iframe` are skipped and whitespace is collapsed. At most 20,000 characters are stored in `canonical_resources.content_text`; a later unfurl that finds no text keeps the previous text.

The search trigger adds `ai_keywords` (weight C) and `content_text` (weight D) with the `simple`, `turkish` and `english` configurations, so title and note matches still rank first. Snippets (`ts_headline`) are roadmap R4.

### 5. AI providers

Two wire formats cover every provider. Requests are deliberately minimal (model, messages, schema): no `temperature`, and no `max_tokens` where the API allows it, because names and support differ between models.

| Provider | Base URL | Format |
| :--- | :--- | :--- |
| OpenRouter | `https://openrouter.ai/api/v1` | OpenAI-compatible, plus `provider.require_parameters: true` so only endpoints that honour the schema serve the request |
| OpenAI | `https://api.openai.com/v1` | OpenAI-compatible |
| Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | OpenAI-compatible |
| Custom (Ollama, LM Studio, vLLM, …) | admin-provided `http(s)` URL | OpenAI-compatible; key optional |
| Anthropic | `https://api.anthropic.com/v1` | Messages API |

*   **OpenAI-compatible:** `POST {base}/chat/completions` with `response_format: { type: "json_schema", json_schema: { name, strict: true, schema } }`. If a server rejects that with HTTP 400, the call is retried once with `{ type: "json_object" }` and the JSON is validated locally.
*   **Anthropic:** `POST /v1/messages` with `anthropic-version: 2026-10-21`, `x-api-key`, `max_tokens: 1024` (required by this API) and `output_config: { format: { type: "json_schema", schema } }`.
*   **Model lists:** `GET {base}/models` (Anthropic: `GET /v1/models?limit=1000`). OpenRouter's list is filtered to models that support structured outputs, Anthropic's to models whose capabilities report structured outputs, and Gemini's `models/` prefix is stripped. The list is fetched only when an admin asks for it and is stored with the settings; no model name is hard-coded.
*   Provider calls use plain `fetch` with `redirect: "error"`, a 60-second timeout and a 1 MB response cap (8 MB for model lists). They do not go through `safeFetch`: a local model may live on a private network, and the address comes only from an admin. Page fetches keep using `safeFetch`.

### 6. Prompt and output contract

The system prompt says that page content is untrusted data and must never be followed as instructions. The user message contains the section list (as `s1`…`sN` with names and descriptions), the link (URL, site, type, title, description), optionally the members' notes, and a page excerpt (the first 6,000 characters of `content_text`) between delimiters.

The JSON schema is built per call from the enabled features:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["language", "summary", "keywords", "sections"],
  "properties": {
    "language": { "type": "string" },
    "summary": { "type": "string" },
    "keywords": { "type": "array", "items": { "type": "string" } },
    "sections": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["key", "confidence"],
        "properties": {
          "key": { "type": "string", "enum": ["s1", "s2", "s3"] },
          "confidence": { "type": "string", "enum": ["high", "medium", "low"] }
        }
      }
    }
  }
}
```

Disabled features and an empty section list remove their properties. The output is validated with zod and cleaned:

*   **Summary:** plain text without URLs or control characters, at most 400 characters, written in the instance's `DEFAULT_LOCALE`.
*   **Keywords:** lowercased, de-duplicated, at most 10 of at most 40 characters, in the instance language and English.
*   **Sections:** keys are mapped back to section IDs that still exist; `low` suggestions are dropped.

`PROMPT_VERSION` and an input hash (provider, model, prompt version, inputs, feature flags) prevent paying twice for the same input.

### 7. Section modes

| Mode | Behaviour |
| :--- | :--- |
| Off | No AI section suggestions (summaries and keywords may still run). |
| Suggest (default) | `high` and `medium` suggestions are offered to the author and to admins. |
| Automatic | `high` suggestions (at most 2) are added to feed-visible shares that have no section; the card says "Added by AI · Undo". `medium` suggestions are still offered. |

Silent shares always have a section, so they are never touched.

### 8. Data model (`drizzle/0002_smart_capture.sql`)

The migration only adds; the previous image keeps working against it.

| Object | Columns and purpose |
| :--- | :--- |
| `instance_settings` | `key` PK, `value jsonb`, `secret text` (AES-256-GCM), `updated_by_id`, `updated_at`. Smart capture uses the key `smart_capture`. |
| `canonical_resources` | + `content_text text`, + `ai_keywords text[] NOT NULL DEFAULT '{}'`; the search trigger is extended. |
| `enrichment_jobs` | Same shape and lease/fence rules as `unfurl_jobs`; one row per resource. |
| `resource_enrichments` | `resource_id` PK, `summary`, `language`, `suggested_sections jsonb` (`[{ sectionId, confidence }]`), `provider`, `model`, `prompt_version`, `input_hash`, timestamps. |
| `share_section_suggestions` | PK `(share_id, section_id)`, `source` (`history` \| `ai`), `status` (`pending` \| `accepted` \| `dismissed` \| `auto_applied`), `resolved_by_id`, `resolved_at`, `created_at`. A dismissed suggestion is never offered again for that share. |
| `ai_usage_daily` | PK `(day, provider, model)`: requests, input and output tokens, failures. |
| `audit_logs_action_known_check` | + `admin.ai_settings_updated`, `admin.ai_key_updated`, `admin.ai_key_removed`, `admin.ai_backfill_started`, `admin.ai_data_purged`, `admin.ai_jobs_retried`. |

### 9. Admin screen (`/admin/ai`, "Smart capture")

One page of plain forms:

*   **Status:** off, on (provider · model) or paused (key rejected or unreadable), and today's requests against the limit.
*   **Suggestions from history:** on or off.
*   **AI** (replaced by a note when `AI_FEATURES=off`):
    *   Provider (radio list), base URL (custom only), API key (write-only, shown as `••••1a2b`; an empty field keeps the stored key; "Remove key"), model (text input with a `<datalist>` filled by "Fetch models").
    *   "Test connection" sends a tiny structured request with the submitted values and reports success or the HTTP status.
    *   Features: section mode, summaries, keywords.
    *   Privacy: the exact list of what is sent; "Send a page excerpt" (on), "Include members' notes" (off), excluded domains (one per line, subdomains included).
    *   Daily request limit (default 200).
    *   Queue: queued, running and failed counts; "Retry failed"; "Enrich existing links" (resources with active shares and no enrichment); "Delete AI data" (summaries, keywords and AI suggestions; sections that were already accepted stay). "Delete AI data" asks for a confirmation checkbox, which works the same with and without JavaScript.
*   Every change is audited, never with the key. A `401` or `403` from the provider pauses AI and shows a badge on the admin tab until the key is fixed; a successful test clears it.

### 10. Suggestions in the UI

*   **Share form:** the duplicate check returns `suggestedSections` (history and stored AI suggestions). They are listed first in the section picker, marked "suggested", and never pre-checked. The note hint mentions `#section`.
*   **Feed and section pages:** for the author and admins, a line under the link reads "Suggested: Frontend — Add · Dismiss" (each button is a form). Auto-applied sections read "Added by AI: Frontend — Undo". Other members see nothing.
*   **Unassigned (admin):** each row shows its suggestions with "Add"; "Accept all suggestions" applies every pending suggestion on the page.
*   **Resource page and side peek:** the summary appears as "Summary (AI)" under the description while summaries are enabled.

### 11. Security and privacy

| Risk | Mitigation |
| :--- | :--- |
| Prompt injection from page text | The model has no tools; output is limited by the schema; section IDs are re-validated; the summary is plain text without URLs, at most 400 characters; the default mode only suggests. |
| Data leaving the server | Off until an admin configures it; the exact "what is sent" list is on the page; notes are off by default; excluded domains; local models are supported. Never sent: member names, e-mail addresses, comments, likes, other links. |
| Key exposure | AES-256-GCM with a key derived from `BETTER_AUTH_SECRET` (HKDF-SHA256); never returned to the browser or logged; provider error messages are sanitised. Rotating `BETTER_AUTH_SECRET` makes the stored key unreadable, and the page asks for it again. |
| Cost | One call per resource and input hash, a 6,000-character excerpt, a daily request limit, concurrency 1, a pause on `401`/`403`, back-off on `429`. |
| Failures | AI failures never affect sharing or previews; three attempts (back-off of 1 and 10 minutes), then "failed" with a retry on `/admin/ai`. |
| Operator control | `AI_FEATURES=off` hides the AI settings and stops all AI calls; history suggestions and hashtags keep working. |

### 12. Environment

| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `AI_FEATURES` | `on` | `off` hides the AI settings and disables AI calls for the instance. |
| `AI_CONCURRENCY` | `1` | Parallel enrichment jobs (1–4). |

### 13. Testing

*   **Unit:** hashtag parser, history scoring, text extraction, the secret box, provider adapters against a fake `fetch` (bodies, headers, errors, fallbacks, model lists), schema building and output cleaning.
*   **Integration** (`tests/integration/m15-smart-capture.test.ts`): settings encryption and access, hashtags through `createLinkShare` and `updateLinkShare`, history suggestions, enrichment with a fake provider (summary, keywords in search, suggest and automatic modes, undo, silent shares untouched, daily limit, pause on `401`, purge), `suggestedSections` in the duplicate check.
*   **E2E** (`tests/e2e/m17-smart-capture.spec.ts`): an admin connects a local fake OpenAI-compatible server; a seeded link gets a suggestion; the author adds it with and without JavaScript; a member cannot open `/admin/ai`.

## Alternatives considered

*   **Vercel AI SDK or provider SDKs.** Five or more packages for one "return JSON" call, and the wire formats would still need custom handling. Rejected.
*   **Freeform AI tags.** Brings back the synonym sprawl the core design avoided; hidden bilingual keywords give the search benefit without it.
*   **Calling the model during the share request.** Breaks the "sharing never waits" rule. Rejected.
*   **Embeddings and vector search.** Needs `pgvector` or a second store and costs more; trigram similarity on titles is enough for suggestions. Revisit in R9.
*   **A separate `SECRETS_KEY`.** One more variable for every self-hoster; deriving the key from `BETTER_AUTH_SECRET` is enough, and rotating that secret already resets sessions.

## Risks

| Risk | Mitigation |
| :--- | :--- |
| Page text grows the database | 20,000-character cap: roughly 20–40 MB per 1,000 links including the search index. |
| Suggestions feel noisy | Dismissals stick per share; history suggestions can be switched off; AI defaults to suggest-only. |
| Providers change their formats | Two adapters behind one interface; the model list, errors and the test button make breakage visible on the admin page. |
