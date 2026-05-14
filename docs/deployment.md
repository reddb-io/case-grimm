# Build & Publish

The published site is static, but it is not hand-maintained. GitHub Actions
rebuilds the embedded RedDB snapshot and exports the docs payload before every
Pages deploy.

<div id="build-publish-root"></div>

## Local Refresh

```bash
./grimm rebuild
./grimm export docs
./grimm docs serve
```

The workflow does the same generation in CI, then uploads `docs/` as a GitHub
Pages artifact.
