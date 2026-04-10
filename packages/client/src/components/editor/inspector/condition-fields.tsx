import { useConclaveStore } from "@/stores/conclave-store";
import type { ConditionConfig } from "@openconclave/shared";
import { Field, MONO_INPUT_CLASS, AutoTextarea } from "./shared";

interface ConditionFieldsProps {
  nodeId: string;
  config: ConditionConfig;
}

export function ConditionFields({ nodeId, config }: ConditionFieldsProps) {
  const updateNodeConfig = useConclaveStore((s) => s.updateNodeConfig);

  return (
    <Field label="Expression">
      <AutoTextarea
        value={config.expression}
        onChange={(e) => updateNodeConfig(nodeId, { expression: e.target.value })}
        placeholder="input.includes('done')"
        minRows={3}
        label="Expression"
        className={MONO_INPUT_CLASS}
      />
    </Field>
  );
}
