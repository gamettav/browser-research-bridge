# Distribution checklist

The end-user installation contract is:

1. **Chrome:** click **Add to Chrome** on the product website and complete the Chrome Web Store dialog.
2. **Agent:** install **GroundTab** from the GitHub marketplace now, or from the official Codex/Claude directory when those listings are approved.
3. **Pair:** ask the agent to **set up GroundTab**, then enter its one-time code in the extension page.

No public instructions may direct users to clone the repository, run project scripts, install Native Messaging, download Chrome for Testing, enable Developer Mode, copy an extension ID, or paste a bridge token. Adding `gamettav/groundtab` through the agent's own marketplace command is a supported end-user install path, not a source checkout.

## Chrome Web Store

- [x] Build and test `apps/chrome-extension/dist`.
- [x] Create the release zip with `pnpm package:extension`.
- [x] Upload the zip in the Chrome Developer Dashboard.
- [x] Complete the single-purpose, privacy, data-use, and remote-code declarations.
- [x] Provide screenshots, icon assets, support contact, privacy-policy URL, and permission justifications.
- [x] Publish version `0.4.2` and record https://chromewebstore.google.com/detail/groundtab/hofdkaefhagmobgomodpekofmghdkpjc as `NEXT_PUBLIC_CHROME_WEB_STORE_URL`.
- [ ] Verify install, update, uninstall, first-run pairing, Chrome Stable, and Edge behavior from the signed Store build.

Suggested permission disclosures:

- **All websites:** required to read a public URL selected by the user's agent without demanding a manual `activeTab` click for every research page. Users can narrow Chrome site access; requests outside it fail.
- **Tabs and scripting:** required only to open an inactive fallback tab, extract bounded readable content, and close that tab when static fetching is insufficient.
- **Storage:** stores the paired local credential and connection status on the user's device.
- **Alarms:** reconnects the MV3 service worker to the local agent plugin after worker suspension.
- **Offscreen:** parses statically fetched HTML without opening a visible tab.

The public manifest does not request Native Messaging and contains no developer-generated extension key. The Web Store assigns the production extension identity; first-run pairing learns and binds that identity safely.

## Codex directory

- [x] Add the repository-root Codex marketplace manifest and verify a clean marketplace install.
- [x] Confirm the plugin contains only its skill, MCP manifest, bundled server/broker, and optional probe—not the Chrome extension or legacy installer.
- [x] Verify a fresh Codex CLI session calls the native GroundTab MCP tools through the paired signed extension.
- [ ] Test official-directory install/uninstall, implicit `$browse` activation, upgrade, IDE, and desktop surfaces.
- [ ] Submit the plugin through the Codex plugin publishing flow.
- [ ] Record the approved directory URL as `NEXT_PUBLIC_CODEX_PLUGIN_URL`.

## Claude Code marketplace

- [x] Add the repository-root Claude marketplace manifest and validate `integrations/claude/groundtab`.
- [x] Test marketplace install/reinstall, MCP startup, pairing, explicit `/groundtab:browse`, and noninteractive read-only tool permissions with `claude-personal --chrome`.
- [ ] Test the official marketplace upgrade path and all supported Claude Code surfaces.
- [ ] Publish through an approved Claude Code marketplace and record its install URL as `NEXT_PUBLIC_CLAUDE_PLUGIN_URL`.

## Release gate

GroundTab is publicly installable through the signed Chrome listing and the repository's native Codex/Claude marketplace manifests. Before announcing official agent-directory availability, all three official URLs must resolve for a logged-out user and a clean-machine smoke test must complete:

`Add to Chrome → add GitHub marketplace → install agent plugin → ask to set up → enter code → bridge_status connected → one search → one static fetch → one rendered fallback`
