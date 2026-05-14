# Grimm Tales Data Studio

Fairy tales are easy to read and hard to query. This site turns the curated
gold corpus into a visual RedDB showcase: you can start from the stories,
inspect the structured data, and follow the same corpus through graph,
tables, KV, timeseries, and statistics.

<div id="overview-dashboard"></div>

## What To Open First

- Start with **Visual Atlas** if you want charts and corpus-level shape.
- Open **Ask the Corpus** if you want guided questions and answers.
- Use **Tale Reader** if you want to read the canonical gold text and inspect
  source editions.
- Use **RedDB Showcase** if you want to see which database model powers each
  view.

Locally, generate the static data before serving:

```bash
./grimm export docs
./grimm docs serve
```
