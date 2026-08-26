import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Cpu,
  RadioTower,
  RotateCcw,
  Save,
  ShieldAlert,
  Wifi,
} from "lucide-react";
import { PageIntro, Panel } from "@/components/sentinel-shell";
import { useSentinel } from "@/hooks/use-sentinel";
import { apiFetch } from "@/services/api";
import type { BackendSnapshot, Sentinel } from "@/types/sentinel";

type Pending = {
  action: "NORMAL" | "REDIRECT_TO_EXIT" | "CRITICAL" | "RESET";
  exit?: string;
  label: string;
};

export default function Devices() {
  const { snapshot, refresh } = useSentinel();
  const facility = snapshot?.facility;
  const sentinel = facility?.sentinels[0];
  const [deviceId, setDeviceId] = useState("");
  const [address, setAddress] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(
    null,
  );
  const [confirm, setConfirm] = useState<Pending | null>(null);

  useEffect(() => {
    setDeviceId(
      sentinel?.device_id === "unconfigured" ? "" : (sentinel?.device_id ?? ""),
    );
    setAddress(sentinel?.ip_address ?? "");
  }, [sentinel?.id, sentinel?.device_id, sentinel?.ip_address]);

  async function saveConnection(showSuccess = true) {
    if (!sentinel) return false;
    if (!deviceId.trim() || !address.trim()) {
      setMessage({
        text: "Enter both the ESP32 device ID and network address.",
        ok: false,
      });
      return false;
    }
    setSaving(true);
    try {
      await apiFetch<Sentinel>(`/sentinels/${sentinel.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          device_id: deviceId.trim(),
          ip_address: address.trim(),
          connected: false,
          command_acknowledged: false,
        }),
      });
      if (showSuccess)
        setMessage({ text: "Connection settings saved.", ok: true });
      await refresh();
      return true;
    } catch (reason) {
      setMessage({
        text:
          reason instanceof Error
            ? reason.message
            : "Could not save ESP32 settings.",
        ok: false,
      });
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    if (!sentinel) return;
    setTesting(true);
    setMessage(null);
    try {
      const saved = await saveConnection(false);
      if (!saved) return;
      await apiFetch(`/hardware/${sentinel.id}/heartbeat`, { method: "POST" });
      setMessage({
        text: "ESP32 responded correctly. CrowdGuard is ready to send guidance.",
        ok: true,
      });
      await refresh();
    } catch (reason) {
      setMessage({
        text:
          reason instanceof Error
            ? reason.message
            : "ESP32 did not respond. Confirm local mode, Wi-Fi and the address.",
        ok: false,
      });
    } finally {
      setTesting(false);
    }
  }

  async function sendCommand(pending: Pending) {
    try {
      await apiFetch<BackendSnapshot>("/control/manual", {
        method: "POST",
        body: JSON.stringify({
          action: pending.action,
          recommended_exit_id: pending.exit,
          sentinel_id: sentinel?.id,
        }),
      });
      setMessage({
        text: `${pending.label} was acknowledged by the ESP32.`,
        ok: true,
      });
      setConfirm(null);
      await refresh();
    } catch (reason) {
      setMessage({
        text: reason instanceof Error ? reason.message : "Command failed.",
        ok: false,
      });
    }
  }

  return (
    <div className="enter-rise">
      <PageIntro
        eyebrow="Devices"
        title="Connect the ESP32 without guesswork"
        description="Configure one local network address, test the heartbeat, then verify the guidance outputs."
        action={
          <span
            className={`rounded-full px-3 py-1.5 text-[10px] font-medium ${sentinel?.connected ? "bg-secondary/15 text-secondary" : "bg-primary/15 text-primary"}`}
          >
            {sentinel?.connected ? "ESP32 connected" : "Setup required"}
          </span>
        }
      />

      {!facility || !sentinel ? (
        <div className="rounded-xl border border-border bg-card p-8 text-sm text-muted-foreground">
          No Sentinel device exists in the active facility. Add one in Advanced
          setup.
        </div>
      ) : (
        <>
          <section className="grid gap-5 xl:grid-cols-[1.05fr_.95fr]">
            <Panel
              title="Connection"
              eyebrow="SAVE · TEST · READY"
              className="rounded-xl"
            >
              <div className="p-5">
                <div
                  className={`mb-5 flex items-start gap-3 rounded-xl border p-4 ${sentinel.connected ? "border-secondary/30 bg-secondary/5" : "border-primary/30 bg-primary/5"}`}
                >
                  <span
                    className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${sentinel.connected ? "bg-secondary/15 text-secondary" : "bg-primary/15 text-primary"}`}
                  >
                    {sentinel.connected ? (
                      <CheckCircle2 size={19} />
                    ) : (
                      <Wifi size={19} />
                    )}
                  </span>
                  <div>
                    <div className="text-sm font-semibold">
                      {sentinel.connected
                        ? "Device online"
                        : "Waiting for a successful test"}
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {sentinel.connected
                        ? `Last response ${sentinel.last_heartbeat ? new Date(sentinel.last_heartbeat).toLocaleTimeString() : "received"} · ${sentinel.latency_ms ?? "—"} ms`
                        : "CrowdGuard will not send commands until the heartbeat succeeds."}
                    </div>
                  </div>
                </div>

                <label className="block">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    ESP32 device ID
                  </span>
                  <input
                    className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-3 text-sm outline-none focus:border-primary"
                    value={deviceId}
                    onChange={(event) => setDeviceId(event.target.value)}
                    placeholder="crowdguard-sentinel-01"
                    autoComplete="off"
                  />
                  <span className="mt-1.5 block text-[10px] text-muted-foreground">
                    Must match DEVICE_ID in the firmware.
                  </span>
                </label>

                <label className="mt-4 block">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Network address
                  </span>
                  <input
                    className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-3 text-sm outline-none focus:border-primary"
                    value={address}
                    onChange={(event) => setAddress(event.target.value)}
                    placeholder="192.168.1.80 or crowdguard-esp32.local"
                    autoComplete="off"
                  />
                  <span className="mt-1.5 block text-[10px] text-muted-foreground">
                    HTTP is added automatically when omitted.
                  </span>
                </label>

                <div className="mt-5 flex flex-wrap gap-2">
                  <button
                    className="button-secondary"
                    onClick={() => void saveConnection()}
                    disabled={saving || testing}
                  >
                    <Save size={13} /> {saving ? "Saving…" : "Save"}
                  </button>
                  <button
                    className="button-primary"
                    onClick={() => void testConnection()}
                    disabled={saving || testing}
                  >
                    <RadioTower size={13} />{" "}
                    {testing ? "Testing…" : "Save and test"}
                  </button>
                </div>

                {message && (
                  <div
                    role="status"
                    className={`mt-4 flex items-start gap-2 rounded-lg border p-3 text-[11px] ${message.ok ? "border-secondary/30 bg-secondary/5 text-secondary" : "border-destructive/30 bg-destructive/5 text-destructive"}`}
                  >
                    {message.ok ? (
                      <CheckCircle2 size={15} />
                    ) : (
                      <AlertTriangle size={15} />
                    )}
                    <span>{message.text}</span>
                  </div>
                )}
              </div>
            </Panel>

            <Panel
              title="Quick connection guide"
              eyebrow="ABOUT 5 MINUTES"
              className="rounded-xl"
            >
              <div className="space-y-4 p-5">
                <GuideStep number="1" title="Run CrowdGuard locally">
                  The FastAPI backend and ESP32 must be on the same Wi-Fi or
                  LAN. A Render cloud server cannot reach a private 192.168.x.x
                  device.
                </GuideStep>
                <GuideStep number="2" title="Flash the supplied firmware">
                  Set Wi-Fi name, password and DEVICE_ID in the ESP32 sketch,
                  then upload it using Arduino IDE.
                </GuideStep>
                <GuideStep number="3" title="Find the address">
                  Open Arduino Serial Monitor at 115200 baud. Copy the printed
                  IP address into the field on this page.
                </GuideStep>
                <GuideStep number="4" title="Save and test">
                  CrowdGuard calls GET /status. The returned device_id must
                  match before commands are enabled.
                </GuideStep>

                <details className="rounded-lg border border-border bg-background">
                  <summary className="cursor-pointer p-3 text-xs font-semibold">
                    Required ESP32 responses
                  </summary>
                  <div className="border-t border-border p-3">
                    <CodeCopy text='{"device_id":"crowdguard-sentinel-01","status":"ready"}' />
                    <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">
                      POST /command must return{" "}
                      <code className="text-foreground">
                        acknowledged: true
                      </code>{" "}
                      and the current arm, display, audio and LED state.
                    </p>
                  </div>
                </details>

                <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-[10px] leading-relaxed text-primary">
                  Firmware and the complete wiring/setup guide are included in{" "}
                  <strong>firmware/crowdguard_esp32</strong> and{" "}
                  <strong>docs/ESP32_QUICKSTART.md</strong>.
                </div>
              </div>
            </Panel>
          </section>

          <Panel
            title="Device status"
            eyebrow={sentinel.name.toUpperCase()}
            className="mt-5 rounded-xl"
          >
            <div className="grid gap-px bg-border sm:grid-cols-2 xl:grid-cols-4">
              <State
                label="Connection"
                value={sentinel.connected ? "Connected" : "Offline"}
              />
              <State
                label="Latency"
                value={
                  sentinel.latency_ms === null
                    ? "Unavailable"
                    : `${sentinel.latency_ms} ms`
                }
              />
              <State
                label="Last command"
                value={sentinel.last_command ?? "None"}
              />
              <State
                label="Acknowledgement"
                value={
                  sentinel.command_acknowledged
                    ? "Acknowledged"
                    : "Not acknowledged"
                }
              />
              <State
                label="Guidance arm"
                value={sentinel.hardware_state.arm_state}
              />
              <State
                label="Display"
                value={sentinel.hardware_state.display_message}
              />
              <State
                label="Audio"
                value={`${sentinel.hardware_state.audio} · ${sentinel.hardware_state.audio_state}`}
              />
              <State
                label="Automatic mode"
                value={snapshot?.automatic_control ? "Enabled" : "Disabled"}
              />
            </div>
          </Panel>

          <Panel
            title="Manual test controls"
            eyebrow="AVAILABLE AFTER HEARTBEAT"
            className="mt-5 rounded-xl"
          >
            <div className="grid gap-px bg-border sm:grid-cols-2 xl:grid-cols-4">
              <Control
                label="Normal guidance"
                icon={RotateCcw}
                disabled={!sentinel.connected}
                onClick={() =>
                  setConfirm({ action: "NORMAL", label: "Normal guidance" })
                }
              />
              {facility.exits
                .filter((exit) => exit.enabled)
                .map((exit) => (
                  <Control
                    key={exit.id}
                    label={`Guide to ${exit.name}`}
                    icon={RadioTower}
                    disabled={!sentinel.connected}
                    onClick={() =>
                      setConfirm({
                        action: "REDIRECT_TO_EXIT",
                        exit: exit.id,
                        label: `Guide to ${exit.name}`,
                      })
                    }
                  />
                ))}
              <Control
                label="Critical response"
                icon={ShieldAlert}
                disabled={!sentinel.connected}
                onClick={() =>
                  setConfirm({ action: "CRITICAL", label: "Critical response" })
                }
              />
              <Control
                label="Reset device"
                icon={RotateCcw}
                disabled={!sentinel.connected}
                onClick={() =>
                  setConfirm({ action: "RESET", label: "Device reset" })
                }
              />
            </div>
          </Panel>
        </>
      )}

      {confirm && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-2xl">
            <ShieldAlert
              className={
                confirm.action === "CRITICAL"
                  ? "text-destructive"
                  : "text-primary"
              }
            />
            <h2 className="mt-3 text-sm font-semibold">
              Confirm {confirm.label.toLowerCase()}
            </h2>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              This sends a real command to the connected ESP32 and records an
              event.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                className="button-secondary"
                onClick={() => setConfirm(null)}
              >
                Cancel
              </button>
              <button
                className={
                  confirm.action === "CRITICAL"
                    ? "button-danger"
                    : "button-primary"
                }
                onClick={() => void sendCommand(confirm)}
              >
                Send command
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function GuideStep({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: string;
}) {
  return (
    <div className="flex gap-3">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
        {number}
      </span>
      <div>
        <div className="text-xs font-semibold">{title}</div>
        <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
          {children}
        </p>
      </div>
    </div>
  );
}

function CodeCopy({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-md bg-black/30 p-2">
      <code className="min-w-0 flex-1 overflow-x-auto text-[9px] text-secondary">
        {text}
      </code>
      <button
        className="text-muted-foreground hover:text-foreground"
        onClick={() => {
          void navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        }}
        aria-label="Copy response example"
      >
        {copied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
      </button>
    </div>
  );
}

function State({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card p-4">
      <div className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 text-xs font-semibold">{humanize(value)}</div>
    </div>
  );
}

function Control({
  label,
  icon: Icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: typeof Cpu;
  disabled: boolean;
  onClick(): void;
}) {
  return (
    <button
      className="flex min-h-24 flex-col items-start justify-between bg-card p-4 text-left transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
      disabled={disabled}
      onClick={onClick}
    >
      <Icon size={17} className="text-primary" />
      <span className="text-xs font-medium">{label}</span>
    </button>
  );
}

function humanize(value: string) {
  return value
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/^./, (letter) => letter.toUpperCase());
}
