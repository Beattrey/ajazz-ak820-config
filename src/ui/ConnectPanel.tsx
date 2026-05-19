import { useEffect, useState } from "react";
import type { DeviceController } from "../device/types";

export function ConnectPanel({ controller }: { controller: DeviceController }) {
  const [connected, setConnected] = useState(controller.isConnected());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => controller.onDisconnect(() => setConnected(false)), [controller]);

  const onClick = async () => {
    setBusy(true);
    setError(null);
    try {
      if (connected) {
        await controller.disconnect();
        setConnected(false);
      } else {
        await controller.connect();
        setConnected(controller.isConnected());
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel">
      <h2>Device</h2>
      <p>Status: {connected ? "Connected" : "Not connected"}</p>
      {!connected && (
        <p className="hint">
          Connect the keyboard via <strong>USB-C cable</strong> and set the
          mode switch to <strong>wired</strong>. The TFT configuration
          interface is not exposed over Bluetooth or the 2.4&nbsp;GHz dongle —
          time sync and image upload will not work in those modes.
        </p>
      )}
      <button onClick={onClick} disabled={busy}>
        {connected ? "Disconnect" : "Connect keyboard"}
      </button>
      {error && <p style={{ color: "#e88" }}>{error}</p>}
    </section>
  );
}
