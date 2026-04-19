import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "@/components/ui/toast";
import { SettingsNav, findSection, type SectionId } from "./nav";
import { SettingsTopbar } from "./topbar";
import { SaveBar } from "./save-bar";
import { useSettingsDirty } from "./use-settings-dirty";
import { WebSearchPane } from "./panes/web-search";
import { ModelsPane } from "./panes/models";
import { IntegrationsPane } from "./panes/integrations";
import { AdvancedPane } from "./panes/advanced";
import { KnowledgePane } from "./panes/knowledge";
import { MarketplacePane } from "./panes/marketplace";
import { StubPane } from "./panes/stub";
import { UpdateBanner } from "./update-banner";

const DEFAULT_SECTION: SectionId = "models";

function parseSection(): SectionId {
  const m = window.location.pathname.match(/^\/settings\/([^/?#]+)/);
  if (!m) return DEFAULT_SECTION;
  const candidate = m[1] as SectionId;
  return findSection(candidate)?.enabled ? candidate : DEFAULT_SECTION;
}

export function SettingsPage() {
  const [section, setSection] = useState<SectionId>(parseSection);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const dirty = useSettingsDirty({});
  const { reset } = dirty;

  useEffect(() => {
    api
      .get<Record<string, string>>("/settings")
      .then((data) => {
        reset(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [reset]);

  useEffect(() => {
    const target = section === DEFAULT_SECTION ? "/settings" : `/settings/${section}`;
    if (window.location.pathname !== target) {
      window.history.replaceState({}, "", target);
    }
  }, [section]);

  const handleSelect = (id: SectionId) => setSection(id);

  const handleDiscard = () => dirty.reset(dirty.saved);

  const handleSave = async () => {
    setSaving(true);
    try {
      const changed = dirty.diff();
      await api.put("/settings", changed);
      dirty.reset(dirty.values);
      toast("Settings saved", "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save", "error");
    }
    setSaving(false);
  };

  return (
    <div className="settings-shell">
      <SettingsNav active={section} onSelect={handleSelect} />
      <div className="settings-main">
        <UpdateBanner />
        <SettingsTopbar active={section} />
        <div className="settings-scroll">
          {loading ? (
            <div className="settings-loading">Loading…</div>
          ) : (
            <Pane section={section} values={dirty.values} setValue={dirty.setValue} />
          )}
        </div>
        <SaveBar
          visible={dirty.dirty}
          editCount={dirty.editCount}
          saving={saving}
          onDiscard={handleDiscard}
          onSave={handleSave}
        />
      </div>
    </div>
  );
}

function Pane({
  section,
  values,
  setValue,
}: {
  section: SectionId;
  values: Record<string, string>;
  setValue: (k: string, v: string) => void;
}) {
  if (section === "web-search") return <WebSearchPane values={values} setValue={setValue} />;
  if (section === "models") return <ModelsPane values={values} setValue={setValue} />;
  if (section === "integrations") return <IntegrationsPane values={values} setValue={setValue} />;
  if (section === "knowledge") return <KnowledgePane />;
  if (section === "marketplace") return <MarketplacePane />;
  if (section === "advanced") return <AdvancedPane />;
  const item = findSection(section);
  return <StubPane title={item?.label ?? section} />;
}
