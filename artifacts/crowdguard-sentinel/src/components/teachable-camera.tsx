import { useEffect, useRef, useState } from 'react';
import * as tmImage from '@teachablemachine/image';
import * as cocoSsd from '@tensorflow-models/coco-ssd';
import { apiFetch } from '@/services/api';

type Prediction = { className: string; probability: number };
type Status = 'IDLE' | 'LOADING' | 'RUNNING' | 'ERROR';
const MODEL_PATH = '/my_model/';
const PERSON_MODEL_URL = '/person_model/model.json';

export function TeachableCamera({ cameraId }: { cameraId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const webcamRef = useRef<tmImage.Webcam | null>(null);
  const frameRef = useRef<number | null>(null);
  const runningRef = useRef(false);
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
    setStatus('IDLE');
  }

  useEffect(() => () => {
    runningRef.current = false;
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    webcamRef.current?.stop();
  }, []);

  async function start() {
    if (status === 'LOADING' || status === 'RUNNING') return;
    setStatus('LOADING');
    setError('');
    setPredictions([]);
    setPeopleCount(0);
    try {
      const [model, personModel] = await Promise.all([
        tmImage.load(`${MODEL_PATH}model.json`, `${MODEL_PATH}metadata.json`),
        cocoSsd.load({ base: 'lite_mobilenet_v2', modelUrl: PERSON_MODEL_URL }),
      ]);
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
      setStatus('RUNNING');
      let lastDetectionAt = 0;
      let lastReportedCount = -1;
      let lastReportAt = 0;

      const loop = async () => {
        if (!runningRef.current) return;
        webcam.update();
        const next = await model.predict(webcam.canvas);
        if (runningRef.current) {
          setPredictions([...next].sort((a, b) => b.probability - a.probability));
          const now = performance.now();
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
              const confidence = people.length ? Math.min(...people.map((item) => item.score)) : 1;
              void apiFetch('/ai/person-count', { method: 'POST', body: JSON.stringify({ camera_id: cameraId, count: people.length, confidence }) }).catch((reason) => {
                setError(reason instanceof Error ? reason.message : 'Unable to update People Index');
              });
            }
          }
          frameRef.current = requestAnimationFrame(loop);
        }
      };
      frameRef.current = requestAnimationFrame(loop);
    } catch (reason) {
      stop();
      setStatus('ERROR');
      setError(reason instanceof Error ? reason.message : 'Unable to start camera inference');
    }
  }

  const top = predictions[0];
  return <div className="mb-4 overflow-hidden border border-border bg-background/40">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-3">
      <div><div className="data-mono text-[9px] text-primary">LOCAL DUAL-MODEL AI</div><div className="mt-1 text-[10px] text-muted-foreground">COCO-SSD person count + 4-class congestion model · offline</div></div>
      {status === 'RUNNING'
        ? <button type="button" onClick={stop} className="border border-destructive/50 px-3 py-2 data-mono text-[9px] text-destructive">STOP CAMERA</button>
        : <button type="button" onClick={() => void start()} disabled={status === 'LOADING'} className="border border-primary/50 px-3 py-2 data-mono text-[9px] text-primary disabled:opacity-50">{status === 'LOADING' ? 'LOADING MODEL…' : 'START CAMERA AI'}</button>}
    </div>
    <div className="grid md:grid-cols-[1.25fr_1fr]">
      <div ref={containerRef} className="relative grid aspect-[4/3] min-h-56 place-items-center overflow-hidden bg-[#071019] text-center data-mono text-[9px] text-muted-foreground">
        {status === 'IDLE' && 'CAMERA OFF · PRESS START'}
        {status === 'LOADING' && 'LOADING LOCAL MODEL…'}
        {status === 'ERROR' && 'CAMERA OR MODEL ERROR'}
      </div>
      <div className="border-t border-border p-4 md:border-l md:border-t-0">
        <div className="mb-4 border border-secondary/40 bg-secondary/5 p-3">
          <div className="data-mono text-[8px] text-muted-foreground">LIVE PEOPLE INDEX</div>
          <div className="data-mono mt-1 text-[28px] text-secondary">{status === 'RUNNING' ? peopleCount : '—'}</div>
        </div>
        <div className="data-mono text-[8px] text-muted-foreground">TOP CLASS</div>
        <div className="mt-2 text-[14px] font-semibold text-primary">{top?.className ?? 'NO PREDICTION'}</div>
        <div className="data-mono mt-1 text-[10px] text-muted-foreground">{top ? `${(top.probability * 100).toFixed(1)}% confidence` : 'Start the camera to classify frames'}</div>
        <div className="mt-4 space-y-3">{predictions.map((item) => <div key={item.className}>
          <div className="mb-1 flex justify-between data-mono text-[8px]"><span>{item.className}</span><span>{(item.probability * 100).toFixed(1)}%</span></div>
          <div className="h-1.5 bg-muted"><div className="h-full bg-primary transition-[width]" style={{ width: `${item.probability * 100}%` }}/></div>
        </div>)}</div>
        {error && <div className="mt-4 border border-destructive/40 p-2 text-[9px] text-destructive">{error}</div>}
        <div className="mt-4 text-[8px] leading-relaxed text-muted-foreground">Predictions are decision-support signals, not certified safety determinations.</div>
      </div>
    </div>
  </div>;
}
