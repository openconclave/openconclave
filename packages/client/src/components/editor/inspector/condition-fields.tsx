import { useWorkflowStore } from "@/stores/workflow-store";
import type { ConditionConfig } from "@openconclave/shared";
import { Field, MONO_INPUT_CLASS } from "./shared";

interface ConditionFieldsProps {
  nodeId: string;
  config: ConditionConfig;
}

export function ConditionFields({ nodeId, config }: ConditionFieldsProps) {
  const updateNodeConfig = useWorkflowStore((s) => s.updateNodeConfig);

  return (
    <Field label="Expression">
      <textarea
        value={config.expression}
        onChange={(e) => updateNodeConfig(nodeId, { expression: e.target.value })}
        placeholder="input.includes('done')"
        rows={3}
        className={`${MONO_INPUT_CLASS} resize-none`}
      />
    </Field>
  );
}
