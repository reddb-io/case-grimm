# Ontology

The ontology is the shared vocabulary that keeps the corpus useful. Without it,
each tale would be a beautiful isolated document. With it, the same stories can
answer questions about agency, consequence, thresholds, transformations,
predators, helpers, tests, deception, and recurring symbolic machinery.

ATU tale-type notes live in `input/3-gold/atu.yaml`; graph vocabulary lives in
`input/3-gold/ontology.yaml`; tale-specific entities and edges live beside each
canonical tale in `input/3-gold/tales`.

<div id="ontology-root"></div>

## Reader Facets

| Facet | What it captures |
|---|---|
| `HAS_WORLD_LAW` | Rules of reality inside a tale. |
| `HAS_MORAL_REGIME` | How justice, consequence, restoration, or arbitrariness works. |
| `IS_BEING_TYPE` | Folkloric kinds such as witch, dwarf, elf, dragon, fairy, or giant. |
| `GAINS_AGENCY_THROUGH` | How a character or object gains power to act. |
| `EXISTS_IN_STATE` | Altered states such as abandoned, cursed, disguised, or promised. |
| `HAS_THRESHOLD_TYPE` | Places that behave as transitions, tests, or borders. |
| `HAS_PROPP_EVENT` | Ordered narrative functions with actor, scene, and evidence. |
