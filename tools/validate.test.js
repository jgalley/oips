import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildValidators, semanticErrors, quoteErrors, indexErrors, validateFiles } from './validate.js';
import { compare, money, duration, VOCABULARY } from './compare.js';

const { product, quote, index } = buildValidators();
const path = (p) => new URL(`../examples/${p}`, import.meta.url).pathname;
const load = (p) => JSON.parse(readFileSync(path(p), 'utf8'));
const alder = () => load('alder/product-comprehensive.json');
const birch = () => load('birch/product-comprehensive.json');
const aQuote = () => load('alder/quote.json');
const localProducts = () => new Map([['example.alder.motor.comprehensive@3.1.0', { file: path('alder/product-comprehensive.json'), doc: alder() }]]);
const benefit = (d, code) => d.benefits.find((b) => b.code === code);

test('examples are valid with no warnings', () => {
  for (const [v, d] of [[product, alder()], [product, birch()], [quote, aQuote()], [index, load('alder/well-known-oips.json')]]) {
    assert.ok(v(d), JSON.stringify(v.errors));
    assert.deepEqual(semanticErrors(d), { errors: [], warnings: [] });
  }
  assert.deepEqual(quoteErrors(aQuote(), localProducts()), []);
  assert.deepEqual(indexErrors(load('alder/well-known-oips.json'), localProducts()), []);
});

test('examples list every motor benefit code', () => {
  for (const p of [alder(), birch()]) assert.deepEqual(p.benefits.map((b) => b.code).sort(), [...VOCABULARY].sort());
});

const rejects = (validator, load, name, mutate) =>
  test(`schema rejects ${name}`, () => {
    const doc = load();
    mutate(doc);
    assert.equal(validator(doc), false);
  });

rejects(product, alder, 'an unknown motor benefit code', (d) => { d.benefits[0].code = 'free_pizza'; });
rejects(product, alder, 'an unknown providedWhen code', (d) => { benefit(d, 'courtesy_car').providedWhen = ['full_moon']; });
rejects(product, alder, 'an unknown exclusion code', (d) => { d.exclusions[0].code = 'bad_vibes'; });
rejects(product, alder, 'an unknown condition code', (d) => { d.conditions[0].code = 'whatever'; });
rejects(product, alder, 'an unknown code in excess appliesTo', (d) => { d.excesses[0].appliesTo = ['free_pizza']; });
rejects(product, alder, 'an unknown code in a benefit excess', (d) => { benefit(d, 'windscreen_glass').excesses[0].appliesTo = ['nope']; });
rejects(product, alder, 'an unknown code in condition appliesTo', (d) => { d.conditions[0].appliesTo = ['nope']; });
rejects(product, alder, 'money as a float', (d) => { d.excesses[0].amount.amount = 250.5; });
rejects(product, alder, 'negative money', (d) => { d.excesses[0].amount.amount = '-250'; });
rejects(product, alder, 'a lowercase currency', (d) => { d.excesses[0].amount.currency = 'gbp'; });
rejects(product, alder, 'a limit with two values', (d) => { d.benefits[0].limits[0].amount = { amount: '1', currency: 'GBP' }; });
rejects(product, alder, 'marketValueCap without marketValue', (d) => { d.benefits[1].limits[0].marketValueCap = 'declared_value'; });
rejects(product, alder, 'an optional extra without offer details', (d) => { delete benefit(d, 'key_replacement').optionalExtra; });
rejects(product, alder, 'an included benefit with optional extra details', (d) => { benefit(d, 'fire').optionalExtra = {}; });
rejects(product, alder, 'a not_included benefit with limits', (d) => { benefit(d, 'misfuelling').limits = [{ basis: 'per_claim', marketValue: true }]; });
rejects(product, alder, 'a not_stated benefit with conditions', (d) => { benefit(d, 'scratch_dent').providedWhen = ['first_owner']; });
rejects(product, alder, 'a motor product without the motor module', (d) => { delete d.motor; });
rejects(product, alder, 'a product without excessStacking', (d) => { delete d.excessStacking; });
rejects(product, alder, 'no policy wording document', (d) => { d.documents = d.documents.filter((x) => x.type !== 'policy_wording'); });
rejects(product, alder, 'an unknown top-level field', (d) => { d.marketingFluff = true; });
rejects(product, alder, 'a bad duration', (d) => { d.cancellation.coolingOffPeriod = '14 days'; });
rejects(quote, aQuote, 'a quote without lineOfBusiness', (d) => { delete d.lineOfBusiness; });
rejects(quote, aQuote, 'an unknown code in quote benefitOverrides', (d) => { d.benefitOverrides = [{ code: 'free_pizza', availability: 'included' }]; });
rejects(quote, aQuote, 'an unknown providedWhen code in quote benefitOverrides', (d) => { d.benefitOverrides = [{ code: 'fire', availability: 'included', providedWhen: ['full_moon'] }]; });
rejects(quote, aQuote, 'an unknown code in quote optionalExtras', (d) => { d.optionalExtras[0].code = 'free_pizza'; });
rejects(quote, aQuote, 'an unknown code in quote excess appliesTo', (d) => { d.excesses[0].appliesTo = ['nope']; });
rejects(quote, aQuote, 'an unknown endorsement code', (d) => { d.endorsements[0].code = 'whatever'; });
rejects(quote, aQuote, 'an unknown code in sellerRemuneration appliesTo', (d) => { d.sellerRemuneration[1].appliesTo = ['bogus_code']; });
rejects(quote, aQuote, 'extensions on a quote', (d) => { d.extensions = { 'com.x': { postcode: 'SW1A 1AA' } }; });
rejects(quote, aQuote, 'a driver name', (d) => { d.risk.motor.drivers[0].name = 'Jane Doe'; });
rejects(quote, aQuote, 'exact years of licence held', (d) => { d.risk.motor.drivers[0].yearsLicenceHeld = 3; });
rejects(quote, aQuote, 'over-long free text', (d) => { d.assumptions[0] = 'x'.repeat(2001); });

const flags = (name, load, mutate, pattern) =>
  test(`semantic checks flag ${name}`, () => {
    const doc = load();
    mutate(doc);
    assert.ok(semanticErrors(doc).errors.some((e) => pattern.test(e)), JSON.stringify(semanticErrors(doc)));
  });

flags('duplicate benefit codes', alder, (d) => d.benefits.push({ ...d.benefits[0] }), /appears more than once/);
flags('dangling clause references', alder, (d) => { d.benefits[1].clauses = [{ document: 'missing', section: '1' }]; }, /unknown document "missing"/);
flags('effective dates out of order', alder, (d) => { d.effective.to = '2020-01-01'; }, /effective.from is after/);
flags('minAge above maxAge', alder, (d) => { d.motor.drivers.minAge = 80; d.motor.drivers.maxAge = 17; }, /minAge is above maxAge/);
flags('mixed currencies', alder, (d) => { d.fees[0].amount.currency = 'USD'; }, /mixes currencies/);
flags('quote validity before issue', aQuote, (d) => { d.validUntil = '2020-01-01T00:00:00Z'; }, /issuedAt is after validUntil/);
flags('cover ending before it starts', aQuote, (d) => { d.cover.endDate = '2026-01-01'; }, /startDate is not before endDate/);
flags('an excess for an unknown driver', aQuote, (d) => { d.excesses[0].drivers = ['d9']; }, /unknown driver "d9"/);
flags('an override excess for an unknown driver', aQuote, (d) => {
  d.benefitOverrides = [{ code: 'fire', availability: 'included', excesses: [{ type: 'additional', amount: { amount: '50', currency: 'GBP' }, drivers: ['nobody'] }] }];
}, /benefitOverrides\[0\]\.excesses\[0\] refers to unknown driver "nobody"/);
flags('validity before issue across time zones', aQuote, (d) => {
  d.issuedAt = '2026-01-01T06:00:00-05:00';
  d.validUntil = '2026-01-01T10:00:00Z';
}, /issuedAt is after validUntil/);

test('date checks respect UTC offsets on a valid quote', () => {
  const d = aQuote();
  d.issuedAt = '2026-01-01T10:00:00+05:00';
  d.validUntil = '2026-01-01T06:00:00Z';
  assert.deepEqual(semanticErrors(d).errors, []);
});

test('semantic checks ignore clauses inside extensions', () => {
  const d = alder();
  d.extensions = { 'example.alder': { clauses: [{ document: 'internal', section: '1' }] } };
  assert.deepEqual(semanticErrors(d).errors, []);
});

test('warns when a product omits vocabulary codes', () => {
  const d = alder();
  d.benefits = d.benefits.filter((b) => b.code !== 'vandalism');
  assert.match(semanticErrors(d).warnings.join(), /vandalism/);
});

test('quote checks flag hash, extra and tier mismatches against the product', () => {
  const q = aQuote();
  q.product.sha256 = 'f'.repeat(64);
  q.optionalExtras.push({ code: 'misfuelling', price: { amount: '5', currency: 'GBP' }, selected: false });
  q.optionalExtras.push({ code: 'breakdown_assistance', tier: 'platinum', price: { amount: '5', currency: 'GBP' }, selected: false });
  const errors = quoteErrors(q, localProducts()).join('\n');
  assert.match(errors, /sha256 does not match/);
  assert.match(errors, /"misfuelling" is not an optional extra/);
  assert.match(errors, /tier "platinum"/);
});

test('index checks flag a hash that does not match the product', () => {
  const i = load('alder/well-known-oips.json');
  i.products[0].sha256 = 'f'.repeat(64);
  assert.equal(indexErrors(i, localProducts()).length, 1);
});

test('validator reports, rather than crashes on, broken files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oips-'));
  const files = {
    bad: join(dir, 'bad.json'),
    noQuoteProduct: join(dir, 'quote.json'),
    notJson: join(dir, 'broken.json'),
    valueOf: join(dir, 'valueof.json'),
    constructor: join(dir, 'constructor.json'),
    nullDoc: join(dir, 'null.json'),
  };
  writeFileSync(files.valueOf, JSON.stringify({ documentType: 'valueOf' }));
  writeFileSync(files.constructor, JSON.stringify({ documentType: 'constructor' }));
  writeFileSync(files.nullDoc, 'null');
  writeFileSync(files.bad, JSON.stringify({ documentType: 'product', benefits: [] }));
  writeFileSync(files.noQuoteProduct, JSON.stringify({ documentType: 'quote' }));
  writeFileSync(files.notJson, '{ nope');
  const results = validateFiles(Object.values(files));
  for (const f of Object.values(files)) assert.ok(results.get(f).errors.length > 0, f);
});

test('money keeps exact decimals and the right currency', () => {
  assert.equal(money({ amount: '39.90', currency: 'GBP' }), '£39.90');
  assert.equal(money({ amount: '39.9', currency: 'GBP' }), '£39.90');
  assert.equal(money({ amount: '1234.5675', currency: 'GBP' }), '£1,234.5675');
  assert.equal(money({ amount: '20000000', currency: 'GBP' }), '£20,000,000');
  assert.equal(money({ amount: '50', currency: 'EUR' }), '€50');
});

test('durations read as words', () => {
  assert.equal(duration('PT24H'), '24 hours');
  assert.equal(duration('P1Y6M'), '1 year 6 months');
  assert.equal(duration('P14D'), '14 days');
});

test('comparison shows the facts that decide it', () => {
  const b = birch();
  b.benefits = b.benefits.filter((x) => x.code !== 'vandalism');
  const table = compare([alder(), b]);
  assert.match(table, /\| european cover \| Yes; full policy cover; 90 days a year; EEA, CH \| Yes; legal minimum; 30 days a year; EEA \|/);
  assert.match(table, /\| vandalism \| Yes \| Not stated \|/);
  assert.match(table, /\| new car replacement \| Yes; within 12 months/);
  assert.match(table, /\| theft \| Yes; market value; excludes keys left in car/);
  assert.match(table, /\| Write-off settlement \| market value \| lower of market and declared \|/);
  assert.match(table, /\| Additional excesses combine \| cumulative \| highest applies \|/);
  assert.match(table, /breakdown assistance \| Extra \(from £39\.99\); Roadside \[roadside assistance\]; Roadside and National Recovery \[roadside assistance, national recovery\]/);
  assert.doesNotMatch(table, /undefined/);
});

test('validator flags repeated tier ids and repeated benefit overrides', () => {
  const d = alder();
  const tiers = benefit(d, 'breakdown_assistance').optionalExtra.tiers;
  tiers.push({ ...tiers[0] });
  assert.match(semanticErrors(d).errors.join('\n'), /tier "[^"]+" appears more than once/);
  const q = aQuote();
  q.benefitOverrides = [{ code: 'courtesy_car', availability: 'included' }, { code: 'courtesy_car', availability: 'not_included' }];
  assert.ok(quote(q), JSON.stringify(quote.errors));
  assert.match(semanticErrors(q).errors.join('\n'), /benefitOverrides\[1\] "courtesy_car" appears more than once/);
});

test('validator flags a quote whose selected extras exceed the premium', () => {
  const q = aQuote();
  q.optionalExtras[0].selected = true;
  q.premium.annual.amount = '1.00';
  q.premium.tax.amount = '0.10';
  assert.match(quoteErrors(q, localProducts()).join('\n'), /cost more than premium\.annual/);
});

test('validator flags quote clauses that point at no product document', () => {
  const q = aQuote();
  q.endorsements[0].clauses = [{ document: 'no-such-doc', section: '1' }];
  assert.ok(quote(q), JSON.stringify(quote.errors));
  assert.match(quoteErrors(q, localProducts()).join('\n'), /unknown product document "no-such-doc"/);
});

test('validator flags an extra offered but overridden to included', () => {
  const q = aQuote();
  q.benefitOverrides = [{ code: q.optionalExtras[0].code, availability: 'included' }];
  assert.match(quoteErrors(q, localProducts()).join('\n'), /offered as an optional extra but overridden to included/);
});

test('validator rejects two different product files with the same id and version', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oips-'));
  const copy = alder();
  copy.name = { en: 'Altered' };
  writeFileSync(join(dir, 'altered.json'), JSON.stringify(copy));
  const results = validateFiles([path('alder/product-comprehensive.json'), join(dir, 'altered.json')]);
  for (const r of results.values()) assert.match(r.errors.join('\n'), /also published, with different bytes/);
});

test('validator warns when a quote is checked without its product', () => {
  const [r] = validateFiles([path('alder/quote.json')]).values();
  assert.deepEqual(r.errors, []);
  assert.match(r.warnings.join('\n'), /not in this run, so its hash, extras and bundles were not checked/);
});

test('schema applies the product id pattern to quotes and index entries', () => {
  const q = aQuote();
  q.product.id = 'Not An Id';
  assert.equal(quote(q), false);
  const i = load('alder/well-known-oips.json');
  i.products[0].id = 'Not An Id';
  assert.equal(index(i), false);
});

test('comparison shows voluntary excesses and every fee any product charges', () => {
  const a = alder();
  a.excesses.push({ type: 'voluntary', amount: { amount: '150', currency: 'GBP' } });
  const b = birch();
  b.fees.push({ code: 'other', label: 'Renewal admin', amount: { amount: '12', currency: 'GBP' } });
  const table = compare([a, b]);
  assert.match(table, /\| Voluntary excess \| voluntary £150 \| None stated \|/);
  assert.match(table, /\| Fee: missed payment \| Not stated \| £25 \|/);
  assert.match(table, /\| Fee: Renewal admin \| Not stated \| £12 \|/);
});

test('comparison keeps publisher text from breaking the table or adding markup', () => {
  const a = alder();
  a.name = 'Alder\n| injected | row |\n<script>x</script>';
  const [header] = compare([a, birch()]).split('\n');
  assert.equal(header.split(/(?<!\\)\|/).length, 5);
  assert.ok(!header.includes('<script>'));
  assert.match(header, /&lt;script&gt;/);
});

test('lenient reading accepts a later document with unknown fields and codes', () => {
  const later = alder();
  later.oips = '0.0.2';
  later.newTopLevelField = { anything: true };
  later.benefits.push({ code: 'flying_car_cover', availability: 'included' });
  benefit(later, 'courtesy_car').availability = 'conditionally_included';
  assert.equal(product(later), false);
  const reader = buildValidators({ lenient: true });
  assert.ok(reader.product(later), JSON.stringify(reader.product.errors));
  assert.equal(reader.product({ ...later, documentType: undefined }), false);
  assert.match(compare([later, birch()]), /\| courtesy car \| Not stated[;| ]/);
  const featured = alder();
  benefit(featured, 'fire').features = ['roadside_assistance'];
  assert.equal(product(featured), false);
  assert.ok(reader.product(featured), JSON.stringify(reader.product.errors));
});

test('quotes carry banded rating facts and identifier-only references', () => {
  const q = aQuote();
  q.reference = 'Quote for J Smith AB12 CDE';
  assert.equal(quote(q), false);
  const r = aQuote();
  r.risk.motor.vehicle.declaredValue = { amount: '21500', currency: 'GBP' };
  assert.equal(quote(r), false);
  const m = aQuote();
  m.risk.motor.annualMileage = 8000;
  assert.equal(quote(m), false);
});

test('index schema and checks reject malformed entries', () => {
  const entry = (mutate) => { const i = load('alder/well-known-oips.json'); mutate(i.products[0]); return i; };
  assert.equal(index(entry((e) => { e.status = 'discontinued'; })), false);
  assert.equal(index(entry((e) => { delete e.sha256; })), false);
  assert.equal(index(entry((e) => { e.url = 'not a url'; })), false);
  assert.equal(index(entry((e) => { e.extra = true; })), false);
  const backwards = entry((e) => { e.effectiveTo = '2026-01-01'; });
  assert.ok(index(backwards));
  assert.match(indexErrors(backwards, localProducts()).join('\n'), /effectiveFrom is after effectiveTo/);
});

test('command-line tools exit non-zero on bad input', async () => {
  const { spawnSync } = await import('node:child_process');
  const run = (tool, ...args) => spawnSync(process.execPath, [new URL(tool, import.meta.url).pathname, ...args], { encoding: 'utf8' });
  assert.equal(run('validate.js', path('alder')).status, 0);
  const missing = run('validate.js', 'no-such-file.json');
  assert.equal(missing.status, 1);
  assert.equal(missing.stderr.trim(), 'not found: no-such-file.json');
  const dir = mkdtempSync(join(tmpdir(), 'oips-'));
  writeFileSync(join(dir, 'broken.json'), '{');
  assert.equal(run('validate.js', dir).status, 1);
  assert.equal(run('validate.js', mkdtempSync(join(tmpdir(), 'oips-'))).status, 1);
  const fixture = new URL('fixtures/needs.json', import.meta.url).pathname;
  assert.equal(run('needs.js', fixture, path('alder/product-comprehensive.json')).status, 2);
  const wrong = run('needs.js', fixture, path('birch/product-comprehensive.json'), path('alder/quote.json'));
  assert.equal(wrong.status, 1);
  assert.match(wrong.stderr, /product\.sha256 does not match/);
  const altered = alder();
  altered.name = { en: 'Altered after quoting' };
  writeFileSync(join(dir, 'altered.json'), JSON.stringify(altered));
  const tampered = run('needs.js', fixture, join(dir, 'altered.json'), path('alder/quote.json'));
  assert.equal(tampered.status, 1);
  assert.match(tampered.stderr, /product\.sha256 does not match/);
  const later = { ...alder(), oips: '0.0.2', newTopLevelField: true };
  const laterDir = mkdtempSync(join(tmpdir(), 'oips-'));
  writeFileSync(join(laterDir, 'later.json'), JSON.stringify(later));
  assert.equal(run('validate.js', laterDir).status, 1);
  assert.equal(run('validate.js', '--lenient', laterDir).status, 0);
  assert.equal(run('needs.js', fixture, path('alder/product-comprehensive.json'), path('alder/quote.json')).status, 0);
});
