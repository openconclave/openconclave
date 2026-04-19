import { useState } from "react";
import { CopyBox, FieldRow } from "../../atoms";

const DOCKER_BASH = `mkdir -p ~/searxng
SECRET=$(openssl rand -hex 32)
cat > ~/searxng/settings.yml <<EOF
use_default_settings: true
search:
  formats: [html, json]
server:
  secret_key: "$SECRET"
  limiter: false
EOF
docker rm -f searxng 2>/dev/null
docker run -d --name searxng -p 8080:8080 --restart unless-stopped \\
  -v ~/searxng:/etc/searxng searxng/searxng`;

const DOCKER_PS = `$dir = "$HOME\\searxng"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$secret = -join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
@"
use_default_settings: true
search:
  formats: [html, json]
server:
  secret_key: "$secret"
  limiter: false
"@ | Set-Content "$dir\\settings.yml"
docker rm -f searxng 2>$null
docker run -d --name searxng -p 8080:8080 --restart unless-stopped -v "$\{dir}:/etc/searxng" searxng/searxng`;

type Shell = "bash" | "powershell";

export function SearxngConfig({
  url,
  onUrlChange,
}: {
  url: string;
  onUrlChange: (v: string) => void;
}) {
  const [shell, setShell] = useState<Shell>(() => defaultShell());
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
      <FieldRow
        label="Run your own"
        help="Creates ~/searxng/settings.yml with JSON output enabled, then runs the container. Re-run anytime — old container is removed first."
      >
        <div className="ws-shell-picker">
          <div className="ws-shell-tabs">
            <button
              type="button"
              className={shell === "bash" ? "on" : ""}
              onClick={() => setShell("bash")}
            >
              bash / zsh
            </button>
            <button
              type="button"
              className={shell === "powershell" ? "on" : ""}
              onClick={() => setShell("powershell")}
            >
              PowerShell
            </button>
          </div>
          <CopyBox text={shell === "bash" ? DOCKER_BASH : DOCKER_PS} />
        </div>
      </FieldRow>
    </>
  );
}

function defaultShell(): Shell {
  if (typeof navigator === "undefined") return "bash";
  return /windows/i.test(navigator.userAgent) ? "powershell" : "bash";
}
