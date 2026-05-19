import { useEffect, useState } from "react";
import type { DeviceController } from "../device/types";
import { syncTime } from "../operations";

export function TimeSyncPanel({ controller }: { controller: DeviceController }) {
  const [connected, setConnected] = useState(controller.isConnected());
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => controller.onDisconnect(() => setConnected(false)), [controller]);

  // Poll connection state. The controller is mutated externally by
  // ConnectPanel; this is the simplest way to keep panels in sync without
  // adding a global event/state mechanism.
  useEffect(() => {
    const id = setInterval(() => setConnected(controller.isConnected()), 250);
    return () => clearInterval(id);
  }, [controller]);

  const onClick = async () => {
    setStatus("Syncing…");
    try {
      await syncTime(controller, new Date());
      setStatus("Time synced");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Sync failed");
    }
  };

  return (
    <section className="panel">
      <h2>Time</h2>
      <p>Sends your Mac's current time to the keyboard.</p>
      <button onClick={onClick} disabled={!connected}>
        Sync now
      </button>
      {status && <p>{status}</p>}
    </section>
  );
}
