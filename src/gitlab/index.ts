#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { parseArgs } from 'node:util';
import {
  CreateOrUpdateFileSchema,
  SearchRepositoriesSchema,
  CreateRepositorySchema,
  GetFileContentsSchema,
  GetRepositoryTreeSchema,
  PushFilesSchema,
  CreateIssueSchema,
  CreateMergeRequestSchema,
  ForkRepositorySchema,
  CreateBranchSchema,
} from './schemas.js';
import {
  forkProject,
  getDefaultBranchRef,
  createBranch,
  searchProjects,
  createRepository,
  getFileContents,
  getRepositoryTree,
  createOrUpdateFile,
  createCommit,
  createIssue,
  createMergeRequest,
} from './gitlab-api.js';

const { values } = parseArgs({
  options: {
    readonly: { type: 'boolean', default: false }
  }
});
const isReadOnly = values.readonly;

const server = new Server({
  name: "gitlab-mcp-server",
  version: "0.0.3",
}, {
  capabilities: {
    tools: {}
  }
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const readonlyTools = [
    "search_repositories",
    "get_repository_tree",
    "get_file_contents",
  ]

  const tools = [
    {
      name: "create_or_update_file",
      description: "Create or update a single file in a GitLab project",
      inputSchema: zodToJsonSchema(CreateOrUpdateFileSchema)
    },
    {
      name: "search_repositories",
      description: "Search for GitLab projects",
      inputSchema: zodToJsonSchema(SearchRepositoriesSchema)
    },
    {
      name: "create_repository",
      description: "Create a new GitLab project",
      inputSchema: zodToJsonSchema(CreateRepositorySchema)
    },
    {
      name: "get_file_contents",
      description: "Get the contents of a file or directory from a GitLab project",
      inputSchema: zodToJsonSchema(GetFileContentsSchema)
    },
    {
      name: "get_repository_tree",
      description: "Get the directory tree of a GitLab project",
      inputSchema: zodToJsonSchema(GetRepositoryTreeSchema)
    },
    {
      name: "push_files",
      description: "Push multiple files to a GitLab project in a single commit",
      inputSchema: zodToJsonSchema(PushFilesSchema)
    },
    {
      name: "create_issue",
      description: "Create a new issue in a GitLab project",
      inputSchema: zodToJsonSchema(CreateIssueSchema)
    },
    {
      name: "create_merge_request",
      description: "Create a new merge request in a GitLab project",
      inputSchema: zodToJsonSchema(CreateMergeRequestSchema)
    },
    {
      name: "fork_repository",
      description: "Fork a GitLab project to your account or specified namespace",
      inputSchema: zodToJsonSchema(ForkRepositorySchema)
    },
    {
      name: "create_branch",
      description: "Create a new branch in a GitLab project",
      inputSchema: zodToJsonSchema(CreateBranchSchema)
    }
  ]

  return {
    tools: isReadOnly ? tools.filter(t => readonlyTools.includes(t.name)) : tools
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    if (!request.params.arguments) {
      throw new Error("Arguments are required");
    }

    switch (request.params.name) {
      case "fork_repository": {
        const args = ForkRepositorySchema.parse(request.params.arguments);
        const fork = await forkProject(args.project_id, args.namespace);
        return { content: [{ type: "text", text: JSON.stringify(fork, null, 2) }] };
      }

      case "create_branch": {
        const args = CreateBranchSchema.parse(request.params.arguments);
        let ref = args.ref;
        if (!ref) {
          ref = await getDefaultBranchRef(args.project_id);
        }

        const branch = await createBranch(args.project_id, {
          name: args.branch,
          ref
        });

        return { content: [{ type: "text", text: JSON.stringify(branch, null, 2) }] };
      }

      case "search_repositories": {
        const args = SearchRepositoriesSchema.parse(request.params.arguments);
        const results = await searchProjects(args.search, args.page, args.per_page);
        return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
      }

      case "create_repository": {
        const args = CreateRepositorySchema.parse(request.params.arguments);
        const repository = await createRepository(args);
        return { content: [{ type: "text", text: JSON.stringify(repository, null, 2) }] };
      }

      case "get_file_contents": {
        const args = GetFileContentsSchema.parse(request.params.arguments);
        const contents = await getFileContents(args.project_id, args.file_path, args.ref);
        return { content: [{ type: "text", text: JSON.stringify(contents, null, 2) }] };
      }

      case "get_repository_tree": {
        const args = GetRepositoryTreeSchema.parse(request.params.arguments);
        const tree = await getRepositoryTree(
          args.project_id,
          args.path,
          args.ref,
          args.recursive,
          args.per_page
        );
        
        // Format the tree result for better readability
        let formattedTree = "Repository directory structure:\n\n";
        
        // Group items by type (directory first, then files)
        const directories = tree.filter(item => item.type === 'tree');
        const files = tree.filter(item => item.type === 'blob');
        
        // Add directories with a trailing slash for clarity
        directories.forEach(dir => {
          formattedTree += `Folder: ${dir.path}/\n`;
        });
        
        // Add files
        files.forEach(file => {
          formattedTree += `File: ${file.path}\n`;
        });

        return { 
          content: [{ 
            type: "text", 
            text: formattedTree
          }] 
        };
      }

      case "create_or_update_file": {
        const args = CreateOrUpdateFileSchema.parse(request.params.arguments);
        const result = await createOrUpdateFile(
          args.project_id,
          args.file_path,
          args.content,
          args.commit_message,
          args.branch,
          args.previous_path
        );
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "push_files": {
        const args = PushFilesSchema.parse(request.params.arguments);
        const result = await createCommit(
          args.project_id,
          args.commit_message,
          args.branch,
          args.files.map(f => ({ path: f.file_path, content: f.content }))
        );
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "create_issue": {
        const args = CreateIssueSchema.parse(request.params.arguments);
        const { project_id, ...options } = args;
        const issue = await createIssue(project_id, options);
        return { content: [{ type: "text", text: JSON.stringify(issue, null, 2) }] };
      }

      case "create_merge_request": {
        const args = CreateMergeRequestSchema.parse(request.params.arguments);
        const { project_id, ...options } = args;
        const mergeRequest = await createMergeRequest(project_id, options);
        return { content: [{ type: "text", text: JSON.stringify(mergeRequest, null, 2) }] };
      }

      default:
        throw new Error(`Unknown tool: ${request.params.name}`);
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(`Invalid arguments: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
    }
    throw error;
  }
});

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.log("GitLab MCP Server running on stdio");
}

runServer().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});