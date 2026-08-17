const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export default function Security() {
  return (
    <main className="legal wrap">
      <p className="eyebrow">GROUNDTAB</p>
      <h1>Security</h1>
      <p className="legal-date">Local by design</p>

      <h2>Boundary</h2>
      <p>The Chrome/Brave extension and agent plugin communicate only over loopback. First-run pairing uses short-lived bidirectional proofs; later connections use mutual nonce-based authentication. The long-lived credential is never shown to the user or transmitted after pairing.</p>

      <h2>Browser access</h2>
      <p>The extension performs read-only extraction and has no click, type, form-submit, CAPTCHA-solving, or credential-export capability. Public-address checks, final-URL validation, sensitive-domain defaults, output limits, and prompt-injection instructions reduce risk, but they are not an atomic browser sandbox.</p>

      <h2>Safer profiles</h2>
      <p>Install the extension only in a Chrome or Brave profile whose readable sites you are comfortable granting to the agent. Browser site-access restrictions can provide an allowlist. A separate low-privilege profile remains the strongest option for people who routinely keep sensitive services signed in.</p>

      <h2>Report a vulnerability</h2>
      <p>Use the private security contact on the Chrome Web Store listing. Do not publicly disclose a vulnerability that could expose local credentials, page content, or control of the extension before a fix is available.</p>

      <a className="legal-back" href={`${BASE_PATH}/`}>← Back to GroundTab</a>
    </main>
  );
}
