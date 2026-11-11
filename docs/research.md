# Prior art: open standards for comparing insurance products

Researched 11 November 2026. Focus: UK private car insurance.

## Verdict

No open, machine-readable standard exists that UK or EU insurers use, or must use, to publish product cover in a like-for-like form. Brazil has one: a statutory OpenAPI spec for public product data in which auto insurance is a first-class product type. It is the closest working precedent, and the basis to adapt from rather than adopt wholesale (its coverage enums are Brazilian, it publishes premium-rate ranges not prices, and its regime is under revision).

## Insurance data standards

| Standard | Open? | Fit | Notes |
|---|---|---|---|
| [ACORD Next-Generation Digital Standards](https://www.acord.org/standards-architecture/acord-data-standards/next-generation-digital-standards) | No, members only | Business-to-business exchange | JSON object model for policy, coverage, party, claim |
| [Polaris](https://www.insuranceage.co.uk/broker/4435746/polaris-creates-new-standards-for-sharing-economy-products) | No, members only | UK broker and insurer e-trading, rating and quote exchange | Current licence terms not verified |
| [Open Insurance Initiative (OPIN)](https://github.com/The-Open-Insurance-Initiative/API-spec) | Yes, Apache 2.0 | General open insurance API | Dormant since June 2022 |
| [Brazil Open Insurance (SUSEP)](https://github.com/br-openinsurance/areadesenvolvedor/tree/main/docs/specs/current) | Yes, statutory | Public product data, policy data, quotes | `auto-insurance` product spec v3; `quote-auto` v2. Rules under revision (Resolução SUSEP 61/2025, consultations 12/2026 and 13/2026) |
| [EIOPA open insurance](https://www.eiopa.europa.eu/system/files/2022-06/feedback_statement_on_open_insurance_-_accessing_and_sharing_insurance-related_data.pdf) | n/a | Consent and data sharing | No product schema |
| [FIDA (EU)](https://www.mlex.com/mlex/articles/2545816) | n/a | Customer data, not product data | Stalled; a draft Commission 2027 work programme plans withdrawal (MLex, 3 November 2026) |
| [UK Open Finance roadmap](https://www.fca.org.uk/publications/corporate-documents/open-finance-roadmap) | n/a | FCA, 14 April 2026 | Insurance is later-stage, around 2029-30 |
| [Australia CDR](https://www.itnews.com.au/news/consumer-data-right-expansion-paused-596343) | n/a | Expansion to insurance paused June 2023 | Current status not verified |
| [India Bima Sugam](https://www.angelone.in/news/personal-finance/bima-sugam-rollout-to-begin-with-motor-insurance-as-platform-adopts-phased-launch) | n/a | Marketplace, motor first | No published product-data schema found |

## Disclosure documents

- **IPID** ([EU 2017/1469](https://register.eiopa.europa.eu/Pages/Supervision/Insurance/Editable-Template-for-the-Insurance-Product-Information-Document-(IPID).aspx), UK ICOBS 6A): a fixed presentation format, PDF only, no data form. Its headings are a recognised minimum content outline.
- **FCA Consumer Duty and GIPP pricing rules**: fair value and renewal pricing; no requirement for machine-readable product data.
- **Defaqto ratings and comparison-site feeds**: proprietary.

## Analogues in other sectors

- [UK Open Banking Open Data](https://openbankinguk.github.io/knowledge-base-pub/standards/open-data.html): mandatory, unauthenticated product APIs with typed fees and eligibility. UK regulatory precedent for product data.
- [Australia CDR product reference data](https://consumerdatastandardsaustralia.github.io/standards/) and [AER energy plans](https://www.aer.gov.au/energy-product-reference-data): central register of product endpoints; the regulator hosts data for most energy retailers.
- [US Transparency in Coverage](https://github.com/CMSgov/price-transparency-guide): published JSON schemas, an index file, and an [official validator](https://github.com/CMSgov/price-transparency-guide-validator).
- [US marketplace health plan data](https://github.com/CMSgov/QHP-provider-formulary-APIs): issuers publish `/cms-data-index.json` at a well-known URL.
- [schema.org FinancialProduct](https://schema.org/FinancialProduct) and [FIBO](https://spec.edmcouncil.org/fibo/): too thin on insurance to use as a schema.

## Ideas adopted in v0.0.1

1. A closed vocabulary of coverage codes, each coverage an object with limits, excesses and scope (Brazil).
2. Every structured value links back to the legal wording (Brazil `termsAndConditions`).
3. A well-known URL with an index file (CMS).
4. A validator shipped with the schema (CMS).
5. Separate product and quote layers sharing the same benefit objects (Brazil).
6. Optional regulator-hosted registry for discovery (Australia CDR, AER).
7. Content aligned to the IPID headings (EU/UK).
8. Fees and conditions as typed data, not prose (UK Open Banking).

## Not verified

Brazil Phase 1 mandatory status after the 2025-26 revision; FIDA's final status; Polaris licence terms and how comparison-site feeds work; Australia CDR insurance status after 2024; FIBO insurance class detail; exact GIPP and Consumer Duty text.
