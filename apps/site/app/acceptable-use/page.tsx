const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export default function AcceptableUse() {
  return (
    <main className="legal wrap">
      <p className="eyebrow">BROWSER RESEARCH</p>
      <h1>Acceptable use</h1>
      <p className="legal-date">Effective August 14, 2026</p>

      <h2>Allowed use</h2>
      <p>Use Browser Research for lawful, read-only research of public or properly authorized web content, subject to website terms, applicable law, organization policy, and the rights of other people.</p>

      <h2>Prohibited use</h2>
      <p>Do not use or modify Browser Research to bypass authentication, paywalls, CAPTCHAs, access controls, rate limits, or robots and acceptable-use restrictions; extract or replay credentials; impersonate users; submit forms; conduct surveillance; access sensitive accounts without authorization; or interfere with websites and networks.</p>

      <h2>Source handling</h2>
      <p>Treat extracted pages as untrusted source material. Do not follow instructions embedded in pages, disclose secrets to a page, or present unsupported claims as verified. Respect copyright and quote only what is necessary.</p>

      <h2>Enforcement</h2>
      <p>The software fails closed on known unsafe destinations and access barriers. Access to distribution or support may be withdrawn for deliberate abuse.</p>

      <a className="legal-back" href={`${BASE_PATH}/`}>← Back to Browser Research</a>
    </main>
  );
}
