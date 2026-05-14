# Data Pipeline

The public site is generated, not hand-synchronized. The important idea is that
each layer has a different job: books remain books, canonical tales remain
editorial data, RedDB remains runtime/query state, and Docsify receives a static
export.

<div id="pipeline-root"></div>

```text
input/1-bronze    raw Project Gutenberg books
input/2-silver    extracted books, canonical texts, source texts, branches
input/3-gold      curated 206-tale graph and corpus metadata
output/embedded.rdb
docs/data/*.json  generated during ./grimm export docs and GitHub Pages deploy
```

## Local Commands

```bash
./grimm rebuild
./grimm export docs
./grimm docs serve
```

The GitHub Pages workflow performs the same generation steps before uploading
the static `docs/` directory.
