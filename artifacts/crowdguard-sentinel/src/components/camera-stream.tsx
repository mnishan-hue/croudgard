import { Camera, Radio } from "lucide-react";
import { serviceConfig } from "@/services/config";

export function CameraStream({
  cameraId,
  cameraName,
  streaming,
  compact = false,
}: {
  cameraId: string;
  cameraName: string;
  streaming: boolean;
  compact?: boolean;
}) {
  const streamUrl = `${serviceConfig.apiBaseUrl.replace(/\/$/, "")}/cameras/${encodeURIComponent(cameraId)}/stream`;

  return (
    <div
      className={`relative isolate overflow-hidden bg-[#071019] ${compact ? "aspect-video" : "aspect-video min-h-52"}`}
    >
      {streaming ? (
        <img
          key={streamUrl}
          src={streamUrl}
          alt={`Live annotated footage from ${cameraName}`}
          className="h-full w-full object-contain"
        />
      ) : (
        <div className="grid h-full min-h-32 place-items-center grid-surface text-center">
          <div>
            <Camera
              size={compact ? 24 : 34}
              className="mx-auto text-muted-foreground/35"
            />
            {!compact && (
              <>
                <div className="mt-3 data-mono text-[10px] text-muted-foreground">
                  WAITING FOR EDGE WORKER
                </div>
                <p className="mx-auto mt-2 max-w-sm text-[10px] leading-relaxed text-muted-foreground/75">
                  Start the worker assigned to {cameraName}. Footage appears
                  automatically when annotated frames arrive.
                </p>
              </>
            )}
          </div>
        </div>
      )}
      <div
        className={`absolute left-2 top-2 flex items-center gap-1.5 rounded-sm border px-2 py-1 data-mono text-[7px] backdrop-blur ${streaming ? "border-secondary/40 bg-[#071019]/80 text-secondary" : "border-border bg-[#071019]/80 text-muted-foreground"}`}
      >
        <Radio size={9} /> {streaming ? "LIVE ANNOTATED VIDEO" : "NO VIDEO"}
      </div>
      <div className="absolute bottom-2 left-2 max-w-[75%] truncate rounded-sm bg-[#071019]/80 px-2 py-1 data-mono text-[7px] text-foreground/80 backdrop-blur">
        {cameraName} · {cameraId}
      </div>
    </div>
  );
}
