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
  source: 'manual';
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

