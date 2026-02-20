# cmemory — Architecture & Planning Prompt

## The Core Idea

cmemory is a **lesson memory system for Claude Code CLI**. Claude saves and retrieves lessons via MCP tools, with a single hook nudging it to use them. No background synthesis, no hidden pipelines — Claude is the synthesizer.

**Three channels, one store:**

1. **`CLAUDE.md`** — Project profile + top lessons + MCP tool instructions. Claude reads this on every session start and immediately knows the project and its tools.
2. **MCP tools** — `search_lessons`, `save_lesson`, `reject_lesson`, `update_profile`. Claude actively searches, saves, and curates.
3. **`UserPromptSubmit` hook** — A lightweight nudge on every prompt reminding Claude to use its MCP tools. No embedding, no search — just a text reminder.

---

## High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                         Claude Code CLI                              │
│                                                                      │
│  Session Start → reads CLAUDE.md (profile + lessons + MCP instructions) │
│                                                                      │
│  User: "login is broken"                                             │
│           │                                                          │
│           ▼                                                          │
│  ┌─────────────────────┐    ┌──────────────────────────────────┐    │
│  │  UserPromptSubmit   │    │  MCP Tools (Claude calls these)   │    │
│  │  Hook (nudge only)  │    │  • search_lessons(query)          │    │
│  │  ↓ "Use cmemory     │    │  • save_lesson(content, tags)     │    │
│  │    tools to search" │    │  • reject_lesson(id, reason)      │    │
│  └─────────────────────┘    │  • update_profile(content)        │    │
│                              └──────────────────────────────────┘    │
│                                         │                            │
└─────────────────────────────────────────┼────────────────────────────┘
                                          │
                                          ▼
┌──────────────────────────────────────────────────────────────────────┐
│                        cmemory MCP Server                            │
│                                                                      │
│  Embeddings: nomic-embed-text-v1.5 via transformers.js (WASM)        │
│  Storage: JSON files in .claude/cmemory/ (project-scoped)            │
│  Search: Brute-force cosine similarity, 0.55 threshold               │
│  CLAUDE.md: Auto-updated when lessons/profile change                 │
└──────────────────────────────────────────────────────────────────────┘
```

---

## MCP Tools — The Primary Interface

### `search_lessons` — Find relevant lessons

**Input:** `{ query: string }`

**What it does:**
1. Embed the query with `getQueryEmbedding(query)` (prepends `search_query: ` prefix for nomic)
2. Load all lessons from `.claude/cmemory/lessons.json`
3. Cosine similarity search, threshold 0.55, top 5 results
4. Return matched lessons with content, tags, and similarity scores

**Returns:** Markdown-formatted list of matching lessons, or "No matching lessons found" if none above threshold.

```typescript
// Example return
`Found 3 matching lessons:

1. [0.78] **Stripe webhook handler** (tags: api/webhooks.ts, stripe)
   The Stripe webhook handler silently drops events when signature verification throws. Catch the error explicitly and return 400.

2. [0.71] **Webhook retry logic** (tags: api/webhooks.ts, retry)
   Stripe retries webhooks for up to 72 hours. If the handler returns 500, you'll get duplicate events. Always return 200 or 400, never 500.

3. [0.59] **Payment processing** (tags: lib/payments.ts)
   The payment amount must be in cents for Stripe but dollars for the UI. Convert at the API boundary in lib/payments.ts, not in components.`
```

### `save_lesson` — Store a new lesson

**Input:** `{ content: string, tags?: string[], force?: boolean }`

**What it does:**
1. Embed the content with `getDocumentEmbedding(content)` (prepends `search_document: ` prefix)
2. **Dedup check** (skip if `force: true`): Search existing lessons with the new embedding at 0.50 threshold
3. If similar lessons found, return them to Claude and ask whether to proceed or skip:
   - "Similar lesson already exists: [content]. Call save_lesson again with force: true to save anyway, or skip if this is a duplicate."
4. If no similar lessons (or `force: true`):
   - Generate UUID, create lesson object, append to `lessons.json`
   - Call `updateClaudeMd()` to refresh the CLAUDE.md managed sections
5. Return confirmation with lesson ID

**Why dedup happens here, not in background:** Claude has the full context of what it just learned and why. It's better positioned to decide "is this the same thing?" than a background process running after the session ends.

**Hard cap: 50 lessons per project.** If saving would exceed 50, return an error: "Lesson limit reached (50). Use reject_lesson to remove outdated lessons first." This keeps the store bounded without scoring/decay infrastructure.

### `reject_lesson` — Remove a wrong or stale lesson

**Input:** `{ lessonId: string, reason?: string }`

**What it does:**
1. Find the lesson by ID in `lessons.json`
2. Remove it from the array
3. Save updated `lessons.json`
4. Call `updateClaudeMd()` to refresh CLAUDE.md
5. Return confirmation

**When Claude uses this:** When it encounters a lesson during `search_lessons` that contradicts what it's currently seeing in the code. Claude has the live codebase context to know when a lesson is stale.

### `update_profile` — Update the project profile

**Input:** `{ content: string }`

**What it does:**
1. Write content to `.claude/cmemory/profile.md`
2. Call `updateClaudeMd()` to refresh the profile section in CLAUDE.md
3. Return confirmation

**When Claude uses this:** When it learns something structural about the project — the stack, architecture, data model, auth approach, deployment setup, audience, conventions. The CLAUDE.md instructions tell Claude when and how to use this tool.

---

## `CLAUDE.md` — The Persistent Knowledge Layer

cmemory writes three managed sections into `CLAUDE.md` using comment markers. Claude reads this file on every session start — zero runtime cost, zero hooks needed.

```markdown
# Project Instructions

(user's own content here — untouched by cmemory)

<!-- cmemory:tools-start -->
## cmemory Tools

You have access to lesson memory tools. Use them proactively:

- **search_lessons** — Search for relevant lessons before starting work on a task. Query with natural language describing what you're about to do.
- **save_lesson** — When you discover something non-obvious (a bug root cause, a gotcha, a pattern that's easy to get wrong), save it as a lesson. Write 1-3 sentences. Include file paths and concepts as tags.
- **reject_lesson** — If a search result is wrong or outdated based on what you see in the code, reject it so it doesn't mislead future sessions.
- **update_profile** — If you learn something structural about this project (stack, architecture, data model, auth, deployment, audience), update the project profile.

<!-- cmemory:tools-end -->

<!-- cmemory:profile-start -->
## Project Profile (auto-managed by cmemory)

**Stack:** Next.js 14 (App Router), TypeScript, Prisma with PostgreSQL, NextAuth.js with Google OAuth + magic links. Deployed on Vercel with Edge middleware for auth checks.

**Architecture:** Monorepo. API routes in app/api/, shared types in packages/types/, UI components in packages/ui/. Server components by default, client components only in app/_components/.

**Data:** Prisma schema in prisma/schema.prisma. Multi-tenant — every table has orgId. Row-level security enforced in middleware, not at the DB level.

**Auth:** NextAuth.js session strategy with JWT. Refresh tokens stored in httpOnly cookies. The middleware in middleware.ts checks auth on every route except /public/*.

**Audience:** B2B SaaS for logistics companies. Users are warehouse managers, not developers. UI must be simple.

<!-- cmemory:profile-end -->

<!-- cmemory:lessons-start -->
## Project Lessons (auto-managed by cmemory)

- The Stripe webhook handler in api/webhooks.ts silently drops events when signature verification throws. Catch the error explicitly and return 400.
- Database migrations must run before seed scripts. The seed references tables that don't exist yet if you reverse the order.
- The auth token refresh in lib/auth.ts has a race condition when two requests fire simultaneously. Use the mutex pattern in lib/locks.ts.

<!-- cmemory:lessons-end -->
```

**The tools section** tells Claude what MCP tools are available and when to use each one. This is the primary nudge — always there, always read, no hook latency.

**The profile section** gives Claude immediate understanding of the project. Starts empty, grows as Claude calls `update_profile`.

**The lessons section** shows the top 10 lessons sorted by recency. Updated whenever `save_lesson` or `reject_lesson` is called.

**How the sections get updated:** Every MCP tool that modifies state calls `updateClaudeMd()`, which reads `profile.md` and `lessons.json` and rewrites the managed sections. User content outside the markers is never touched.

---

## The Hook — Just a Nudge

### `UserPromptSubmit` — Remind Claude to use its tools

cmemory uses ONE hook. It does no embedding, no search, no model loading. It prints a short reminder to stdout and exits.

```typescript
// on-prompt.ts — the entire hook
const input = JSON.parse(readStdin());

// Only nudge if cmemory is initialized for this project
const projectRoot = findProjectRoot(process.cwd());
if (!projectRoot) process.exit(0);

const lessons = loadLessons(projectRoot);
process.stdout.write(
  `[cmemory] ${lessons.length} lessons available. ` +
  `Use search_lessons to find relevant context before starting work.`
);
process.exit(0);
```

**Why this works:** The CLAUDE.md instructions tell Claude what the tools are and when to use them. The hook reinforces it on every prompt — a gentle nudge, not a forced injection. This mirrors what cmem's `consult.ts` hook does, and it's proven effective.

**Why no PostToolUse/Stop/SessionEnd hooks:** Claude handles everything through MCP calls. No background synthesis, no queue, no spawned processes.

---

## Lesson Storage — Project-Scoped in `.claude/`

```
my-project/
├── .claude/
│   ├── settings.json          # Claude Code project settings (already exists)
│   ├── settings.local.json    # Local overrides (already exists)
│   └── cmemory/
│       ├── lessons.json       # All lessons + embeddings
│       ├── profile.md         # Project profile text (source of truth)
│       └── meta.json          # Project name, lesson count, stats
├── CLAUDE.md                  # Profile + lessons + MCP instructions (auto-managed sections)
├── src/
└── ...
```

**Why `.claude/cmemory/`:**
- Lessons are project-specific — a lesson about auth.ts in project A is noise in project B
- `.claude/` already exists in Claude Code projects, no new top-level dotfolder
- Teams can commit `lessons.json` to share lessons, or gitignore for personal use
- No global registry — cmemory checks if `.claude/cmemory/` exists in cwd

**CLAUDE.md is committed** (team shares profile + lessons). `.claude/cmemory/` is gitignored (raw storage with embeddings is build artifact, CLAUDE.md is the sharing mechanism).

### Lesson Schema

```typescript
interface Lesson {
  id: string;                    // uuid
  content: string;               // The lesson text (1-3 sentences)
  tags: string[];                // File paths, function names, concepts
  embedding: number[];           // 768-dim float array (nomic-embed-text-v1.5)
  createdAt: string;             // ISO timestamp
  updatedAt: string;             // ISO timestamp
  source: 'claude' | 'manual';  // Who created it — Claude via MCP or user via CLI
}
```

**No confidence score, staleness, or hit counting.** Claude curates the store in real-time. If a lesson is wrong, Claude calls `reject_lesson`. If it's outdated, Claude saves a new one and rejects the old one. The store stays clean because the curator (Claude) has full codebase context when making decisions.

---

## Vector Search

```typescript
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function searchLessons(
  queryEmbedding: number[],
  lessons: Lesson[],
  threshold = 0.55,
  topK = 5
): Array<{ lesson: Lesson; score: number }> {
  return lessons
    .map(l => ({ lesson: l, score: cosineSimilarity(queryEmbedding, l.embedding) }))
    .filter(r => r.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
```

At 50 lessons with 768-dim vectors, this runs in **< 1ms**. No index needed.

**Threshold: 0.55.** Validated empirically via integration tests with nomic-embed-text-v1.5:
- SHOULD_MATCH range: 0.50 – 0.78
- SHOULD_NOT_MATCH range: 0.42 – 0.45
- 0.55 catches 8/9 legitimate matches, cleanly rejects all noise

---

## Embeddings — Zero Native Builds

Use `@huggingface/transformers` (transformers.js). Runs via ONNX Runtime compiled to WASM. No native compilation, no GPU, works on Windows/Mac/Linux identically.

```typescript
import { pipeline } from '@huggingface/transformers';

let extractor: any = null;

// Private — callers must use getQueryEmbedding or getDocumentEmbedding
async function getEmbedding(text: string): Promise<number[]> {
  if (!extractor) {
    extractor = await pipeline('feature-extraction', 'nomic-ai/nomic-embed-text-v1.5');
  }
  const result = await extractor(text, { pooling: 'mean', normalize: true });
  return Array.from(result.data);
}

// For search queries — prepend task prefix for asymmetric retrieval
export async function getQueryEmbedding(text: string): Promise<number[]> {
  return getEmbedding(`search_query: ${text}`);
}

// For storing lessons — prepend document prefix
export async function getDocumentEmbedding(text: string): Promise<number[]> {
  return getEmbedding(`search_document: ${text}`);
}
```

**Model:** `nomic-ai/nomic-embed-text-v1.5` — 768 dimensions, ~270MB, uses task prefixes for asymmetric search (short query → longer document). Proven fast in CMEM.

**`getEmbedding` is private.** Only the two prefixed functions are exported. This prevents accidentally storing a lesson without the document prefix, which would degrade search quality.

---

## `save_lesson` Dedup Flow

When Claude calls `save_lesson`, the MCP tool checks for duplicates first:

```
Claude calls: save_lesson({ content: "...", tags: [...] })
                    │
                    ▼
        Embed content with getDocumentEmbedding()
                    │
                    ▼
        Cosine search existing lessons at 0.50 threshold
                    │
            ┌───────┴───────┐
            │               │
       No matches      Similar found
            │               │
            ▼               ▼
     Save immediately   Return similar lessons to Claude:
     Return lesson ID   "Similar lesson exists: [content]
                         Save anyway? Call save_lesson again
                         with force: true, or skip."
                              │
                    ┌─────────┴─────────┐
                    │                   │
              Claude saves        Claude skips
              (force: true)       (no duplicate)
```

**Why this works better than background dedup:** Claude has the full context. It just read the code, just hit the bug, just found the fix. It knows whether the existing lesson is the same insight or a related-but-different one. A background process working from a transcript would have to reconstruct that understanding.

---

## MCP Server Setup

### Server Implementation

```typescript
// src/mcp/server.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new Server({ name: 'cmemory', version: '0.1.0' }, {
  capabilities: { tools: {} }
});

// Register tools: search_lessons, save_lesson, reject_lesson, update_profile
// Each tool resolves project root from process.cwd()
// Errors return { isError: true } — never crash the server

const transport = new StdioServerTransport();
await server.connect(transport);
```

### Registration via `cmemory install`

`cmemory install` writes both the hook and MCP server config to `.claude/settings.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "cmemory hook on-prompt",
            "timeout": 5
          }
        ]
      }
    ]
  },
  "mcpServers": {
    "cmemory": {
      "command": "cmemory",
      "args": ["mcp"]
    }
  }
}
```

One hook (nudge), one MCP server (four tools). That's the entire integration surface.

---

## CLI Commands

```bash
cmemory init                    # Initialize cmemory for current project (creates .claude/cmemory/)
cmemory install                 # Configure hook + MCP server in Claude Code settings
cmemory mcp                     # Start MCP server (called by Claude Code, not the user)
cmemory lessons                 # List all lessons for current project
cmemory lessons --search "auth" # Search lessons semantically
cmemory add "lesson text"       # Manually add a lesson via CLI
cmemory forget <id>             # Remove a lesson via CLI
cmemory profile                 # Show current project profile
cmemory profile set <file>      # Set profile from a file
cmemory profile clear           # Clear the project profile
cmemory status                  # Show stats: lesson count, profile status, hook/MCP health
cmemory log                     # Show recent activity (searches, saves, rejects)
cmemory hook on-prompt          # Hidden — hook dispatch, not user-facing
```

---

## Performance Considerations

| Operation | Expected Time | Notes |
|-----------|--------------|-------|
| Model load (first MCP call) | 2-3s | Cached for server lifetime |
| Embed one query | 10-50ms | After model loaded |
| Search 50 lessons | < 1ms | Brute-force cosine similarity |
| Hook (nudge) | < 10ms | No embedding, no search, just text |

**MCP server is long-running.** Unlike hooks (which spawn/die per event), the MCP server stays alive for the session. The embedding model loads once on the first `search_lessons` or `save_lesson` call and stays cached. Subsequent calls are fast.

**The hook is instant.** No model loading, no embedding, no search. It reads `lessons.json` to get the count and prints a one-line nudge. Well under the 5-second timeout.

---

## Tech Stack Summary

| Component | Choice | Why |
|-----------|--------|-----|
| Language | TypeScript/Node.js | Same ecosystem as Claude Code |
| Embeddings | `@huggingface/transformers` | Pure WASM, no native builds, runs everywhere |
| Model | `nomic-ai/nomic-embed-text-v1.5` | 768-dim, ~270MB, asymmetric prefixes, proven in CMEM |
| Storage | JSON files in `.claude/cmemory/` | Project-scoped, no DB needed at lesson scale, zero deps |
| MCP | `@modelcontextprotocol/sdk` | Standard MCP server with stdio transport |
| Persistent knowledge | `CLAUDE.md` | Profile + lessons + tool instructions, zero runtime cost |
| Hook | `UserPromptSubmit` only | Lightweight nudge, no embedding/search |
| Package | npm (global install) | `npm install -g cmemory` |

---

## What Makes This Different from CMEM

1. **MCP-first** — Claude actively searches, saves, and curates lessons via MCP tools. Not a passive system that hides behind hooks.
2. **No background synthesis** — No Stop/SessionEnd hooks, no `claude -p` background processes, no pending queue. Claude is the synthesizer — it has the full context and saves lessons in the moment.
3. **Living project profile** — `update_profile` lets Claude build and maintain a project overview. Claude knows what the project IS from the first prompt.
4. **Inline dedup** — `save_lesson` checks for duplicates at save time and asks Claude to decide. No separate classification pipeline.
5. **One hook** — A text nudge on `UserPromptSubmit`. No PostToolUse injection, no blocking, no model loading in hooks.
6. **Simple schema** — `content` + `tags` + `embedding`. No confidence, staleness, categories, reasoning steps, evidence refs.
7. **Hard cap** — 50 lessons max. Bounded by design, not by decay curves.
8. **Zero native builds** — WASM embeddings, JSON storage, works on Windows/Mac/Linux.
9. **No extra LLM calls** — No `claude -p` background synthesis. The only LLM is Claude itself during normal sessions.
10. **CLAUDE.md as the sharing layer** — Profile, lessons, and tool instructions all in one committed file.

---

## Open Questions

1. **Nudge effectiveness** — Is the `UserPromptSubmit` nudge enough, or do we need cmem's blocking approach (`block.ts` that prevents file reads until lessons are consulted)? Start with nudge, add blocking only if Claude consistently ignores tools.
2. **Hard cap value** — 50 feels right for most projects. Should it be configurable via `meta.json`?
3. **Cross-project search** — Should `search_lessons` accept an optional `projectPath` to query another project's lessons? Or is that a future feature?
4. **`save_lesson` force flag** — When dedup finds a similar lesson, should Claude call `save_lesson` again with `force: true`, or should there be a separate `replace_lesson` tool?
5. **Profile structure** — Should `update_profile` accept the full profile text (replace), or a patch/instruction? Full replace is simpler but Claude needs to include everything each time.
