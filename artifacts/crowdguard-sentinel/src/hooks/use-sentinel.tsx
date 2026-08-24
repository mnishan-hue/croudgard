import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getMockState, getNoDataState, type Scenario } from '@/lib/sentinel';
import type { BackendSnapshot, Facility } from '@/types/sentinel';
import { apiFetch } from '@/services/api';
import { connectSentinelSocket } from '@/services/websocket';

type Connection = 'connecting'|'open'|'closed'|'error';
const Context=createContext<{scenario:Scenario;setScenario:(s:Scenario)=>void;state:ReturnType<typeof getMockState>;snapshot:BackendSnapshot|null;facilities:Facility[];connection:Connection;error:string|null;refresh:()=>Promise<void>;selectFacility:(id:string)=>Promise<void>}|null>(null);
const scenarioNames:Record<Scenario,string>={normal:'NORMAL',exitA:'EXIT_A_CONGESTION',exitB:'EXIT_B_CONGESTION',ripple:'RIPPLE_DETECTED',critical:'CRITICAL_STATE',recovery:'RECOVERY'};

function adapt(snapshot:BackendSnapshot):ReturnType<typeof getMockState>{
  const f=snapshot.facility, selectedExit=f.exits.find(x=>x.id===snapshot.decision.recommended_exit_id);
  const cameras=f.cameras.map(c=>{const assigned=f.zones.filter(z=>c.zone_ids.includes(z.id));const m=assigned[0]?.metrics;return{id:c.id,name:c.name,zone:assigned.map(z=>z.name).join(', ')||'Unassigned',online:c.status==='ONLINE'&&c.enabled,fps:c.status==='ONLINE'?24:0,peopleDetected:m?.people_count??0,density:Math.round(m?.density??0),resolution:'Configuration ready',processing:c.ai_enabled?'DEMO AI':'AI disabled'}});
  const zones=f.zones.map(z=>({zone:z.name,risk:Math.round(z.risk),density:Math.round(z.metrics.density),speed:z.metrics.average_speed,queueGrowth:z.metrics.queue_growth,inflow:Math.round(z.metrics.inflow),outflow:Math.round(z.metrics.outflow),stoppedPeople:Math.round(z.metrics.stopped_percentage),directionConflict:Math.round(z.metrics.direction_conflict)}));
  const predictions=f.exits.map(e=>({zone:e.name,risk:Math.round(e.risk),label:e.status,trend:e.risk>50?'↑':'→',recommendedExit:selectedExit?.name??'None',intervention:snapshot.intervention.status}));
  const hw=f.sentinels[0]?.hardware_state;
  return {preset:{risk:snapshot.prediction.risk,state:snapshot.prediction.crowd_state,decision:snapshot.decision.reason,robot:hw?.display_message??'NO SENTINEL',accent:'amber',people:f.zones.reduce((n,z)=>n+z.metrics.people_count,0),a:f.exits[0]?.risk??0,b:f.exits[1]?.risk??0,ripple:snapshot.prediction.ripple_state!=='NONE'},cameras,zones,analysis:{state:snapshot.prediction.crowd_state,risk:Math.round(snapshot.prediction.risk),confidence:Math.round(snapshot.prediction.confidence),rippleDetected:snapshot.prediction.ripple_state!=='NONE',rippleStrength:Math.round(f.zones.reduce((m,z)=>Math.max(m,z.metrics.ripple_score),0)),propagation:snapshot.prediction.ripple_state},predictions,robot:{arm:hw?.arm_state??'DISCONNECTED',display:hw?.display_message??'NO DATA',exitALights:f.exits[0]?hw?.led_routes[f.exits[0].id]??'NORMAL':'N/A',exitBLights:f.exits[1]?hw?.led_routes[f.exits[1].id]??'NORMAL':'N/A',audio:hw?.audio??'NONE',beacon:'REMOVED'},events:snapshot.events.map(e=>({timestamp:new Date(e.timestamp).toLocaleTimeString(),category:e.category,severity:e.severity==='CRITICAL'?'critical' as const:e.severity==='WARNING'?'watch' as const:'info' as const,message:e.message})),explanations:snapshot.prediction.explanations.map(e=>({signal:e.signal,value:String(Math.round(e.value)),unit:'',status:e.value>60?'elevated':'nominal',contribution:Math.round(e.contribution*100),tooltip:e.description})),system:{timestamp:new Date(snapshot.timestamp).toLocaleTimeString(),systemState:snapshot.intervention.status,aiEngine:`${snapshot.ai_provider} · SIMULATED`,esp32:f.sentinels.every(s=>s.connected)?'MOCK CONNECTED':'DISCONNECTED',emergencyStatus:snapshot.prediction.risk>=90?'CRITICAL CROWD RISK':'CLEAR'}};
}
export function SentinelProvider({children}:{children:ReactNode}){
 const [scenario,setScenarioState]=useState<Scenario>('exitA'),[snapshot,setSnapshot]=useState<BackendSnapshot|null>(null),[facilities,setFacilities]=useState<Facility[]>([]),[connection,setConnection]=useState<Connection>('connecting'),[error,setError]=useState<string|null>(null);
 const refresh=useCallback(async()=>{try{const [s,f]=await Promise.all([apiFetch<BackendSnapshot>('/system'),apiFetch<Facility[]>('/facilities')]);setSnapshot(s);setFacilities(f);setError(null)}catch(e){setError(e instanceof Error?e.message:'BACKEND OFFLINE');setConnection('error')}},[]);
 useEffect(()=>{void refresh();return connectSentinelSocket<BackendSnapshot>(setSnapshot,setConnection)},[refresh]);
 const setScenario=useCallback((s:Scenario)=>{setScenarioState(s);void apiFetch<BackendSnapshot>('/demo/scenario',{method:'POST',body:JSON.stringify({scenario:scenarioNames[s],timed:true})}).then(setSnapshot).catch(e=>setError(String(e)))},[]);
 const selectFacility=useCallback(async(id:string)=>{const s=await apiFetch<BackendSnapshot>(`/demo/facility/${id}`,{method:'POST'});setSnapshot(s)},[]);
 const state=useMemo(()=>snapshot?adapt(snapshot):getNoDataState(),[snapshot]);
 return <Context.Provider value={{scenario,setScenario,state,snapshot,facilities,connection,error,refresh,selectFacility}}>{children}</Context.Provider>
}
export function useSentinel(){const value=useContext(Context);if(!value)throw new Error('useSentinel must be used within SentinelProvider');return value}
