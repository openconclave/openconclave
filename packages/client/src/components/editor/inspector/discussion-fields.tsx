import { useCallback } from "react";
import { useWorkflowStore } from "@/stores/workflow-store";
import type {
  DiscussionConfig,
  DiscussionModeratorConfig,
  AgentConfig,
  CodeConfig,
} from "@openconclave/shared";
import { Field, INPUT_CLASS } from "./shared";

// ── Default configs when creating a moderator from scratch ────

const DEFAULT_CODE_MODERATOR_CONFIG: CodeConfig = {
  runtime: "python",
  code: [
    "import sys, json",
    "data = json.load(sys.stdin)",
    "# data = { responses, transcript, round, input }",
    "# Return: { action: 'call_next' | 'call_specific' | 'end_discussion', nextAgent?, summary? }",
    'print(json.dumps({ "action": "end_discussion", "summary": "Discussion complete." }))',
  ].join("\n"),
};

const DEFAULT_AGENT_MODERATOR_CONFIG: AgentConfig = {
  engine: "claude",
  model: "sonnet",
  systemPrompt:
    "You are a discussion moderator. Review the transcript and decide who should speak next or end the discussion. Use the `moderate` tool to take action.",
};

// ── Sub-components ────────────────────────────────────────────

interface ModeratorCodeEditorProps {
  nodeId: string;
  moderator: DiscussionModeratorConfig & { type: "code" };
}

function ModeratorCodeEditor({ nodeId, moderator }: ModeratorCodeEditorProps) {
  const updateNodeConfig = useWorkflowStore((s) => s.updateNodeConfig);

  // store.ts:145 merges one level deep: `{ ...existingConfig, moderator: newValue }`.
  // Setting only `moderator` preserves prompt/maxRounds/tool automatically.
  // The inner spread chain (moderator → node → config) IS needed to avoid clobbering
  // sibling fields within the moderator object when patching just one sub-field.
  const updateModeratorCode = useCallback(
    (patch: Partial<CodeConfig>) => {
      updateNodeConfig(nodeId, {
        moderator: {
          ...moderator,
          node: {
            ...moderator.node,
            config: { ...moderator.node.config, ...patch },
          },
        },
      });
    },
    [nodeId, moderator, updateNodeConfig]
  );

  const codeConfig = moderator.node.config as CodeConfig;

  return (
    <div className="space-y-3">
      <Field label="Runtime">
        <select
          value={codeConfig.runtime ?? "python"}
          onChange={(e) => updateModeratorCode({ runtime: e.target.value as CodeConfig["runtime"] })}
          className={INPUT_CLASS}
        >
          <option value="python">Python</option>
          <option value="node">Node.js</option>
          <option value="bash">Bash</option>
        </select>
      </Field>
      <Field label="Moderator Code">
        <textarea
          value={codeConfig.code ?? ""}
          onChange={(e) => updateModeratorCode({ code: e.target.value })}
          rows={8}
          className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs font-mono resize-y leading-relaxed"
          spellCheck={false}
        />
      </Field>
      <p className="text-[10px] text-muted-foreground px-1 leading-snug">
        Input: <code className="font-mono">{"{ responses, transcript, round, input }"}</code> via stdin.
        <br />
        Output: <code className="font-mono">{"{ action, nextAgent?, summary? }"}</code> where action
        is <code className="font-mono">"call_next"</code>,{" "}
        <code className="font-mono">"call_specific"</code>, or{" "}
        <code className="font-mono">"end_discussion"</code>.
      </p>
    </div>
  );
}

interface ModeratorAgentEditorProps {
  nodeId: string;
  moderator: DiscussionModeratorConfig & { type: "agent" };
}

function ModeratorAgentEditor({ nodeId, moderator }: ModeratorAgentEditorProps) {
  const updateNodeConfig = useWorkflowStore((s) => s.updateNodeConfig);

  // store.ts:145 merges one level deep: setting only `moderator` preserves prompt/maxRounds/tool.
  // Inner spread chain preserves sibling fields within moderator when patching one sub-field.
  const updateModeratorAgent = useCallback(
    (patch: Partial<AgentConfig>) => {
      updateNodeConfig(nodeId, {
        moderator: {
          ...moderator,
          node: {
            ...moderator.node,
            config: { ...moderator.node.config, ...patch },
          },
        },
      });
    },
    [nodeId, moderator, updateNodeConfig]
  );

  const agentConfig = moderator.node.config as AgentConfig;
  const engine = agentConfig.engine ?? "claude";

  return (
    <div className="space-y-3">
      <Field label="Engine">
        <select
          value={engine}
          onChange={(e) => updateModeratorAgent({ engine: e.target.value as AgentConfig["engine"] })}
          className={INPUT_CLASS}
        >
          <option value="claude">Claude</option>
          <option value="ollama">Ollama</option>
          <option value="openai">OpenAI-compatible</option>
          <option value="debug">Debug (static)</option>
        </select>
      </Field>
      {engine === "claude" && (
        <Field label="Model">
          <select
            value={agentConfig.model ?? "sonnet"}
            onChange={(e) => updateModeratorAgent({ model: e.target.value })}
            className={INPUT_CLASS}
          >
            <option value="sonnet">claude-sonnet (latest)</option>
            <option value="haiku">claude-haiku (fast)</option>
            <option value="opus">claude-opus (powerful)</option>
          </select>
        </Field>
      )}
      {engine === "ollama" && (
        <Field label="Ollama Model">
          <input
            type="text"
            value={agentConfig.ollamaModel ?? ""}
            onChange={(e) => updateModeratorAgent({ ollamaModel: e.target.value })}
            placeholder="llama3, mistral, ..."
            className={INPUT_CLASS}
          />
        </Field>
      )}
      <Field label="System Prompt">
        <textarea
          value={agentConfig.systemPrompt ?? ""}
          onChange={(e) => updateModeratorAgent({ systemPrompt: e.target.value })}
          rows={5}
          placeholder="You are a discussion moderator..."
          className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs resize-y leading-relaxed"
        />
      </Field>
      <p className="text-[10px] text-muted-foreground px-1 leading-snug">
        The moderator sees the full transcript and must call the{" "}
        <code className="font-mono">moderate</code> tool with an action:{" "}
        <code className="font-mono">"call_next"</code>,{" "}
        <code className="font-mono">"call_specific"</code>, or{" "}
        <code className="font-mono">"end_discussion"</code>.
      </p>
    </div>
  );
}

// ── Main DiscussionFields ─────────────────────────────────────

interface DiscussionFieldsProps {
  nodeId: string;
  config: DiscussionConfig;
}

export function DiscussionFields({ nodeId, config }: DiscussionFieldsProps) {
  const updateNodeConfig = useWorkflowStore((s) => s.updateNodeConfig);

  // Top-level flat fields — safe for shallow merge
  const updateFlat = useCallback(
    (patch: Partial<Pick<DiscussionConfig, "prompt" | "maxRounds">>) => {
      updateNodeConfig(nodeId, patch);
    },
    [nodeId, updateNodeConfig]
  );

  // ── Moderator type-select handler ─────────────────────────
  const handleModeratorTypeChange = useCallback(
    (value: "none" | "code" | "agent") => {
      // store.ts:145 — `{ ...n.data.config, ...configUpdate }` — one-level spread.
      // Each call below only sets the `moderator` key; all other config fields
      // (prompt, maxRounds, tool) are preserved automatically by the store.
      if (value === "none") {
        updateNodeConfig(nodeId, { moderator: undefined });
        return;
      }

      if (value === "code") {
        updateNodeConfig(nodeId, {
          moderator: {
            type: "code",
            node: {
              label: "Code Moderator",
              type: "transform",
              config: { ...DEFAULT_CODE_MODERATOR_CONFIG },
            },
          },
        });
        return;
      }

      // value === "agent"
      updateNodeConfig(nodeId, {
        moderator: {
          type: "agent",
          node: {
            label: "Agent Moderator",
            type: "agent",
            config: { ...DEFAULT_AGENT_MODERATOR_CONFIG },
          },
        },
      });
    },
    [nodeId, updateNodeConfig]
  );

  const moderatorTypeValue = config.moderator?.type ?? "none";

  return (
    <>
      {/* ── Prompt ── */}
      <Field label="Prompt Template">
        <textarea
          value={config.prompt ?? ""}
          onChange={(e) => updateFlat({ prompt: e.target.value })}
          rows={6}
          className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs font-mono resize-y leading-relaxed"
          spellCheck={false}
          placeholder="{{transcript}}\n\nYou are {{agentName}}. Share your perspective."
        />
      </Field>
      <p className="text-[10px] text-muted-foreground px-1 -mt-2 leading-snug">
        Variables:{" "}
        <code className="font-mono">{"{{agentName}}"}</code>,{" "}
        <code className="font-mono">{"{{transcript}}"}</code>,{" "}
        <code className="font-mono">{"{{round}}"}</code>,{" "}
        <code className="font-mono">{"{{input}}"}</code>,{" "}
        <code className="font-mono">{"{{input.field}}"}</code>
      </p>

      {/* ── Max Rounds ── */}
      <Field label="Max Rounds">
        <input
          type="number"
          min={1}
          max={100}
          value={config.maxRounds ?? 3}
          onChange={(e) => {
            const val = parseInt(e.target.value, 10);
            if (!isNaN(val) && val >= 1 && val <= 100) {
              updateFlat({ maxRounds: val });
            }
          }}
          className={INPUT_CLASS}
        />
      </Field>
      <p className="text-[10px] text-muted-foreground px-1 -mt-2">
        Hard cap: discussion always stops here. Max 100.
      </p>

      {/* ── Moderator ── */}
      <div className="border-t border-border/60 pt-3">
        <p className="mb-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Moderator
        </p>

        {/* Type-select: inspector-first control — no mouse required */}
        <Field label="Type">
          <select
            value={moderatorTypeValue}
            onChange={(e) => handleModeratorTypeChange(e.target.value as "none" | "code" | "agent")}
            className={INPUT_CLASS}
          >
            <option value="none">None (sequential, all participants)</option>
            <option value="code">Code (Python / Node / Bash script)</option>
            <option value="agent">Agent (LLM-driven)</option>
          </select>
        </Field>

        {/* Inline editor based on selected type */}
        {config.moderator?.type === "code" && (
          <div className="mt-3 space-y-3">
            <ModeratorCodeEditor
              nodeId={nodeId}
              moderator={config.moderator as DiscussionModeratorConfig & { type: "code" }}
            />
          </div>
        )}

        {config.moderator?.type === "agent" && (
          <div className="mt-3 space-y-3">
            <ModeratorAgentEditor
              nodeId={nodeId}
              moderator={config.moderator as DiscussionModeratorConfig & { type: "agent" }}
            />
          </div>
        )}

        {!config.moderator && (
          <p className="mt-2 text-[10px] text-muted-foreground px-1 leading-snug">
            Without a moderator all connected agents speak once per round in connection order, for
            up to <strong>{config.maxRounds ?? 3}</strong> round
            {(config.maxRounds ?? 3) !== 1 ? "s" : ""}.
            <br className="mb-1" />
            You can also drop an Agent or Code node onto the discussion card on the canvas.
          </p>
        )}
      </div>
    </>
  );
}
