import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import * as crypto from 'crypto';
import { findProjectRoot } from '../utils/paths';
import { loadLessons, saveLessons, saveProfile } from '../core/storage';
import { getQueryEmbedding, getDocumentEmbedding } from '../core/embeddings';
import { searchLessons } from '../core/search';
import { updateClaudeMd } from '../synthesis/claude-md';

export async function startMcpServer(): Promise<void> {
  const projectRoot = findProjectRoot(process.cwd());

  const server = new Server(
    { name: 'cmemory', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'search_lessons',
        description: 'Search project lessons by semantic similarity. Returns the most relevant lessons for the given query.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            query: { type: 'string', description: 'The search query to find relevant lessons' },
          },
          required: ['query'],
        },
      },
      {
        name: 'save_lesson',
        description: 'Save a new lesson to the project memory. Use this to persist insights, patterns, or debugging knowledge discovered during the session. Auto-checks for duplicates.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            content: { type: 'string', description: 'The lesson content to save' },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional tags to categorize the lesson',
            },
            replace_id: {
              type: 'string',
              description: 'If set, update the lesson with this ID instead of creating a new one',
            },
            force: {
              type: 'boolean',
              description: 'If true, skip duplicate check and save as a new lesson',
            },
          },
          required: ['content'],
        },
      },
      {
        name: 'reject_lesson',
        description: 'Remove a wrong or stale lesson by ID (prefix match supported).',
        inputSchema: {
          type: 'object' as const,
          properties: {
            lesson_id: { type: 'string', description: 'Full ID or prefix of the lesson to remove' },
          },
          required: ['lesson_id'],
        },
      },
      {
        name: 'update_profile',
        description: 'Replace the project profile (stack, architecture, conventions). This updates the profile section in CLAUDE.md.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            content: { type: 'string', description: 'The new profile content' },
          },
          required: ['content'],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      if (!projectRoot) {
        return {
          content: [{ type: 'text', text: 'No cmemory project found. Run `cmemory init` first.' }],
          isError: true,
        };
      }

      if (name === 'search_lessons') {
        const query = (args as { query: string }).query;
        const lessons = loadLessons(projectRoot);

        if (lessons.length === 0) {
          return {
            content: [{ type: 'text', text: 'No lessons stored yet.' }],
          };
        }

        const embedding = await getQueryEmbedding(query);
        const results = searchLessons(embedding, lessons, 0.55, 5);

        if (results.length === 0) {
          return {
            content: [{ type: 'text', text: `No lessons matched the query: "${query}"` }],
          };
        }

        const lines = results.map(r => {
          const tags = r.lesson.tags.length > 0 ? ` [${r.lesson.tags.join(', ')}]` : '';
          const score = (r.score * 100).toFixed(1);
          return `- **${score}%** ${r.lesson.content}${tags}`;
        });

        return {
          content: [{ type: 'text', text: `Found ${results.length} lesson(s):\n\n${lines.join('\n')}` }],
        };
      }

      if (name === 'save_lesson') {
        const { content, tags = [], replace_id, force } = args as {
          content: string;
          tags?: string[];
          replace_id?: string;
          force?: boolean;
        };
        const now = new Date().toISOString();
        const lessons = loadLessons(projectRoot);

        // Replace mode: update existing lesson in place
        if (replace_id) {
          const idx = lessons.findIndex(l => l.id === replace_id || l.id.startsWith(replace_id));
          if (idx === -1) {
            return {
              content: [{ type: 'text', text: `No lesson found matching ID: ${replace_id}` }],
              isError: true,
            };
          }
          const embedding = await getDocumentEmbedding(content);
          lessons[idx] = {
            ...lessons[idx],
            content,
            tags,
            embedding,
            updatedAt: now,
          };
          saveLessons(projectRoot, lessons);
          updateClaudeMd(projectRoot);
          return {
            content: [{ type: 'text', text: `Lesson updated (${lessons[idx].id}).` }],
          };
        }

        // Dedup check (unless force=true)
        if (!force) {
          const embedding = await getDocumentEmbedding(content);
          const results = searchLessons(embedding, lessons, 0.50, 1);
          if (results.length > 0) {
            const match = results[0];
            const score = (match.score * 100).toFixed(1);
            return {
              content: [{
                type: 'text',
                text: `Similar lesson exists: ${match.lesson.id} — ${match.lesson.content} (similarity: ${score}%). Call with replace_id to update, or force=true to save as new.`,
              }],
            };
          }

          // No duplicate — save with the embedding we already computed
          const lesson = {
            id: crypto.randomUUID(),
            content,
            tags,
            embedding,
            createdAt: now,
            updatedAt: now,
            source: 'manual' as const,
          };
          lessons.push(lesson);
          saveLessons(projectRoot, lessons);
          updateClaudeMd(projectRoot);
          return {
            content: [{ type: 'text', text: `Lesson saved (${lesson.id}).` }],
          };
        }

        // Force save — skip dedup
        const embedding = await getDocumentEmbedding(content);
        const lesson = {
          id: crypto.randomUUID(),
          content,
          tags,
          embedding,
          createdAt: now,
          updatedAt: now,
          source: 'manual' as const,
        };
        lessons.push(lesson);
        saveLessons(projectRoot, lessons);
        updateClaudeMd(projectRoot);
        return {
          content: [{ type: 'text', text: `Lesson saved (${lesson.id}).` }],
        };
      }

      if (name === 'reject_lesson') {
        const { lesson_id } = args as { lesson_id: string };
        const lessons = loadLessons(projectRoot);
        const matches = lessons.filter(l => l.id.startsWith(lesson_id));

        if (matches.length === 0) {
          return {
            content: [{ type: 'text', text: `No lesson found matching ID: ${lesson_id}` }],
            isError: true,
          };
        }
        if (matches.length > 1) {
          const list = matches.map(m => `  ${m.id}  ${m.content.substring(0, 60)}`).join('\n');
          return {
            content: [{ type: 'text', text: `Ambiguous ID "${lesson_id}" matches ${matches.length} lessons. Be more specific:\n${list}` }],
            isError: true,
          };
        }

        const toRemove = matches[0];
        const remaining = lessons.filter(l => l.id !== toRemove.id);
        saveLessons(projectRoot, remaining);
        updateClaudeMd(projectRoot);

        return {
          content: [{ type: 'text', text: `Removed lesson: ${toRemove.content}` }],
        };
      }

      if (name === 'update_profile') {
        const { content } = args as { content: string };
        saveProfile(projectRoot, {
          content,
          updatedAt: new Date().toISOString(),
        });
        updateClaudeMd(projectRoot);
        return {
          content: [{ type: 'text', text: `Profile updated (${content.length} chars). CLAUDE.md refreshed.` }],
        };
      }

      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true,
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
