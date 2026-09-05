/**
 * PLACEHOLDER — replace with the rules half's implementation at merge.
 *
 * `buildFactsPack` is the seam `contract.ts` describes: it turns a `DerivedFeatures` v2 and a
 * finished `FundingReadinessPlanV1` into the `FactsPackV2` the narrative layer is allowed to see.
 * It belongs to the rules lane, which is building `DerivedFeatures` v2 and the ten-item checklist
 * in parallel with this one, and the real version lands with that work.
 *
 * It is a throwing stub rather than an absent module because the production wiring in
 * `analysis/worker.ts` has to name its dependency somewhere, and a wiring that imports a module
 * that does not exist is a build failure rather than a merge conflict. The throw is deliberate and
 * loud: the worker catches it, logs it and swallows it, so a deployment that reached this file
 * before the merge loses its narrative and nothing else.
 *
 * When the rules half lands, this file is overwritten wholesale. Nothing else in `narrative/`
 * imports it — the tests build their packs by hand from the contract types on purpose, so the
 * checker stays an independent statement of what the prose may say.
 */

import type { DerivedFeatures } from '../../analysis/features.ts';
import type { FundingReadinessPlanV1 } from '../types.ts';
import type { FactsPackV2 } from './contract.ts';

export function buildFactsPack(...inputs: [DerivedFeatures, FundingReadinessPlanV1]): FactsPackV2 {
  // The rest parameter keeps the signature the real implementation has to satisfy while giving the
  // placeholder no unused bindings to apologise for. `void` rather than a discard: the parameter is
  // load-bearing documentation of the seam, and dropping it would make the stub's shape a lie.
  void inputs;
  throw new Error('FACTS_PACK_NOT_IMPLEMENTED');
}
