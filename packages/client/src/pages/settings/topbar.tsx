import { findSection, type SectionId } from "./nav";

export function SettingsTopbar({ active }: { active: SectionId }) {
  const section = findSection(active);
  return (
    <header className="settings-topbar">
      <div className="crumb">
        <span className="dim">Settings</span>
        <span className="sep">/</span>
        <span className="cur">{section?.label ?? active}</span>
      </div>
    </header>
  );
}
