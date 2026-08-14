export default function Privacy() {
  return (
    <main className="legal wrap">
      <p className="eyebrow">BROWSER RESEARCH</p>
      <h1>Privacy policy</h1>
      <p className="legal-date">Effective August 14, 2026</p>

      <h2>Plain-language summary</h2>
      <p>Browser Research does not send page content, browsing history, cookie values, credentials, research logs, or usage telemetry to a Browser Research cloud service. The extension and agent plugin communicate locally on your device.</p>

      <h2>Data processed on your device</h2>
      <p>When you ask your agent to research a URL, the extension may request that public page, briefly render it in an inactive tab, and return bounded readable text and source metadata to the local agent plugin. It does not return cookie values, browser storage, history, form-field values, or password data.</p>
      <p>The extension stores a generated pairing credential, local connection status, and broker port in Chrome extension storage. The agent plugin stores its matching credential and optional research policy in a private local configuration file.</p>

      <h2>Retention</h2>
      <p>Extracted captures and body-free audit records are bounded and process-local by default. They disappear when the requesting agent process ends. Users can configure shorter retention, disable capture retention, or explicitly clear retained captures and audit records.</p>

      <h2>Network requests and third parties</h2>
      <p>Requested websites and search providers receive ordinary network requests from Chrome and apply their own privacy policies. Browser Research does not sell personal data, use it for advertising, or enable remote telemetry by default.</p>

      <h2>Permissions and user control</h2>
      <p>All-sites access allows research without requiring a manual click for every page. You can restrict the extension&apos;s site access in Chrome; research outside those domains will fail. Sensitive banking, healthcare, administration, email, and password-manager domains are denied by default by the local research policy.</p>

      <h2>Contact</h2>
      <p>For privacy or deletion questions, use the support contact on the Browser Research Chrome Web Store listing. Because data is not held by a Browser Research cloud service, clearing the extension and local agent configuration removes the product&apos;s persistent local data.</p>

      <a className="legal-back" href="/">← Back to Browser Research</a>
    </main>
  );
}
