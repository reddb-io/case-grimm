# Gold Layer Schema (v2)

Per-tale knowledge graph files in YAML, plus a shared ontology.
Validated by JSON Schema via ajv (`pnpm run validate`).

```
input/3-gold/
├── SCHEMA.md             ← this file
├── ontology.yaml         ← shared ontological vocabulary (16 categories)
├── atu.yaml              ← ATU tale-type catalogue
├── corpus.yaml           ← materialized provenance/corpus tables + graph
├── schemas/              ← JSON Schemas (draft-07)
│   ├── atu.schema.json
│   ├── corpus.schema.json
│   ├── ontology.schema.json
│   └── tale.schema.json
└── tales/
    └── <slug>.yaml       ← per-tale graph (206 files when complete)
```

## Design principles

1. **YAML universal**: human-editable, multiline-friendly, comment-tolerant.
2. **Type-instance pattern**: universal concepts (e.g. `loc_forest`) live in `ontology.yaml`; ATU tale-types live in `atu.yaml`; tale-specific instances (e.g. `loc_forest_hansel_and_gretel`) live in per-tale yaml with `instance_of:` pointer.
3. **Cross-tale identity**: characters always separate per-tale; connected only via shared ontology references (species, archetype, domains).
4. **Hybrid tale structure**: entity subtrees as source-of-truth + classification sections + Propp ordering + narrative edges.
5. **Open vocabulary** (edge labels, ontology additions): LLM may propose; periodic auto-cataloging.

## Ontology entry — 4-facet schema

Every entry across all categories carries:

| field | meaning |
|-------|---------|
| `name` | human-readable label |
| `description` | prose definition (multiline OK) |
| `tier` | `phenomenal` (what EXISTS) \| `structural` (recurring PATTERNS) \| `operational` (RULES of tale-world) |
| `scope` | `entity` (per-char/obj) \| `tale` (per-story) \| `world` (universal rule) |
| `lens` | `propp` \| `atu` \| `structural` \| `cognitive` \| `material` |
| `domains` | cross-cutting tags (`[violence, forest, speech, ...]`) |
| `related` | labels of related entries (powers "what represents X?" queries) |
| `examples` | concrete tales/situations |

## Ontology categories

| key | label pattern | examples |
|-----|---------------|----------|
| `archetypes` | `arc_*` | arc_trickster, arc_predator |
| `themes` | `theme_*` | theme_envy, theme_devouring |
| `world_laws` | `law_*` | law_promise_binds_reality |
| `agency_modes` | `agency_*` | agency_cunning, agency_virtue |
| `existential_states` | `state_*` | state_cursed, state_disguised |
| `threshold_types` | `threshold_*` | threshold_forest, threshold_well |
| `transformation_modes` | `transform_*` | transform_curse, transform_marriage |
| `speech_acts` | `speech_*` | speech_curse, speech_promise |
| `moral_regimes` | `moral_*` | moral_retributive, moral_arbitrary |
| `affects` | `affect_*` | affect_envy, affect_fear |
| `narrative_functions` | `func_*` | func_villainy, func_wedding (Propp) |
| `species` | `sp_*` | sp_wolf, sp_human |
| `being_types` | `being_*` | being_witch, being_dwarf |
| `symbol_numbers` | `num_*` | num_3, num_7 |
| `locations` | `loc_*` | loc_forest, loc_castle (universal types) |
| `magic_objects` | `obj_*` | obj_spinning_wheel, obj_apple (universal types) |
| `edge_labels` | `[A-Z_]+` | KILLS, MARRIES, PROMISES_TO |

## ATU catalogue

`atu.yaml` holds `atu_types` entries such as `atu_500` ("Name of the
Supernatural Helper"). These are kept separate because they describe
whole-tale comparative types and can become long structural summaries.
Ontology entries may still reference them in `related`, and per-tale files
may still carry `atu` / `atu_name` as compact metadata.

## Corpus catalogue

`corpus.yaml` is the materialized provenance layer. It is generated from
silver book manifests and `silver/canonical/*/branches.yaml`, then validated
as gold so importers do not need to recalculate counts or branch topology at
runtime.

It contains table-shaped sections:

- `books`: one row per silver book manifest, with declared totals and aggregate counts.
- `book_tales`: one row per tale as it appears inside a source book.
- `canonical_tales`: one row per private canonical tale, with precomputed source and branch counters.
- `canonical_sources`: canonical tale to source-book relationships.
- `canonical_branch_sections`: editorial/canonical decision points from `branches.yaml`.
- `canonical_branches`: explicit alternative branches under those decision points.
- `graph`: a ready-to-import `corpus` graph connecting books, book tales, canonical tales, branch sections, and branches.

Regenerate it after changing silver books, branches, or gold tale metadata:

```bash
pnpm run build:corpus
pnpm run validate:corpus
```

## Per-tale YAML — required fields

Validated by `tale.schema.json`. **Minimum robust** baseline:

- `slug` (kebab-case)
- `khm` (integer or composite string like `"10/41/80"`)
- `canonical_source` (path to silver canonical.txt)
- `entities.characters` (≥1)
- `classifications.themes` (≥1)
- `classifications.world_laws` (≥1)
- `classifications.moral_regimes` (≥1)
- `propp` (≥1 function, ordered)
- `edges` (≥1)

Optional but encouraged:
- `atu`, `atu_name`
- `title`
- `entities.magic_objects`, `entities.locations`
- `classifications.agency_modes_dominant`, `affects_driving`, `symbol_numbers`, `threshold_types`
- Per-character: `archetypes`, `species`, `being_type`, `agency_modes`, `existential_states`, `transformations`, `speech_acts_performed`, `affects`, `traits`
- `evidence:` quote from canonical.txt on any node/edge

## Validation

```bash
pnpm install                  # one-time
pnpm run validate             # validate ontology + ATU catalog + all tales
pnpm run validate:ontology    # only ontology.yaml
pnpm run validate:atu         # only atu.yaml
pnpm run validate:corpus      # only corpus.yaml
pnpm run validate:tales       # only tales/*.yaml
```

VSCode YAML plugin auto-applies schemas via `.vscode/settings.json` —
inline error highlighting + autocomplete while editing.

## Edge label catalog

Open vocabulary. Common labels documented in `ontology.yaml`'s
`edge_labels:` section as they stabilise. Full catalog auto-extracted
from tales/*.yaml via `scripts/catalog_edges.py` → `edge-catalog.yaml`.

Naming convention: `UPPER_SNAKE_CASE`, verb-form (`KILLS`, `MARRIES`,
`PROMISES_TO`, `OWNS`).

## Legacy

`*-legacy.{md,json}` and `tales-legacy/` preserve the v1 design (62
Taylor-modelled tales, flat ontology). Reference only — not loaded.
