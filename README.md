# CMS Worker Test Bistro

Minimal one-page test site for the shared private CMS deploy/debounce Worker.

Content source of truth:

```txt
content/sites/test-bistro-two/content.json
```

Build:

```bash
pnpm build
```

The Worker dispatches `.github/workflows/deploy-pages.yml`. That workflow accepts `clientId`, `deployId`, and `pagesProjectName`, includes `deployId` in the run name, builds static `out/`, and deploys it to GitHub Pages.

`.github/workflows/simulate-cms-save.yml` is a server-side test workflow that updates the CMS JSON, commits it, then calls the shared Worker with the repo secret `CMS_DEPLOY_WORKER_TOKEN`.
