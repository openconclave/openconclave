import { CopyBox, FieldRow } from "../../atoms";

const DOCKER_CMD = `docker run -d --name searxng -p 8080:8080 --restart unless-stopped searxng/searxng`;

export function SearxngConfig({
  url,
  onUrlChange,
}: {
  url: string;
  onUrlChange: (v: string) => void;
}) {
  return (
    <>
      <FieldRow
        label="Instance URL"
        help="Your SearXNG endpoint. localhost:8080 is the default if you run the container below."
      >
        <input
          className="settings-input mono"
          placeholder="http://localhost:8080"
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
        />
      </FieldRow>
      <FieldRow label="Run your own" help="One-liner to spin up a SearXNG container locally. Requires Docker.">
        <CopyBox text={DOCKER_CMD} />
      </FieldRow>
    </>
  );
}
