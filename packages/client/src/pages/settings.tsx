import { useEffect, useState } from "react";
import { Header } from "@/components/layout/header";
import { api } from "@/lib/api";
import { toast } from "@/components/ui/toast";
import { Save, Eye, EyeOff } from "lucide-react";

type SettingsMap = Record<string, string>;

const settingsConfig = [
  {
    key: "telegram_bot_token",
    label: "Telegram Bot Token",
    description: "Bot token from @BotFather. Required for Telegram triggers.",
    secret: true,
    placeholder: "123456:ABC-DEF...",
  },
  {
    key: "ollama_url",
    label: "Ollama URL",
    description: "Ollama API endpoint. Default: http://localhost:11434",
    secret: false,
    placeholder: "http://localhost:11434",
  },
  {
    key: "max_concurrent_agents",
    label: "Max Concurrent Agents",
    description: "Maximum number of Claude Code agents running simultaneously.",
    secret: false,
    placeholder: "3",
  },
];

export function SettingsPage() {
  const [values, setValues] = useState<SettingsMap>({});
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<SettingsMap>("/settings").then(setValues).catch(() => {});
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put("/settings", values);
      // Restart Telegram trigger if token changed
      if (values.telegram_bot_token) {
        await api.post("/telegram/restart", {}).catch(() => {});
      }
      toast("Settings saved", "success");
    } catch (err: any) {
      toast(`Failed to save: ${err.message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Header
        title="Settings"
        actions={
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {saving ? "Saving..." : "Save"}
          </button>
        }
      />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl space-y-6">
          {settingsConfig.map((cfg) => (
            <div key={cfg.key} className="rounded-lg border border-border bg-card p-4">
              <label className="block text-sm font-medium mb-1">{cfg.label}</label>
              <p className="text-xs text-muted-foreground mb-3">{cfg.description}</p>
              <div className="flex items-center gap-2">
                <input
                  type={cfg.secret && !showSecrets[cfg.key] ? "password" : "text"}
                  value={values[cfg.key] ?? ""}
                  onChange={(e) => setValues({ ...values, [cfg.key]: e.target.value })}
                  placeholder={cfg.placeholder}
                  className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-mono"
                />
                {cfg.secret && (
                  <button
                    onClick={() =>
                      setShowSecrets({ ...showSecrets, [cfg.key]: !showSecrets[cfg.key] })
                    }
                    className="text-muted-foreground hover:text-foreground p-1.5"
                  >
                    {showSecrets[cfg.key] ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
