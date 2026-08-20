import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { Activity, AlertTriangle, Aperture, Bot, Camera, ChevronDown, Cpu, FileClock, LayoutDashboard, Menu, RadioTower, ShieldCheck, Thermometer, X } from 'lucide-react';
import { scenarios, type Scenario, type Severity } from '@/lib/sentinel';
import { useSentinel } from '@/hooks/use-sentinel';
import { serviceConfig } from '@/services/config';

const nav = [
  { href: '/', label: 'Live Control', icon: LayoutDashboard },
  { href: '/cameras', label: 'Camera Analysis', icon: Camera },
  { href: '/intelligence', label: 'AI Intelligence', icon: Activity },
  { href: '/hardware', label: 'Hardware', icon: Cpu },
  { href: '/events', label: 'Event Log', icon: FileClock },
];

export function SentinelShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [location] = useLocation();
  const { state } = useSentinel();
  return (
    <div className="noise min-h-[100dvh] bg-background">
      <aside className={`${mobileOpen ? 'translate-x-0' : '-translate-x-full'} fixed inset-y-0 left-0 z-50 flex w-[246px] flex-col border-r border-sidebar-border bg-sidebar transition-transform duration-200 lg:translate-x-0`}>
        <div className="flex h-[76px] items-center justify-between border-b border-sidebar-border px-5">
          <Link href="/" className="flex items-center gap-3" data-testid="link-brand">
            <span className="relative grid h-9 w-9 place-items-center border border-primary/60 bg-primary/10 text-primary"><ShieldCheck size={20} /><i className="status-pulse absolute -right-1 -top-1 h-2 w-2 rounded-full bg-secondary" /></span>
            <span><span className="block text-[15px] font-bold tracking-[-.02em] text-foreground">CROWDGUARD</span><span className="data-mono block text-[9px] tracking-[.22em] text-muted-foreground">SENTINEL / OC-01</span></span>
          </Link>
          <button className="text-muted-foreground lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close navigation" data-testid="button-close-navigation"><X size={18} /></button>
        </div>
        <div className="border-b border-sidebar-border px-4 py-4">
          <p className="data-mono mb-2 text-[9px] uppercase tracking-[.18em] text-muted-foreground">Facility</p>
          <div className="flex items-center justify-between rounded-sm border border-sidebar-border bg-sidebar-accent/60 px-3 py-2.5"><div><div className="text-[12px] font-semibold">Harbor Arena</div><div className="data-mono mt-1 text-[9px] text-muted-foreground">GATE COMPLEX · ZONE 03</div></div><ChevronDown size={13} className="text-muted-foreground" /></div>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-5">
          <p className="data-mono mb-3 px-3 text-[9px] uppercase tracking-[.18em] text-muted-foreground">Operations</p>
          {nav.map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={() => setMobileOpen(false)} className={`group flex items-center gap-3 border-l-2 px-3 py-2.5 text-[12px] font-medium transition-colors ${location === href ? 'border-primary bg-primary/10 text-primary' : 'border-transparent text-sidebar-foreground/65 hover:border-sidebar-border hover:bg-sidebar-accent hover:text-sidebar-foreground'}`} data-testid={`link-nav-${label.toLowerCase().replaceAll(' ', '-')}`}><Icon size={16} strokeWidth={1.8} /><span>{label}</span>{label === 'Event Log' && <span className="data-mono ml-auto rounded-sm bg-destructive/15 px-1.5 py-0.5 text-[9px] text-destructive">5</span>}</Link>)}
          <p className="data-mono mb-3 mt-8 px-3 text-[9px] uppercase tracking-[.18em] text-muted-foreground">System</p>
          <div className="flex items-center gap-3 px-3 py-2 text-[11px] text-sidebar-foreground/65"><RadioTower size={15} className="text-secondary" /> <span>Live telemetry</span><span className="status-pulse ml-auto h-1.5 w-1.5 rounded-full bg-secondary" /></div>
          <div className="flex items-center gap-3 px-3 py-2 text-[11px] text-sidebar-foreground/65"><Thermometer size={15} className="text-primary" /> <span>6 thermal nodes</span><span className="data-mono ml-auto text-[9px]">OK</span></div>
        </nav>
        <div className="border-t border-sidebar-border p-4"><div className="flex items-center gap-2 text-[10px] text-muted-foreground"><span className={`h-2 w-2 rounded-full ${state.system.emergencyStatus === 'CLEAR' ? 'bg-secondary' : 'bg-destructive status-pulse'}`} /> <span className="data-mono uppercase tracking-[.14em]">{state.system.emergencyStatus === 'CLEAR' ? 'No active emergency' : state.system.emergencyStatus}</span></div><div className="data-mono mt-3 text-[9px] text-muted-foreground/60">BUILD 0.9.7 · LOCAL DEMO</div></div>
      </aside>
      {mobileOpen && <button className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close menu" data-testid="button-overlay-navigation" />}
      <div className="lg:pl-[246px]">
        <header className="sticky top-0 z-30 flex h-[76px] items-center justify-between border-b border-border bg-background/95 px-4 backdrop-blur-md sm:px-7">
          <div className="flex items-center gap-3"><button className="text-muted-foreground lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation" data-testid="button-open-navigation"><Menu size={20} /></button><div><div className="data-mono text-[9px] uppercase tracking-[.2em] text-muted-foreground">LOCAL OPERATIONS CONTROL</div><div className="mt-1 text-[13px] font-semibold text-foreground">{location === '/' ? 'Live Control' : nav.find((item) => item.href === location)?.label ?? 'Operations'}</div></div></div>
          <div className="flex items-center gap-2 sm:gap-5">
            <div className="hidden items-center gap-3 xl:flex">
              <HeaderStatus label="Data source" value={serviceConfig.useMockData ? 'MOCK MODE' : 'LIVE BACKEND'} tone={serviceConfig.useMockData ? 'amber' : 'teal'} />
              <HeaderStatus label="AI engine" value={state.system.aiEngine} tone="teal" />
              <HeaderStatus label="ESP32 relay" value={state.system.esp32} tone="teal" />
              <HeaderStatus label="Emergency" value={state.system.emergencyStatus} tone={state.system.emergencyStatus === 'CLEAR' ? 'teal' : 'red'} />
            </div>
            <div className="hidden items-center gap-2 border-l border-border pl-3 text-right sm:flex sm:pl-5"><span className="data-mono text-[10px] text-muted-foreground">{state.system.timestamp} UTC</span><span className="h-1.5 w-1.5 rounded-full bg-secondary status-pulse" /></div>
            <div className="flex items-center gap-2 border-l border-border pl-3 sm:pl-5"><span className="grid h-7 w-7 place-items-center rounded-full border border-secondary/40 bg-secondary/10 text-[10px] font-bold text-secondary">OP</span><span className="hidden text-[11px] font-medium sm:block">Operator / 04</span></div>
          </div>
        </header>
        <main className="mx-auto max-w-[1600px] px-4 py-5 sm:px-7 sm:py-7">{children}</main>
      </div>
    </div>
  );
}

function HeaderStatus({ label, value, tone }: { label: string; value: string; tone: 'teal' | 'red' | 'amber' }) {
  return <div className="flex items-center gap-2">
    <span className={`h-1.5 w-1.5 rounded-full ${tone === 'red' ? 'bg-destructive status-pulse' : tone === 'amber' ? 'bg-primary' : 'bg-secondary'}`} />
    <div><div className="data-mono text-[8px] uppercase tracking-[.12em] text-muted-foreground">{label}</div><div className={`data-mono mt-0.5 text-[9px] ${tone === 'red' ? 'text-destructive' : tone === 'amber' ? 'text-primary' : 'text-secondary'}`}>{value}</div></div>
  </div>;
}

export function PageIntro({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><div className="data-mono mb-2 text-[10px] uppercase tracking-[.22em] text-primary">{eyebrow}</div><h1 className="text-[26px] font-semibold tracking-[-.04em] text-foreground sm:text-[32px]">{title}</h1><p className="mt-2 max-w-[650px] text-[12px] leading-relaxed text-muted-foreground">{description}</p></div>{action}</div>;
}

export function ScenarioControls() {
  const { scenario, setScenario } = useSentinel();
  return <section className="panel mb-6 flex flex-col gap-4 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4"><div className="flex items-center gap-3"><div className="grid h-8 w-8 place-items-center border border-primary/40 bg-primary/10 text-primary"><Aperture size={15} /></div><div><div className="text-[11px] font-semibold">Demo Controls</div><div className="data-mono text-[9px] text-muted-foreground">SIMULATION STATE · LOCAL ONLY</div></div></div><div className="flex min-w-0 flex-1 flex-wrap justify-start gap-1.5 sm:justify-end">{scenarios.map((item) => <button key={item.id} onClick={() => setScenario(item.id)} className={`min-w-[104px] border px-2.5 py-2 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${scenario === item.id ? 'border-primary/70 bg-primary/15 text-primary' : 'border-border bg-muted/40 text-muted-foreground hover:border-primary/35 hover:bg-muted'}`} data-testid={`button-scenario-${item.id}`} aria-pressed={scenario === item.id}><span className="block text-[10px] font-semibold">{item.label}</span><span className="data-mono mt-0.5 block text-[8px] opacity-65">{item.short}</span></button>)}</div></section>;
}

export function Panel({ title, eyebrow, children, className = '', action }: { title: string; eyebrow?: string; children: React.ReactNode; className?: string; action?: React.ReactNode }) {
  return <section className={`panel overflow-hidden ${className}`}><div className="flex items-center justify-between border-b border-border px-4 py-3"><div>{eyebrow && <div className="data-mono mb-1 text-[8px] uppercase tracking-[.18em] text-muted-foreground">{eyebrow}</div>}<h2 className="text-[12px] font-semibold tracking-wide text-foreground">{title}</h2></div>{action}</div><div>{children}</div></section>;
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  const styles: Record<Severity, string> = { info: 'bg-secondary/10 text-secondary border-secondary/25', watch: 'bg-primary/10 text-primary border-primary/25', urgent: 'bg-destructive/10 text-destructive border-destructive/25', critical: 'bg-destructive text-destructive-foreground border-destructive' };
  return <span className={`data-mono inline-flex items-center gap-1 border px-1.5 py-0.5 text-[8px] uppercase tracking-[.12em] ${styles[severity]}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{severity}</span>;
}

export function MapPanel() {
  const { state } = useSentinel();
  const hotspot = state.preset.risk > 75 ? 'bg-destructive' : state.preset.risk > 55 ? 'bg-primary' : 'bg-secondary';
  return <div className="scanline relative h-[318px] overflow-hidden bg-[#101b27]"><div className="absolute inset-0 opacity-70 grid-surface" /><div className="absolute left-[9%] top-[18%] h-[66%] w-[82%] border border-secondary/35 bg-secondary/[.025]"><div className="absolute inset-[8%] border border-dashed border-muted-foreground/25" /><div className="absolute left-[20%] top-[38%] h-[24%] w-[54%] border border-primary/30 bg-primary/[.05]" /><div className="absolute left-[42%] top-[8%] h-[84%] border-l border-dashed border-muted-foreground/25" /><span className="absolute left-[42%] top-[-13px] -translate-x-1/2 data-mono text-[8px] text-muted-foreground">CENTRAL PLAZA</span></div><div className={`absolute left-[17%] top-[45%] h-12 w-12 rounded-full ${hotspot}/15 blur-xl`} /><div className={`absolute right-[12%] top-[33%] h-8 w-8 rounded-full ${state.preset.risk > 65 ? hotspot : 'bg-secondary'}/20 blur-lg`} /><div className="absolute left-[4%] top-[43%] flex items-center gap-1 text-[9px] text-muted-foreground"><span className="h-2 w-2 rounded-full border border-primary bg-primary/30" /> EXIT A</div><div className="absolute right-[3%] top-[43%] flex items-center gap-1 text-[9px] text-muted-foreground">EXIT B <span className="h-2 w-2 rounded-full border border-secondary bg-secondary/30" /></div><div className="absolute left-[42%] top-[46%] grid h-7 w-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-primary bg-primary/20 text-primary"><Bot size={15} /></div>{[...Array(12)].map((_, i) => <span key={i} className={`absolute h-1.5 w-1.5 rounded-full ${i % 3 === 0 ? 'bg-secondary' : 'bg-primary/70'} signal-flow`} style={{ left: `${20 + (i * 17) % 64}%`, top: `${30 + (i * 23) % 38}%`, animationDelay: `${i * 80}ms` }} />)}<div className="absolute bottom-3 left-3 border border-border bg-background/80 px-2 py-1.5 backdrop-blur-sm"><div className="data-mono text-[8px] text-muted-foreground">LIVE CROWD FIELD · 14:32:08</div><div className="mt-1 flex gap-3 text-[9px]"><span className="text-secondary">● FLOW</span><span className="text-primary">● DENSITY</span><span className="text-destructive">● RISK</span></div></div><div className="absolute right-3 top-3 flex items-center gap-1 border border-secondary/30 bg-background/80 px-2 py-1 data-mono text-[8px] text-secondary"><span className="status-pulse h-1.5 w-1.5 rounded-full bg-secondary" /> MAP FEED LIVE</div></div>;
}