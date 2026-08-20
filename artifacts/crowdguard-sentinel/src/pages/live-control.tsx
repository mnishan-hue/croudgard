import { useMemo, useState } from 'react';
import { ArrowRight, Bot, CircleAlert, Gauge, Radio, Route, ShieldCheck, Siren, TrendingUp, Users } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useSentinel } from '@/hooks/use-sentinel';
import { MapPanel, PageIntro, Panel, ScenarioControls } from '@/components/sentinel-shell';

const chartSeed = [28, 31, 35, 33, 39, 46, 52, 60, 66, 71, 69, 65, 62];
function chartData(risk: number) { return chartSeed.map((value, index) => ({ time: `${14}:${20 + index}`, risk: Math.max(8, Math.min(98, value + (risk - 55) * .35 + (index > 8 ? (risk - 55) * .22 : 0))) })); }

export default function LiveControl() {
  const { state } = useSentinel();
  const [armed, setArmed] = useState(true);
  const data = useMemo(() => chartData(state.analysis.risk), [state.analysis.risk]);
  const critical = state.analysis.risk > 85;
  return <div className="enter-rise">
    <PageIntro eyebrow="01 / COMMAND SURFACE" title="Live Control" description="One view for the crowd signal, the decision, and the response. This console is running a local simulation against the Harbor Arena gate complex." action={<div className="flex items-center gap-2 border border-secondary/25 bg-secondary/5 px-3 py-2"><span className="status-pulse h-2 w-2 rounded-full bg-secondary" /><span className="data-mono text-[9px] uppercase tracking-[.12em] text-secondary">Telemetry connected</span></div>} />
    <ScenarioControls />
    <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard label="Crowd risk index" value={`${state.analysis.risk}`} unit="/ 100" note={state.analysis.state} tone={critical ? 'danger' : state.analysis.risk > 55 ? 'amber' : 'teal'} icon={Gauge} />
      <MetricCard label="People in field" value={String(state.preset.people)} unit="tracks" note="anonymous · live" tone="teal" icon={Users} />
      <MetricCard label="Recommended exit" value={state.predictions[0].recommendedExit} unit="ROUTE" note={state.preset.decision} tone="amber" icon={Route} />
      <MetricCard label="Robot response" value={armed ? 'ENGAGED' : 'PAUSED'} unit="R-04" note={armed ? state.robot.display : 'Manual pause active'} tone={armed ? 'teal' : 'danger'} icon={Bot} />
    </div>
    <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
      <Panel title="Live venue map" eyebrow="SPATIAL MODEL / 3 SEC REFRESH" action={<span className="data-mono text-[9px] text-muted-foreground">N 37° · W 122°</span>}><MapPanel /></Panel>
      <Panel title="Decision trace" eyebrow="CROWDGUARD AI / EXPLAINABLE">
        <div className="space-y-0 p-4">
          <TraceRow step="01" label="Pattern detected" value={state.analysis.state} tone={critical || state.analysis.rippleDetected ? 'danger' : 'amber'} />
          <TraceRow step="02" label="Risk assessed" value={`${state.analysis.risk} / 100 · ${state.analysis.confidence}% confidence`} tone={state.analysis.risk > 60 ? 'danger' : 'teal'} />
          <TraceRow step="03" label="Decision issued" value={state.preset.decision} tone="amber" />
          <TraceRow step="04" label="Response sent" value={state.robot.display} tone="teal" last />
          <div className="mt-5 border border-border bg-muted/35 p-3"><div className="flex items-center gap-2 text-[10px] font-semibold"><ShieldCheck size={14} className="text-secondary" />Why this decision?</div><p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">Exit {state.predictions[0].recommendedExit === 'Exit B' ? 'A' : 'B'} is carrying {state.predictions[0].risk}% density with a {state.predictions[0].trend === '↑' ? 'rising' : 'stable'} queue. Routing people to {state.predictions[0].recommendedExit} preserves an estimated 18% outflow margin.</p></div>
        </div>
      </Panel>
    </div>
    <div className="mt-5 grid gap-5 xl:grid-cols-[1.5fr_1fr]">
      <Panel title="Risk trajectory" eyebrow="LAST 13 MINUTES" action={<div className="flex items-center gap-1 text-[10px] text-primary"><TrendingUp size={13} /> {state.analysis.risk > 50 ? 'elevated' : 'stable'}</div>}>
        <div className="h-[220px] px-2 pb-3 pt-4"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data} margin={{ left: -22, right: 12, top: 5, bottom: 0 }}><defs><linearGradient id="riskFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={critical ? '#ef665e' : '#e8aa3d'} stopOpacity={.28} /><stop offset="100%" stopColor={critical ? '#ef665e' : '#e8aa3d'} stopOpacity={0} /></linearGradient></defs><CartesianGrid stroke="#263442" strokeDasharray="2 5" vertical={false} /><XAxis dataKey="time" tick={{ fill: '#768493', fontSize: 9 }} axisLine={false} tickLine={false} /><YAxis domain={[0, 100]} tick={{ fill: '#768493', fontSize: 9 }} axisLine={false} tickLine={false} /><Tooltip contentStyle={{ background: '#17232f', border: '1px solid #334454', fontSize: 10 }} labelStyle={{ color: '#aebbc7' }} /><Area type="monotone" dataKey="risk" stroke={critical ? '#ef665e' : '#e8aa3d'} fill="url(#riskFill)" strokeWidth={2} dot={false} /></AreaChart></ResponsiveContainer></div>
      </Panel>
      <Panel title="Robot action stack" eyebrow="MOBILE UNIT / R-04">
        <div className="p-4"><div className="mb-4 flex items-center justify-between border border-secondary/20 bg-secondary/5 p-3"><div className="flex items-center gap-2"><span className="status-pulse h-2 w-2 rounded-full bg-secondary" /><span className="data-mono text-[10px] text-secondary">{state.robot.arm}</span></div><span className="data-mono text-[9px] text-muted-foreground">LATENCY 84ms</span></div><div className="space-y-2">{[['Display', state.robot.display], ['Exit A lights', state.robot.exitALights], ['Exit B lights', state.robot.exitBLights], ['Audio cue', state.robot.audio], ['Beacon', state.robot.beacon]].map(([label, value]) => <div className="flex items-center justify-between border-b border-border/70 py-2 last:border-0" key={label}><span className="text-[10px] text-muted-foreground">{label}</span><span className={`data-mono text-[9px] ${String(value).includes('RED') || String(value).includes('EMERGENCY') ? 'text-destructive' : 'text-foreground'}`}>{value}</span></div>)}</div><button onClick={() => setArmed((value) => !value)} className={`mt-4 flex w-full items-center justify-center gap-2 border py-2.5 text-[10px] font-semibold uppercase tracking-[.12em] ${armed ? 'border-primary/50 bg-primary/10 text-primary' : 'border-destructive/40 bg-destructive/10 text-destructive'}`} data-testid="button-toggle-robot">{armed ? <Siren size={14} /> : <Radio size={14} />}{armed ? 'Pause robot guidance' : 'Resume robot guidance'}</button></div>
      </Panel>
    </div>
    <div className={`mt-5 flex items-center gap-3 border p-3 ${critical ? 'border-destructive/50 bg-destructive/10' : 'border-secondary/25 bg-secondary/5'}`}><CircleAlert size={16} className={critical ? 'text-destructive' : 'text-secondary'} /><p className="text-[11px] text-muted-foreground"><span className="font-semibold text-foreground">{critical ? 'Critical crowd state requires operator confirmation.' : 'Operator note.'}</span> {critical ? 'Emergency response is staged. Verify physical egress before escalating.' : 'All actions shown are simulated locally and ready for FastAPI/WebSocket replacement.'}</p><ArrowRight size={15} className="ml-auto text-muted-foreground" /></div>
  </div>;
}

function MetricCard({ label, value, unit, note, tone, icon: Icon }: { label: string; value: string; unit: string; note: string; tone: 'danger' | 'amber' | 'teal'; icon: typeof Gauge }) {
  const color = tone === 'danger' ? 'text-destructive' : tone === 'amber' ? 'text-primary' : 'text-secondary';
  return <div className="panel p-4"><div className="flex items-start justify-between"><span className="data-mono text-[9px] uppercase tracking-[.13em] text-muted-foreground">{label}</span><Icon size={16} className={color} /></div><div className="mt-3 flex items-baseline gap-2"><span className={`data-mono text-[28px] font-semibold ${color}`}>{value}</span><span className="data-mono text-[9px] text-muted-foreground">{unit}</span></div><div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground"><span className={`h-1.5 w-1.5 rounded-full ${tone === 'danger' ? 'bg-destructive' : tone === 'amber' ? 'bg-primary' : 'bg-secondary'}`} />{note}</div></div>;
}
function TraceRow({ step, label, value, tone, last = false }: { step: string; label: string; value: string; tone: 'danger' | 'amber' | 'teal'; last?: boolean }) {
  const color = tone === 'danger' ? 'text-destructive' : tone === 'amber' ? 'text-primary' : 'text-secondary';
  return <div className="relative flex gap-3 pb-5"><div className="relative z-10 grid h-6 w-6 shrink-0 place-items-center border border-border bg-card data-mono text-[8px] text-muted-foreground">{step}</div>{!last && <span className="absolute left-3 top-6 h-[calc(100%-12px)] border-l border-dashed border-border" />}<div><div className="data-mono text-[9px] uppercase tracking-[.12em] text-muted-foreground">{label}</div><div className={`mt-1 text-[11px] font-medium ${color}`}>{value}</div></div></div>;
}