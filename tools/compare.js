#!/usr/bin/env node
// Prints a Markdown table comparing OIPS product documents benefit by benefit.
// Usage: node tools/compare.js <product.json> <product.json> [...]
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCHEMA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'schema', 'v0.0.1');
const motor = JSON.parse(readFileSync(join(SCHEMA_DIR, 'motor.schema.json'), 'utf8'));
export const VOCABULARY = motor.$defs.benefitCode.anyOf.map((c) => c.const);

const AVAILABILITY = {
  included: 'Yes',
  optional_extra: 'Extra',
  not_included: 'No',
  not_stated: 'Not stated',
};

const BASIS = {
  per_claim: 'per claim',
  per_incident: 'per incident',
  per_person: 'per person',
  per_item: 'per item',
  per_day: 'per day',
  per_policy_year: 'a year',
  aggregate: 'in total',
};

const words = (s) => (s ?? '').replaceAll('_', ' ');
const text = (t) => (typeof t === 'string' ? t : t ? Object.values(t)[0] : '');

// Formats from the decimal string so no precision is lost.
export function money({ amount, currency }) {
  const symbol = new Intl.NumberFormat('en-GB', { style: 'currency', currency })
    .formatToParts(0).find((p) => p.type === 'currency').value;
  const [whole, fraction] = amount.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${symbol}${grouped}${fraction ? `.${fraction.padEnd(2, '0')}` : ''}`;
}

const UNITS = { Y: 'year', M: 'month', W: 'week', D: 'day', H: 'hour', S: 'second' };
export function duration(iso) {
  const [date, time = ''] = iso.slice(1).split('T');
  const parts = [];
  for (const [part, isTime] of [[date, false], [time, true]]) {
    for (const [, n, u] of part.matchAll(/(\d+)([YMWDHS])/g)) {
      const unit = isTime && u === 'M' ? 'minute' : UNITS[u];
      parts.push(`${n} ${unit}${n === '1' ? '' : 's'}`);
    }
  }
  return parts.join(' ');
}

function limit(l) {
  let value;
  if (l.unlimited) value = 'unlimited';
  else if (l.marketValue) value = l.marketValueCap ? 'lower of market and declared value' : 'market value';
  else if (l.amount) value = money(l.amount);
  else if (l.units) value = `${l.units.value} ${l.units.unit}`;
  const per = l.marketValue || l.unlimited ? '' : ` ${BASIS[l.basis]}`;
  const within = l.maxDuration ? ` over ${duration(l.maxDuration)}` : '';
  return `${value}${per}${within}`;
}

function excess(e) {
  const when = text(e.condition) || words(e.conditionCode) || e.type;
  const on = e.appliesTo ? ` on ${e.appliesTo.map(words).join(', ')}` : '';
  return `${when} ${money(e.amount)}${on}`;
}

export function cell(benefit) {
  if (!benefit) return 'Not stated';
  const parts = [AVAILABILITY[benefit.availability]];
  const offer = benefit.optionalExtra;
  const prices = [offer?.indicativePrice, ...(offer?.tiers ?? []).map((t) => t.indicativePrice)].filter(Boolean);
  if (prices.length) {
    const lowest = prices.reduce((a, b) => (Number(b.amount) < Number(a.amount) ? b : a));
    parts[0] += ` (from ${money(lowest)})`;
  }
  if (benefit.coverBasis) parts.push(words(benefit.coverBasis));
  if (benefit.vehicleClass) parts.push(words(benefit.vehicleClass));
  if (benefit.guaranteed === false) parts.push('subject to availability');
  for (const l of benefit.limits ?? []) parts.push(limit(l));
  for (const t of offer?.tiers ?? []) {
    const ls = (t.limits ?? []).map(limit).join(', ');
    const fs = (t.features ?? []).map(words).join(', ');
    parts.push(`${text(t.name)}${fs ? ` [${fs}]` : ''}${ls ? `: ${ls}` : ''}`);
  }
  for (const e of benefit.excesses ?? []) parts.push(`excess: ${excess({ ...e, appliesTo: undefined })}`);
  if (benefit.territories) parts.push(benefit.territories.join(', '));
  if (benefit.qualifyingPeriod) parts.push(`within ${duration(benefit.qualifyingPeriod)}`);
  if (benefit.providedWhen?.length) parts.push(`only if ${benefit.providedWhen.map(words).join(', ')}`);
  for (const x of benefit.exclusions ?? []) parts.push(`excludes ${words(x.code) || text(x.summary)}`);
  return parts.filter(Boolean).join('; ');
}

// Publisher text must not break the table or inject markup into rendered Markdown.
const escape = (c) => String(c)
  .replace(/[\r\n]+/g, ' ')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('|', '\\|');

// One row per fee any of the products charges, so no fee is hidden by omission.
function feeRows(products) {
  const label = (f) => (f.code === 'other' ? text(f.label) || 'other fee' : words(f.code));
  const labels = [...new Set(products.flatMap((p) => (p.fees ?? []).map(label)))];
  return labels.map((l) => [`Fee: ${l}`, ...products.map((p) => {
    const found = (p.fees ?? []).filter((f) => label(f) === l);
    return found.length ? found.map((f) => money(f.amount)).join('; ') : 'Not stated';
  })]);
}

const terms = (list) => (list ?? []).map((t) => (t.code && t.code !== 'other' ? words(t.code) : text(t.summary))).join('; ') || 'None stated';

export function compare(products) {
  const header = ['', ...products.map((p) => text(p.name))];
  const excessesOf = (p, type) => (p.excesses ?? []).filter((e) => e.type === type).map(excess).join('; ') || 'None stated';
  const rows = [
    ['Cover level', ...products.map((p) => words(p.motor?.coverLevel))],
    ['Write-off settlement', ...products.map((p) => words(p.motor?.writeOffSettlement) || 'Not stated')],
    ['Compulsory excess', ...products.map((p) => excessesOf(p, 'compulsory'))],
    ['Voluntary excess', ...products.map((p) => excessesOf(p, 'voluntary'))],
    ['Additional excesses', ...products.map((p) => excessesOf(p, 'additional'))],
    ['Additional excesses combine', ...products.map((p) => words(p.excessStacking))],
    ...VOCABULARY.map((code) => [words(code), ...products.map((p) => cell(p.benefits.find((b) => b.code === code)))]),
    ['General exclusions', ...products.map((p) => terms(p.exclusions))],
    ['Conditions', ...products.map((p) => terms(p.conditions))],
    ...feeRows(products),
    ['Refund after cooling off', ...products.map((p) => words(p.cancellation.refundBasisAfterCoolingOff) || 'Not stated')],
  ];
  const line = (r) => `| ${r.map(escape).join(' | ')} |`;
  return [line(header), line(header.map(() => '---')), ...rows.map(line)].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const products = process.argv.slice(2).map((f) => JSON.parse(readFileSync(f, 'utf8')));
  console.log(compare(products));
}
