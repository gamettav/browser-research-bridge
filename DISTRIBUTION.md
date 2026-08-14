# Distribution checklist

The end-user installation contract is:

1. **Chrome:** click **Add to Chrome** on the product website and complete the Chrome Web Store dialog.
2. **Agent:** install **GroundTab** from the Codex plugin directory or Claude Code marketplace.
3. **Pair:** ask the agent to **set up GroundTab**, then enter its one-time code in the extension page.

No public instructions may direct users to clone the repository, run project scripts, install Native Messaging, download Chrome for Testing, enable Developer Mode, copy an extension ID, or paste a bridge token.

## Chrome Web Store

- [ ] Build and test `apps/chrome-extension/dist`.
- [ ] Create the release zip with `pnpm package:extension`.
- [ ] Upload the zip in the Chrome Developer Dashboard.
- [ ] Complete the single-purpose, privacy, data-use, and remote-code declarations.
- [ ] Provide screenshots, icon assets, support contact, privacy-policy URL, and permission justifications.
- [ ] Submit for review and record the approved Store URL as `NEXT_PUBLIC_CHROME_WEB_STORE_URL`.
- [ ] Verify install, update, uninstall, first-run pairing, Chrome Stable, and Edge behavior from the signed Store build.

Suggested permission disclosures:

- **All websites:** required to read a public URL selected by the user's agent without demanding a manual `activeTab` click for every research page. Users can narrow Chrome site access; requests outside it fail.
- **Tabs and scripting:** required only to open an inactive fallback tab, extract bounded readable content, and close that tab when static fetching is insufficient.
- **Storage:** stores the paired local credential and connection status on the user's device.
- **Alarms:** reconnects the MV3 service worker to the local agent plugin after worker suspension.
- **Offscreen:** parses statically fetched HTML without opening a visible tab.

The public manifest does not request Native Messaging and contains no developer-generated extension key. The Web Store assigns the production extension identity; first-run pairing learns and binds that identity safely.

## Codex directory

- [ ] Run the plugin validator against `integrations/codex/browser-research`.
- [ ] Confirm the plugin contains only its skill, MCP manifest, bundled server/broker, and optional probe—not the Chrome extension or legacy installer.
- [ ] Test install/uninstall, implicit `$browse` activation, explicit setup intent, upgrade, IDE, CLI, and desktop surfaces.
- [ ] Submit the plugin through the Codex plugin publishing flow.
- [ ] Record the approved directory URL as `NEXT_PUBLIC_CODEX_PLUGIN_URL`.

## Claude Code marketplace

- [ ] Validate `integrations/claude/browser-research` and the `/browse` command/user-skill artifacts.
- [ ] Test interactive and noninteractive sessions, install/uninstall, MCP startup, pairing, permissions, and upgrade behavior.
- [ ] Publish through an approved Claude Code marketplace and record its install URL as `NEXT_PUBLIC_CLAUDE_PLUGIN_URL`.

## Release gate

Do not call the product publicly installable until all three URLs resolve for a logged-out user and a clean-machine smoke test completes this sequence without repository access or user-run scripts:

`Add to Chrome → install agent plugin → ask to set up → enter code → bridge_status connected → one search → one static fetch → one rendered fallback`
