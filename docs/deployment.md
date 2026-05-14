# Deployment

This Docsify site is intentionally static:

- `docs/index.html` loads Docsify from CDN.
- `docs/assets/app.js` renders the interactive reader.
- `docs/data/*.json` contains generated RedDB/gold export data.
- `docs/.nojekyll` keeps GitHub Pages from treating the site as Jekyll.

To refresh the data bundle after changing `input/3-gold` or the extracted
texts, run:

```bash
./grimm export docs
```

The included GitHub Actions workflow runs `./grimm setup`, `./grimm rebuild`,
`./grimm export docs`, and then publishes `docs/` to GitHub Pages. In
repository settings, set Pages to deploy from GitHub Actions.
