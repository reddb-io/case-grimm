# Embedded RedDB — TypeScript

RedDB running **embedded inside the Node process** via `@reddb-io/sdk`.
The package downloads the `red` binary on `postinstall` and speaks JSON-RPC
over stdio — no server, no port, no container.

## When to use

- Local ETL / analysis scripts.
- Integration tests without spinning up infra.
- Single-process apps where IPC latency is irrelevant.

## Quick start

```bash
pnpm install
pnpm start                       # ingest 655 nodes / 1741 edges + run demos
pnpm sim lrc_wolf 5              # find characters similar to the Little Red-Cap wolf
pnpm sim cinderella 5            # …or to Cinderella
pnpm sim gingerbread_witch 4     # …or to the Hansel & Gretel witch
```

`pnpm start` walks `../../input/` recursively (see [`input/SCHEMA.md`](../../input/SCHEMA.md))
and persists to `../../output/embedded.rdb`.

Optional env vars:

| Var                 | Default                              | Effect                          |
|---------------------|--------------------------------------|---------------------------------|
| `REDDB_URI`         | `file://<repo>/output/embedded.rdb`  | Use `memory://` for ephemeral.  |
| `REDDB_DATA_DIR`    | `<repo>/input`                       | Point at another data folder.   |
| `REDDB_BIN`         | (auto)                               | Path to a `red` binary override.|

## The `red` binary

The SDK speaks JSON-RPC over stdio to a `red` binary that matches its
own major version (SDK `1.0.x` → `red 1.0.x`). The package's `postinstall`
downloads it from GitHub releases. If that fails (private repo, blocked
network, missing asset for your platform), the next `connect()` call
throws and tells you how to point at an existing binary:

```
reddb: binary "red" not found.
  expected at: …/@reddb-io/sdk/bin/red
  override:    set REDDB_BIN=/path/to/red
```

Two ways to resolve:

1. **Point at an existing binary** of the matching version:
   ```bash
   REDDB_BIN=/path/to/red pnpm start
   ```
2. **Build from the reddb source** (sibling checkout):
   ```bash
   cd /path/to/reddb && cargo build --release --bin red
   REDDB_BIN=$PWD/target/release/red pnpm start
   ```

---

## `pnpm start` — ingest & demos

1. **Load.** Walks `input/`, picks every `*.json` with a `collection` field,
   dedupes nodes by `label` via `src/shared/load-graph.ts`.
2. **Idempotency check.** If the target collection already has entities, it
   skips ingest and jumps to queries. Delete `output/embedded.rdb` (or set
   `REDDB_URI=memory://`) to re-ingest.
3. **Insert nodes** in chunks of 100 with multi-row `VALUES (…), (…), …` —
   about 3× faster than single-row inserts.
4. **Calibrate `label → entity_id`** by assuming sequential allocation
   with a `+101` offset (RedDB reserves the first ~100 ids per collection
   for internal metadata). Cross-checked by reading the first id back via
   `GRAPH NEIGHBORHOOD`.
5. **Insert edges** in chunks of 50 using the resolved numeric ids. Edges
   whose endpoints can't be resolved are reported and skipped.
6. **Run a demo suite**:
   - entity-type distribution (aggregate SQL)
   - top edge labels by frequency
   - devouring stats (`EATS` / `KILLS` / `DECEIVES` / …)
   - top-10 most-central nodes (`GRAPH CENTRALITY`)
   - largest communities / components (`GRAPH COMMUNITY` / `COMPONENTS`)
   - graph properties (`GRAPH PROPERTIES`)
   - shortest paths between iconic character pairs (`GRAPH SHORTEST_PATH`)

Typical ingest: **~10 seconds** (1.8s nodes + 8s edges over stdio). Idempotent
re-runs skip ingest and jump straight to demos.

---

## `pnpm sim <character_slug> [topN] [--same-tale]` — similarity engine

Finds the characters most similar to a target via **Jaccard** over a strict
ontological fingerprint:

```
character_fp = { archetypes the character carries }    (IS_ARCHETYPE)
             ∪ { species the character carries }       (IS_SPECIES)
             ∪ { themes attached to their tale }       (CONTAINS_THEME)
             ∪ { locations attached to their tale }    (HAS_LOCATION)
             ∪ { symbolic numbers in their tale }      (CONTAINS_NUMBER)

match(a, b) = |fp(a) ∩ fp(b)| / |fp(a) ∪ fp(b)|
```

By default the script **excludes same-tale candidates** so the matches
surface genuine cross-tale resonance — pass `--same-tale` to include them.

> Why is the fingerprint built from the curated JSON instead of from
> live `GRAPH NEIGHBORHOOD` traversal? Because traversal through the
> tale node leaks sibling-character features (everyone in *Wolf and
> Seven Kids* would carry the same depth-2 hits and tie at the top of
> the list). The strict fingerprint preserves *per-character* signal.

### Cool insights this surfaces

#### 1. "Cinderela is the same archetype as the miller's daughter"

```
$ pnpm sim cinderella 3
'cinderella' (Cinderella)
  tale: cinderella_tale
  fingerprint (8): arc_humble_hero, arc_oppressed_maiden, loc_castle, num_3,
                   theme_cruel_stepfamily, theme_humble_triumph,
                   theme_magic_pact, theme_test_of_virtue

Top 3 cross-tale matches:

   63.6%  rumpelstiltskin_daughter   — Miller's Daughter (later Queen)
          tale:   rumpelstiltskin_tale
          shared: arc_humble_hero, arc_oppressed_maiden, loc_castle, num_3,
                  theme_humble_triumph, theme_magic_pact, theme_test_of_virtue

   60.0%  the_golden_goose_dummling  — Dummling (Simpleton, youngest)
   60.0%  the_white_snake_princess   — The Proud Princess
```

The strongest cross-tale resonance for **Cinderella is the miller's
daughter in Rumpelstiltskin** — both `humble_hero + oppressed_maiden`
who triumph via a `magic_pact` set in a `castle`. The differentiating
attribute is Cinderella's `theme_cruel_stepfamily`. Literature scholars
would write papers about this; the graph surfaces it in 30 ms.

#### 2. The "narrative wolf" is sometimes a human

```
$ pnpm sim lrc_wolf 4
'lrc_wolf' (Wolf (Little Red-Cap))
  fingerprint (11): arc_disguised_villain, arc_predator, arc_trickster,
                    sp_wolf, theme_devouring, theme_disguise,
                    theme_forest_danger, theme_moral_punishment,
                    theme_resurrection, loc_forest, loc_grandmother_house

Top 4 cross-tale matches:

   69.2%  wsk_wolf                       — Wolf (Seven Kids)
   50.0%  old_sultan_wolf                — The Wolf
   46.7%  the_robber_bridegroom_groom    — Cannibal Bridegroom    ← human!
   46.2%  tom_thumb_wolf                 — The Hungry Wolf
```

Top three are literal wolves. **The cannibal bridegroom from *The
Robber Bridegroom* at 47%** is a human who plays the wolf's role —
disguised predator who lures and devours. The fingerprint correctly
abstracts away "wolf" and finds the *narrative function*.

#### 3. Two cannibal cook-witches across tales

```
$ pnpm sim gingerbread_witch 3
'gingerbread_witch' (Gingerbread Witch from Hansel & Gretel)
  fingerprint (14): arc_disguised_villain, arc_evil_witch, arc_predator,
                    sp_witch, loc_cottage, loc_forest, loc_oven,
                    theme_abandoned_children, theme_cruel_stepfamily,
                    theme_devouring, theme_forest_danger,
                    theme_humble_triumph, theme_hunger,
                    theme_moral_punishment

Top 3 cross-tale matches:

   43.8%  fundevogel_sanna       — Old Sanna (the cook-witch)
          shared: arc_evil_witch, arc_predator, loc_forest, sp_witch,
                  theme_devouring, theme_forest_danger, theme_moral_punishment

   33.3%  the_blue_light_witch
   31.6%  lrc_wolf
```

Top match: **Old Sanna in *Fundevogel*** — another witch who tries to
*boil a child* in a kitchen in the forest. The graph rediscovers
folklore's "cannibal cook" trope without anyone tagging it.

#### 4. Two enchanted-prince animals point to the same tale

```
$ pnpm sim the_frog_prince_frog 2
'the_frog_prince_frog' (The Frog / enchanted Prince)
  fingerprint (10): arc_animal_helper, arc_royal_rescuer, loc_castle,
                    loc_forest, loc_well, num_3, theme_broken_promise,
                    theme_curse, theme_magic_pact, theme_metamorphosis

Top 2 cross-tale matches:

   57.1%  lily_griffin       — The Griffin
   57.1%  lily_lion_prince   — Enchanted Lion-Prince
```

The Frog Prince is structurally the **same character as both the
griffin and the lion-prince in *Lily and the Lion*** — same `curse`,
`magic_pact`, `metamorphosis`. The two halves of the Lily story (the
animal helper and the cursed prince) match equally to the frog because
he plays *both roles at once* in his shorter tale.

### Try your own

```bash
pnpm sim hansel                       # who else is an abandoned naive child in the forest?
pnpm sim evil_queen                   # who else is a disguised maternal villain?
pnpm sim the_blue_light_soldier       # poor-soldier-with-magical-protector
pnpm sim the_frog_prince_princess     # naive-princess-who-makes-a-pact
pnpm sim cinderella --same-tale 8     # include the stepsisters & prince in scoring
```

### Why this isn't pure SQL

You'd think `MATCH (c)-[:IS_ARCHETYPE]->(a) WITH c, COLLECT(a) …` would do this in one query. In RedDB 1.0.7, MATCH's `RETURN` projects empty rows
and `WHERE` doesn't filter — both broken — so the fingerprint join is
done client-side. The full graph is still queryable for centrality /
community / shortest-path; only row-projecting MATCH is currently a no-op.
See the project root README's "Feedback on RedDB 1.0.7" for the
catalogue.

---

## Notes & limitations

- **String escaping** — names containing apostrophes (e.g. *Cinderella's
  Father*) are escaped by doubling the quote (`''`). Slugs are URL-safe.
- **Multi-row inserts** (`VALUES (…), (…), …`) are about 3× faster than
  one-row-per-call. Chunks of 100 for nodes / 50 for edges are sweet
  spots — see the in-memory benchmark commented in `src/index.ts`.
- **Sequential id assumption** — `entity_id = insertion_index + 102`. Holds
  for a fresh collection only. The script's idempotency guard refuses to
  re-ingest into a populated DB, which is what protects this assumption.
- **MATCH limitations** — see the "Why this isn't pure SQL" note above.
  Any demo or feature here that surfaces real per-row data uses either
  aggregate SQL (`SELECT … GROUP BY`) or `GRAPH <algorithm>` clauses;
  similarity does the join in client memory.
