import { useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  Activity,
  Camera,
  ChevronDown,
  Cpu,
  History,
  Menu,
  Settings2,
  ShieldCheck,
  X,
} from "lucide-react";
import { useSentinel } from "@/hooks/use-sentinel";

const navigation = [
  { href: "/", label: "Overview", icon: Activity },
  { href: "/cameras", label: "Cameras", icon: Camera },
  { href: "/hardware", label: "Devices", icon: Cpu },
  { href: "/events", label: "Activity", icon: History },
];

export function OperatorShell({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [location] = useLocation();
  const { state, snapshot, facilities, selectFacility, connection, error } =
    useSentinel();
  const connectedDevices =
    snapshot?.facility.sentinels.filter((item) => item.connected).length ?? 0;
  const activePage = location.startsWith("/cameras/")
    ? "Camera"
    : (navigation.find(({ href }) =>
        href === "/" ? location === "/" : location.startsWith(href),
      )?.label ?? "Settings");

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <aside
        className={`${menuOpen ? "translate-x-0" : "-translate-x-full"} fixed inset-y-0 left-0 z-50 flex w-[224px] flex-col border-r border-border bg-sidebar transition-transform duration-200 lg:translate-x-0`}
      >
        <div className="flex h-16 items-center justify-between border-b border-border px-4">
          <Link
            href="/"
            className="flex items-center gap-3"
            onClick={() => setMenuOpen(false)}
          >
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-primary-foreground shadow-[0_0_24px_hsl(var(--primary)/.18)]">
              <ShieldCheck size={19} />
            </span>
            <span>
              <span className="block text-sm font-bold tracking-tight">
                CrowdGuard
              </span>
              <span className="block text-[10px] text-muted-foreground">
                Safety operations
              </span>
            </span>
          </Link>
          <button
            className="lg:hidden"
            onClick={() => setMenuOpen(false)}
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-3 py-4">
          <label className="block text-[10px] font-medium uppercase tracking-[.14em] text-muted-foreground">
            Facility
          </label>
          <div className="relative mt-2 flex items-center rounded-lg border border-border bg-card px-3 py-2.5">
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold">
                {snapshot?.facility.name ?? "Backend unavailable"}
              </div>
              <div className="mt-0.5 text-[9px] text-muted-foreground">
                {snapshot
                  ? `${snapshot.facility.cameras.length} cameras · ${snapshot.facility.exits.length} exits`
                  : "Waiting for data"}
              </div>
            </div>
            <ChevronDown size={14} className="ml-auto text-muted-foreground" />
            <select
              aria-label="Select facility"
              className="absolute inset-0 cursor-pointer opacity-0"
              value={snapshot?.facility.id ?? ""}
              onChange={(event) => void selectFacility(event.target.value)}
            >
              {facilities.map((facility) => (
                <option key={facility.id} value={facility.id}>
                  {facility.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3">
          {navigation.map(({ href, label, icon: Icon }) => {
            const active =
              href === "/" ? location === "/" : location.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setMenuOpen(false)}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-xs font-medium transition-colors ${active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
              >
                <Icon size={16} />
                {label}
                {label === "Activity" && (snapshot?.events.length ?? 0) > 0 && (
                  <span className="ml-auto rounded-full bg-background/20 px-2 py-0.5 text-[9px]">
                    {snapshot?.events.length}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="space-y-3 border-t border-border p-3">
          <Link
            href="/facility"
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Settings2 size={15} /> Advanced setup
          </Link>
          <div className="rounded-lg border border-border bg-card p-3">
            <StatusRow
              label={
                error
                  ? "Backend offline"
                  : connection === "open"
                    ? "Backend connected"
                    : "Reconnecting"
              }
              ok={!error && connection === "open"}
            />
            <StatusRow
              label={`${connectedDevices} ESP32 connected`}
              ok={connectedDevices > 0}
            />
          </div>
        </div>
      </aside>

      {menuOpen && (
        <button
          className="fixed inset-0 z-40 bg-black/70 lg:hidden"
          onClick={() => setMenuOpen(false)}
          aria-label="Close menu"
        />
      )}

      <div className="lg:pl-[224px]">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-background/95 px-4 backdrop-blur sm:px-6">
          <div className="flex items-center gap-3">
            <button
              className="lg:hidden"
              onClick={() => setMenuOpen(true)}
              aria-label="Open menu"
            >
              <Menu size={20} />
            </button>
            <div>
              <div className="text-sm font-semibold">{activePage}</div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">
                {snapshot?.facility.name ?? "CrowdGuard Sentinel"}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <HeaderPill
              label="Backend"
              value={connection === "open" ? "Online" : "Connecting"}
              ok={connection === "open"}
            />
            <HeaderPill
              label="AI"
              value={state.system.aiEngine === "OFFLINE" ? "Offline" : "Ready"}
              ok={state.system.aiEngine !== "OFFLINE"}
              hidden
            />
            <HeaderPill
              label="ESP32"
              value={connectedDevices ? "Connected" : "Setup needed"}
              ok={connectedDevices > 0}
            />
          </div>
        </header>
        <main className="mx-auto max-w-[1500px] px-4 py-5 sm:px-6 sm:py-6">
          {children}
        </main>
      </div>
    </div>
  );
}

function StatusRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center gap-2 py-1 text-[10px] text-muted-foreground">
      <span
        className={`h-2 w-2 rounded-full ${ok ? "bg-secondary" : "bg-primary"}`}
      />
      <span>{label}</span>
    </div>
  );
}

function HeaderPill({
  label,
  value,
  ok,
  hidden = false,
}: {
  label: string;
  value: string;
  ok: boolean;
  hidden?: boolean;
}) {
  return (
    <div
      className={`${hidden ? "hidden sm:flex" : "flex"} items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5`}
    >
      <span
        className={`h-2 w-2 rounded-full ${ok ? "bg-secondary" : "bg-primary"}`}
      />
      <span className="hidden text-[9px] uppercase tracking-wider text-muted-foreground md:inline">
        {label}
      </span>
      <span className="text-[10px] font-medium">{value}</span>
    </div>
  );
}
