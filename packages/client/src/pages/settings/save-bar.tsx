export function SaveBar({
  visible,
  editCount,
  saving,
  onDiscard,
  onSave,
}: {
  visible: boolean;
  editCount: number;
  saving: boolean;
  onDiscard: () => void;
  onSave: () => void;
}) {
  return (
    <div className={`save-bar ${visible ? "show" : ""}`}>
      <div className="save-bar-inner">
        <div className="note">
          <span className="dot" />
          <span>Unsaved changes</span>
          <span className="count">
            {editCount} {editCount === 1 ? "edit" : "edits"}
          </span>
        </div>
        <div style={{ flex: 1 }} />
        <button type="button" className="btn btn-ghost" onClick={onDiscard} disabled={saving}>
          Discard
        </button>
        <button type="button" className="btn btn-primary" onClick={onSave} disabled={saving}>
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}
