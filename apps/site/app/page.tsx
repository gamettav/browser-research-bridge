import { CopyCommand } from "../components/CopyCommand";
import { ThemeToggle } from "../components/ThemeToggle";

const REPO = "https://github.com/gamettav/browser-research-bridge";

const INSTALL_COMMAND =
  "pnpm install && pnpm check && node scripts/browser-research.mjs setup --extension-id <ID>";

const TERMINAL_HTML = `<span class="t-prompt">▸</span> <span class="t-key">fetch_rendered_page</span>(
    url=<span class="t-str">"https://docs.example.dev/api/rate-limits"</span>
  )

<span class="t-mut"># agent's own fetcher: 403 Forbidden</span>
<span class="t-mut"># bridge: opened an inactive tab, rendered, closed it</span>

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
    <>One local broker serves both harnesses at once over an authenticated loopback channel.</>
  ) },
  { n: "03", glyph: "◱", title: "Inactive tab", body: (
    <>The extension opens a background tab in your research profile, waits for render, and re-checks the final URL.</>
  ) },
  { n: "04", glyph: "⤶", title: "Clean Markdown", body: (
    <>Readable text, links, and a stable citation block come back — then the tab is closed.</>
  ) },
];

const does = [
  { t: "Fail-closed DNS checks.", d: "Private, internal, and metadata addresses are refused before navigation — and the final URL is re-resolved after redirects." },
  { t: "Mutual token auth.", d: "A high-entropy token proves both sides by challenge–response; the secret itself never crosses the wire." },
  { t: "Read-only tool surface.", d: "There is no click, type, or submit tool. Page text can't trigger an action because none exists." },
  { t: "Untrusted-content labeling.", d: "Extracted pages are marked untrusted and stripped of scripts, forms, and hidden text before your agent sees them." },
  { t: "In-memory captures.", d: "Citations live only in the running process, capped and never written to disk." },
];

const never = [
  { t: "Solve CAPTCHAs", d: "or defeat challenge pages — they return a structured error." },
  { t: "Spoof fingerprints", d: "or run any stealth/anti-detection behavior." },
  { t: "Extract cookies", d: ", storage, history, or form values into tool output." },
  { t: "Submit forms", d: "or perform any write action on a page." },
  { t: "Circumvent login", d: ", paywalls, or access controls — logged-out pages stay logged out." },
];

const steps = [
  { title: "Create a dedicated Chrome profile", body: <>A low-privilege research profile, signed into only the sources this agent should be allowed to read.</> },
  { title: "Load the unpacked extension", body: <>Enable Developer mode and load <code>apps/chrome-extension/dist</code>. Copy the extension ID it shows.</> },
  { title: "Run setup", body: <>Run the <code>setup</code> command with your extension ID. It generates a 256-bit token and installs the Native Messaging host.</> },
  { title: "Paste the token", body: <>Open the extension options once and paste the token. Save — the badge turns to Connected.</> },
  { title: "Run doctor", body: <>The <code>doctor</code> command verifies file permissions, the pinned Node runtime, build freshness, and that all read-only tools start.</> },
];

const faqs = [
  { q: "Does it read my cookies or my browsing?", a: "No. It never puts cookie values, storage, history, or form values into tool output. It uses the dedicated profile's session only to render a page — the same way Chrome itself does when you open a tab — and returns readable text, not your session.", open: true },
  { q: "Is this a scraper or a bot-evasion tool?", a: "No. It renders pages a normal Chrome tab can open and returns structured errors on CAPTCHAs, logins, and access denials instead of getting around them. There is no stealth, no fingerprint spoofing, and no “open any site” claim — only pages your profile is already authorized to view." },
  { q: "Is it safe to run?", a: "The tool surface is read-only, the broker is localhost-only, both ends authenticate by challenge–response, and DNS checks fail closed against private targets. It is also an unsigned experimental preview — which is exactly why the dedicated, low-privilege profile is mandatory rather than optional." },
  { q: "Why does the extension request access to all sites?", a: "Unattended research can't rely on Chrome's activeTab permission, which needs a click each time. You can still restrict site access in Chrome — autonomous calls outside those origins then fail closed." },
  { q: "How is this different from Claude in Chrome?", a: "It works with Codex too, exposes a harness-neutral MCP surface, and keeps a deterministic read-only tool set built for bulk clean extraction with citations. Think of it as a complement for agent CLIs, not a replacement for an in-browser assistant." },
];

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
            <a className="ghlink" href={REPO}>GitHub&nbsp;↗</a>
            <ThemeToggle />
          </nav>
        </div>
      </header>

      <main>
        <section className="hero" style={{ borderTop: 0 }}>
          <div className="wrap hero-grid">
            <div>
              <p className="eyebrow">Local MCP bridge · read-only</p>
              <h1 className="headline">
                Your agent got blocked.<br />
                <span className="em">Your browser didn&apos;t.</span>
              </h1>
              <p className="lede">
                A local, read-only bridge that lets Claude Code and Codex read fully rendered pages through your own
                Chrome — no cloud, no cookie extraction, no bypasses. Just the page you could already open.
              </p>
              <div className="cta-row">
                <a className="btn btn-primary" href={REPO}>View on GitHub</a>
                <a className="btn btn-ghost" href="#security">Read the security model</a>
              </div>
              <div className="hero-meta">
                <span><i className="dot" /> Runs on localhost</span>
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
              <h2>Open a real tab, extract, close it.</h2>
              <p>Every request runs through a shared local broker into a dedicated Chrome profile. The tab is inactive, short-lived, and cleaned up whether the job succeeds or fails.</p>
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
              You decide what the agent can see by choosing what the research profile is signed into. Inactive tabs are
              closed in a <code>finally</code> block, and a global two-job ceiling is enforced across every session.
            </p>
          </div>
        </section>

        <section id="security" className="sec-security">
          <div className="wrap">
            <div className="section-head">
              <p className="eyebrow">Security posture</p>
              <h2>The boundary is the point.</h2>
              <p>This tool reads pages your own profile is already authorized to view. It is not a scraper and not an anti-bot tool — and the code enforces that, not just the docs.</p>
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
              The SSRF regression suite and lifecycle tests assert that the blocked things stay blocked. Because it&apos;s an
              unsigned preview, the dedicated low-privilege Chrome profile is a requirement, not a suggestion — it&apos;s the
              real boundary, and we say so plainly in <a href={`${REPO}/blob/main/SECURITY.md`}>SECURITY.md</a>.
            </p>
          </div>
        </section>

        <section id="setup">
          <div className="wrap">
            <div className="section-head">
              <p className="eyebrow">Setup</p>
              <h2>Five steps, one machine.</h2>
              <p>Early preview: manual setup, macOS &amp; Linux, unpacked extension. Chrome Web Store packaging and signed installers are on the roadmap.</p>
            </div>
            <div className="steps">
              {steps.map((step) => (
                <div className="step" key={step.title}>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </div>
              ))}
            </div>

            <CopyCommand command={INSTALL_COMMAND} />

            <div className="callout">
              <b>REQUIREMENTS</b> — Node 20.11+, pnpm, Chrome 116+. The bridge renders pages a normal tab can open;
              logged-in, CAPTCHA, and denial pages return errors rather than being bypassed.
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
            <a href={REPO}>GitHub</a>
            <a href={`${REPO}/blob/main/SECURITY.md`}>Security model</a>
            <a href={`${REPO}/blob/main/RESEARCH.md`}>Design notes</a>
            <a href={`${REPO}/security/advisories/new`}>Report a vulnerability</a>
          </nav>
        </div>
      </footer>
    </>
  );
}
