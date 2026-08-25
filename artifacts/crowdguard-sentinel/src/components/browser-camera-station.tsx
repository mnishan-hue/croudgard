import { useState } from "react";
import {
  Camera,
  CheckCircle2,
  LoaderCircle,
  RefreshCw,
  Square,
  TriangleAlert,
  X,
} from "lucide-react";
import { useBrowserCameras } from "@/hooks/use-browser-cameras";
import type { Camera as FacilityCamera } from "@/types/sentinel";

export function BrowserCameraStation({ cameras }: { cameras: FacilityCamera[] }) {
  const station = useBrowserCameras();
  const [open, setOpen] = useState(false);
  const enabled = cameras.filter((camera) => camera.enabled).slice(0, 3);
  const selectedCount = enabled.filter(
    (camera) => station.assignments[camera.id],
  ).length;
  const runningCount = Object.keys(station.streams).length;
  const busy = ["REQUESTING_PERMISSION", "LOADING_AI", "CONNECTING"].includes(
    station.status,
  );

  async function configure() {
    setOpen(true);
    if (!station.devices.length) await station.prepare(enabled);
  }

  return (
    <>
      <div className="mb-5 rounded-lg border border-secondary/25 bg-secondary/[.035] p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="grid h-10 w-10 place-items-center rounded-md border border-secondary/30 bg-secondary/5 text-secondary">
            <Camera size={19} />
          </div>
          <div className="min-w-64 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-[14px] font-semibold">Browser camera station</h2>
              {station.status === "RUNNING" && (
                <span className="status-chip py-1 text-secondary">
                  <span className="status-pulse h-1.5 w-1.5 rounded-full bg-secondary" />
                  {runningCount} camera{runningCount === 1 ? "" : "s"} analyzing
                </span>
              )}
            </div>
            <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
              Connect one, two, or three USB cameras. Each active feed is analyzed independently and contributes to CrowdGuard.
            </p>
            {station.error && (
              <p className="mt-2 text-[10px] text-destructive">{station.error}</p>
            )}
          </div>
          {station.status === "RUNNING" ? (
            <div className="flex gap-2">
              <button type="button" className="button-secondary" onClick={() => setOpen(true)}>
                View cameras
              </button>
              <button type="button" className="button-danger" onClick={station.stop}>
                <Square size={12} /> Stop
              </button>
            </div>
          ) : (
            <button type="button" className="button-primary" onClick={() => void configure()} disabled={busy}>
              {busy ? <LoaderCircle size={14} className="animate-spin" /> : <Camera size={14} />}
              {busy ? "Preparing cameras…" : "Connect cameras"}
            </button>
          )}
        </div>
      </div>

      {open && (
        <div role="dialog" aria-modal="true" aria-label="Connect browser cameras" className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/80 p-4">
          <div className="panel my-6 w-full max-w-5xl overflow-hidden">
            <div className="flex items-start justify-between gap-4 border-b border-border p-5">
              <div>
                <div className="data-mono text-[8px] text-secondary">DIRECT BROWSER CAPTURE</div>
                <h2 className="mt-1 text-[18px] font-semibold">Connect available physical cameras</h2>
                <p className="mt-2 max-w-2xl text-[11px] leading-relaxed text-muted-foreground">
                  Assign a different device to each location. Keep this website open while monitoring; closing it stops browser analysis.
                </p>
              </div>
              <button type="button" aria-label="Close camera setup" className="rounded-md border border-border p-2 text-muted-foreground hover:text-foreground" onClick={() => setOpen(false)}>
                <X size={16} />
              </button>
            </div>

            <div className="p-5">
              {station.status === "REQUESTING_PERMISSION" ? (
                <Waiting message="Waiting for camera permission…" />
              ) : station.status === "LOADING_AI" ? (
                <Waiting message="Loading the on-device person detector…" />
              ) : station.status === "CONNECTING" ? (
                <Waiting message="Opening all three camera feeds…" />
              ) : station.status === "RUNNING" ? (
                <div className="grid gap-3 md:grid-cols-3">
                  {enabled.filter((camera) => station.streams[camera.id]).map((camera) => (
                    <LocalPreview
                      key={camera.id}
                      camera={camera}
                      stream={station.streams[camera.id]}
                      people={station.metrics[camera.id]?.peopleCount}
                      fps={station.metrics[camera.id]?.fps}
                    />
                  ))}
                </div>
              ) : (
                <>
                  {station.error && (
                    <div className="mb-4 flex gap-3 border border-destructive/40 bg-destructive/5 p-3 text-[10px] text-destructive">
                      <TriangleAlert size={16} className="shrink-0" />
                      <span>{station.error}</span>
                    </div>
                  )}
                  {station.devices.length ? (
                    <div>
                      <div className={`mb-4 flex items-center gap-2 border p-3 text-[10px] ${station.devices.length >= 3 ? "border-secondary/30 bg-secondary/5 text-secondary" : "border-primary/35 bg-primary/5 text-primary"}`}>
                        {station.devices.length >= 3 ? <CheckCircle2 size={15} /> : <TriangleAlert size={15} />}
                        {station.devices.length} physical camera{station.devices.length === 1 ? "" : "s"} detected
                        {station.devices.length < 3 && " · You can start now and add more cameras later."}
                      </div>
                      <div className="grid gap-3 md:grid-cols-3">
                        {enabled.map((camera, index) => (
                        <label key={camera.id} className="border border-border bg-card p-4">
                          <span className="data-mono text-[8px] text-secondary">CAMERA {index + 1}</span>
                          <span className="mt-1 block text-[13px] font-semibold">{camera.name}</span>
                          <span className="mt-1 block text-[9px] text-muted-foreground">{camera.zone_ids.join(", ") || "Unassigned location"}</span>
                          <select
                            value={station.assignments[camera.id] ?? ""}
                            onChange={(event) => station.setAssignment(camera.id, event.target.value)}
                            className="mt-4 w-full rounded-md border border-border bg-background px-3 py-2 text-[11px] text-foreground"
                          >
                            <option value="">Not connected</option>
                            {station.devices.map((device, deviceIndex) => (
                              <option
                                key={device.deviceId}
                                value={device.deviceId}
                                disabled={Object.entries(station.assignments).some(
                                  ([assignedCameraId, assignedDeviceId]) =>
                                    assignedCameraId !== camera.id &&
                                    assignedDeviceId === device.deviceId,
                                )}
                              >
                                {device.label || `Camera ${deviceIndex + 1}`}
                              </option>
                            ))}
                          </select>
                        </label>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="grid min-h-48 place-items-center text-center">
                      <div>
                        <Camera size={32} className="mx-auto text-muted-foreground/40" />
                        <p className="mt-3 text-[11px] text-muted-foreground">Allow camera access to discover connected devices.</p>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-background/30 p-4">
              <p className="text-[9px] text-muted-foreground">
                AI uses COCO-SSD person detection. Footage is uploaded only while this station is running.
              </p>
              <div className="flex gap-2">
                {station.status === "RUNNING" ? (
                  <button type="button" className="button-danger" onClick={station.stop}>
                    <Square size={12} /> Stop all cameras
                  </button>
                ) : (
                  <>
                    <button type="button" className="button-secondary" onClick={() => void station.prepare(enabled)} disabled={busy}>
                      <RefreshCw size={12} /> Rescan
                    </button>
                    <button type="button" className="button-primary" onClick={() => void station.start(enabled)} disabled={busy || selectedCount === 0}>
                      <CheckCircle2 size={13} /> Start {selectedCount || "selected"} camera{selectedCount === 1 ? "" : "s"}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Waiting({ message }: { message: string }) {
  return (
    <div className="grid min-h-64 place-items-center text-center">
      <div>
        <LoaderCircle size={30} className="mx-auto animate-spin text-secondary" />
        <p className="mt-4 data-mono text-[10px] text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}

function LocalPreview({ camera, stream, people, fps }: { camera: FacilityCamera; stream?: MediaStream; people?: number; fps?: number }) {
  return (
    <div className="overflow-hidden border border-secondary/30 bg-card">
      <div className="relative aspect-video bg-[#071019]">
        <video
          ref={(node) => {
            if (node && node.srcObject !== stream) node.srcObject = stream ?? null;
          }}
          autoPlay
          muted
          playsInline
          className="h-full w-full object-contain"
        />
        <span className="absolute left-2 top-2 status-chip py-1 text-secondary">
          <span className="status-pulse h-1.5 w-1.5 rounded-full bg-secondary" /> LIVE
        </span>
      </div>
      <div className="flex items-center justify-between gap-3 p-3">
        <div>
          <div className="text-[11px] font-semibold">{camera.name}</div>
          <div className="mt-1 data-mono text-[7px] text-muted-foreground">{camera.id}</div>
        </div>
        <div className="text-right data-mono text-[8px] text-secondary">
          <div>{people ?? "—"} PEOPLE</div>
          <div className="mt-1 text-muted-foreground">{fps ? `${fps.toFixed(1)} AI FPS` : "AI STARTING"}</div>
        </div>
      </div>
    </div>
  );
}
