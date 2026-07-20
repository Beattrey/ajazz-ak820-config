export function UnsupportedBrowser() {
  return (
    <div className="app">
      <h1>AJAZZ AK820 Pro Configurator</h1>
      <p>
        This app requires the WebHID API, which is only available in Chrome and Edge (Chromium-based
        browsers).
      </p>
      <p>Please open this page in Chrome or Edge to continue.</p>
    </div>
  );
}
