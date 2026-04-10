import { useCallback } from "react";
import { useConclaveStore } from "@/stores/conclave-store";
import type {
  DiscussionConfig,
  AgentConfig,
  CodeConfig,
} from "@openconclave/shared";
import { X } from "lucide-react";
import { AgentFields } from "./agent-fields";
import { CodeFields } from "./code-fields";
import { Field, INPUT_CLASS, AutoTextarea } from "./shared";

// ── Main DiscussionFields ─────────────────────────────────────

interface DiscussionFieldsProps {
  nodeId: string;
  config: DiscussionConfig;
}

export function DiscussionFields({ nodeId, config }: DiscussionFieldsProps) {
  const updateNodeConfig = useConclaveStore((s) => s.updateNodeConfig);

  // Top-level flat fields — safe for shallow merge
  const updateFlat = useCallback(
    (patch: Partial<Pick<DiscussionConfig, "prompt" | "maxRounds">>) => {
      updateNodeConfig(nodeId, patch);
    },
    [nodeId, updateNodeConfig]
  );

  const clearModerator = useCallback(() => {
    updateNodeConfig(nodeId, { moderator: undefined });
  }, [nodeId, updateNodeConfig]);

  // Adapter: routes AgentFields/CodeFields updates into the nested moderator config path.
  // store.ts:145 merges one level deep — setting only `moderator` preserves prompt/maxRounds/tool.
  // The inner spread chain preserves sibling fields within the moderator object.
  const updateModeratorConfig = useCallback(
    (patch: Partial<AgentConfig | CodeConfig>) => {
      if (!config.moderator) return;
      updateNodeConfig(nodeId, {
        moderator: {
          ...config.moderator,
          node: {
            ...config.moderator.node,
            config: { ...config.moderator.node.config, ...patch },
          },
        },
      });
    },
    [nodeId, config.moderator, updateNodeConfig]
  );

  return (
    <>
      {/* ── Prompt ── */}
      <Field label="Prompt Template">
        <AutoTextarea
          value={config.prompt ?? ""}
          onChange={(e) => updateFlat({ prompt: e.target.value })}
          minRows={6}
          label="Prompt Template"
          className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs font-mono leading-relaxed"
          spellCheck={false}
          placeholder="Topic: {{input}}\n\n{{transcript}}\n\nYou are {{agentName}}. Share your perspective."
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
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Moderator
          </p>
          {config.moderator && (
            <button
              onClick={clearModerator}
              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-destructive hover:bg-destructive/10 transition-colors"
            >
              <X className="h-3 w-3" />
              Remove
            </button>
          )}
        </div>

        {config.moderator?.type === "agent" && (
          <div className="space-y-3">
            <AgentFields
              nodeId={nodeId}
              config={config.moderator.node.config as AgentConfig}
              onUpdate={updateModeratorConfig}
            />
            <p className="text-[10px] text-muted-foreground px-1 leading-snug">
              The moderator sees the full transcript and must call the{" "}
              <code className="font-mono">moderate</code> tool with an action:{" "}
              <code className="font-mono">"call_next"</code>,{" "}
              <code className="font-mono">"call_specific"</code>, or{" "}
              <code className="font-mono">"end_discussion"</code>.
            </p>
          </div>
        )}

        {config.moderator?.type === "code" && (
          <div className="space-y-3">
            <CodeFields
              nodeId={nodeId}
              config={config.moderator.node.config as CodeConfig}
              onUpdate={updateModeratorConfig}
            />
            <p className="text-[10px] text-muted-foreground px-1 leading-snug">
              Input: <code className="font-mono">{"{ responses, transcript, round, input }"}</code> via stdin.
              <br />
              Output: <code className="font-mono">{"{ action, nextAgent?, summary? }"}</code> where action
              is <code className="font-mono">"call_next"</code>,{" "}
              <code className="font-mono">"call_specific"</code>, or{" "}
              <code className="font-mono">"end_discussion"</code>.
            </p>
          </div>
        )}

        {!config.moderator && (
          <p className="text-[10px] text-muted-foreground px-1 leading-snug">
            Without a moderator all connected agents speak once per round in connection order, for
            up to <strong>{config.maxRounds ?? 3}</strong> round
            {(config.maxRounds ?? 3) !== 1 ? "s" : ""}.
            <br className="mb-1" />
            Drop an Agent or Code node from the palette onto the discussion card to set a moderator.
          </p>
        )}
      </div>
    </>
  );
}
