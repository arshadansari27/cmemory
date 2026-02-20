import * as crypto from 'crypto';
import { Lesson, SynthesisAction, SynthesisResponse } from '../core/types';
import { loadLessons, saveLessons, loadMeta, saveMeta, clearPending, saveProfile } from '../core/storage';
import { getDocumentEmbedding } from '../core/embeddings';
import { updateClaudeMd } from './claude-md';
import { debug, info, warn } from '../utils/logger';

/**
 * Process a synthesis response: apply add/replace/discard actions to lesson storage.
 */
export async function processSynthesisResponse(
  projectRoot: string,
  response: SynthesisResponse
): Promise<void> {
  const lessons = loadLessons(projectRoot);
  let modified = false;

  for (const action of response.actions) {
    switch (action.action) {
      case 'add': {
        const now = new Date().toISOString();
        info(`Adding lesson: ${action.content.substring(0, 80)}...`);
        const embedding = await getDocumentEmbedding(action.content);
        const lesson: Lesson = {
          id: crypto.randomUUID(),
          content: action.content,
          tags: action.tags || [],
          embedding,
          createdAt: now,
          updatedAt: now,
          source: 'synthesis',
        };
        lessons.push(lesson);
        modified = true;
        break;
      }

      case 'replace': {
        const idx = lessons.findIndex(l => l.id === action.targetId);
        if (idx === -1) {
          warn(`Replace target not found: ${action.targetId}, adding as new lesson instead`);
          const now = new Date().toISOString();
          const embedding = await getDocumentEmbedding(action.content);
          lessons.push({
            id: crypto.randomUUID(),
            content: action.content,
            tags: action.tags || [],
            embedding,
            createdAt: now,
            updatedAt: now,
            source: 'synthesis',
          });
        } else {
          info(`Replacing lesson ${action.targetId}: ${action.content.substring(0, 80)}...`);
          const embedding = await getDocumentEmbedding(action.content);
          lessons[idx] = {
            ...lessons[idx],
            content: action.content,
            tags: action.tags || [],
            embedding,
            updatedAt: new Date().toISOString(),
          };
        }
        modified = true;
        break;
      }

      case 'discard': {
        debug(`Discard: ${action.reason}`);
        break;
      }
    }
  }

  // Handle profile update
  if (response.profile !== null && response.profile !== undefined) {
    saveProfile(projectRoot, {
      content: response.profile,
      updatedAt: new Date().toISOString(),
    });
    info('Updated project profile');
    modified = true;
  }

  if (modified) {
    saveLessons(projectRoot, lessons);
    const meta = loadMeta(projectRoot);
    meta.lastSyncAt = new Date().toISOString();
    saveMeta(projectRoot, meta);
    updateClaudeMd(projectRoot);
    info(`Saved ${lessons.length} lesson(s)`);
  }

  clearPending(projectRoot);
  debug('Pending queue cleared');
}
