import { useState } from "react";
import { Sidebar } from "./sidebar";

const STORAGE_KEY = "oc-sidebar-open";

export function Shell({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === null ? true : stored === "true";
  });

  const toggle = () => {
    setSidebarOpen((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  };

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar open={sidebarOpen} onToggle={toggle} />
      <main className="flex flex-1 flex-col overflow-hidden">{children}</main>
    </div>
  );
}
