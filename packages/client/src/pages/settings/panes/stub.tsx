export function StubPane({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="settings-page">
      <div className="settings-hero">
        <div>
          <h1>{title}</h1>
          <p>{hint ?? "This section is coming soon."}</p>
        </div>
      </div>
      <div className="settings-empty">
        <div className="settings-empty-ico">·</div>
        <div>Not available in this version of OpenConclave.</div>
      </div>
    </div>
  );
}
