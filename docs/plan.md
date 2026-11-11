# Open Insurance Product Standard (OIPS): design

## Problem

Comparing insurance products is close to impossible. Each insurer presents cover differently, comparison sites show their own partial feature grids, and the facts that decide whether a claim pays (limits, excesses, exclusions, conditions) live in PDF policy wordings. There is no open, machine-readable format a customer, a comparison tool or an AI agent can use to compare two products clause by clause. See [research.md](research.md).

## Proposal

Every insurer publishes a JSON document per product, against an open published schema, and gives every customer a JSON document with each quote. The policy wording remains the legal contract; the JSON is the structured, comparable summary of it, with every value linked to the clause it summarises.

## Documents

| Document | Who publishes | Audience | Contents |
|---|---|---|---|
| **Index** | Each insurer or distributor | Crawlers, regulators, agents | Every product document: id, version, URL, hash, status |
| **Product** | Each insurer or distributor | Public, free to reuse | Cover, benefits, limits, excesses, exclusions, conditions, fees, cancellation, claims and complaints service |
| **Quote** | Whoever issues the quote | The customer only | Price, instalments, the customer's excesses, priced optional extras, endorsements, rating facts, and how the seller is paid. Pinned to an exact product version by hash |

A product compared with another product answers "which cover is better?". A quote laid over its product answers "what am I actually buying, at what price?".

## Structure of a product document

- **Core**, common to every line: identity, versioning, effective dates, insurer and distributor (with FCA reference and LEI), linked legal documents, cancellation, fees, claims, complaints, compensation scheme.
- **Benefits**: one entry per code from the line-of-business vocabulary. Each has `availability` (`included`, `optional_extra`, `not_included`, `not_stated`), limits, benefit-specific excesses, the circumstances it applies in (`providedWhen`), cover basis and territory where relevant, its exclusions, and `clauses` pointing into the wording.
- **Line-of-business module**: for motor, cover level, vehicle use, driver rules, no claims discount, telematics, write-off settlement and repair parts.
- **Extensions**: publisher data outside the standard, namespaced by reversed domain.

### Design rules

1. **Compare on codes, never on names.** "Premier Plus" means nothing; `courtesy_car: included, providedWhen: [approved_repairer_used, car_repairable]` means something.
2. **Silence is never ambiguous.** Products should list every vocabulary code. `not_stated` exists so that a missing fact is visibly missing, and tools must never read it as covered.
3. **Every value traces to the wording.** `clauseRef` names the document, section and page. A regulator or ombudsman can check the JSON against the contract.
4. **Exact money.** Amounts are decimal strings with an ISO 4217 currency.
5. **No personal data in public documents.** Index and product documents describe products, never people. A quote document is the customer's personal data: it must not contain names, addresses, registrations or dates of birth in any field, including free text. Its reference is an identifier only, its rating facts are banded (age, years licensed, vehicle value, mileage) so that together they are harder to tie to one person, it allows no publisher extensions, and it is shared only with the customer or someone they choose.
6. **Self-describing for agents.** Vocabulary codes carry descriptions inside the schema, so an agent reading the schema knows what `driving_other_cars` means without a separate glossary.
7. **IPID-aligned.** Every IPID heading maps to fields (below), so the JSON can be argued to be the IPID in data form.
8. **Incentives are visible.** A quote states how the seller is paid (commission, fee, add-on commission, finance commission, and who pays it), so an agent can tell the customer when a ranking may reflect the seller's interest rather than theirs.

### IPID mapping

| IPID heading | OIPS fields |
|---|---|
| What is this type of insurance? | `name`, `summary`, `lineOfBusiness`, `motor.coverLevel` |
| What is insured? | `benefits[]` with `availability: included` |
| What is not insured? | `exclusions[]`, `benefits[]` with `not_included` |
| Are there any restrictions on cover? | `excesses[]`, `limits[]`, `providedWhen`, `benefits[].exclusions[]` |
| Where am I covered? | `jurisdiction`, `benefits[].territories`, `european_cover` |
| What are my obligations? | `conditions[]` |
| When and how do I pay? | Quote `premium` |
| When does the cover start and end? | Quote `cover` |
| How do I cancel the contract? | `cancellation`, `fees[]` |

## Why this needs regulation

Voluntary adoption will not happen, because the parties who would have to publish gain from the status quo:

- **Comparison sites** are paid per sale by insurers, so they rank on headline price. Their feature data is proprietary and partial, and their position depends on being the only place comparison happens. Open product and quote documents let an agent compare directly, with no intermediary and no fee.
- **Insurers** compete for the top of a price-sorted list by raising excesses, moving cover into add-ons and tightening conditions. Products that are hard to compare can carry higher margins.

The obligation therefore has to come from the regulator. The FCA already has the pieces:

- **The IPID** (ICOBS 6A) already requires this content. OIPS is the IPID in data form, so the rule changes the format, not the substance, of an existing disclosure.
- **Consumer Duty** (PRIN 2A) requires firms to support consumer understanding and avoid foreseeable harm. Cover that cannot be compared is a foreseeable harm.
- **Open Banking** is the UK precedent: the CMA's 2017 retail banking order required the largest banks to publish product data through open, unauthenticated APIs to a common standard, and to fund the body that wrote it.

The rule would require every firm that manufactures or distributes retail motor insurance (then home) to:

1. Publish the index and a product document for every product on sale or renewal, conforming to the standard, under an open licence.
2. Give every customer a quote document with every quote, including through comparison sites, unchanged.
3. Keep every version resolvable for at least the life of any policy sold on it.
4. Treat the product document as part of the product's disclosure, so a mismatch with the wording is a breach.

## Optional extras

Extras are where like-for-like comparison usually breaks: breakdown alone comes in tiers named differently by every insurer, covering different mixes of roadside, recovery, home start, onward travel and European cover, and extras are often sold in bundles. OIPS handles this in three layers:

1. **Tiers declare features.** Each tier of an extra lists feature codes from the line-of-business vocabulary (for breakdown: `roadside_assistance`, `national_recovery`, `home_start`, `onward_travel`, `european_breakdown`, `personal_cover`, `caravan_trailer`, `parts_and_labour`). Tier names are informational only.
2. **Bundles are explicit.** The product document defines each bundle's contents by code and tier; the quote prices it.
3. **Compare on the price of what you need.** The customer states their needs once, as codes and required features. For each quote, the cheapest combination of included cover, extras, tiers and bundles that meets every need gives a like-for-like total, and any need a product cannot meet is reported rather than ignored. `tools/needs.js` implements this.

## Publication

1. **Well-known URL.** Each publisher serves `https://{domain}/.well-known/oips.json` (the index). Product documents may live anywhere; the index lists their URLs and SHA-256 hashes.
2. **Immutable versions.** A product document's URL and bytes never change once published. A change to cover publishes a new version; the old one moves to `withdrawn` but stays resolvable, so past quotes and live policies can always be checked against their terms.
3. **Media type** `application/vnd.oips+json`, served over HTTPS, with permissive CORS so browser tools and agents can fetch directly.
4. **Licence.** Product and index documents are published under an open data licence (e.g. CC BY 4.0 or the Open Government Licence) so comparison sites need no agreement with the insurer.
5. **Registry.** A regulator or industry body (the FCA, or an Open Banking-style implementation entity) runs a central registry of publisher domains, validates published files nightly, and hosts files for small firms that cannot. This is the Australian energy model.
6. **Signatures (later).** Detached JWS signatures over each document, keyed to the publisher's registry entry, so a quote document cannot be forged or altered.

## Sharing quotes

- **Download.** Every quote page offers "Download quote data (JSON)" next to the PDF.
- **Email.** The quote email carries the JSON as an attachment.
- **Comparison sites.** Return the insurer's quote document unchanged alongside each price, so the customer can take it elsewhere.
- **Agents.** A customer gives an agent their quote documents; the agent fetches each pinned product version, verifies hashes, and compares benefit by benefit. Nothing needs an API key.
- **Later: consented API.** A customer-authorised endpoint to fetch live quotes and policy documents, on Open Finance consent rails once they exist for insurance.

## Versioning of the standard

Semantic versioning. During 0.x anything may change. From 1.0, minor versions only add optional fields and vocabulary codes.

The schemas are strict, so a publisher checking its own documents catches typos and unknown codes. Readers must not be: a consumer ignores fields it does not recognise and treats an unknown code as `not_stated`, so a document written to a later version still reads. `tools/validate.js --lenient` validates the way a reader should, against copies of the schemas with code lists opened and unknown fields allowed.

## Conformance

A document conforms when it is valid against its schema and meets these rules, which JSON Schema cannot express. `tools/validate.js` checks each of them.

- **One currency.** Every amount in a document, and in a quote and its product, uses the same currency.
- **Clauses resolve.** Every clause reference, in a product or a quote, names a document listed in the product.
- **No duplicates.** Benefit codes, tier ids within an extra, bundle ids, bundle contents, quote extras, quote bundles and benefit overrides each appear once.
- **Dates in order.** Effective from precedes effective to, a quote is issued before it expires, and cover starts before it ends.
- **Quotes match their product.** A quote's sha256 equals the hash of the product document's bytes as published. Its extras, tiers and bundles exist in the product, no extra is selected twice (alone, in two tiers or in a bundle), selected extras cost no more than the premium, and an extra is not also overridden to another availability.
- **One document per version.** Two product documents with the same id and version have the same bytes.
- **Driver references resolve.** Every driver an excess names is a driver in the quote's rating facts.

## Scope of v0.0.1

- In: core, motor (UK private car) module, product, quote and index schemas, two fictional example products and a quote, a validator, and a side-by-side comparison script.
- Out: other lines (home, travel, pet, van), signatures, the registry, policy (in-force) documents, claims data, translations beyond the `text` type.

## Next

1. Close the known gaps listed in the README, found by comparing two real UK car insurance quotes.
2. Add home insurance as a second module to test whether the core holds up.
3. Write up the regulatory case as a standalone paper for the FCA, with the IPID mapping and a cost estimate for a mid-sized insurer.
