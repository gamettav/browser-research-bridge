# Security policy

GroundTab is a read-only local research bridge. Install the Chrome extension only in a profile whose site access you are comfortable granting to the agent. Chrome site-access controls can narrow the default all-public-sites permission; a separate low-privilege profile remains the strongest option for users who research while signed in to sensitive services, but it is not part of ordinary installation.

## Supported boundary

The project helps an agent read policy-allowed pages that Chrome can display. It must not be extended to solve CAPTCHAs, evade bot detection, spoof browser identity, expose or replay cookie values, defeat paywalls, submit forms, or bypass authentication and authorization controls. Banking, healthcare, administration, email, and password-manager domains are denied by default.

## Pairing and local authentication

- A fresh extension connects only to the loopback broker started by the installed agent plugin.
- The agent shows a random 64-bit pairing code that expires after ten minutes and locks after five incorrect attempts.
- The extension sends an HMAC proof derived from that code, not the code itself. The broker proves it knows the same code before releasing the generated 256-bit bridge credential.
- Later extension and MCP connections use mutual nonce-based HMAC authentication. The long-lived credential is stored in a private local configuration file and is never printed or sent over loopback after pairing.
- Pairing binds the broker to the exact Chrome extension origin. Other extension origins and web origins are rejected.

## Reporting

Do not publish a vulnerability that could allow a website or local process to control the extension, read arbitrary page content, or steal the bridge credential. Report it privately to the repository owner first.

## Known risks and limits

- The extension needs broad HTTP(S) host permission for unattended research; users may narrow this in Chrome at the cost of failed requests outside the allowlist.
- Extension-context requests follow Chrome's normal credential rules, and rendered fallback tabs run in the profile where the extension is installed. Cookie values, storage, history, and form values are not returned, but readable signed-in page content may be accessible unless site access or research policy denies it.
- DNS and redirect checks are fail-closed before extraction but are not an atomic network sandbox. DNS may change between validation and navigation, and Chrome can issue a redirect request before its final URL is available for inspection.
- Captures and audit records are bounded and process-local rather than encrypted cross-session storage.
- Public Store and marketplace releases are not signed or review-approved until the release checklist marks them published.
