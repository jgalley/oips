# Open Insurance Product Standard (OIPS)

An open JSON format for describing insurance products and quotes so they can be compared like for like, by people, comparison sites and AI agents.

Status: **v0.0.1, draft.** UK private car insurance only. Anything may change before 1.0.

## The idea

Each insurer publishes:

- an **index** at `https://{domain}/.well-known/oips.json` listing its products;
- a **product document** per product version: every benefit, limit, excess, exclusion, condition and fee, each linked to the clause in the policy wording it summarises;
- a **quote document** with every quote: the customer's price, excesses and priced extras, pinned by hash to the exact product version.

Products are compared on a shared vocabulary of benefit codes (`courtesy_car`, `european_cover`, `driving_other_cars` and so on), not on marketing names. A benefit is `included`, `optional_extra`, `not_included` or `not_stated`, so a missing fact is visible rather than silent.

Design and rationale: [docs/plan.md](docs/plan.md). Prior art: [docs/research.md](docs/research.md).

## Layout

```
schema/v0.0.1/
  common.schema.json    money, limits, excesses, clause references, organisations
  product.schema.json   product document
  quote.schema.json     quote document
  index.schema.json     /.well-known/oips.json
  motor.schema.json     private car vocabulary and fields
examples/               two fictional insurers, their quotes and an index
tools/
  validate.js           schema plus cross-document checks
  compare.js            side-by-side Markdown table of products
  needs.js              price each quote for the cover you need, extras included
```

## Use

```
npm install
npm test                          # validate examples and run the test suite
node tools/validate.js <files>    # validate your own documents
node tools/compare.js a.json b.json
node tools/needs.js needs.json productA.json quoteA.json productB.json quoteB.json
```

All insurers, firms and reference numbers in `examples/` are fictional.

## Known gaps

Comparing two real UK car insurance quotes by hand against this draft exposed these, which v0.0.1 does not yet model:

- **Business use by driver.** Use classes such as "business use" need to say which drivers they cover, not just that they apply.
- **Broker and insurer.** When a broker sells the policy, the quote must name the insurer that pays claims as well as the seller.
- **Add-ons with their own insurer.** Legal expenses or breakdown cover is often underwritten by a different insurer from the main policy.
- **Bundled cover with a tier.** An extra included in the price still needs its tier and features stated, so it can be compared with the same extra sold separately.
- **Customer-specific terms.** Endorsements on one customer's policy need to override the product document in the quote.
- **Conflicting disclosures.** Fee and refund terms can differ between a renewal notice and the policy wording, and the standard has no way to flag which governs.

Feedback is welcome, particularly from people who work in insurance, comparison or regulation. Open an issue.

## Licence

Apache 2.0.
