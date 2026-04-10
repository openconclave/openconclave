import { useConclaveStore } from "@/stores/conclave-store";
import { Field, INPUT_CLASS } from "./shared";

interface FileConfig {
  path: string;
}

interface FileFieldsProps {
  nodeId: string;
  config: FileConfig;
}

export function FileFields({ nodeId, config }: FileFieldsProps) {
  const updateNodeConfig = useConclaveStore((s) => s.updateNodeConfig);
  const update = (c: Partial<FileConfig>) => updateNodeConfig(nodeId, c);

  return (
    <>
      <Field label="File Path (absolute)">
        <input
          type="text"
          value={config.path ?? ""}
          onChange={(e) => update({ path: e.target.value })}
          placeholder="C:\path\to\file.md"
          className={`${INPUT_CLASS} font-mono`}
        />
      </Field>
      <p className="text-[10px] text-muted-foreground px-1">
        Absolute file path. Tip: right-click file in Explorer &rarr; "Copy as path", then paste
        here.
      </p>
    </>
  );
}
