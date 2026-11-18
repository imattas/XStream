# Working on XStream

Read SPEC.md and docs/UPSTREAM.md before changing a protocol adapter. Keep the xHome service boundary in the Worker and the media path in the browser. Record the upstream revision and protocol evidence for changes to signaling or token exchange.

Use Node 24 and the pinned pnpm version. Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm test:e2e` after installing the Playwright Chromium browser. Keep mocked-service results distinct from testing with a physical console. Keep credentials out of fixtures, logs, and browser storage.
