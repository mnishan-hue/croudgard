import { useEffect, useRef, useState } from 'react';
import * as tmImage from '@teachablemachine/image';
import * as cocoSsd from '@tensorflow-models/coco-ssd';
import { apiFetch } from '@/services/api';

type Prediction = { className: string; probability: number };
type Status = 'IDLE' | 'LOADING' | 'RUNNING' | 'ERROR';
const BASE_PATH = import.meta.env.BASE_URL.replace(/\/$/, '');
const MODEL_PATH = `${BASE_PATH}/my_model/`;
const PERSON_MODEL_URL = `${BASE_PATH}/person_model/model.json`;
let modelPromise:Promise<[tmImage.CustomMobileNet,cocoSsd.ObjectDetection]>|null=null;

function loadModels(){
  modelPromise??=Promise.all([
    tmImage.load(`${MODEL_PATH}model.json`,`${MODEL_PATH}metadata.json`),
    cocoSsd.load({base:'lite_mobilenet_v2',modelUrl:PERSON_MODEL_URL}),
  ]);
  return modelPromise.catch((error)=>{modelPromise=null;throw error});
}

export function TeachableCamera({ cameraId }: { cameraId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const webcamRef = useRef<tmImage.Webcam | null>(null);
  const frameRef = useRef<number | null>(null);
  const runningRef = useRef(false);
  const mountedRef = useRef(true);
  const [status, setStatus] = useState<Status>('IDLE');
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [peopleCount, setPeopleCount] = useState(0);
  const [error, setError] = useState('');

  function stop() {
    runningRef.current = false;
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    webcamRef.current?.stop();
    webcamRef.current = null;
    containerRef.current?.replaceChildren();
    if(mountedRef.current)setStatus('IDLE');
  }

  useEffect(() => () => {mountedRef.current=false;runningRef.current=false;if(frameRef.current!==null)cancelAnimationFrame(frameRef.current);webcamRef.current?.stop();containerRef.current?.replaceChildren()}, []);

  async function start() {
    if (status === 'LOADING' || status === 'RUNNING') return;
    setStatus('LOADING');
    setError('');
    setPredictions([]);
    setPeopleCount(0);
    try {
      if(!window.isSecureContext&&!['localhost','127.0.0.1'].includes(window.location.hostname))throw new Error('Camera access requires a secure HTTPS connection');
      if(!navigator.mediaDevices?.getUserMedia)throw new Error('This browser does not support camera access');
      const [model, personModel] = await loadModels();
      const webcam = new tmImage.Webcam(420, 320, true);
      await webcam.setup({ facingMode: 'user' });
      await webcam.play();
      webcamRef.current = webcam;
      containerRef.current?.replaceChildren(webcam.canvas);
      webcam.canvas.className = 'h-full w-full object-cover';
      const overlay = document.createElement('canvas');
      overlay.width = webcam.width;
      overlay.height = webcam.height;
      overlay.className = 'pointer-events-none absolute inset-0 h-full w-full';
      containerRef.current?.appendChild(overlay);
      runningRef.current = true;
      if(!mountedRef.current){webcam.stop();return}
      setStatus('RUNNING');
      let lastDetectionAt = 0;
      let lastClassificationAt = 0;
      let lastReportedCount = -1;
      let lastReportAt = 0;
      let lastReportedClass = '';
      let lastClassReportAt = 0;
      let smoothedPredictions:Prediction[]=[];

      const loop = async () => {
        if (!runningRef.current) return;
        try{
          webcam.update();
          const now = performance.now();
          if(now-lastClassificationAt>=250){
            lastClassificationAt=now;
            const next=await model.predict(webcam.canvas);
            smoothedPredictions=next.map((item)=>({className:item.className,probability:(smoothedPredictions.find((old)=>old.className===item.className)?.probability??item.probability)*.35+item.probability*.65})).sort((a,b)=>b.probability-a.probability);
            if(runningRef.current)setPredictions(smoothedPredictions);
            const strongest=smoothedPredictions[0];
            if(strongest&&strongest.probability>=.6&&(strongest.className!==lastReportedClass||now-lastClassReportAt>=5000)){
              lastReportedClass=strongest.className;lastClassReportAt=now;
              void apiFetch('/ai/crowd-observation',{method:'POST',body:JSON.stringify({camera_id:cameraId,classification:strongest.className,confidence:strongest.probability})}).catch((reason)=>setError(reason instanceof Error?reason.message:'Unable to update crowd classification'));
            }
          }
          if (runningRef.current) {
          if (now - lastDetectionAt >= 750) {
            lastDetectionAt = now;
            const detections = await personModel.detect(webcam.canvas, 50);
            const people = detections.filter((item) => item.class === 'person' && item.score >= .55);
            setPeopleCount(people.length);
            const context = overlay.getContext('2d');
            if (context) {
              context.clearRect(0, 0, overlay.width, overlay.height);
              context.strokeStyle = '#2dd4bf';
              context.fillStyle = '#2dd4bf';
              context.lineWidth = 2;
              context.font = '12px monospace';
              for (const person of people) {
                const [x, y, width, height] = person.bbox;
                context.strokeRect(x, y, width, height);
                context.fillText(`PERSON ${Math.round(person.score * 100)}%`, x, Math.max(12, y - 4));
              }
            }
            if (people.length !== lastReportedCount || now - lastReportAt >= 5000) {
              lastReportedCount = people.length;
              lastReportAt = now;
              const confidence = people.length ? people.reduce((sum,item)=>sum+item.score,0)/people.length : .6;
              void apiFetch('/ai/person-count', { method: 'POST', body: JSON.stringify({ camera_id: cameraId, count: people.length, confidence }) }).catch((reason) => {
                setError(reason instanceof Error ? reason.message : 'Unable to update People Index');
              });
            }
          }
          frameRef.current = requestAnimationFrame(loop);
          }
        }catch(reason){runningRef.current=false;if(mountedRef.current){setStatus('ERROR');setError(reason instanceof Error?reason.message:'AI inference stopped unexpectedly')}}
      };
      frameRef.current = requestAnimationFrame(loop);
    } catch (reason) {
      stop();
      if(mountedRef.current){setStatus('ERROR');setError(reason instanceof Error ? reason.message : 'Unable to start camera inference')}
    }
  }

  const top = predictions[0];
  const reliable=(top?.probability??0)>=.65;
  return <div className="overflow-hidden bg-background/30">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-3">
      <div><div className="text-[12px] font-semibold text-foreground">On-device crowd analysis</div><div className="mt-1 text-[10px] text-muted-foreground">Runs privately in this browser. Video is not uploaded.</div></div>
      {status === 'RUNNING'
        ? <button type="button" onClick={stop} className="button-danger">Stop analysis</button>
        : <button type="button" onClick={() => void start()} disabled={status === 'LOADING'} className="button-primary disabled:opacity-50">{status === 'LOADING' ? 'Loading AI…' : 'Start live analysis'}</button>}
    </div>
    <div className="grid md:grid-cols-[1.25fr_1fr]">
      <div ref={containerRef} className="relative grid aspect-[4/3] min-h-56 place-items-center overflow-hidden bg-[#071019] text-center data-mono text-[9px] text-muted-foreground">
        {status === 'IDLE' && 'Camera preview will appear here'}
        {status === 'LOADING' && 'Loading private on-device models…'}
        {status === 'ERROR' && 'Camera could not be started'}
      </div>
      <div className="border-t border-border p-4 md:border-l md:border-t-0">
        <div className="mb-4 border border-secondary/40 bg-secondary/5 p-3">
          <div className="data-mono text-[8px] text-muted-foreground">LIVE PEOPLE INDEX</div>
          <div className="data-mono mt-1 text-[28px] text-secondary">{status === 'RUNNING' ? peopleCount : '—'}</div>
        </div>
        <div className="data-mono text-[8px] text-muted-foreground">TOP CLASS</div>
        <div className="mt-2 text-[14px] font-semibold text-primary">{top?.className.replaceAll('_',' ') ?? 'NO PREDICTION'}</div>
        <div className="data-mono mt-1 text-[10px] text-muted-foreground">{top ? `${(top.probability * 100).toFixed(1)}% confidence · ${reliable?'stable signal':'low confidence'}` : 'Start the camera to classify frames'}</div>
        <div className="mt-4 space-y-3">{predictions.map((item) => <div key={item.className}>
          <div className="mb-1 flex justify-between data-mono text-[8px]"><span>{item.className}</span><span>{(item.probability * 100).toFixed(1)}%</span></div>
          <div className="h-1.5 bg-muted"><div className="h-full bg-primary transition-[width]" style={{ width: `${item.probability * 100}%` }}/></div>
        </div>)}</div>
        {error && <div className="mt-4 border border-destructive/40 p-2 text-[9px] text-destructive">{error}</div>}
        {top&&!reliable&&<div className="mt-4 rounded-md border border-primary/30 bg-primary/5 p-2 text-[9px] text-primary">Low-confidence result. Improve lighting or camera position before using this signal.</div>}
        <div className="mt-4 text-[8px] leading-relaxed text-muted-foreground">Predictions are smoothed across frames and are decision-support signals, not certified safety determinations.</div>
      </div>
    </div>
  </div>;
}
