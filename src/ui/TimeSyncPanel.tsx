import { useState } from "react";
import { useDeviceSession } from "../device/DeviceSession";
import { syncTime } from "../operations";

export function TimeSyncPanel() {
  const { controller, connected, activeOperation, runOperation } = useDeviceSession();
  const [status, setStatus] = useState<string | null>(null);

  const onClick = async () => {
    setStatus("Syncing…");
    try {
      await runOperation("time sync", () => syncTime(controller, new Date()));
      setStatus("Time synced");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Sync failed");
    }
  };

  return (
    <section className="panel">
      <h2>Time</h2>
      <p>Sends your Mac's current time to the keyboard.</p>
      <button type="button" onClick={onClick} disabled={!connected || activeOperation !== null}>
        Sync now
      </button>
      {status && <p>{status}</p>}
    </section>
  );
}
