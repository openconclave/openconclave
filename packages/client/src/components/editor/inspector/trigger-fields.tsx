import { useWorkflowStore } from "@/stores/workflow-store";
import { cn } from "@/lib/utils";
import type { TriggerConfig } from "@openconclave/shared";
import { Field, INPUT_CLASS, MONO_INPUT_CLASS } from "./shared";

const CRON_PRESETS = [
  { label: "Every 5m", cron: "*/5 * * * *" },
  { label: "Every 15m", cron: "*/15 * * * *" },
  { label: "Hourly", cron: "0 * * * *" },
  { label: "Daily 9am", cron: "0 9 * * *" },
  { label: "Weekdays 9am", cron: "0 9 * * 1-5" },
  { label: "Mon 9am", cron: "0 9 * * 1" },
  { label: "Midnight", cron: "0 0 * * *" },
] as const;

interface TriggerFieldsProps {
  nodeId: string;
  config: TriggerConfig;
}

export function TriggerFields({ nodeId, config }: TriggerFieldsProps) {
  const updateNodeConfig = useWorkflowStore((s) => s.updateNodeConfig);
  const update = (c: Partial<TriggerConfig>) => updateNodeConfig(nodeId, c);

  return (
    <>
      <Field label="Type">
        <select
          value={config.type}
          onChange={(e) => update({ type: e.target.value as TriggerConfig["type"] })}
          className={INPUT_CLASS}
        >
          <option value="manual">Manual</option>
          <option value="cron">Cron</option>
          <option value="webhook">Webhook</option>
          <option value="channel">Channel (Claude Code)</option>
          <option value="telegram">Telegram</option>
          <option value="chat">Chat (Web UI)</option>
        </select>
      </Field>

      {config.type === "chat" && (
        <p className="text-[10px] text-muted-foreground px-1">
          Users can chat with this workflow at{" "}
          <span className="font-mono text-primary">{"/{toolName}/chat"}</span>. Connect an output
          edge back to this trigger to send responses to the chat.
        </p>
      )}

      {config.type === "telegram" && (
        <Field label="Chat ID">
          <input
            type="text"
            value={config.chatId ?? ""}
            onChange={(e) => update({ chatId: e.target.value })}
            placeholder="1470461098"
            className={MONO_INPUT_CLASS}
          />
          <p className="mt-1 text-[10px] text-muted-foreground">
            Messages from this chat will trigger the workflow.
          </p>
        </Field>
      )}

      {config.type === "cron" && (
        <Field label="Cron Expression">
          <input
            type="text"
            value={config.cron ?? ""}
            onChange={(e) => update({ cron: e.target.value })}
            placeholder="0 9 * * 1-5"
            className={MONO_INPUT_CLASS}
          />
          <div className="flex flex-wrap gap-1 mt-1.5">
            {CRON_PRESETS.map((p) => (
              <button
                key={p.cron}
                onClick={() => update({ cron: p.cron })}
                className={cn(
                  "rounded px-1.5 py-0.5 text-[10px] border transition-colors",
                  config.cron === p.cron
                    ? "bg-primary/20 border-primary/40 text-primary"
                    : "border-border/40 text-muted-foreground hover:bg-accent/30"
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </Field>
      )}

      {config.type === "webhook" && (
        <Field label="Webhook Path">
          <input
            type="text"
            value={config.webhookPath ?? ""}
            onChange={(e) => update({ webhookPath: e.target.value })}
            placeholder="/hooks/my-trigger"
            className={MONO_INPUT_CLASS}
          />
        </Field>
      )}

      {config.type === "channel" && (
        <p className="text-[10px] text-muted-foreground px-1">
          Triggered from Claude Code via the OpenConclave channel.
        </p>
      )}

      {(config.type === "manual" || config.type === "cron") && (
        <Field label="Input Prompt">
          <textarea
            value={config.prompt ?? ""}
            onChange={(e) => update({ prompt: e.target.value })}
            placeholder="Initial data passed to the first node..."
            rows={3}
            className={`${INPUT_CLASS} resize-none`}
          />
        </Field>
      )}
    </>
  );
}
