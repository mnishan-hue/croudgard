import { Camera, ExternalLink, Users } from "lucide-react";
import { Link } from "wouter";
import type { BackendSnapshot } from "@/types/sentinel";

export function LiveCameraGrid({snapshot}:{snapshot:BackendSnapshot}) {
  const cameras=snapshot.facility.cameras.filter(camera=>camera.enabled);
  const reporting=new Set(snapshot.reporting_camera_ids);
  const columns=cameras.length===1?"grid-cols-1":cameras.length===2?"md:grid-cols-2":cameras.length<=4?"md:grid-cols-2 xl:grid-cols-3":"sm:grid-cols-2 xl:grid-cols-3";
  return <div className={`grid gap-3 ${columns} ${cameras.length>9?"max-h-[760px] overflow-y-auto pr-1":""}`}>
    {cameras.map(camera=>{
      const zones=snapshot.facility.zones.filter(zone=>camera.zone_ids.includes(zone.id));
      const primary=[...zones].sort((a,b)=>b.risk-a.risk)[0];
      const live=reporting.has(camera.id);
      return <Link key={camera.id} href={`/cameras/${encodeURIComponent(camera.id)}`} className="group overflow-hidden border border-border bg-card transition-colors hover:border-primary/50">
        <div className={`relative grid min-h-32 place-items-center grid-surface ${live?"bg-secondary/[.05]":"bg-[#0b151f]"}`}><Camera size={26} className={live?"text-secondary":"text-muted-foreground/40"}/><span className={`absolute left-3 top-3 data-mono text-[8px] ${live?"text-secondary":"text-muted-foreground"}`}>{live?"LIVE METRICS":"WAITING"}</span><ExternalLink size={13} className="absolute right-3 top-3 text-muted-foreground group-hover:text-primary"/></div>
        <div className="p-3"><div className="flex items-start justify-between gap-3"><div><div className="text-[12px] font-semibold">{camera.name}</div><div className="mt-1 text-[9px] text-muted-foreground">{zones.map(zone=>zone.name).join(", ")||"Unassigned"}</div></div><div className="flex items-center gap-1 data-mono text-[10px] text-secondary"><Users size={12}/>{live?primary?.metrics.people_count??0:"—"}</div></div>
          <div className="mt-3 grid grid-cols-3 gap-px bg-border"><Datum label="STATE" value={live?(primary?.crowd_state.replaceAll("_"," ")??"NO DATA"):"NO DATA"}/><Datum label="RISK" value={live?`${Math.round(primary?.risk??0)}`:"—"}/><Datum label="FPS" value={live&&primary?.metrics.fps?primary.metrics.fps.toFixed(1):"—"}/></div>
        </div></Link>;
    })}
    {!cameras.length&&<div className="panel col-span-full grid min-h-40 place-items-center text-[11px] text-muted-foreground">No enabled cameras are configured.</div>}
  </div>;
}

function Datum({label,value}:{label:string;value:string}){return <div className="bg-card p-2"><div className="data-mono text-[7px] text-muted-foreground">{label}</div><div className="mt-1 truncate text-[9px] text-foreground">{value}</div></div>}
