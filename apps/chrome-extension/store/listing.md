# Chrome Web Store submission

Use this sheet when creating the unlisted MVP item in the Chrome Web Store Developer Dashboard.

## Store listing

- Product name: `GroundTab`
- Summary: `Ground Codex and Claude Code in real web pages through Chrome.`
- Language: `English (United States)`
- Category: `Workflow & Planning`
- Visibility: `Unlisted`
- Regions: `All regions`
- Website: `https://gamettav.github.io/browser-research-bridge/`
- Support URL: `https://github.com/gamettav/browser-research-bridge/issues`
- Privacy policy: `https://gamettav.github.io/browser-research-bridge/privacy/`
- Store icon: `apps/chrome-extension/static/icon-128.png`
- Screenshot: `apps/chrome-extension/store/groundtab-pairing-1280x800.png`
- Small promo tile: `apps/chrome-extension/store/groundtab-promo-440x280.png`

### Detailed description

GroundTab connects Codex and Claude Code to Chrome for read-only web research. It gives your agent a grounded view of real pages when ordinary fetching is blocked, empty, or requires JavaScript.

Install the matching agent plugin, ask the agent to set up GroundTab, and enter the one-time code in the extension. After pairing, the agent can search the web, fetch static HTML without opening a tab, and use an inactive rendered tab when a page needs JavaScript.

GroundTab is read-only. It does not click controls, type into pages, submit forms, solve CAPTCHAs, bypass logins or paywalls, or expose cookie values. Access barriers return an error.

PAGE ACCESS AND DATA USE

The extension requests HTTP(S) site access so it can read a user-requested URL without requiring a manual click for every research page. It processes requested URLs and bounded readable page content locally, then sends the result over 127.0.0.1 to the user's Codex or Claude Code plugin. GroundTab has no cloud service and enables no remote telemetry by default. Users can restrict the extension's site access in Chrome.

The default local policy denies banking, healthcare, administration, email, password-manager, localhost, private-network, and cloud-metadata destinations. DNS and redirect checks fail closed before extraction.

Learn more and read the source:
https://github.com/gamettav/browser-research-bridge

## Privacy practices

### Single purpose

Let Codex and Claude Code perform user-requested, read-only web research through Chrome and return bounded page text and source metadata to the user's local agent plugin.

### Permission justifications

`alarms`

Reconnect the Manifest V3 service worker to the local agent plugin after Chrome suspends the worker. No remote scheduling or telemetry uses this permission.

`offscreen`

Parse statically fetched HTML in an extension document when a page does not require a rendered tab. This reduces tab creation and does not display or execute the page's scripts.

`scripting`

Run the packaged read-only extractor in a rendered fallback tab. The extractor returns bounded readable text and metadata; it does not click, type, submit, or read form values.

`storage`

Store the generated local pairing credential, broker port, connection state, and pairing status in Chrome extension storage. The credential is never shown to the user or sent to a remote GroundTab service.

`tabs`

Open an inactive fallback tab when static HTML is insufficient, inspect its final URL and loading state, extract readable content, and close it after the request.

`http://*/*` and `https://*/*`

Fetch or render the public HTTP(S) URL selected by the user's agent without requiring an activeTab click for every research page. Users can restrict site access in Chrome; requests outside that set fail. Local, private-network, cloud-metadata, and sensitive-account destinations are denied by policy.

### Remote code

Select `No, I am not using remote code.` All executable JavaScript ships inside the extension package. Fetched pages are treated as data and their scripts are not evaluated by the static extraction path.

### Data disclosures

Disclose these categories:

- Website content: page titles, readable text, links, and available author/date metadata from user-requested research pages.
- Web history: requested/final URLs and search queries needed to complete the user's research request.

The data is used only for the extension's user-facing research feature. It is processed locally and sent over loopback to the user's agent plugin. Certify that data is not sold, used for advertising, used for creditworthiness, or used for an unrelated purpose, and that the product complies with the Limited Use requirements.

## Reviewer instructions

No website account or paid feature is required. The extension is a companion to the GroundTab Codex or Claude Code plugin and initially opens its pairing page. The full source, protocol, tests, and packaged agent plugins are available at:

`https://github.com/gamettav/browser-research-bridge`

Expected first-run behavior:

1. Click the GroundTab toolbar icon.
2. The options page reports that it is waiting for the local agent plugin.
3. Start the GroundTab plugin in Codex or Claude Code and request setup.
4. Enter the 16-character one-time code shown by the agent.
5. The options page changes to connected.

The pairing code expires after ten minutes and locks after five incorrect attempts. No login credentials are required or provided.
