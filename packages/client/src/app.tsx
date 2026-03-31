import { Shell } from "@/components/layout/shell";
import { ToastContainer } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm";
import { DashboardPage } from "@/pages/dashboard";
import { WorkflowsPage } from "@/pages/workflows";
import { WorkflowEditorPage } from "@/pages/workflow-editor";
import { RunsPage } from "@/pages/runs";
import { RunDetailPage } from "@/pages/run-detail";
import { SettingsPage } from "@/pages/settings";
import { ChatPage } from "@/pages/chat";

function getPage() {
  const path = window.location.pathname;
  if (path === "/" || path === "") return <DashboardPage />;
  if (path === "/workflows") return <WorkflowsPage />;
  if (path.startsWith("/workflows/")) return <WorkflowEditorPage />;
  if (path === "/runs") return <RunsPage />;
  if (path.startsWith("/runs/")) return <RunDetailPage />;
  if (path === "/settings") return <SettingsPage />;
  // /:toolName/chat or /:toolName/chat/:sessionId
  if (path.split("/")[2] === "chat") return <ChatPage />;
  return <DashboardPage />;
}

export default function App() {
  return (
    <>
      <Shell>{getPage()}</Shell>
      <ToastContainer />
      <ConfirmDialog />
    </>
  );
}
