import { useState } from "react";
import {
  Camera as CameraIcon,
  DoorOpen,
  GitFork,
  Pencil,
  Plus,
  RadioTower,
  Trash2,
} from "lucide-react";
import { PageIntro, Panel } from "@/components/sentinel-shell";
import { useSentinel } from "@/hooks/use-sentinel";
import { apiFetch } from "@/services/api";
import type { Camera, Exit, Zone } from "@/types/sentinel";

type Editor =
  | { kind: "camera"; value: Camera; creating: boolean }
  | { kind: "exit"; value: Exit; creating: boolean };

const cameraTypes = [
  "MAIN_CROWD",
  "EXIT",
  "ENTRY",
  "JUNCTION",
  "CORRIDOR",
  "QUEUE_AREA",
  "GENERAL",
];
const exitStatuses = [
  "AVAILABLE",
  "CAUTION",
  "CONGESTED",
  "RESTRICTED",
  "CLOSED",
] as const;
const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

export default function FacilityConfiguration() {
  const { snapshot, facilities, selectFacility, refresh } = useSentinel();
  const [editor, setEditor] = useState<Editor | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const facility = snapshot?.facility;

  if (!facility)
    return (
      <div className="panel grid min-h-64 place-items-center p-8 text-center">
        <div>
          <div className="data-mono text-[11px] text-primary">
            FACILITY CONFIGURATION UNAVAILABLE
          </div>
          <button
            onClick={() => void refresh()}
            className="mt-4 border border-primary/40 px-3 py-2 data-mono text-[9px] text-primary"
          >
            RETRY
          </button>
        </div>
      </div>
    );

  const newCamera = (): Editor => ({
    kind: "camera",
    creating: true,
    value: {
      id: `camera_${Date.now().toString().slice(-6)}`,
      facility_id: facility.id,
      name: "New Camera",
      enabled: true,
      status: "ONLINE",
      source: "",
      zone_ids: [],
      camera_type: "GENERAL",
      ai_enabled: true,
      description: "",
    },
  });
  const newExit = (): Editor => ({
    kind: "exit",
    creating: true,
    value: {
      id: `exit_${Date.now().toString().slice(-6)}`,
      facility_id: facility.id,
      name: "New Exit",
      zone_id: facility.zones[0]?.id ?? "",
      enabled: true,
      availability: 1,
      risk: 0,
      status: "AVAILABLE",
      capacity: 100,
      camera_ids: [],
      current_inflow: 0,
      current_outflow: 0,
    },
  });

  async function save() {
    if (!editor) return;
    setBusy(true);
    setError(null);
    try {
      const collection = editor.kind === "camera" ? "cameras" : "exits";
      const path = editor.creating
        ? `/${collection}`
        : `/${collection}/${editor.value.id}`;
      await apiFetch(path, {
        method: editor.creating ? "POST" : "PATCH",
        body: JSON.stringify(editor.value),
      });
      setEditor(null);
      await refresh();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to save configuration",
      );
    } finally {
      setBusy(false);
    }
  }
  async function remove(collection: "cameras" | "exits", id: string) {
    if (!window.confirm("Remove this configuration record?")) return;
    await apiFetch(`/${collection}/${id}`, { method: "DELETE" });
    await refresh();
  }
  async function addZone() {
    const name = window.prompt("Zone name");
    if (!name) return;
    await apiFetch("/zones", {
      method: "POST",
      body: JSON.stringify({
        id: `${slug(name)}_${Date.now().toString().slice(-4)}`,
        facility_id: facility!.id,
        name,
        type: "GENERAL",
        camera_ids: [],
      }),
    });
    await refresh();
  }
  async function addJunction() {
    const name = window.prompt("Junction name");
    if (!name) return;
    await apiFetch("/junctions", {
      method: "POST",
      body: JSON.stringify({
        id: `${slug(name)}_${Date.now().toString().slice(-4)}`,
        name,
        connected_exit_ids: [],
        sentinel_ids: [],
        map_x: 50,
        map_y: 50,
      }),
    });
    await refresh();
  }
  async function addSentinel() {
    const name = window.prompt("Sentinel name");
    if (!name || !facility!.junctions.length) return;
    const deviceId = window.prompt("ESP32 device ID", slug(name));
    if (!deviceId) return;
    const ipAddress = window.prompt("ESP32 address (example: 192.168.1.80)", "");
    await apiFetch("/sentinels", {
      method: "POST",
      body: JSON.stringify({
        id: `${slug(name)}_${Date.now().toString().slice(-4)}`,
        name,
        junction_id: facility!.junctions[0].id,
        nearby_exit_ids: [],
        device_id: deviceId,
        ip_address: ipAddress || "",
        connected: false,
      }),
    });
    await refresh();
  }

  return (
    <div className="enter-rise">
      <PageIntro
        eyebrow="06 / SYSTEM TOPOLOGY"
        title="Facility Configuration"
        description="Create and edit scalable camera, zone, exit, junction and Sentinel configuration. Changes persist in the local SQLite store."
        action={
          <select
            value={facility.id}
            onChange={(event) => void selectFacility(event.target.value)}
            className="border border-primary/40 bg-card px-3 py-2 data-mono text-[10px] text-primary"
          >
            {facilities.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        }
      />
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Count
          icon={CameraIcon}
          label="CAMERAS"
          value={facility.cameras.length}
        />
        <Count icon={RadioTower} label="ZONES" value={facility.zones.length} />
        <Count icon={DoorOpen} label="EXITS" value={facility.exits.length} />
        <Count
          icon={GitFork}
          label="JUNCTIONS"
          value={facility.junctions.length}
        />
        <Count
          icon={RadioTower}
          label="SENTINELS"
          value={facility.sentinels.length}
        />
      </div>
      <div className="mb-5 flex flex-wrap gap-2">
        <button
          onClick={() => setEditor(newCamera())}
          className="border border-primary/35 px-3 py-2 data-mono text-[8px] text-primary"
        >
          + ADD CAMERA
        </button>
        <button
          onClick={() => void addZone()}
          className="border border-primary/35 px-3 py-2 data-mono text-[8px] text-primary"
        >
          + ADD ZONE
        </button>
        <button
          onClick={() => setEditor(newExit())}
          className="border border-primary/35 px-3 py-2 data-mono text-[8px] text-primary"
        >
          + ADD EXIT
        </button>
        <button
          onClick={() => void addJunction()}
          className="border border-primary/35 px-3 py-2 data-mono text-[8px] text-primary"
        >
          + ADD JUNCTION
        </button>
        <button
          disabled={!facility.junctions.length}
          onClick={() => void addSentinel()}
          className="border border-primary/35 px-3 py-2 data-mono text-[8px] text-primary disabled:opacity-40"
        >
          + ADD SENTINEL
        </button>
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel
          title="Camera Management"
          eyebrow="FULL CONFIGURATION"
          action={
            <button
              onClick={() => setEditor(newCamera())}
              className="flex items-center gap-1 text-[9px] text-primary"
            >
              <Plus size={13} /> ADD CAMERA
            </button>
          }
        >
          <div className="divide-y divide-border">
            {facility.cameras.map((camera) => (
              <ConfigRow
                key={camera.id}
                title={camera.name}
                detail={`${camera.camera_type} · ${camera.status} · ${camera.zone_ids.length} zone(s) · ${camera.ai_enabled ? "AI ON" : "AI OFF"}`}
                enabled={camera.enabled}
                onEdit={() =>
                  setEditor({
                    kind: "camera",
                    creating: false,
                    value: { ...camera },
                  })
                }
                onRemove={() => void remove("cameras", camera.id)}
              />
            ))}
          </div>
        </Panel>
        <Panel
          title="Exit Management"
          eyebrow="DYNAMIC RANKING INPUTS"
          action={
            <button
              onClick={() => setEditor(newExit())}
              className="flex items-center gap-1 text-[9px] text-primary"
            >
              <Plus size={13} /> ADD EXIT
            </button>
          }
        >
          <div className="divide-y divide-border">
            {facility.exits.map((exit) => (
              <ConfigRow
                key={exit.id}
                title={exit.name}
                detail={`${exit.status} · capacity ${exit.capacity} · ${exit.camera_ids.length} camera(s) · risk ${Math.round(exit.risk)}`}
                enabled={exit.enabled}
                onEdit={() =>
                  setEditor({
                    kind: "exit",
                    creating: false,
                    value: { ...exit },
                  })
                }
                onRemove={() => void remove("exits", exit.id)}
              />
            ))}
          </div>
        </Panel>
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Panel
          title="Zones and coverage"
          eyebrow="MANY-TO-MANY CAMERA ASSIGNMENT"
          action={
            <button
              onClick={() => void addZone()}
              className="text-[9px] text-primary"
            >
              + ADD ZONE
            </button>
          }
        >
          <div className="divide-y divide-border">
            {facility.zones.map((zone) => (
              <div key={zone.id} className="p-4">
                <div className="flex justify-between text-[11px] font-semibold">
                  <span>{zone.name}</span>
                  <span className="data-mono text-primary">
                    RISK {Math.round(zone.risk)}
                  </span>
                </div>
                <div className="mt-1 data-mono text-[8px] text-muted-foreground">
                  {zone.type} · {zone.camera_ids.length} CAMERA(S) ·{" "}
                  {zone.crowd_state}
                </div>
              </div>
            ))}
          </div>
        </Panel>
        <Panel
          title="Junctions and Sentinels"
          eyebrow="STATIONARY GUIDANCE TOPOLOGY"
        >
          <div className="divide-y divide-border">
            {facility.junctions.map((junction) => (
              <div key={junction.id} className="p-4">
                <div className="text-[11px] font-semibold">{junction.name}</div>
                <div className="mt-1 data-mono text-[8px] text-muted-foreground">
                  {junction.connected_exit_ids.length} EXITS ·{" "}
                  {junction.sentinel_ids.length} SENTINELS
                </div>
              </div>
            ))}
            {facility.sentinels.map((sentinel) => (
              <div key={sentinel.id} className="p-4">
                <div className="text-[11px] font-semibold text-secondary">
                  {sentinel.name}
                </div>
                <div className="mt-1 data-mono text-[8px] text-muted-foreground">
                  {sentinel.device_id} ·{" "}
                  {sentinel.connected ? "CONNECTED" : "OFFLINE"}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
      {editor && (
        <EditorDialog
          editor={editor}
          setEditor={setEditor}
          zones={facility.zones}
          cameras={facility.cameras}
          busy={busy}
          error={error}
          onSave={() => void save()}
          onClose={() => {
            setEditor(null);
            setError(null);
          }}
        />
      )}
    </div>
  );
}

function EditorDialog({
  editor,
  setEditor,
  zones,
  cameras,
  busy,
  error,
  onSave,
  onClose,
}: {
  editor: Editor;
  setEditor: (value: Editor) => void;
  zones: Zone[];
  cameras: Camera[];
  busy: boolean;
  error: string | null;
  onSave: () => void;
  onClose: () => void;
}) {
  const update = (changes: Partial<Camera> | Partial<Exit>) =>
    setEditor({ ...editor, value: { ...editor.value, ...changes } } as Editor);
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/75 p-4">
      <div className="mx-auto my-8 w-full max-w-2xl border border-border bg-card p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold">
              {editor.creating ? "Add" : "Edit"} {editor.kind}
            </div>
            <div className="mt-1 data-mono text-[8px] text-muted-foreground">
              ID {editor.value.id}
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground">
            CLOSE
          </button>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label="NAME">
            <input
              value={editor.value.name}
              onChange={(event) => update({ name: event.target.value })}
              className="field"
            />
          </Field>
          {editor.creating && (
            <Field label="ID">
              <input
                value={editor.value.id}
                onChange={(event) => update({ id: slug(event.target.value) })}
                className="field"
              />
            </Field>
          )}
          {editor.kind === "camera" ? (
            <>
              <Field label="STREAM / SOURCE">
                <input
                  value={editor.value.source}
                  onChange={(event) => update({ source: event.target.value })}
                  className="field"
                />
              </Field>
              <Field label="CAMERA TYPE">
                <select
                  value={editor.value.camera_type}
                  onChange={(event) =>
                    update({ camera_type: event.target.value })
                  }
                  className="field"
                >
                  {cameraTypes.map((type) => (
                    <option key={type}>{type}</option>
                  ))}
                </select>
              </Field>
              <Field label="STATUS">
                <select
                  value={editor.value.status}
                  onChange={(event) =>
                    update({ status: event.target.value as Camera["status"] })
                  }
                  className="field"
                >
                  <option>ONLINE</option>
                  <option>OFFLINE</option>
                  <option>DEGRADED</option>
                </select>
              </Field>
              <Field label="DESCRIPTION">
                <input
                  value={editor.value.description}
                  onChange={(event) =>
                    update({ description: event.target.value })
                  }
                  className="field"
                />
              </Field>
            </>
          ) : (
            <>
              <Field label="ASSIGNED ZONE">
                <select
                  value={editor.value.zone_id}
                  onChange={(event) => update({ zone_id: event.target.value })}
                  className="field"
                >
                  {zones.map((zone) => (
                    <option key={zone.id} value={zone.id}>
                      {zone.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="STATUS">
                <select
                  value={editor.value.status}
                  onChange={(event) =>
                    update({ status: event.target.value as Exit["status"] })
                  }
                  className="field"
                >
                  {exitStatuses.map((status) => (
                    <option key={status}>{status}</option>
                  ))}
                </select>
              </Field>
              <Field label="CAPACITY">
                <input
                  type="number"
                  min="1"
                  value={editor.value.capacity}
                  onChange={(event) =>
                    update({ capacity: Number(event.target.value) })
                  }
                  className="field"
                />
              </Field>
              <Field label="AVAILABILITY 0–1">
                <input
                  type="number"
                  min="0"
                  max="1"
                  step=".1"
                  value={editor.value.availability}
                  onChange={(event) =>
                    update({ availability: Number(event.target.value) })
                  }
                  className="field"
                />
              </Field>
            </>
          )}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Toggle
            label="ENABLED"
            checked={editor.value.enabled}
            onChange={(checked) => update({ enabled: checked })}
          />
          {editor.kind === "camera" && (
            <Toggle
              label="AI ENABLED"
              checked={editor.value.ai_enabled}
              onChange={(checked) => update({ ai_enabled: checked })}
            />
          )}
        </div>
        <div className="mt-5">
          <div className="data-mono text-[8px] text-muted-foreground">
            {editor.kind === "camera" ? "ASSIGNED ZONES" : "ASSOCIATED CAMERAS"}
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {(editor.kind === "camera" ? zones : cameras).map((item) => {
              const selected =
                editor.kind === "camera"
                  ? editor.value.zone_ids.includes(item.id)
                  : editor.value.camera_ids.includes(item.id);
              return (
                <label
                  key={item.id}
                  className="flex items-center gap-2 border border-border p-2 text-[10px]"
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={(event) =>
                      editor.kind === "camera"
                        ? update({
                            zone_ids: event.target.checked
                              ? [...editor.value.zone_ids, item.id]
                              : editor.value.zone_ids.filter(
                                  (id) => id !== item.id,
                                ),
                          })
                        : update({
                            camera_ids: event.target.checked
                              ? [...editor.value.camera_ids, item.id]
                              : editor.value.camera_ids.filter(
                                  (id) => id !== item.id,
                                ),
                          })
                    }
                  />
                  {item.name}
                </label>
              );
            })}
          </div>
        </div>
        {error && (
          <div className="mt-4 border border-destructive/40 bg-destructive/10 p-3 text-[10px] text-destructive">
            {error}
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="border border-border px-3 py-2 text-[10px]"
          >
            CANCEL
          </button>
          <button
            disabled={busy || !editor.value.name.trim()}
            onClick={onSave}
            className="border border-primary bg-primary/10 px-4 py-2 text-[10px] text-primary"
          >
            {busy ? "SAVING…" : "SAVE CONFIGURATION"}
          </button>
        </div>
      </div>
    </div>
  );
}
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label>
      <span className="data-mono text-[8px] text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between border border-border p-3 text-[10px]">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}
function Count({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof CameraIcon;
  label: string;
  value: number;
}) {
  return (
    <div className="panel p-4">
      <Icon size={15} className="text-secondary" />
      <div className="data-mono mt-3 text-2xl text-primary">{value}</div>
      <div className="mt-1 data-mono text-[8px] text-muted-foreground">
        {label}
      </div>
    </div>
  );
}
function ConfigRow({
  title,
  detail,
  enabled,
  onEdit,
  onRemove,
}: {
  title: string;
  detail: string;
  enabled: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-3 p-4">
      <span
        className={`h-2 w-2 rounded-full ${enabled ? "bg-secondary" : "bg-muted-foreground"}`}
      />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold">{title}</div>
        <div className="mt-1 truncate data-mono text-[8px] text-muted-foreground">
          {detail}
        </div>
      </div>
      <button
        onClick={onEdit}
        aria-label={`Edit ${title}`}
        className="text-muted-foreground hover:text-primary"
      >
        <Pencil size={14} />
      </button>
      <button
        onClick={onRemove}
        aria-label={`Remove ${title}`}
        className="text-muted-foreground hover:text-destructive"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}
