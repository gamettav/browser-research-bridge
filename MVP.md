# MVP acceptance ledger

Last updated: 2026-08-17

## Product installation contract

- Chrome extension installs through the Chrome Web Store.
- Codex and Claude Code install their GroundTab plugin/MCP through the agent's normal plugin surface; the repository-root GitHub marketplaces are live today.
- The plugin automatically creates private local configuration and starts the broker; the user does not run or supervise a script.
- The extension and plugin pair once with a short-lived code. There is no Native Messaging installation, dedicated Chrome download, Developer Mode, extension-ID copy, or long-lived token paste.
- The website links to the signed Chrome listing and the supported GitHub marketplace instructions. Official agent-directory listings remain clearly labeled as pending.

## Passed locally

- Protocol v3 first-run pairing uses a random 64-bit code, ten-minute expiry, five-attempt lockout, exact extension-origin binding, and bidirectional HMAC proofs. The pairing code is not sent over loopback and the long-lived credential is never shown to the user.
- First MCP startup creates a private 256-bit local credential without prior configuration; the broker persists the Chrome identity after successful pairing.
- Later extension and MCP connections retain mutual nonce-based HMAC authentication and malicious-port/wrong-secret regressions.
- The public MV3 manifest has no `nativeMessaging` permission and no preselected developer extension key.
- The extension options page provides the three-step agent pairing flow and contains no token, port, extension-ID, Native Messaging, doctor, or script UI.
- The Codex and Claude plugin packaging contains the MCP server/broker and browse workflow without bundling the Chrome extension or legacy OS installer.
- Extension-context static fetch is first; 401/403, challenge, empty-shell, unsupported-content, and JavaScript-dependent responses fall back to a short-lived rendered tab with adaptive settle timing.
- Requested and final URLs receive public-address and policy checks; changed/unsafe destinations fail closed before extraction.
- Broker-owned concurrency, absolute deadlines, cancellation, reconnect, bounded output, local policy, configurable retention, body-free audits, and explicit destructive maintenance tools are covered by automated tests.
- The bundled research workflow provides DuckDuckGo → Bing → Google failover, transient retry, replacement sources, domain quarantine, canonical/syndication deduplication, source ranking, independent-evidence checks, claim coverage, prompt-injection handling, early stopping, and exact `Research incomplete` behavior.
- Research-quality fixtures cover factual, technical, news, comparison, insufficient-evidence, recovery, and malicious-page scenarios.

## Current distribution status

These are external distribution gates, not user setup steps:

- Chrome Web Store: published publicly as version `0.4.2` at https://chromewebstore.google.com/detail/groundtab/hofdkaefhagmobgomodpekofmghdkpjc.
- GitHub marketplace manifests for Codex and Claude Code: packaged and verified locally for version `0.4.3`.
- Codex plugin-directory submission, review, and approved install URL.
- Claude Code marketplace submission, review, and approved install URL.
- Clean-machine acceptance from all three signed/reviewed packages.

The app is installable now through Chrome plus the GitHub marketplaces. Official one-click directory availability still requires the remaining reviews and this clean-machine flow:

`Add to Chrome → add GitHub marketplace → install agent plugin → ask to set up → enter code → connected → search → static fetch → rendered fallback`

## Deferred after MVP

- Bundled cross-platform runtime for agent environments without `node` on `PATH`.
- Signed native/platform installers, Windows/ARM packaging, automatic updates, and rollback.
- Licensed search API/BYOK, long-term provider fixture maintenance, conditional caching, PDF parsing, and encrypted cross-session audit persistence.
- Portable interception of arbitrary native-crawler failures; recovery remains skill-directed.
