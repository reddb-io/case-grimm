#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SILVER_BOOKS = path.join(ROOT, "input", "2-silver", "books");
const SILVER_CANONICAL = path.join(ROOT, "input", "2-silver", "canonical");
const GOLD = path.join(ROOT, "input", "3-gold");
const GOLD_TALES = path.join(GOLD, "tales");
const OUT = path.join(GOLD, "corpus.yaml");

function readYaml(file) {
  return yaml.load(fs.readFileSync(file, "utf8"));
}

function writeYaml(file, data) {
  fs.writeFileSync(
    file,
    yaml.dump(data, {
      sortKeys: false,
      noRefs: true,
      lineWidth: 120,
      quotingType: "'",
      forceQuotes: false,
    }),
    "utf8",
  );
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function maybeString(value) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function compactObject(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined));
}

function labelPart(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function nodeLabel(prefix, ...parts) {
  return [prefix, ...parts.map(labelPart).filter(Boolean)].join("_");
}

function splitKeptBooks(value) {
  if (Array.isArray(value)) return value.filter((x) => typeof x === "string" && x.trim());
  if (typeof value !== "string") return [];
  return value
    .split("+")
    .map((x) => x.trim())
    .filter(Boolean);
}

function meaningfulPlotBreak(value) {
  if (value === undefined || value === null) return false;
  const text = Array.isArray(value) ? value.join(" ") : String(value);
  const normalized = text.trim().toLowerCase();
  return Boolean(normalized) && !/^(none|n\/a|na|no|false)\b/.test(normalized);
}

function stableText(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function stringList(value) {
  return asArray(value).map(stableText).filter((text) => text.trim());
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function sum(items, keyFn) {
  return items.reduce((acc, item) => acc + Number(keyFn(item) ?? 0), 0);
}

function readGoldTalesBySlug() {
  const tales = new Map();
  for (const entry of fs.readdirSync(GOLD_TALES).sort()) {
    if (!entry.endsWith(".yaml") && !entry.endsWith(".yml")) continue;
    const file = path.join(GOLD_TALES, entry);
    const tale = asObject(readYaml(file));
    if (typeof tale.slug === "string") tales.set(tale.slug, tale);
  }
  return tales;
}

function buildBooksAndBookTales() {
  const books = [];
  const bookTales = [];
  const bookTaleByBookSlug = new Map();
  const bookTalesByBookKhm = new Map();

  for (const bookId of fs.readdirSync(SILVER_BOOKS).sort()) {
    const manifestPath = path.join(SILVER_BOOKS, bookId, "tales.yaml");
    if (!fs.existsSync(manifestPath)) continue;
    const manifest = asObject(readYaml(manifestPath));
    const tales = asArray(manifest.tales).map(asObject);
    const languageCounts = countBy(tales, (tale) => maybeString(tale.language));

    books.push(compactObject({
      book_id: maybeString(manifest.book_id) ?? bookId,
      source_file: maybeString(manifest.source_file),
      total_declared: manifest.total,
      tale_count: tales.length,
      word_count: sum(tales, (tale) => tale.word_count),
      char_count: sum(tales, (tale) => tale.char_count),
      language_counts: languageCounts,
    }));

    for (const tale of tales) {
      if (typeof tale.slug !== "string") continue;
      const row = compactObject({
        id: `${bookId}:${tale.slug}`,
        book_id: bookId,
        slug: tale.slug,
        title: maybeString(tale.title),
        title_de: maybeString(tale.title_de),
        khm: tale.khm,
        khm_variant: tale.khm_variant,
        composite_khm: tale.composite_khm,
        atu: tale.atu,
        kind: tale.kind,
        language: tale.language,
        word_count: tale.word_count,
        char_count: tale.char_count,
        body_line: tale.body_line,
        body_title: maybeString(tale.body_title),
      });
      bookTales.push(row);
      bookTaleByBookSlug.set(`${bookId}:${tale.slug}`, row);
      if (tale.khm !== undefined && tale.khm !== null) {
        const khms = Array.isArray(tale.composite_khm) ? tale.composite_khm : [tale.khm];
        for (const khm of khms) {
          const key = `${bookId}:${String(khm)}`;
          if (!bookTalesByBookKhm.has(key)) bookTalesByBookKhm.set(key, row);
        }
      }
    }
  }

  return { books, bookTales, bookTaleByBookSlug, bookTalesByBookKhm };
}

function findBookTale({ bookId, slug, khm, bookTaleByBookSlug, bookTalesByBookKhm }) {
  const exact = bookTaleByBookSlug.get(`${bookId}:${slug}`);
  if (exact) return { row: exact, matchMethod: "slug" };
  if (khm !== undefined && khm !== null) {
    const byKhm = bookTalesByBookKhm.get(`${bookId}:${String(khm)}`);
    if (byKhm) return { row: byKhm, matchMethod: "khm" };
  }
  return { row: undefined, matchMethod: undefined };
}

function buildCanonicalCorpus(goldTales, bookTaleByBookSlug, bookTalesByBookKhm) {
  const canonicalTales = [];
  const canonicalSources = [];
  const branchSections = [];
  const branches = [];

  for (const slug of fs.readdirSync(SILVER_CANONICAL).sort()) {
    const branchesPath = path.join(SILVER_CANONICAL, slug, "branches.yaml");
    if (!fs.existsSync(branchesPath)) continue;

    const source = asObject(readYaml(branchesPath));
    const goldTale = asObject(goldTales.get(slug));
    const sources = asArray(source.sources).map(asObject).filter((row) => typeof row.book === "string");
    const sections = asArray(source.sections).map(asObject);
    const baseBookId = typeof source.base === "string"
      ? source.base
      : maybeString(asObject(source.base).book);

    const explicitBranches = sections.flatMap((section) => asArray(section.branches).map(asObject));
    const canonicalDecisionTypes = Object.keys(countBy(sections, (section) => maybeString(asObject(section.canonical).type))).sort();
    const branchTypes = Object.keys(countBy(explicitBranches, (branch) => maybeString(branch.type))).sort();
    const sourceBookIds = sources.map((row) => row.book);
    const sourceBookIdsUnique = [...new Set(sourceBookIds)].sort();

    canonicalTales.push(compactObject({
      slug,
      title: maybeString(goldTale.title),
      khm: source.khm ?? goldTale.khm,
      khm_variant: goldTale.khm_variant,
      legend_number: goldTale.legend_number,
      atu: source.atu ?? goldTale.atu,
      canonical_source: maybeString(goldTale.canonical_source),
      base_book_id: baseBookId,
      source_count: sourceBookIdsUnique.length,
      alternative_source_count: Math.max(sourceBookIdsUnique.length - (baseBookId ? 1 : 0), 0),
      canonical_decision_count: sections.length,
      branch_section_count: sections.filter((section) => asArray(section.branches).length > 0).length,
      explicit_branch_count: explicitBranches.length,
      branch_consequence_count: sum(explicitBranches, (branch) => asArray(branch.consequences).length),
      plot_break_count: explicitBranches.filter((branch) => meaningfulPlotBreak(branch.plot_breaks)).length,
      canonical_decision_types: canonicalDecisionTypes,
      explicit_branch_types: branchTypes,
      source_book_ids: sourceBookIdsUnique,
    }));

    for (const row of sources) {
      const match = findBookTale({
        bookId: row.book,
        slug,
        khm: source.khm ?? goldTale.khm,
        bookTaleByBookSlug,
        bookTalesByBookKhm,
      });
      canonicalSources.push(compactObject({
        canonical_slug: slug,
        book_id: row.book,
        weight: row.weight,
        is_base: row.book === baseBookId,
        book_tale_id: match.row?.id,
        book_tale_slug: match.row?.slug,
        match_method: match.matchMethod,
      }));
    }

    sections.forEach((section, sectionIndex) => {
      const canonical = asObject(section.canonical);
      const sectionId = maybeString(section.id) ?? `section-${sectionIndex + 1}`;
      const branchRows = asArray(section.branches).map(asObject);
      const keptBooks = splitKeptBooks(canonical.kept);

      branchSections.push(compactObject({
        id: `${slug}:${sectionId}`,
        canonical_slug: slug,
        section_id: sectionId,
        title: maybeString(section.title),
        canonical_type: maybeString(canonical.type),
        canonical_rationale: maybeString(canonical.rationale),
        kept_book_ids: keptBooks,
        explicit_branch_count: branchRows.length,
      }));

      branchRows.forEach((branch, branchIndex) => {
        const consequences = stringList(branch.consequences);
        branches.push(compactObject({
          id: `${slug}:${sectionId}:${branchIndex + 1}`,
          section_ref: `${slug}:${sectionId}`,
          canonical_slug: slug,
          section_id: sectionId,
          branch_index: branchIndex + 1,
          type: maybeString(branch.type),
          from_book_id: maybeString(branch.from),
          description: maybeString(branch.description),
          text: maybeString(branch.text),
          consequences,
          consequence_count: consequences.length,
          plot_breaks: maybeString(branch.plot_breaks),
          has_plot_break: meaningfulPlotBreak(branch.plot_breaks),
        }));
      });
    });
  }

  return { canonicalTales, canonicalSources, branchSections, branches };
}

function buildCorpusGraph({ books, bookTales, canonicalTales, canonicalSources, branchSections, branches }) {
  const nodes = [];
  const edges = [];
  const seen = new Set();

  function addNode(label, nodeType, name) {
    if (seen.has(label)) return;
    seen.add(label);
    nodes.push({ label, node_type: nodeType, name });
  }

  function addEdge(from, to, label) {
    if (!from || !to) return;
    edges.push({ from, to, label });
  }

  for (const book of books) {
    addNode(nodeLabel("book", book.book_id), "book", book.book_id);
  }

  for (const tale of bookTales) {
    const book = nodeLabel("book", tale.book_id);
    const bookTale = nodeLabel("book_tale", tale.book_id, tale.slug);
    addNode(bookTale, "book_tale", tale.title ?? tale.slug);
    addEdge(book, bookTale, "CONTAINS");
  }

  for (const tale of canonicalTales) {
    const canonical = nodeLabel("canonical", tale.slug);
    addNode(canonical, "canonical_tale", tale.title ?? tale.slug);
    if (tale.base_book_id) addEdge(canonical, nodeLabel("book", tale.base_book_id), "USES_BASE_BOOK");
  }

  for (const source of canonicalSources) {
    const canonical = nodeLabel("canonical", source.canonical_slug);
    const book = nodeLabel("book", source.book_id);
    addEdge(canonical, book, source.is_base ? "USES_BASE_BOOK" : "USES_SOURCE_BOOK");
    if (source.book_tale_id) {
      const [bookId, slug] = source.book_tale_id.split(":");
      addEdge(canonical, nodeLabel("book_tale", bookId, slug), source.is_base ? "USES_BASE_TEXT" : "DERIVED_FROM");
    }
  }

  for (const section of branchSections) {
    const canonical = nodeLabel("canonical", section.canonical_slug);
    const sectionNode = nodeLabel("branch_section", section.canonical_slug, section.section_id);
    addNode(sectionNode, "branch_section", section.title ?? section.id);
    addEdge(canonical, sectionNode, "HAS_BRANCH_POINT");
  }

  for (const branch of branches) {
    const branchNode = nodeLabel("branch", branch.canonical_slug, branch.section_id, branch.branch_index);
    const sectionNode = nodeLabel("branch_section", branch.canonical_slug, branch.section_id);
    addNode(branchNode, "branch", branch.description ?? branch.id);
    addEdge(sectionNode, branchNode, "HAS_ALTERNATIVE");
    if (branch.from_book_id) addEdge(branchNode, nodeLabel("book", branch.from_book_id), "FROM_SOURCE");
  }

  return { collection: "corpus", nodes, edges };
}

function main() {
  const goldTales = readGoldTalesBySlug();
  const { books, bookTales, bookTaleByBookSlug, bookTalesByBookKhm } = buildBooksAndBookTales();
  const { canonicalTales, canonicalSources, branchSections, branches } =
    buildCanonicalCorpus(goldTales, bookTaleByBookSlug, bookTalesByBookKhm);
  const graph = buildCorpusGraph({ books, bookTales, canonicalTales, canonicalSources, branchSections, branches });

  const corpus = {
    schema_version: 1,
    generated_from: {
      silver_books: "../2-silver/books/*/tales.yaml",
      silver_branches: "../2-silver/canonical/*/branches.yaml",
      gold_tales: "tales/*.yaml",
    },
    counters: {
      book_count: books.length,
      book_tale_count: bookTales.length,
      canonical_tale_count: canonicalTales.length,
      canonical_source_count: canonicalSources.length,
      branch_section_count: branchSections.length,
      explicit_branch_count: branches.length,
      graph_node_count: graph.nodes.length,
      graph_edge_count: graph.edges.length,
    },
    books,
    book_tales: bookTales,
    canonical_tales: canonicalTales,
    canonical_sources: canonicalSources,
    canonical_branch_sections: branchSections,
    canonical_branches: branches,
    graph,
  };

  writeYaml(OUT, corpus);
  console.log(`Wrote ${path.relative(ROOT, OUT)}`);
  console.log(JSON.stringify(corpus.counters, null, 2));
}

main();
