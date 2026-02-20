import * as fs from 'fs';
import { readStdin, runHook, getProjectRoot, spawnSynthesisIfNeeded } from './shared';
import { StopInput } from '../core/types';
import { appendPending } from '../core/storage';
import { debug } from '../utils/logger';

const MIN_TOOL_CALLS = 5;

export async function onStop(): Promise<void> {
  await runHook(async () => {
    const input = (await readStdin()) as StopInput;
    const { transcript_path, cwd } = input;

    const projectRoot = getProjectRoot(cwd);
    if (!projectRoot) return;

    if (!transcript_path || !fs.existsSync(transcript_path)) {
      debug('No transcript path or file not found, skipping');
      return;
    }

    // Count tool_use blocks by parsing JSONL lines
    const transcript = fs.readFileSync(transcript_path, 'utf-8');
    let toolUseCount = 0;
    for (const line of transcript.split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.type === 'tool_use') toolUseCount++;
      } catch {
        // skip malformed lines
      }
    }

    if (toolUseCount < MIN_TOOL_CALLS) {
      debug(`Only ${toolUseCount} tool calls (min ${MIN_TOOL_CALLS}), skipping`);
      return;
    }

    appendPending(projectRoot, transcript_path);
    debug(`Queued transcript for synthesis: ${transcript_path}`);

    spawnSynthesisIfNeeded(projectRoot);
  });
}
