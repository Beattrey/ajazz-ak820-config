import { useMemo, useState } from "react";
import { DeviceSessionProvider, useDeviceSession } from "./device/DeviceSession";
import { UnsupportedBrowser } from "./ui/UnsupportedBrowser";
import { ConnectPanel } from "./ui/ConnectPanel";
import { TimeSyncPanel } from "./ui/TimeSyncPanel";
import { ImagePanel } from "./ui/ImagePanel";
import { LightingPanel } from "./ui/LightingPanel";
import { OperationStatus } from "./ui/OperationStatus";
import { WebHIDDeviceController } from "./device/webhid-controller";

export default function App() {
  const supported = useMemo(() => typeof navigator !== "undefined" && "hid" in navigator, []);
  const [controller] = useState(() => new WebHIDDeviceController());

  if (!supported) return <UnsupportedBrowser />;

  return (
    <DeviceSessionProvider controller={controller}>
      <Configurator />
    </DeviceSessionProvider>
  );
}

type Workspace = "lighting" | "display" | "device";

const WORKSPACES: { id: Workspace; label: string; description: string }[] = [
  { id: "lighting", label: "Lighting", description: "Effects, colour and sleep" },
  { id: "display", label: "Display", description: "TFT image upload" },
  { id: "device", label: "Device", description: "Connection and time" },
];

export function Configurator() {
  const [workspace, setWorkspace] = useState<Workspace>("lighting");
  const { health } = useDeviceSession();
  const current = WORKSPACES.find((item) => item.id === workspace) ?? WORKSPACES[0];

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <p className="eyebrow">Keyboard control</p>
          <h1>AJAZZ AK820 Pro</h1>
        </div>
        <button
          type="button"
          className={`connection-pill health-${health}`}
          onClick={() => setWorkspace("device")}
          aria-label={`${healthText(health)}. Open device settings.`}
        >
          <span className="device-health-dot" aria-hidden="true" />
          {healthText(health)}
        </button>
      </header>

      <OperationStatus />

      <div className="app-shell">
        <nav className="workspace-nav" aria-label="Configurator sections">
          {WORKSPACES.map((item) => (
            <button
              type="button"
              key={item.id}
              className={workspace === item.id ? "is-active" : ""}
              aria-label={`${item.label}: ${item.description}`}
              aria-current={workspace === item.id ? "page" : undefined}
              onClick={() => setWorkspace(item.id)}
            >
              <strong>{item.label}</strong>
              <small>{item.description}</small>
            </button>
          ))}
        </nav>

        <main className="workspace">
          <div className="workspace-heading">
            <div>
              <p className="eyebrow">Configurator</p>
              <h2>{current.label}</h2>
            </div>
            <p>{current.description}</p>
          </div>

          {workspace === "lighting" && <LightingPanel />}
          {workspace === "display" && <ImagePanel />}
          {workspace === "device" && (
            <div className="device-workspace">
              <ConnectPanel />
              <TimeSyncPanel />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function healthText(health: ReturnType<typeof useDeviceSession>["health"]): string {
  switch (health) {
    case "disconnected":
      return "Not connected";
    case "checking":
      return "Checking keyboard";
    case "responsive":
      return "Keyboard connected";
    case "unresponsive":
      return "Keyboard asleep";
  }
}
