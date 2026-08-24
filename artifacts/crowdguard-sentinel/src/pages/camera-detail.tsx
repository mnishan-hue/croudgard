import { ArrowLeft } from 'lucide-react';
import { Link, useParams } from 'wouter';
import { PageIntro, Panel } from '@/components/sentinel-shell';
import { TeachableCamera } from '@/components/teachable-camera';
import { useSentinel } from '@/hooks/use-sentinel';

export default function CameraDetail() {
  const { cameraId = '' } = useParams<{cameraId:string}>();
  const { snapshot, refresh } = useSentinel();
  const camera=snapshot?.facility.cameras.find((item)=>item.id===decodeURIComponent(cameraId));
  const zones=snapshot?.facility.zones.filter((zone)=>camera?.zone_ids.includes(zone.id))??[];
  const primary=[...zones].sort((a,b)=>b.risk-a.risk)[0];

  if(!snapshot)return <div className="panel grid min-h-64 place-items-center p-8 text-center"><div><div className="data-mono text-[11px] text-primary">BACKEND OFFLINE</div><button onClick={()=>void refresh()} className="mt-4 border border-primary/40 px-3 py-2 data-mono text-[9px] text-primary">RETRY</button></div></div>;
  if(!camera)return <div className="panel grid min-h-64 place-items-center p-8 text-center"><div><div className="data-mono text-[11px] text-destructive">CAMERA NOT FOUND</div><Link href="/cameras" className="mt-4 inline-flex border border-primary/40 px-3 py-2 data-mono text-[9px] text-primary">BACK TO CAMERA GRID</Link></div></div>;

  const metrics=primary?.metrics;
  const values=[
    ['CURRENT CLASSIFICATION',primary?.crowd_state??'NO DATA'],
    ['PEOPLE COUNT',String(metrics?.people_count??'—')],
    ['DENSITY',metrics?`${Math.round(metrics.density)}%`:'—'],
    ['AVERAGE SPEED',metrics?`${metrics.average_speed.toFixed(2)} m/s`:'—'],
    ['DIRECTION',metrics?.direction_conflict&&metrics.direction_conflict>35?'CONFLICTING':'PRIMARY FLOW'],
    ['INFLOW',metrics?`${Math.round(metrics.inflow)} / min`:'—'],
    ['OUTFLOW',metrics?`${Math.round(metrics.outflow)} / min`:'—'],
    ['STOPPED',metrics?`${Math.round(metrics.stopped_percentage)}%`:'—'],
    ['QUEUE GROWTH',metrics?`${metrics.queue_growth.toFixed(2)} / min`:'—'],
    ['DIRECTION CONFLICT',metrics?`${Math.round(metrics.direction_conflict)}%`:'—'],
    ['RIPPLE SCORE',metrics?`${Math.round(metrics.ripple_score)} / 100`:'—'],
    ['RISK',primary?`${Math.round(primary.risk)} / 100`:'—'],
  ];

  return <div className="enter-rise">
    <PageIntro eyebrow="02 / CAMERA DETAIL" title={camera.name} description={`${camera.id} · ${camera.camera_type} · ${camera.source}`} action={<Link href="/cameras" className="flex items-center gap-2 border border-border px-3 py-2 data-mono text-[9px] text-muted-foreground"><ArrowLeft size={13}/> CAMERA GRID</Link>}/>
    <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
      <Panel title="Camera feed" eyebrow={camera.status==='ONLINE'&&camera.enabled?'LOCAL MODEL READY':'CAMERA DISABLED'}>
        <TeachableCamera cameraId={camera.id}/>
      </Panel>
      <Panel title="Camera health" eyebrow="CONFIGURATION AND PROVIDER">
        <div className="divide-y divide-border">{[
          ['STATUS',camera.enabled?camera.status:'DISABLED'],
          ['AI MODE',camera.ai_enabled?snapshot.ai_mode:'AI DISABLED'],
          ['AI PROVIDER',snapshot.ai_provider],
          ['AI CONFIDENCE',snapshot.prediction.simulated?`${Math.round(snapshot.prediction.confidence)}% · SIMULATED`:`${Math.round(snapshot.prediction.confidence)}%`],
          ['ASSIGNED ZONES',zones.map((zone)=>zone.name).join(', ')||'UNASSIGNED'],
          ['SOURCE',camera.source],
        ].map(([label,value])=><div key={label} className="p-4"><div className="data-mono text-[8px] text-muted-foreground">{label}</div><div className="mt-2 break-words text-[11px] text-foreground">{value}</div></div>)}</div>
      </Panel>
    </div>
    <Panel title="Current zone metrics" eyebrow="BACKEND SNAPSHOT" className="mt-5"><div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">{values.map(([label,value])=><div key={label} className="bg-card p-4"><div className="data-mono text-[8px] text-muted-foreground">{label}</div><div className="data-mono mt-2 text-[13px] text-foreground">{value}</div></div>)}</div></Panel>
  </div>;
}
