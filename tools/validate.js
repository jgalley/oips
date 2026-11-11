#!/usr/bin/env node
// Validates OIPS documents against the schema, plus checks JSON Schema cannot express.
// Usage: node tools/validate.js [--lenient] <file-or-directory>...
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const SCHEMA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'schema', 'v0.0.1');
const SCHEMA_BASE = 'https://jgalley.github.io/oips/schema/v0.0.1/';
const motor = JSON.parse(readFileSync(join(SCHEMA_DIR, 'motor.schema.json'), 'utf8'));
const VOCABULARY = { 'motor.private_car': motor.$defs.benefitCode.anyOf.map((c) => c.const) };

// A reader's copy of a schema: unknown fields are allowed and code lists are open, so a
// document from a later version still reads, with unknown codes treated as not_stated.
function lenient(node) {
  if (Array.isArray(node)) return node.map(lenient);
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === 'additionalProperties' && v === false) continue;
    if (k === 'oips') {
      out.oips = { $ref: 'common.schema.json#/$defs/semver' };
      continue;
    }
    if (k === 'enum' && v.every((x) => typeof x === 'string')) continue;
    if (k === 'anyOf' && v.every((x) => x && typeof x.const === 'string')) {
      out.type = 'string';
      continue;
    }
    out[k] = lenient(v);
  }
  return out;
}

// Strict by default, for publishers checking their own documents. Pass lenient for readers.
export function buildValidators({ lenient: forReaders = false } = {}) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  for (const f of readdirSync(SCHEMA_DIR).filter((n) => n.endsWith('.schema.json'))) {
    const schema = JSON.parse(readFileSync(join(SCHEMA_DIR, f), 'utf8'));
    ajv.addSchema(forReaders ? lenient(schema) : schema);
  }
  return {
    product: ajv.getSchema(`${SCHEMA_BASE}product.schema.json`),
    quote: ajv.getSchema(`${SCHEMA_BASE}quote.schema.json`),
    index: ajv.getSchema(`${SCHEMA_BASE}index.schema.json`),
  };
}

// Exact arithmetic on decimal strings, in units of 1/10000.
export const SCALE = 10000n;
export const toUnits = (amount) => {
  const [whole, fraction = ''] = amount.split('.');
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(4, '0'));
};

export function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

// Visits every object outside `extensions`, which is publisher data the standard does not govern.
function walk(node, path, visit) {
  if (Array.isArray(node)) node.forEach((n, i) => walk(n, `${path}[${i}]`, visit));
  else if (node && typeof node === 'object') {
    visit(node, path);
    for (const [k, v] of Object.entries(node)) if (k !== 'extensions') walk(v, `${path}.${k}`, visit);
  }
}

function currencies(doc) {
  const found = new Set();
  walk(doc, '$', (n) => { if (typeof n.currency === 'string' && typeof n.amount === 'string') found.add(n.currency); });
  return found;
}

// True when timestamp or date a is later than b. Parses, so UTC offsets are respected.
const later = (a, b) => a != null && b != null && Date.parse(a) > Date.parse(b);

// Rules that need the whole document. Call only on schema-valid documents.
export function semanticErrors(doc) {
  const errors = [];
  const warnings = [];
  const currencySet = currencies(doc);
  if (currencySet.size > 1) errors.push(`mixes currencies: ${[...currencySet].join(', ')}`);

  if (doc.documentType === 'product') {
    const docIds = new Set(doc.documents.map((d) => d.id));
    const seen = new Set();
    for (const b of doc.benefits) {
      if (seen.has(b.code)) errors.push(`benefit code "${b.code}" appears more than once`);
      seen.add(b.code);
    }
    const missing = (VOCABULARY[doc.lineOfBusiness] ?? []).filter((c) => !seen.has(c));
    if (missing.length) warnings.push(`benefit codes not listed (read as not_stated): ${missing.join(', ')}`);
    walk(doc, '$', (n, path) => {
      (Array.isArray(n.clauses) ? n.clauses : []).forEach((c, i) => {
        if (!docIds.has(c.document)) errors.push(`${path}.clauses[${i}] refers to unknown document "${c.document}"`);
      });
    });
    if (later(doc.effective.from, doc.effective.to)) errors.push('effective.from is after effective.to');
    const d = doc.motor?.drivers;
    if (d?.minAge != null && d?.maxAge != null && d.minAge > d.maxAge) errors.push('motor.drivers.minAge is above maxAge');
    doc.benefits.forEach((b) => {
      const tierIds = new Set();
      (b.optionalExtra?.tiers ?? []).forEach((t) => {
        if (tierIds.has(t.id)) errors.push(`benefit "${b.code}" tier "${t.id}" appears more than once`);
        tierIds.add(t.id);
      });
    });
    const bundleIds = new Set();
    (doc.bundles ?? []).forEach((b, i) => {
      if (bundleIds.has(b.id)) errors.push(`bundles[${i}] id "${b.id}" appears more than once`);
      bundleIds.add(b.id);
      const codes = new Set();
      b.contains.forEach((x, j) => {
        const e = extraError(doc, x);
        if (e) errors.push(`bundles[${i}].contains[${j}] ${e}`);
        if (codes.has(x.code)) errors.push(`bundles[${i}].contains[${j}] repeats "${x.code}"`);
        codes.add(x.code);
      });
    });
  }

  if (doc.documentType === 'quote') {
    if (later(doc.issuedAt, doc.validUntil)) errors.push('issuedAt is after validUntil');
    if (doc.cover.startDate >= doc.cover.endDate) errors.push('cover.startDate is not before endDate');
    const overridden = new Set();
    (doc.benefitOverrides ?? []).forEach((b, i) => {
      if (overridden.has(b.code)) errors.push(`benefitOverrides[${i}] "${b.code}" appears more than once`);
      overridden.add(b.code);
    });
    const refs = new Set((doc.risk?.motor?.drivers ?? []).map((x) => x.ref));
    walk(doc, "$", (n, path) => {
      if (Array.isArray(n.drivers) && "amount" in n) n.drivers.forEach((r) => {
        if (!refs.has(r)) errors.push(`${path} refers to unknown driver "${r}"`);
      });
    });
  }
  return { errors, warnings };
}

// Why { code, tier } is not a purchasable optional extra of the product, or null if it is.
function extraError(product, { code, tier }) {
  const b = product.benefits.find((x) => x.code === code && x.availability === 'optional_extra');
  if (!b) return `"${code}" is not an optional extra in the product`;
  const tiers = b.optionalExtra.tiers ?? [];
  if (tier && !tiers.some((t) => t.id === tier)) return `tier "${tier}" is not a tier of "${code}" in the product`;
  if (!tier && tiers.length) return `"${code}" has tiers in the product, so a tier is required`;
  return null;
}

// Checks a quote against its product, when that product is in the same run.
export function quoteErrors(quote, productsByKey) {
  const local = productsByKey.get(`${quote.product.id}@${quote.product.version}`);
  if (!local) return [];
  const errors = [];
  const actual = sha256(local.file);
  if (actual !== quote.product.sha256) {
    errors.push(`product.sha256 does not match ${local.file} (expected ${quote.product.sha256}, got ${actual})`);
  }
  const p = local.doc;
  if (p.lineOfBusiness !== quote.lineOfBusiness) errors.push(`lineOfBusiness differs from product (${p.lineOfBusiness})`);
  const offered = new Set();
  (quote.optionalExtras ?? []).forEach((x, i) => {
    const e = extraError(p, x);
    if (e) errors.push(`optionalExtras[${i}] ${e}`);
    const key = `${x.code}/${x.tier ?? ''}`;
    if (offered.has(key)) errors.push(`optionalExtras[${i}] offers "${key}" more than once`);
    offered.add(key);
  });
  const productBundles = new Map((p.bundles ?? []).map((b) => [b.id, b]));
  const quoted = new Set();
  (quote.bundles ?? []).forEach((b, i) => {
    if (!productBundles.has(b.id)) errors.push(`bundles[${i}] "${b.id}" is not a bundle in the product`);
    if (quoted.has(b.id)) errors.push(`bundles[${i}] "${b.id}" appears more than once`);
    quoted.add(b.id);
  });
  // The premium is ambiguous if one extra is bought twice, e.g. two breakdown tiers, or alone and in a bundle.
  const bought = new Map();
  const buy = (code, from) => bought.set(code, [...(bought.get(code) ?? []), from]);
  (quote.optionalExtras ?? []).filter((x) => x.selected).forEach((x) => buy(x.code, x.tier ? `tier "${x.tier}"` : 'on its own'));
  (quote.bundles ?? []).filter((b) => b.selected).forEach((b) => {
    (productBundles.get(b.id)?.contains ?? []).forEach((c) => buy(c.code, `bundle "${b.id}"`));
  });
  for (const [code, from] of bought) {
    if (from.length > 1) errors.push(`"${code}" is selected more than once (${from.join(', ')})`);
  }
  const selected = [
    ...(quote.optionalExtras ?? []).filter((x) => x.selected),
    ...(quote.bundles ?? []).filter((b) => b.selected),
  ].reduce((sum, x) => sum + toUnits(x.price.amount), 0n);
  if (selected > toUnits(quote.premium.annual.amount)) errors.push('selected extras and bundles cost more than premium.annual');
  (quote.benefitOverrides ?? []).forEach((b) => {
    if (b.availability !== 'optional_extra' && (quote.optionalExtras ?? []).some((x) => x.code === b.code)) {
      errors.push(`"${b.code}" is offered as an optional extra but overridden to ${b.availability}`);
    }
  });
  const docIds = new Set(p.documents.map((d) => d.id));
  walk(quote, '$', (n, path) => {
    (Array.isArray(n.clauses) ? n.clauses : []).forEach((c, i) => {
      if (!docIds.has(c.document)) errors.push(`${path}.clauses[${i}] refers to unknown product document "${c.document}"`);
    });
  });
  const [pc] = currencies(p);
  const [qc] = currencies(quote);
  if (pc && qc && pc !== qc) errors.push(`quote currency ${qc} differs from product currency ${pc}`);
  return errors;
}

// Checks index entries against products in the same run.
export function indexErrors(index, productsByKey) {
  const errors = [];
  index.products.forEach((e, i) => {
    const local = productsByKey.get(`${e.id}@${e.version}`);
    if (local && sha256(local.file) !== e.sha256) errors.push(`products[${i}] sha256 does not match ${local.file}`);
    if (later(e.effectiveFrom, e.effectiveTo)) errors.push(`products[${i}] effectiveFrom is after effectiveTo`);
  });
  return errors;
}

export function validateFiles(files, options) {
  const validators = buildValidators(options);
  const results = new Map();
  const parsed = new Map();
  for (const file of files) {
    try {
      parsed.set(file, JSON.parse(readFileSync(file, 'utf8')));
    } catch (e) {
      results.set(file, { errors: [`not valid JSON: ${e.message}`], warnings: [] });
    }
  }
  const productsByKey = new Map();
  for (const [file, doc] of parsed) {
    const type = doc !== null && typeof doc === "object" ? doc.documentType : undefined;
    const validate = Object.hasOwn(validators, type) ? validators[type] : undefined;
    if (!validate) {
      results.set(file, { errors: [`unknown documentType "${type}"`], warnings: [] });
    } else if (!validate(doc)) {
      results.set(file, { errors: validate.errors.map((e) => `${e.instancePath || '$'} ${e.message}`), warnings: [] });
    } else {
      results.set(file, semanticErrors(doc));
      if (doc.documentType === 'product') {
        const key = `${doc.id}@${doc.version}`;
        const earlier = productsByKey.get(key);
        if (!earlier) productsByKey.set(key, { file, doc });
        else if (earlier.file !== file && sha256(earlier.file) !== sha256(file)) {
          const clash = `${key} is also published, with different bytes, in `;
          results.get(file).errors.push(clash + earlier.file);
          results.get(earlier.file).errors.push(clash + file);
        }
      }
    }
  }
  for (const [file, doc] of parsed) {
    const r = results.get(file);
    if (r.errors.length) continue;
    if (doc.documentType === 'quote') {
      if (productsByKey.has(`${doc.product.id}@${doc.product.version}`)) r.errors.push(...quoteErrors(doc, productsByKey));
      else r.warnings.push(`product ${doc.product.id}@${doc.product.version} not in this run, so its hash, extras and bundles were not checked`);
    }
    if (doc.documentType === 'index') r.errors.push(...indexErrors(doc, productsByKey));
  }
  return results;
}

function collect(paths) {
  return paths.flatMap((p) => {
    try {
      statSync(p);
    } catch {
      console.error(`not found: ${p}`);
      process.exit(1);
    }
    return statSync(p).isDirectory()
      ? collect(readdirSync(p).map((n) => join(p, n)))
      : p.endsWith('.json') ? [p] : [];
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const files = collect(args.filter((a) => a !== '--lenient'));
  const results = validateFiles(files, { lenient: args.includes('--lenient') });
  let failed = 0;
  for (const [file, { errors, warnings }] of results) {
    if (errors.length) failed++;
    console.log(`${errors.length ? 'FAIL' : 'ok  '} ${file}`);
    for (const e of errors) console.log(`  error: ${e}`);
    for (const w of warnings) console.log(`  warning: ${w}`);
  }
  console.log(`\n${files.length} checked, ${failed} failed`);
  process.exit(failed || files.length === 0 ? 1 : 0);
}
