import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildValidators, semanticErrors, quoteErrors } from './validate.js';
import { priceForNeeds, report, MAX_BUNDLES } from './needs.js';

const { product, quote } = buildValidators();
const path = (p) => new URL(`../examples/${p}`, import.meta.url).pathname;
const load = (p) => JSON.parse(readFileSync(path(p), 'utf8'));
const alder = () => load('alder/product-comprehensive.json');
const birch = () => load('birch/product-comprehensive.json');
const { needs } = JSON.parse(readFileSync(new URL('fixtures/needs.json', import.meta.url), 'utf8'));
const breakdown = (d) => d.benefits.find((b) => b.code === 'breakdown_assistance');
const products = () => new Map([['example.alder.motor.comprehensive@3.1.0', { file: path('alder/product-comprehensive.json'), doc: alder() }]]);

test('schema rejects an unknown breakdown feature', () => {
  const d = alder();
  breakdown(d).optionalExtra.tiers[0].features = ['helicopter'];
  assert.equal(product(d), false);
});

test('schema rejects features on a benefit without a feature vocabulary', () => {
  const d = alder();
  d.benefits.find((b) => b.code === 'fire').features = ['roadside_assistance'];
  assert.equal(product(d), false);
  const e = alder();
  e.benefits.find((b) => b.code === 'motor_legal_expenses').optionalExtra.tiers = [{ id: 't', name: 'T', features: ['home_start'] }];
  assert.equal(product(e), false);
});

test('schema rejects a bundle containing an unknown benefit code', () => {
  const d = alder();
  d.bundles[0].contains[0].code = 'free_pizza';
  assert.equal(product(d), false);
});

test('validator flags bundles built from things that are not optional extras', () => {
  const d = alder();
  d.bundles[0].contains.push({ code: 'fire' }, { code: 'breakdown_assistance', tier: 'gold' }, { code: 'breakdown_assistance' });
  const errors = semanticErrors(d).errors.join('\n');
  assert.match(errors, /"fire" is not an optional extra/);
  assert.match(errors, /tier "gold" is not a tier/);
  assert.match(errors, /has tiers in the product, so a tier is required/);
});

test('validator flags quote bundles and untiered extras the product does not offer', () => {
  const q = load('alder/quote.json');
  q.bundles.push({ id: 'mystery-pack', price: { amount: '1', currency: 'GBP' }, selected: false });
  q.optionalExtras.push({ code: 'breakdown_assistance', price: { amount: '1', currency: 'GBP' }, selected: false });
  assert.ok(quote(q));
  const errors = quoteErrors(q, products()).join('\n');
  assert.match(errors, /"mystery-pack" is not a bundle/);
  assert.match(errors, /so a tier is required/);
});

test('needs pricing reverses the headline order in the examples', () => {
  const a = priceForNeeds(needs, alder(), load('alder/quote.json'));
  const b = priceForNeeds(needs, birch(), load('birch/quote.json'));
  assert.equal(a.headline.amount, '612.48');
  assert.equal(b.headline.amount, '529.00');
  assert.equal(a.base.amount, '587.49');
  assert.deepEqual(a.extras.map((e) => e.item), ['motor_legal_expenses', 'breakdown_assistance (national-home)']);
  assert.equal(a.total.amount, '697.47');
  assert.deepEqual(b.included, ['motor_legal_expenses']);
  assert.equal(b.total.amount, '703.98');
  assert.deepEqual([a.unmet, b.unmet], [[], []]);
});

test('needs pricing picks a bundle when it is cheaper than the parts', () => {
  const want = [
    { code: 'motor_legal_expenses' },
    { code: 'key_replacement' },
    { code: 'breakdown_assistance', features: ['national_recovery'] },
  ];
  const r = priceForNeeds(want, alder(), load('alder/quote.json'));
  assert.deepEqual(r.extras.map((e) => e.item), ['bundle plus-pack']);
  assert.equal(r.total.amount, '687.48');
});

test('needs pricing does not use a bundle whose tier lacks a needed feature', () => {
  const want = [{ code: 'motor_legal_expenses' }, { code: 'key_replacement' }, { code: 'breakdown_assistance', features: ['home_start'] }];
  const r = priceForNeeds(want, alder(), load('alder/quote.json'));
  assert.ok(!r.extras.some((e) => e.item === 'bundle plus-pack'));
});

test('needs pricing reports needs no option can meet', () => {
  const r = priceForNeeds([{ code: 'gap_insurance' }, { code: 'breakdown_assistance', features: ['european_breakdown'] }], birch(), load('birch/quote.json'));
  assert.deepEqual(r.unmet, ['gap_insurance', 'breakdown_assistance with european_breakdown']);
});

test('needs on one extra are met by a single tier with every feature', () => {
  const want = [
    { code: 'breakdown_assistance', features: ['home_start'] },
    { code: 'breakdown_assistance', features: ['european_breakdown'] },
  ];
  const r = priceForNeeds(want, alder(), load('alder/quote.json'));
  assert.deepEqual(r.extras.map((e) => e.item), ['breakdown_assistance (european)']);
  assert.equal(r.total.amount, '717.48');
});

test('needs pricing refuses a quote whose selected extras exceed the premium', () => {
  const q = load('alder/quote.json');
  q.premium.annual.amount = '10.00';
  assert.throws(() => priceForNeeds(needs, alder(), q), /cost more than the premium/);
});

test('validator flags an extra bought twice or offered twice', () => {
  const check = (mutate, pattern) => {
    const q = load('alder/quote.json');
    mutate(q);
    assert.match(quoteErrors(q, products()).join('\n'), pattern);
  };
  check((q) => { q.bundles[0].selected = true; }, /"motor_legal_expenses" is selected more than once \(on its own, bundle "plus-pack"\)/);
  check((q) => { q.optionalExtras.filter((x) => x.code === 'breakdown_assistance').slice(0, 2).forEach((x) => { x.selected = true; }); },
    /"breakdown_assistance" is selected more than once/);
  check((q) => { q.optionalExtras.push({ ...q.optionalExtras[0] }); }, /offers "motor_legal_expenses\/" more than once/);
  check((q) => { q.bundles.push({ ...q.bundles[0] }); }, /"plus-pack" appears more than once/);
});

test('validator flags a bundle that repeats an extra', () => {
  const d = alder();
  d.bundles[0].contains.push({ code: 'breakdown_assistance', tier: 'european' });
  assert.match(semanticErrors(d).errors.join(), /repeats "breakdown_assistance"/);
});

test('needs pricing honours quote benefit overrides', () => {
  const q = load('birch/quote.json');
  q.benefitOverrides = [{ code: 'courtesy_car', availability: 'included' }];
  const r = priceForNeeds([{ code: 'courtesy_car' }], birch(), q);
  assert.deepEqual(r.included, ['courtesy_car']);
  assert.equal(r.total.amount, '529.00');
});

test('needs pricing refuses a quote paired with a different product', () => {
  assert.throws(() => priceForNeeds(needs, birch(), load('alder/quote.json')), /is for example\.alder\.motor\.comprehensive@3\.1\.0, not example\.birch/);
});

test('schema rejects a quote that leaves tax out of its premium', () => {
  const q = load('alder/quote.json');
  q.premium.taxIncluded = false;
  assert.equal(quote(q), false);
  assert.throws(() => priceForNeeds(needs, alder(), q), /does not include tax/);
});

test('ranking refuses to compare quotes in different currencies', () => {
  const a = priceForNeeds(needs, alder(), load('alder/quote.json'));
  const b = priceForNeeds(needs, birch(), load('birch/quote.json'));
  b.total = { amount: '1.00', currency: 'EUR' };
  assert.throws(() => report([a, b]), /different currencies: GBP, EUR/);
});

test('needs pricing never buys an extra both in a bundle and on its own', () => {
  const q = load('alder/quote.json');
  q.bundles[0].price.amount = '20.00';
  const want = [{ code: 'motor_legal_expenses' }, { code: 'breakdown_assistance', features: ['home_start'] }];
  const r = priceForNeeds(want, alder(), q);
  const bought = r.extras.map((e) => e.item);
  assert.ok(!(bought.includes('bundle plus-pack') && bought.some((i) => i.startsWith('breakdown_assistance'))), bought.join(', '));
  assert.deepEqual(r.unmet, []);
});

test('needs pricing caps bundles at the schema limit', () => {
  const p = alder();
  const q = load('alder/quote.json');
  for (let i = 0; i < MAX_BUNDLES; i++) {
    const id = `noise-${i}`;
    p.bundles.push({ id, name: 'Noise', contains: [{ code: 'key_replacement' }, { code: 'motor_legal_expenses' }] });
    q.bundles.push({ id, price: { amount: '1.00', currency: 'GBP' }, selected: false });
  }
  assert.throws(() => priceForNeeds(needs, p, q), /more than 16 bundles/);
  p.bundles.splice(1, 1);
  q.bundles.splice(1, 1);
  const r = priceForNeeds([{ code: 'breakdown_assistance', features: ['home_start'] }], p, q);
  assert.deepEqual(r.unmet, []);
  assert.ok(!r.extras.some((e) => e.item.startsWith('bundle noise')));
  assert.equal(product(p), true);
  assert.equal(quote(q), true);
});

test('needs results show the accidental damage excess beside the price', () => {
  const a = priceForNeeds(needs, alder(), load('alder/quote.json'));
  const b = priceForNeeds(needs, birch(), load('birch/quote.json'));
  assert.equal(b.excess.amount, '500.00');
  assert.match(report([a, b]), /accidental damage excess £500\.00/);
});

test('validator rejects an included benefit with a zero limit', () => {
  const d = alder();
  const b = d.benefits.find((x) => x.availability === 'included');
  b.limits = [{ amount: { amount: '0', currency: 'GBP' }, basis: 'per_claim' }];
  assert.match(semanticErrors(d).errors.join('\n'), /included with a limit of zero/);
  const u = alder();
  u.benefits.find((x) => x.availability === 'included').limits = [{ units: { value: 0, unit: 'days' }, basis: 'per_claim' }];
  assert.equal(product(u), false);
  u.benefits.find((x) => x.availability === 'included').limits[0].units.value = 1;
  assert.equal(product(u), true, JSON.stringify(product.errors));
});
