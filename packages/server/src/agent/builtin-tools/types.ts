export interface ToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface BuiltinTool {
  tool: ToolDef;
  execute: (args: Record<string, unknown>) => Promise<string>;
}
