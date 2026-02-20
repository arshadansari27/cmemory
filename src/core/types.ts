// --- Project profile ---

export interface Profile {
  content: string;
  updatedAt: string | null;
}

// --- Lesson storage ---

export interface Lesson {
  id: string;
  content: string;
  tags: string[];
  embedding: number[];
  createdAt: string;   // ISO 8601
  updatedAt: string;   // ISO 8601
  source: 'manual' | 'synthesis';
}

export interface Meta {
  version: number;
  lastSyncAt: string | null;
}

export interface PendingQueue {
  transcripts: string[];  // file paths to transcripts
}

// --- Search ---

export interface SearchResult {
  lesson: Lesson;
  score: number;
}

// --- Hook stdin inputs ---

export interface UserPromptSubmitInput {
  hook_event_name: 'UserPromptSubmit';
  prompt: string;
  cwd: string;
  session_id: string;
}

export interface PostToolUseInput {
  hook_event_name: 'PostToolUse';
  session_id: string;
  cwd: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_output?: string;
}

export interface StopInput {
  hook_event_name: 'Stop';
  session_id: string;
  cwd: string;
  transcript_path: string;
  stop_hook_active: boolean;
}

export interface SessionEndInput {
  hook_event_name: 'SessionEnd';
  session_id: string;
  cwd: string;
  transcript_path: string;
}

// --- Synthesis ---

export type SynthesisActionType = 'add' | 'replace' | 'discard';

export interface SynthesisAddAction {
  action: 'add';
  content: string;
  tags: string[];
}

export interface SynthesisReplaceAction {
  action: 'replace';
  targetId: string;
  content: string;
  tags: string[];
}

export interface SynthesisDiscardAction {
  action: 'discard';
  reason: string;
}

export type SynthesisAction = SynthesisAddAction | SynthesisReplaceAction | SynthesisDiscardAction;

export interface SynthesisResponse {
  profile: string | null;
  actions: SynthesisAction[];
}
