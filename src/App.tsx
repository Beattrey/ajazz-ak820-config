import { useMemo, useState } from "react";
import { UnsupportedBrowser } from "./ui/UnsupportedBrowser";
import { ConnectPanel } from "./ui/ConnectPanel";
import { TimeSyncPanel } from "./ui/TimeSyncPanel";
import { ImagePanel } from "./ui/ImagePanel";
import { WebHIDDeviceController } from "./device/webhid-controller";

export default function App() {
  const supported = useMemo(
    () => typeof navigator !== "undefined" && "hid" in navigator,
    [],
  );
  const [controller] = useState(() => new WebHIDDeviceController());

  if (!supported) return <UnsupportedBrowser />;

  return (
    <div className="app">
      <h1>AJAZZ AK820 Pro Configurator</h1>
      <ConnectPanel controller={controller} />
      <TimeSyncPanel controller={controller} />
      <ImagePanel controller={controller} />
    </div>
  );
}
