# Privacy policy

Effective August 14, 2026

GroundTab connects a Chrome extension to a Codex or Claude Code plugin on the same computer. It has no GroundTab cloud service and does not enable remote telemetry by default.

## Data the extension processes

When the user asks their agent to research a URL, the extension may process:

- the requested and final URL;
- the page title, readable text, links, author/date metadata, and HTTP status;
- search queries and search-result titles, URLs, and snippets;
- a generated pairing credential, broker port, and local connection status.

The extension does not return cookie values, browser storage, browsing history outside user-requested research, form-field values, passwords, or payment information. It has no click, type, form-submit, CAPTCHA-solving, or access-control bypass feature.

## How data is used

The extension uses page URLs and website content only to complete research requested by the user. It sends bounded results over the loopback interface to the GroundTab plugin running on the same device. The user's Codex or Claude Code application may then send that result to its model provider under the provider's terms and privacy policy.

GroundTab does not sell data, use it for advertising, use it to determine creditworthiness, or transfer it to a GroundTab-operated remote service.

GroundTab's use of information received from Chrome complies with the Chrome Web Store User Data Policy, including the Limited Use requirements.

## Storage and retention

Chrome extension storage holds the generated pairing credential, broker port, and connection status. The local agent plugin holds the matching credential and optional research policy in a private configuration file.

Extracted captures and body-free audit records are bounded and process-local by default. They disappear when the requesting agent process ends. Users can disable capture retention or clear captures and audit records explicitly.

## Network requests

Requested websites and search providers receive ordinary requests from Chrome and apply their own privacy policies. Static requests follow Chrome's normal cookie rules. The extension never exposes cookie values to the agent.

## Site access and sensitive domains

HTTP(S) site access lets the extension research a URL without requiring a click for every page. Users can restrict that access in Chrome. Requests outside the allowed set then fail. Banking, healthcare, administration, email, and password-manager domains are denied by the default local research policy.

## Deletion

Removing the extension clears its Chrome-managed local storage. Removing the agent plugin and its local GroundTab configuration clears the matching credential and policy. GroundTab has no cloud account or cloud copy to delete.

## Contact

For privacy questions, open a support issue at <https://github.com/gamettav/groundtab/issues>. Do not report security vulnerabilities in a public issue; follow [SECURITY.md](SECURITY.md).
