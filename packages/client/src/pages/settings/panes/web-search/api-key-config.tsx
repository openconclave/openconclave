import { FieldRow, SecretInput } from "../../atoms";
import type { WebSearchProviderInfo } from "./providers";

export function ApiKeyConfig({
  provider,
  value,
  onChange,
}: {
  provider: WebSearchProviderInfo;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <FieldRow
      label="API key"
      help={
        provider.docsUrl ? (
          <>
            <a href={provider.docsUrl} target="_blank" rel="noreferrer" className="link">
              Get one from {provider.name}
            </a>
            . Stored locally, never shared.
          </>
        ) : undefined
      }
    >
      <SecretInput value={value} placeholder={`${provider.name} API key`} onChange={onChange} />
    </FieldRow>
  );
}
