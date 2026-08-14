# @browser-research/site

The landing site for GroundTab — a Next.js (App Router) app that
builds to a fully static export, so it deploys to GitHub Pages with no server.

## Commands

```sh
pnpm --filter @browser-research/site dev        # local dev at http://localhost:3000
pnpm --filter @browser-research/site build      # static export → apps/site/out/
pnpm --filter @browser-research/site typecheck
```

`pnpm build` at the repo root also builds this app as part of `pnpm -r build`.

## Structure

- `app/layout.tsx` — root layout, metadata, and a no-flash theme script.
- `app/page.tsx` — the landing page (server component); section content is data-driven.
- `app/globals.css` — the full design system: light/dark/system theming via CSS
  custom properties, system font stacks only (no webfont requests).
- `components/ThemeToggle.tsx` — client component; toggles `data-theme` and persists it.
- `components/CopyCommand.tsx` — client component; copy-to-clipboard for the install command.

## Deploy (GitHub Pages)

The app is configured with `output: "export"` (see `next.config.mjs`). Build, then
publish `apps/site/out/`.

For a **project page** served under `/<repo>`, set the base path at build time:

```sh
NEXT_PUBLIC_BASE_PATH=/browser-research-bridge pnpm --filter @browser-research/site build
```

For a user/organization page or a custom domain served at the root, build without it.

## Before going public

- Replace the placeholder repo URL (`github.com/gamettav/browser-research-bridge`)
  in `app/page.tsx` (`REPO` constant) with the real repository.
- Keep the product name "GroundTab" in anything user-facing —
  never the `vebicrolly` working-folder name.
