import * as fs from 'fs';
import { execSync } from 'child_process';
import { loadLessons, loadPending, loadProfile } from '../core/storage';
import { Lesson, SynthesisResponse } from '../core/types';
import { debug, error as logError } from '../utils/logger';

const MAX_TRANSCRIPT_CHARS = 100_000;

/**
 * Extract only human/assistant text from a JSONL transcript.
 * Strips tool_use, tool_result, thinking blocks, and non-conversation entries.
 */
function extractConversation(content: string): string {
  const parts: string[] = [];

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    let entry: any;
    try { entry = JSON.parse(line); } catch { continue; }

    if (entry.type !== 'user' && entry.type !== 'assistant') continue;
    const blocks = entry.message?.content;
    if (!Array.isArray(blocks)) continue;

    for (const block of blocks) {
      if (block.type === 'text' && block.text) {
        const role = entry.type === 'user' ? 'User' : 'Assistant';
        parts.push(`${role}: ${block.text}`);
      }
    }
  }

  let result = parts.join('\n\n');

  // Hard character cap — keep the tail (most recent conversation)
  if (result.length > MAX_TRANSCRIPT_CHARS) {
    result = result.slice(-MAX_TRANSCRIPT_CHARS);
  }

  return result;
}

function buildPrompt(transcripts: string[], existingLessons: Lesson[], existingProfile: string): string {
  const transcriptContent = transcripts.map((tPath, i) => {
    if (!fs.existsSync(tPath)) return '';
    const raw = fs.readFileSync(tPath, 'utf-8');
    return `--- Transcript ${i + 1} ---\n${extractConversation(raw)}\n`;
  }).filter(Boolean).join('\n');

  const lessonsContent = existingLessons.length > 0
    ? existingLessons.map(l => `- [id:${l.id}] [${l.tags.join(',')}] ${l.content}`).join('\n')
    : '(none)';

  const profileContent = existingProfile || '(empty — this is a new project)';

  return `You are a lesson extraction system for a coding assistant. You have three inputs:
1. Session transcript(s) from Claude Code
2. The current project profile (may be empty for new projects)
3. Existing lessons

CURRENT PROJECT PROFILE:
${profileContent}

EXISTING LESSONS:
${lessonsContent}

TRANSCRIPT(S):
${transcriptContent}

Your two jobs:

JOB 1 — PROJECT PROFILE:
Update the project profile if the transcript reveals new information about the project's
stack, architecture, data model, auth, deployment, conventions, or audience. Keep it
concise — a few short paragraphs with bold section headers. If nothing new was learned,
return null.

JOB 2 — LESSONS:
Extract concrete, actionable lessons from the session — things that would help in future sessions.
1. Good lessons are: bug patterns, gotchas, project-specific conventions, architectural decisions, debugging insights.
2. Bad lessons are: trivial facts, session-specific context, obvious things.
3. If a lesson updates/improves an existing one, use "replace" with the existing lesson's id.
4. If the session has no useful lessons, return an empty actions array.

Respond with ONLY valid JSON:
{
  "profile": "updated profile markdown text" or null,
  "actions": [
    { "action": "add", "content": "lesson text here", "tags": ["relevant", "tags"] },
    { "action": "replace", "targetId": "existing-lesson-id", "content": "updated lesson text", "tags": ["tags"] },
    { "action": "discard", "reason": "why this session had no useful lessons" }
  ]
}`;
}

/**
 * Run synthesis using `claude -p` with the Sonnet model.
 * Returns parsed SynthesisResponse or null on failure.
 */
export function runSynthesis(projectRoot: string): SynthesisResponse | null {
  const pending = loadPending(projectRoot);
  if (pending.transcripts.length === 0) {
    debug('No pending transcripts');
    return null;
  }

  const existingLessons = loadLessons(projectRoot);
  const existingProfile = loadProfile(projectRoot).content;
  const prompt = buildPrompt(pending.transcripts, existingLessons, existingProfile);

  debug(`Running synthesis for ${pending.transcripts.length} transcript(s)`);

  try {
    // Strip CLAUDECODE env var so `claude -p` doesn't refuse to run
    // when synthesis is spawned from a Claude Code hook
    const env = { ...process.env };
    delete env.CLAUDECODE;

    const result = execSync(
      `claude -p --model sonnet --max-turns 1 --output-format json`,
      {
        input: prompt,
        encoding: 'utf-8',
        timeout: 120000, // 2 minute timeout
        maxBuffer: 10 * 1024 * 1024,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );

    // The output from claude --output-format json wraps the response
    // Try to extract the JSON actions from the response
    let parsed: any;
    try {
      parsed = JSON.parse(result);
    } catch {
      // claude -p might return the text directly, try to find JSON in it
      const jsonMatch = result.match(/\{[\s\S]*"actions"[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        logError('Could not parse synthesis response as JSON');
        debug(`Raw response: ${result.substring(0, 500)}`);
        return null;
      }
    }

    // Handle claude --output-format json wrapper: { result: "..." }
    if (parsed.result && typeof parsed.result === 'string') {
      const innerMatch = parsed.result.match(/\{[\s\S]*"actions"[\s\S]*\}/);
      if (innerMatch) {
        parsed = JSON.parse(innerMatch[0]);
      }
    }

    if (!parsed.actions || !Array.isArray(parsed.actions)) {
      logError('Synthesis response missing actions array');
      return null;
    }

    // Normalize: ensure profile field exists (backward compat)
    if (parsed.profile === undefined) {
      parsed.profile = null;
    }

    return parsed as SynthesisResponse;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const stdout = (err as any)?.stdout?.toString?.() || '';
    const stderr = (err as any)?.stderr?.toString?.() || '';
    logError(`Synthesis failed: ${errMsg}`);
    if (stdout) logError(`stdout: ${stdout.substring(0, 500)}`);
    if (stderr) logError(`stderr: ${stderr.substring(0, 500)}`);
    return null;
  }
}
