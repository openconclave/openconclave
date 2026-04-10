import { useEffect, useState } from "react";
import { Shell } from "@/components/layout/shell";
import { ToastContainer } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm";
import { DashboardPage } from "@/pages/dashboard";
import { ConclavesPage } from "@/pages/conclaves";
import { ConclaveEditorPage } from "@/pages/conclave-editor";
import { RunsPage } from "@/pages/runs";
import { RunDetailPage } from "@/pages/run-detail";
import { SettingsPage } from "@/pages/settings";
import { ChatPage } from "@/pages/chat";
import { KnowledgePage } from "@/pages/knowledge";
import { KnowledgeDetailPage } from "@/pages/knowledge-detail";
import { OnboardingPage } from "@/pages/onboarding";
import { api } from "@/lib/api";

export function getPage() {
  const path = window.location.pathname;
  if (path === "/" || path === "") return <DashboardPage />;
  if (path === "/conclaves") return <ConclavesPage />;
  if (path.startsWith("/conclaves/")) return <ConclaveEditorPage />;
  if (path === "/runs") return <RunsPage />;
  if (path.startsWith("/runs/")) return <RunDetailPage />;
  if (path === "/settings") return <SettingsPage />;
  if (path.startsWith("/knowledge/")) return <KnowledgeDetailPage />;
  if (path === "/knowledge") return <KnowledgePage />;
  // /:toolName/chat or /:toolName/chat/:sessionId
  if (path.split("/")[2] === "chat") return <ChatPage />;
  return <DashboardPage />;
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    // Manual trigger via ?onboarding param (from Settings page)
    if (new URLSearchParams(window.location.search).has("onboarding")) {
      setShowOnboarding(true);
      setReady(true);
      return;
    }

    Promise.all([
      api.get<Record<string, string>>("/settings"),
      api.get<{ providers: unknown[] }>("/providers"),
    ])
      .then(([settings, { providers }]) => {
        // Show onboarding only on truly fresh installs:
        // no onboarding_completed flag AND no providers configured yet
        const isNewInstall =
          settings.onboarding_completed !== "true" && providers.length === 0;
        setShowOnboarding(isNewInstall);
        setReady(true);
      })
      .catch(() => {
        // Server unreachable — skip onboarding check, show app
        setReady(true);
      });
  }, []);

  if (!ready) return null; // Brief flash while checking — intentionally blank

  if (showOnboarding) {
    return (
      <>
        <OnboardingPage
          onComplete={() => {
            setShowOnboarding(false);
            // Clean up the ?onboarding param
            window.history.replaceState({}, "", "/");
          }}
        />
        <ToastContainer />
      </>
    );
  }

  return (
    <>
      <Shell>{getPage()}</Shell>
      <ToastContainer />
      <ConfirmDialog />
    </>
  );
}
