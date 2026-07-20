import { useState } from "react";
import { type DeviceHealth, useDeviceSession } from "../device/DeviceSession";

export function ConnectPanel() {
  const { connected, health, lastResponseAt, activeOperation, connect, disconnect } =
    useDeviceSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    setBusy(true);
    setError(null);
    try {
      if (connected) {
        await disconnect();
      } else {
        await connect();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel">
      <h2>Connection</h2>
      <div className={`device-health health-${health}`} role="status" aria-live="polite">
        <span className="device-health-dot" aria-hidden="true" />
        <span>
          <strong>{healthLabel(health)}</strong>
          {health === "responsive" && lastResponseAt && (
            <small>Last response {lastResponseAt.toLocaleTimeString()}</small>
          )}
          {health === "unresponsive" && (
            <small>Press a key to wake the keyboard. The website will check again automatically.</small>
          )}
        </span>
      </div>
      {!connected && (
        <p className="hint">
          Connect the keyboard via <strong>USB-C cable</strong> and set the mode switch to{" "}
          <strong>wired</strong>. The TFT configuration interface is not exposed over Bluetooth or
          the 2.4&nbsp;GHz dongle — time sync and image upload will not work in those modes.
        </p>
      )}
      <button type="button" onClick={onClick} disabled={busy || activeOperation !== null}>
        {connected ? "Disconnect" : "Connect keyboard"}
      </button>
      {error && <p style={{ color: "#e88" }}>{error}</p>}
    </section>
  );
}

function healthLabel(health: DeviceHealth): string {
  switch (health) {
    case "disconnected":
      return "Not connected";
    case "checking":
      return "Checking keyboard…";
    case "responsive":
      return "Awake and responding";
    case "unresponsive":
      return "Not responding";
  }
}
