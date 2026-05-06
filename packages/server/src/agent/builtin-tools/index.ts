import type { Workspace } from "../../engine/workspace";
import type { BuiltinTool } from "./types";
import { buildBashTool } from "./bash";
import { buildFileTools } from "./files";
import { buildSearchTools } from "./search";
import { buildKnowledgeTools } from "./knowledge";
import { buildWebFetchTool } from "./web-fetch";
import { buildWebSearchTool } from "./web-search";

export type { ToolDef, BuiltinTool } from "./types";
export { runBash } from "./bash";

export function createBuiltinTools(workspace: Workspace, runId?: number): Record<string, BuiltinTool> {
  const resolveIn = (p: string) => workspace.resolveInside(p);
  return {
    ...buildBashTool(workspace.cwd),
    ...buildFileTools(resolveIn),
    ...buildSearchTools(workspace, resolveIn),
    ...buildKnowledgeTools(),
    ...(runId !== undefined ? buildWebFetchTool(runId) : {}),
    ...buildWebSearchTool(),
  };
}

// Maps Claude Code tool names to builtin tool IDs.
// Any tool listed in the frontend tool picker (packages/client/src/components/editor/tool-picker.tsx)
// MUST have an entry here AND a matching executor in createBuiltinTools() above,
// otherwise non-Claude agents will silently drop the tool when building their catalog.
export const TOOL_NAME_MAP: Record<string, string> = {
  Bash: "bash",
  Read: "read_file",
  Write: "write_file",
  Edit: "edit",
  Glob: "glob",
  Grep: "grep",
  WebFetch: "web_fetch",
  WebSearch: "web_search",
  ViewImage: "view_image",
};
