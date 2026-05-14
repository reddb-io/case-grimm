#!/usr/bin/env node
/**
 * Validate gold YAML files against JSON Schemas.
 *
 * Usage:
 *   node scripts/validate_gold.mjs               # validate everything
 *   node scripts/validate_gold.mjs ontology      # only ontology.yaml
 *   node scripts/validate_gold.mjs atu           # only atu.yaml
 *   node scripts/validate_gold.mjs corpus        # only corpus.yaml
 *   node scripts/validate_gold.mjs tales         # only tales/*.yaml
 *
 * Requires (npm i): ajv, ajv-formats, js-yaml, glob
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import Ajv from "ajv/dist/2019.js";
import addFormats from "ajv-formats";
import { globSync } from "glob";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const GOLD = path.join(ROOT, "input", "3-gold");
const SCHEMAS = path.join(GOLD, "schemas");

const ajv = new Ajv({ allErrors: true, strict: false, verbose: true });
addFormats(ajv);

function loadSchema(name) {
  return JSON.parse(fs.readFileSync(path.join(SCHEMAS, name), "utf-8"));
}

function loadYaml(p) {
  return yaml.load(fs.readFileSync(p, "utf-8"));
}

function fmtErrors(errors, file) {
  return errors
    .map((e) => `    ${e.instancePath || "/"}: ${e.message} (${JSON.stringify(e.params)})`)
    .join("\n");
}

function validateOntology() {
  const file = path.join(GOLD, "ontology.yaml");
  if (!fs.existsSync(file)) {
    console.log("  ontology.yaml: (not yet present — skipping)");
    return { ok: true, count: 0 };
  }
  const schema = loadSchema("ontology.schema.json");
  const validate = ajv.compile(schema);
  const data = loadYaml(file);
  const ok = validate(data);
  if (ok) {
    console.log(`  ontology.yaml: OK`);
    return { ok: true, count: 1 };
  } else {
    console.log(`  ontology.yaml: FAIL`);
    console.log(fmtErrors(validate.errors, file));
    return { ok: false, count: 1 };
  }
}

function validateAtu() {
  const file = path.join(GOLD, "atu.yaml");
  if (!fs.existsSync(file)) {
    console.log("  atu.yaml: (not yet present — skipping)");
    return { ok: true, count: 0 };
  }
  const schema = loadSchema("atu.schema.json");
  const validate = ajv.compile(schema);
  const data = loadYaml(file);
  const ok = validate(data);
  if (ok) {
    console.log(`  atu.yaml: OK`);
    return { ok: true, count: 1 };
  } else {
    console.log(`  atu.yaml: FAIL`);
    console.log(fmtErrors(validate.errors, file));
    return { ok: false, count: 1 };
  }
}

function validateCorpus() {
  const file = path.join(GOLD, "corpus.yaml");
  if (!fs.existsSync(file)) {
    console.log("  corpus.yaml: (not yet present — skipping)");
    return { ok: true, count: 0 };
  }
  const schema = loadSchema("corpus.schema.json");
  const validate = ajv.compile(schema);
  const data = loadYaml(file);
  const ok = validate(data);
  if (ok) {
    console.log(`  corpus.yaml: OK`);
    return { ok: true, count: 1 };
  } else {
    console.log(`  corpus.yaml: FAIL`);
    console.log(fmtErrors(validate.errors, file));
    return { ok: false, count: 1 };
  }
}

function validateTales() {
  const taleFiles = globSync(path.join(GOLD, "tales", "*.yaml"));
  if (taleFiles.length === 0) {
    console.log("  tales/*.yaml: (none yet — skipping)");
    return { ok: true, count: 0, failed: 0 };
  }
  const schema = loadSchema("tale.schema.json");
  const validate = ajv.compile(schema);

  let okCount = 0;
  let failCount = 0;
  const failures = [];
  for (const f of taleFiles) {
    const data = loadYaml(f);
    const ok = validate(data);
    if (ok) {
      okCount++;
    } else {
      failCount++;
      failures.push({ file: f, errors: [...validate.errors] });
    }
  }
  console.log(`  tales/*.yaml: ${okCount} OK, ${failCount} FAIL  (total ${taleFiles.length})`);
  for (const f of failures) {
    console.log(`    ${path.relative(ROOT, f.file)}:`);
    console.log(fmtErrors(f.errors, f.file));
  }
  return { ok: failCount === 0, count: taleFiles.length, failed: failCount };
}

function main() {
  const target = process.argv[2];
  const targets = new Set(["ontology", "atu", "corpus", "tales"]);

  console.log("Validating gold YAML...");

  if (target && !targets.has(target)) {
    console.log(`  unknown target: ${target}`);
    console.log(`  expected one of: ${[...targets].join(", ")}`);
    process.exit(1);
  }

  let overallOk = true;

  if (!target || target === "ontology") {
    const r = validateOntology();
    overallOk = overallOk && r.ok;
  }
  if (!target || target === "atu") {
    const r = validateAtu();
    overallOk = overallOk && r.ok;
  }
  if (!target || target === "corpus") {
    const r = validateCorpus();
    overallOk = overallOk && r.ok;
  }
  if (!target || target === "tales") {
    const r = validateTales();
    overallOk = overallOk && r.ok;
  }

  console.log();
  console.log(overallOk ? "✓ all valid" : "✗ validation failed");
  process.exit(overallOk ? 0 : 1);
}

main();
