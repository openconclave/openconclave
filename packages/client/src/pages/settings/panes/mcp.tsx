import { Section } from "../atoms";

export function McpPane() {
  return (
    <div className="settings-page">
      <div className="settings-hero">
        <div>
          <h1>MCP servers</h1>
          <p>Model Context Protocol servers expose tools to your agents. In OpenConclave, MCP servers are configured per-conclave via <code>MCP</code> tool nodes in the editor.</p>
        </div>
      </div>
      <Section title="Configure" sub="Where to set up MCP servers">
        <div className="settings-info">
          Open a conclave in the editor, drop in an <code>MCP</code> tool node, and point it at the server command or URL. The server's tools become available to any agent that has the node on its tool edge.
        </div>
      </Section>
    </div>
  );
}
