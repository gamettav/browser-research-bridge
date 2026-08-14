import { ThemeToggle } from "../components/ThemeToggle";

const REPO = process.env.NEXT_PUBLIC_REPOSITORY_URL;

const CHROME_STORE_URL = process.env.NEXT_PUBLIC_CHROME_WEB_STORE_URL;
const CODEX_PLUGIN_URL = process.env.NEXT_PUBLIC_CODEX_PLUGIN_URL;
const CLAUDE_PLUGIN_URL = process.env.NEXT_PUBLIC_CLAUDE_PLUGIN_URL;

const TERMINAL_HTML = `<span class="t-prompt">▸</span> <span class="t-key">fetch_rendered_page</span>(
    url=<span class="t-str">"https://docs.example.dev/api/rate-limits"</span>
  )

<span class="t-mut"># extension fetch: static HTML was sufficient</span>
<span class="t-mut"># no tab opened · rendered fallback available</span>

<span class="t-ok">✓</span> finalUrl   <span class="t-str">https://docs.example.dev/api/rate-limits</span>
<span class="t-ok">✓</span> title      Rate limits — Example API
<span class="t-ok">✓</span> markdown   1,842 chars · 6 links
<span class="t-ok">✓</span> citation   [cap_3f9a] retained in-process

  <span class="t-mut">## Rate limits</span>
  Requests are capped at <span class="t-str">600/min</span> per token. Bursts
  above the ceiling receive a 429 with a Retry-After<span class="cursor"></span>`;

const flow = [
  { n: "01", glyph: "$_", title: "Agent asks", body: (
    <>Claude Code or Codex calls an MCP tool — <span className="inline-code">search_web</span> or <span className="inline-code">fetch_rendered_page</span>.</>
  ) },
  { n: "02", glyph: "⇄", title: "Shared broker", body: (
    <>The installed agent plugin starts one local broker automatically. There is no background script for the user to manage.</>
  ) },
  { n: "03", glyph: "⚡", title: "Static first", body: (
    <>The paired extension fetches static HTML directly with no cookie values exposed to the agent.</>
  ) },
  { n: "04", glyph: "◱", title: "Render if needed", body: (
    <>Challenges, empty shells, and JavaScript pages fall back to an inactive tab, then return clean citation blocks.</>
  ) },
];

const does = [
  { t: "Fail-closed DNS checks.", d: "Private, internal, and metadata addresses are refused before navigation — and the final URL is re-resolved after redirects." },
  { t: "Mutual token auth.", d: "A high-entropy token proves both sides by challenge–response; the secret itself never crosses the wire." },
  { t: "Read-only research.", d: "There is no click, type, or submit tool. Deletion is isolated in clearly named maintenance tools; bulk clearing requires confirmation." },
  { t: "Untrusted-content labeling.", d: "Extracted pages are marked untrusted and stripped of scripts, forms, and hidden text before your agent sees them." },
  { t: "Local controls.", d: "Allowlists, denylists, limits, URL redaction, retention, and do-not-retain mode are configurable. Body-free audits stay process-local." },
];

const never = [
  { t: "Solve CAPTCHAs", d: "or defeat challenge pages — they return a structured error." },
  { t: "Spoof fingerprints", d: "or run any stealth/anti-detection behavior." },
  { t: "Extract cookies", d: ", storage, history, or form values into tool output." },
  { t: "Submit forms", d: "or perform any write action on a page." },
  { t: "Circumvent login", d: ", paywalls, or access controls — logged-out pages stay logged out." },
];

const steps = [
  { title: "Add the Chrome extension", body: <>Install Browser Research from the Chrome Web Store like any other extension. No Developer Mode or separate Chrome download.</> },
  { title: "Install it in your agent", body: <>Add the Browser Research plugin in Codex or Claude Code. The plugin launches its local MCP broker when the agent starts.</> },
  { title: "Pair once", body: <>Ask the agent to <strong>set up Browser Research</strong>, then enter its short-lived code in the extension. No extension ID, token, or terminal setup.</> },
];

const faqs = [
  { q: "Does it expose my cookies or browsing history?", a: "No cookie values, storage, history, or form values are returned to the agent. Page requests follow Chrome's normal rules, so install it only in a profile whose site access you are comfortable granting; sensitive signed-in domains are denied by default.", open: true },
  { q: "Is this a scraper or a bot-evasion tool?", a: "No. It renders pages a normal Chrome tab can open and returns structured errors on CAPTCHAs, logins, and access denials instead of getting around them. There is no stealth, no fingerprint spoofing, and no “open any site” claim — only pages your profile is already authorized to view." },
  { q: "What happens when a source fails?", a: "The bundled research skill retries one transient navigation failure, switches search providers or source domains, removes canonical and syndicated duplicates, and stops once independent evidence is sufficient. If material evidence is still missing, it returns “Research incomplete” instead of guessing." },
  { q: "Is it safe to run?", a: "Ordinary browsing and audit export are read-only; explicit maintenance tools can delete retained captures or audits. The broker is localhost-only, pairing uses a short-lived proof, later connections authenticate by challenge–response, and DNS checks fail closed against private targets. Chrome's site-access controls remain available if you want a narrower allowlist." },
  { q: "Why does the extension request access to all sites?", a: "Unattended research can't rely on Chrome's activeTab permission, which needs a click each time. You can still restrict site access in Chrome — autonomous calls outside those origins then fail closed." },
  { q: "How is this different from Claude in Chrome?", a: "It works with Codex too, exposes a harness-neutral MCP surface, and keeps ordinary research deterministic and read-only, with separate explicit maintenance tools for local retention. Think of it as a complement for agent CLIs, not a replacement for an in-browser assistant." },
];

function DistributionLink({ label, href }: { label: string; href: string | undefined }) {
  return (
    <div className="distribution-link">
      <strong>{label}</strong>
      {href
        ? <a href={href}>Install ↗</a>
        : <span>Publisher review pending</span>}
    </div>
  );
}

export default function Home() {
  return (
    <>
      <header className="top">
        <div className="wrap">
          <div className="brand">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <rect x="1.2" y="1.2" width="17.6" height="17.6" rx="4" stroke="currentColor" strokeWidth="1.4" />
              <path d="M6 10h8M11 7l3 3-3 3" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Browser&nbsp;Research&nbsp;Bridge
          </div>
          <nav>
            <a className="hide-sm" href="#how">How it works</a>
            <a className="hide-sm" href="#security">Security</a>
            <a className="hide-sm" href="#setup">Setup</a>
            {REPO && <a className="ghlink" href={REPO}>GitHub&nbsp;↗</a>}
            <ThemeToggle />
          </nav>
        </div>
      </header>

      <main>
        <section className="hero" style={{ borderTop: 0 }}>
          <div className="wrap hero-grid">
            <div>
              <p className="eyebrow">Chrome extension · Codex + Claude plugin</p>
              <h1 className="headline">
                Your agent got blocked.<br />
                <span className="em">Your browser didn&apos;t.</span>
              </h1>
              <p className="lede">
                Add one Chrome extension, install one agent plugin, and pair them once. Claude Code and Codex can then
                research public pages through Chrome — static first, rendered when needed.
              </p>
              <div className="cta-row">
                {CHROME_STORE_URL
                  ? <a className="btn btn-primary" href={CHROME_STORE_URL}>Add to Chrome</a>
                  : <span className="btn btn-primary btn-disabled" aria-disabled="true">Chrome Store submission pending</span>}
                <a className="btn btn-ghost" href="#setup">See the 3-step setup</a>
              </div>
              <div className="hero-meta">
                <span><i className="dot" /> No user-run scripts</span>
                <span>Works with Claude&nbsp;Code + Codex</span>
                <span>Apache-2.0</span>
              </div>
            </div>

            <div className="term" role="img" aria-label="Example fetch_rendered_page tool call returning clean Markdown and the final URL">
              <div className="term-bar">
                <i /><i /><i />
                <span className="title">codex · browser-research · fetch_rendered_page</span>
              </div>
              <div className="term-body">
                <pre dangerouslySetInnerHTML={{ __html: TERMINAL_HTML }} />
              </div>
            </div>
          </div>
        </section>

        <section id="how">
          <div className="wrap">
            <div className="section-head">
              <p className="eyebrow">How it works</p>
              <h2>Fetch first. Render only when needed.</h2>
              <p>The agent plugin starts a shared local broker automatically. Static HTML avoids opening a tab; dynamic or incomplete responses fall back to short-lived rendered navigation in the paired extension.</p>
            </div>
            <div className="flow">
              {flow.map((node) => (
                <div className="node" key={node.n}>
                  <span className="n">{node.n}</span>
                  <span className="glyph">{node.glyph}</span>
                  <h3>{node.title}</h3>
                  <p>{node.body}</p>
                </div>
              ))}
            </div>
            <p className="flow-note">
              The bundled skill fails over across search providers and replacement sources, avoids repeatedly failing
              domains, deduplicates equivalent results, and returns <code>Research incomplete</code> when evidence is insufficient.
              Rendered fallback tabs are closed in a <code>finally</code> block, and deadlines and cancellation reach queued work.
            </p>
          </div>
        </section>

        <section id="security" className="sec-security">
          <div className="wrap">
            <div className="section-head">
              <p className="eyebrow">Security posture</p>
              <h2>The boundary is the point.</h2>
              <p>This tool reads policy-allowed pages through the Chrome profile where you install it. It is not an anti-bot tool: challenges and access denials trigger rendered fallback or a structured failure, never a bypass.</p>
            </div>
            <div className="cols">
              <div className="panel does">
                <h3>◆ What it does</h3>
                <ul>
                  {does.map((item) => (
                    <li key={item.t}>
                      <span className="m">+</span>
                      <span><b>{item.t}</b> <span className="d">{item.d}</span></span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="panel never">
                <h3>✕ What it will never do</h3>
                <ul>
                  {never.map((item) => (
                    <li key={item.t}>
                      <span className="m">−</span>
                      <span><b>{item.t}</b> <span className="d">{item.d}</span></span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <p className="sec-foot">
              The SSRF, pairing, and malicious-local-process regressions assert that the blocked things stay blocked. The
              extension never returns cookie values or form data, and Chrome&apos;s normal site-access controls can restrict
              the domains it may read. The complete threat model ships with every release.
            </p>
          </div>
        </section>

        <section id="setup">
          <div className="wrap">
            <div className="section-head">
              <p className="eyebrow">Setup</p>
              <h2>Install twice. Pair once.</h2>
              <p>The user-facing setup has no source checkout, Node command, Native Messaging host, dedicated browser download, extension-ID copy, or long-lived token paste.</p>
            </div>
            <div className="steps">
              {steps.map((step) => (
                <div className="step" key={step.title}>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </div>
              ))}
            </div>

            <div className="distribution-grid">
              <DistributionLink label="Chrome extension" href={CHROME_STORE_URL} />
              <DistributionLink label="Codex plugin" href={CODEX_PLUGIN_URL} />
              <DistributionLink label="Claude Code plugin" href={CLAUDE_PLUGIN_URL} />
            </div>

            <div className="callout">
              <b>RELEASE STATUS</b> — The install flow is implemented. Store and marketplace buttons become live after publisher review; until then they are deliberately marked as pending rather than sending users to source-code setup.
            </div>
          </div>
        </section>

        <section id="faq">
          <div className="wrap">
            <div className="section-head">
              <p className="eyebrow">Questions</p>
              <h2>The things worth asking first.</h2>
            </div>
            <div className="faq">
              {faqs.map((item) => (
                <details key={item.q} open={item.open}>
                  <summary>{item.q}</summary>
                  <p>{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer>
        <div className="wrap">
          <p className="note">Browser Research Bridge — a local, read-only research bridge for coding agents. Open source under Apache-2.0.</p>
          <nav>
            <a href="/privacy/">Privacy</a>
            <a href="/acceptable-use/">Acceptable use</a>
            <a href="/security/">Security</a>
            {REPO && <a href={REPO}>Repository</a>}
          </nav>
        </div>
      </footer>
    </>
  );
}
