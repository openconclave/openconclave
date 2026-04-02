import type { ToolConfig } from "@openconclave/shared";
import { Field } from "./shared";

interface ToolFieldsProps {
  config: ToolConfig;
}

const toolTypeLabels: Record<ToolConfig["toolType"], string> = {
  builtin: "Built-in Tool",
  mcp: "MCP Server",
  knowledge: "Knowledge Base",
};

export function ToolFields({ config }: ToolFieldsProps) {
  return (
    <>
      <Field label="Type">
        <p className="text-sm text-muted-foreground px-1">
          {toolTypeLabels[config.toolType]}
        </p>
      </Field>
      <Field label="Tool ID">
        <p className="text-sm font-mono text-muted-foreground px-1 truncate">
          {config.toolId}
        </p>
      </Field>
      <p className="text-[10px] text-muted-foreground px-1 leading-snug">
        Connect this tool node to an Agent node with an edge. The agent will have access to this tool during its run.
      </p>
    </>
  );
}
