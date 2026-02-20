import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { findProjectRoot } from '../utils/paths';
import { getQueryEmbedding, getDocumentEmbedding } from '../core/embeddings';
import {
  EmbeddingProvider,
  handleSearchLessons,
  handleSaveLesson,
  handleRejectLesson,
  handleUpdateProfile,
} from './handlers';

export async function startMcpServer(): Promise<void> {
  const projectRoot = findProjectRoot(process.cwd());

  const realEmbeddings: EmbeddingProvider = {
    getQueryEmbedding,
    getDocumentEmbedding,
  };

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<any> => {
    const { name, arguments: args } = request.params;

    try {
      if (!projectRoot) {
        return {
          content: [{ type: 'text', text: 'No cmemory project found. Run `cmemory init` first.' }],
          isError: true,
        };
      }

      if (name === 'search_lessons') return handleSearchLessons(args as any, projectRoot, realEmbeddings);
      if (name === 'save_lesson') return handleSaveLesson(args as any, projectRoot, realEmbeddings);
      if (name === 'reject_lesson') return handleRejectLesson(args as any, projectRoot);
      if (name === 'update_profile') return handleUpdateProfile(args as any, projectRoot);

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
