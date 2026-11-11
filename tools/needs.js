#!/usr/bin/env node
// Prices each quote for the cover a customer needs: the cheapest mix of included cover,
// optional extras, tiers and bundles that meets every need, so totals compare like for like.
// Usage: node tools/needs.js <needs.json> <product.json> <quote.json> [<product.json> <quote.json>...]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { money } from './compare.js';
import { sha256, SCALE, toUnits, validateFiles } from './validate.js';

// Matches the schema's maxItems, so trying every subset of bundles stays fast.
export const MAX_BUNDLES = 16;

const fromUnits = (units, currency) => {
  if (units < 0n) throw new RangeError('amount is negative');
  const whole = units / SCALE;
  const fraction = (units % SCALE).toString().padStart(4, '0').replace(/0{1,2}$/, '').padEnd(2, '0');
  return { amount: `${whole}.${fraction}`, currency };
};

// Needs on the same code are one purchase: a single tier must carry every feature asked for.
export function mergeNeeds(needs) {
  const byCode = new Map();
  for (const n of needs) {
    const merged = byCode.get(n.code) ?? { code: n.code };
    if (n.features) merged.features = [...new Set([...(merged.features ?? []), ...n.features])];
    byCode.set(n.code, merged);
  }
  return [...byCode.values()];
}

const hasFeatures = (features, need) => (need.features ?? []).every((f) => (features ?? []).includes(f));

function featuresOf(product, code, tier) {
  const b = product.benefits.find((x) => x.code === code);
  return tier ? b?.optionalExtra?.tiers?.find((t) => t.id === tier)?.features : b?.features;
}

// The quote's benefitOverrides replace the product's entries with the same code.
function includedBenefit(product, quote, code) {
  const b = (quote.benefitOverrides ?? []).find((x) => x.code === code) ?? product.benefits.find((x) => x.code === code);
  return b?.availability === 'included' ? b : null;
}

// Expects a quote that passes tools/validate.js against this product: in particular, no selected
// extra also sits inside a selected bundle, so subtracting every selected item gives the base price.
export function priceForNeeds(rawNeeds, product, quote) {
  const pin = `${quote.product.id}@${quote.product.version}`;
  if (pin !== `${product.id}@${product.version}`) {
    throw new Error(`quote ${quote.reference} is for ${pin}, not ${product.id}@${product.version}`);
  }
  if (quote.premium.taxIncluded !== true) throw new RangeError(`quote ${quote.reference} does not include tax in its premium`);
  const needs = mergeNeeds(rawNeeds);
  const currency = quote.premium.annual.currency;
  const selectedCost = [
    ...(quote.optionalExtras ?? []).filter((x) => x.selected),
    ...(quote.bundles ?? []).filter((x) => x.selected),
  ].reduce((sum, x) => sum + toUnits(x.price.amount), 0n);
  const base = toUnits(quote.premium.annual.amount) - selectedCost;
  if (base < 0n) throw new RangeError(`selected extras cost more than the premium on ${product.id}`);

  const included = [];
  const open = [];
  for (const need of needs) {
    const b = includedBenefit(product, quote, need.code);
    if (b && hasFeatures(b.features, need)) included.push(need);
    else open.push(need);
  }

  const extrasFor = (need) => (quote.optionalExtras ?? [])
    .filter((x) => x.code === need.code && hasFeatures(featuresOf(product, x.code, x.tier), need))
    .map((x) => ({ label: x.tier ? `${x.code} (${x.tier})` : x.code, cost: toUnits(x.price.amount) }));
  if ((quote.bundles ?? []).length > MAX_BUNDLES) {
    throw new RangeError(`quote ${quote.reference} offers more than ${MAX_BUNDLES} bundles`);
  }
  const bundleMeets = (bundle, need) => bundle.contains.some(
    (c) => c.code === need.code && hasFeatures(featuresOf(product, c.code, c.tier), need),
  );
  // A bundle that meets no open need can only add cost, so it is never worth trying.
  const bundles = (quote.bundles ?? []).map((q) => ({
    label: `bundle ${q.id}`,
    cost: toUnits(q.price.amount),
    contains: product.bundles?.find((b) => b.id === q.id)?.contains ?? [],
  })).filter((b) => open.some((need) => bundleMeets(b, need)));

  // Try every subset of bundles and buy the cheapest single extra for each need left.
  let best = null;
  for (let mask = 0; mask < 2 ** bundles.length; mask++) {
    const chosen = bundles.filter((_, i) => mask & (1 << i));
    // Two bundles that share an extra would buy it twice, which a valid quote cannot select.
    const codes = chosen.flatMap((b) => b.contains.map((c) => c.code));
    if (new Set(codes).size < codes.length) continue;
    const picks = chosen.map(({ label, cost }) => ({ label, cost }));
    const unmet = [];
    for (const need of open) {
      if (chosen.some((b) => bundleMeets(b, need))) continue;
      // A chosen bundle already carries this extra at a tier that falls short, and buying a
      // second tier alongside it would buy the extra twice, so this subset cannot meet the need.
      if (chosen.some((b) => b.contains.some((c) => c.code === need.code))) {
        unmet.push(need);
        continue;
      }
      const cheapest = extrasFor(need).sort((a, b) => (a.cost < b.cost ? -1 : a.cost > b.cost ? 1 : 0))[0];
      if (cheapest) picks.push(cheapest);
      else unmet.push(need);
    }
    const total = picks.reduce((s, p) => s + p.cost, base);
    const better = !best || unmet.length < best.unmet.length || (unmet.length === best.unmet.length && total < best.total);
    if (better) best = { picks, unmet, total };
  }

  // The fixed excess on an accidental damage claim: compulsory plus voluntary, before any
  // circumstance-specific additional excess. Shown beside the price so a higher excess cannot hide.
  const excessTerms = (quote.excesses ?? [])
    .filter((e) => (e.type === 'compulsory' || e.type === 'voluntary') && !e.drivers
      && (!e.appliesTo || e.appliesTo.includes('accidental_damage')));
  const excess = excessTerms.reduce((sum, e) => sum + toUnits(e.amount.amount), 0n);

  return {
    product: product.id,
    headline: quote.premium.annual,
    excess: excessTerms.length ? fromUnits(excess, currency) : null,
    base: fromUnits(base, currency),
    included: included.map((n) => n.code),
    extras: best.picks.map((p) => ({ item: p.label, price: fromUnits(p.cost, currency) })),
    unmet: best.unmet.map((n) => (n.features ? `${n.code} with ${n.features.join(', ')}` : n.code)),
    total: fromUnits(best.total, currency),
  };
}

export function report(results) {
  const found = new Set(results.map((r) => r.total.currency));
  if (found.size > 1) throw new RangeError(`cannot rank quotes in different currencies: ${[...found].join(', ')}`);
  const byTotal = (a, b) => {
    const d = toUnits(a.total.amount) - toUnits(b.total.amount);
    return d > 0n ? 1 : d < 0n ? -1 : 0;
  };
  const ranked = [...results].sort((a, b) => a.unmet.length - b.unmet.length || byTotal(a, b));
  return ranked.map((r, i) => [
    `${i + 1}. ${r.product}: ${r.unmet.length ? 'does not meet every need' : money(r.total)}`,
    `   headline ${money(r.headline)}, without extras ${money(r.base)}, accidental damage excess ${r.excess ? money(r.excess) : 'not stated'}`,
    ...(r.included.length ? [`   already included: ${r.included.join(', ')}`] : []),
    ...r.extras.map((e) => `   + ${e.item} ${money(e.price)}`),
    ...(r.unmet.length ? [`   not available: ${r.unmet.join('; ')}`] : []),
  ].join('\n')).join('\n\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [needsFile, ...pairs] = process.argv.slice(2);
  const read = (f) => JSON.parse(readFileSync(f, 'utf8'));
  const { needs } = read(needsFile);
  const results = [];
  if (pairs.length === 0 || pairs.length % 2) {
    console.error('usage: node tools/needs.js <needs.json> <product.json> <quote.json> [<product.json> <quote.json>...]');
    process.exit(2);
  }
  for (let i = 0; i < pairs.length; i += 2) {
    const quote = read(pairs[i + 1]);
    if (sha256(pairs[i]) !== quote.product.sha256) {
      console.error(`${pairs[i + 1]}: product.sha256 does not match ${pairs[i]}`);
      process.exit(1);
    }
    // Pricing is only meaningful for a pair that conforms together, not just one by one.
    for (const [file, { errors }] of validateFiles([pairs[i], pairs[i + 1]])) {
      for (const e of errors) console.error(`${file}: ${e}`);
      if (errors.length) process.exit(1);
    }
    results.push(priceForNeeds(needs, read(pairs[i]), quote));
  }
  console.log(report(results));
}
