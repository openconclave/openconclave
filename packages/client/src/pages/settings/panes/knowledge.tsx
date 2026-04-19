import { useState } from "react";
import { KnowledgePage } from "@/pages/knowledge";

export function KnowledgePane() {
  const [showCreate, setShowCreate] = useState(false);
  return (
    <div className="settings-page knowledge-pane">
      <div className="settings-hero">
        <div>
          <h1>Knowledge</h1>
          <p>Knowledge bases feed documents into your agents via retrieval. Create a base, add documents, and reference it from Knowledge nodes.</p>
        </div>
        <div>
          <button type="button" className="btn btn-primary" onClick={() => setShowCreate(true)}>
            + New knowledge base
          </button>
        </div>
      </div>
      <div style={{ width: "100%" }}>
        <KnowledgePage embedded showCreate={showCreate} onShowCreateChange={setShowCreate} />
      </div>
    </div>
  );
}
