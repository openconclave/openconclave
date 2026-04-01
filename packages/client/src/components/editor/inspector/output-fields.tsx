import { useWorkflowStore } from "@/stores/workflow-store";
import type { OutputConfig, PromptConfig } from "@openconclave/shared";
import { Field, INPUT_CLASS, MONO_INPUT_CLASS } from "./shared";

interface OutputFieldsProps {
  nodeId: string;
  config: OutputConfig;
}

export function OutputFields({ nodeId, config }: OutputFieldsProps) {
  const updateNodeConfig = useWorkflowStore((s) => s.updateNodeConfig);
  const update = (c: Partial<OutputConfig>) => updateNodeConfig(nodeId, c);

  return (
    <Field label="Output Type">
      <select
        value={config.type}
        onChange={(e) => update({ type: e.target.value as OutputConfig["type"] })}
        className={INPUT_CLASS}
      >
        <option value="log">Log</option>
        <option value="claude-code">Claude Code (channel)</option>
        <option value="telegram">Telegram</option>
      </select>
      {config.type === "claude-code" && (
        <p className="mt-2 text-[10px] text-muted-foreground">
          Output will be pushed to any connected Claude Code session via the OpenConclave channel.
        </p>
      )}
      {config.type === "telegram" && (
        <>
          <input
            type="text"
            value={config.chatId ?? ""}
            onChange={(e) => update({ chatId: e.target.value })}
            placeholder="Chat ID"
            className={`mt-2 ${MONO_INPUT_CLASS}`}
          />
          <p className="mt-1 text-[10px] text-muted-foreground">
            Send output to this Telegram chat. Get your ID from /chatid on the bot.
          </p>
        </>
      )}
    </Field>
  );
}

interface PromptFieldsProps {
  nodeId: string;
  config: PromptConfig;
}

export function PromptFields({ nodeId, config }: PromptFieldsProps) {
  const updateNodeConfig = useWorkflowStore((s) => s.updateNodeConfig);

  return (
    <>
      <Field label="Description">
        <input
          type="text"
          value={config.description ?? ""}
          onChange={(e) => updateNodeConfig(nodeId, { description: e.target.value })}
          placeholder="Ask a question if needed"
          className={INPUT_CLASS}
        />
      </Field>
      <p className="text-[10px] text-muted-foreground px-1">
        Channel Loop: pauses workflow, sends agent's output to the connected Claude Code session,
        waits for response, then continues. The description is shown to the agent as the routing
        tool description.
      </p>
    </>
  );
}
