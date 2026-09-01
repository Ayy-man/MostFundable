// R5D-04 / R5D-05, third pass. One definition of a written percentage, composed into every rule
// that references one. The verb axis of C20 was derived from a frame in the second pass and is
// complete; the unit axis inside the same rule was still a hand-written list holding the symbol and
// one spelling of the word, so the rule was only ever as complete as that list. It never showed,
// because every probe that reached it used a noun C10 catches independently and C10 covered for it —
// the derived verbs have no such backstop, so with them the hole is fully exposed.
//
// The unit set is derived by family: the symbol, the word with its plural and adjectival forms, the
// two-word British form, the ordinary abbreviation, the point-difference unit with its abbreviation,
// and the hundredth-of-a-point unit. Casing is free because every rule compiles with `i`, and the
// spacing between the number and the unit is part of the shared definition rather than each rule's
// business. Rules carry a slot where a percentage belongs and the slot is filled once here, so a
// unit added later reaches every rule at the same moment instead of one rule at a time.
const PERCENT_UNIT = atob('KD86JXwoPzpwZXJjZW50YWdlXHMrcG9pbnRzP3xwZXJjZW50YWdlXHMrcHRzP3xwZXJjZW50YWdlcz98cGVyY2VudHM/fHBlclxzP2NlbnRzP3xwY3RzP3xwcHxiYXNpc1xzK3BvaW50cz98YnBzKVxiKQ==');
const PERCENT_VALUE = atob('XGR7MSwzfSg/OlsuLF1cZCspP1xzKig/OiV8KD86cGVyY2VudGFnZVxzK3BvaW50cz98cGVyY2VudGFnZVxzK3B0cz98cGVyY2VudGFnZXM/fHBlcmNlbnRzP3xwZXJccz9jZW50cz98cGN0cz98cHB8YmFzaXNccytwb2ludHM/fGJwcylcYik=');
const PERCENT_VALUE_SLOT = '\u0001';
const PERCENT_UNIT_SLOT = '\u0002';

function withPercent(source) {
  return source.split(PERCENT_VALUE_SLOT).join(PERCENT_VALUE).split(PERCENT_UNIT_SLOT).join(PERCENT_UNIT);
}

const SOURCES = Object.freeze([
  'ZGlzcHV0',
  'KD88IVtcdyTCo+KCrCNbXSkoPzwhXGRbLixdKTYwOSg/IVtcdyVdKSg/IVwuXGQpKD8hLFxkKQ==',
  'cGF5W1xzLl8tXT8oZm9yfHRvKVtccy5fLV0/ZGVsZXRl',
  'cmVtb3ZhbHM/',
  'Y3JlZGl0W1xzLl8tXT9yZXBhaXI=',
  'Z29vZFtccy5fLV0/d2lsbFxiW1xzXFNdezAsMTJ9P2xldHRlcnM/XGJ8Z29vZHdpbGxccysobGV0dGVyfGFkanVzdG1lbnR8ZGVsZXRpb24p',
  'WyvvvItdXHM/XGR7MSwzfVxzKihwdHM/XGJ8cG9pbnRzP1xiKQ==',
  'KHJhaXNlfGJvb3N0fGluY3JlYXNlfGltcHJvdmV8YWRkfGdhaW58bGlmdHxqdW1wKVx3KlteLlxuXXswLDQwfVxic2NvcmVzP1xiW14uXG5dezAsMjB9XGJieVxiW14uXG5dezAsMTJ9XGQ=',
  'XGJcZHsxLDN9XHM/KHB0c1xifHBvaW50cz9cYilbXi5cbl17MCwzMH1cYihzY29yZXM/fGZpY298dmFudGFnZSlcYnxcYihzY29yZXM/fGZpY298dmFudGFnZSlcYlteLlxuXXswLDMwfVxiXGR7MSwzfVxzPyhwdHNcYnxwb2ludHM/XGIp',
  'KGFwcHJvdmFsfGFwcHJvdmVkfHF1YWxpZlx3KnxmdW5kaW5nKVteLlxuXXswLDMwfVxiKG9kZHN8Y2hhbmNlcz98bGlrZWxpaG9vZHxwcm9iYWJpbGl0eSlcYnxcYihvZGRzfGNoYW5jZXM/fGxpa2VsaWhvb2R8cHJvYmFiaWxpdHkpXGJbXi5cbl17MCwzMH1cYihvZnx0byBiZSlcYlteLlxuXXswLDIwfVxiKGFwcHJvdlx3KnxxdWFsaWZcdyp8ZnVuZFx3KilcYg==',
  'XGIob2Rkc3xjaGFuY2VzP3xsaWtlbGlob29kfHByb2JhYmlsaXR5KVxiW14uXG5dezAsMzB9AXwBW14uXG5dezAsMzB9XGIob2Rkc3xjaGFuY2VzP3xsaWtlbGlob29kfHByb2JhYmlsaXR5KVxi',
  'Q3JlZGl0IFNlcnZpY2VzIEFncmVlbWVudA==',
  'XGJcZHsxLDN9W1xzLV0/cG9pbnRzP1xiW14uXG5dezAsNDB9XGIoaW5jcmVhc2V8Z2Fpbnxib29zdClcdypcYnxcYihpbmNyZWFzZXxnYWlufGJvb3N0KVx3KlxiW14uXG5dezAsNDB9XGJcZHsxLDN9W1xzLV0/cG9pbnRzP1xi',
  'XGIBW14uXG5dezAsMzB9XGJsaWtlbHlcYlteLlxuXXswLDIwfVxiKGFwcHJvdlx3KnxxdWFsaWZcdyp8ZnVuZFx3KilcYnxcYihhcHByb3ZhbHxhcHByb3ZlZHxxdWFsaWZcdyopXGJbXi5cbl17MCwzMH1cYgE=',
  'Q3JlZGl0W1xzLl8tXSpTZXJ2aWNlcyg/Oltccy5fLV0rKD86Q2xpZW50fENvbnN1bWVyfFByb2dyYW18RW5yb2xsbWVudHxTZXJ2aWNlKSk/W1xzLl8tXSpBZ3JlZW1lbnQ=',
  'KHJhaXNlfGJvb3N0fGluY3JlYXNlfGltcHJvdmV8YWRkfGdhaW58bGlmdHxqdW1wfHJpc2UpXHcqW14uXG5dezAsNDB9XGJzY29yZXM/XGJbXi5cbl17MCwyMH1cYmJ5XGJbXi5cbl17MCwxMn1cZHsxLDN9W14uXG5dezAsMTJ9XGJwb2ludHM/XGJ8XGJzY29yZXM/XGJbXi5cbl17MCwyMH1cYihyYWlzZXxib29zdHxpbmNyZWFzZXxpbXByb3ZlfGFkZHxnYWlufGxpZnR8anVtcHxyaXNlKVx3KlxiW14uXG5dezAsMjB9XGJieVxiW14uXG5dezAsMTJ9XGR7MSwzfVteLlxuXXswLDEyfVxicG9pbnRzP1xi',
  'XGIoPzphcHBsaWNhbnRzPyBsaWtlIHlvdXx5b3VyICg/OmFwcGxpY2F0aW9ufHByb2ZpbGUpfGNsaWVudHM/IHdpdGggeW91ciBwcm9maWxlKVxiW14uXG5dezAsNjB9XGIoPzphcHByb3ZlZHxxdWFsaWZcdyp8ZnVuZFx3KnxleHBlY3RlZClcYlteLlxuXXswLDQwfSg/OgF8XGJcZHsxLDN9XHMrKD86dGltZXNccyspP291dCBvZlxzK1xkezEsM31cYil8XGIoPzphcHByb3ZlZHxxdWFsaWZcdyp8ZnVuZFx3KnxleHBlY3RlZClcYlteLlxuXXswLDQwfSg/OgF8XGJcZHsxLDN9XHMrKD86dGltZXNccyspP291dCBvZlxzK1xkezEsM31cYilbXi5cbl17MCw2MH1cYig/OmFwcGxpY2FudHM/IGxpa2UgeW91fHlvdXIgKD86YXBwbGljYXRpb258cHJvZmlsZSl8Y2xpZW50cz8gd2l0aCB5b3VyIHByb2ZpbGUpXGI=',
  'XGJcZHsxLDN9XHMrKD86aW58b3V0IG9mKVxzK1xkezEsM31cYlteLlxuXXswLDEwMH1cYig/OmFwcGxpY2FudHM/KD86XHMrd2l0aFxzK3lvdXJccytwcm9maWxlKT98cGVvcGxlXHMrbWF0Y2hpbmdccysoPzp0aGVzZVxzK2ZhY3RzfHlvdXJccytwcm9maWxlKSlcYlteLlxuXXswLDgwfVxiKD86YXJlXHMrYXBwcm92ZWR8cmVjZWl2ZVxzKyg/OmFwcHJvdmFsfHRoZVxzK2xlbmRlclsn4oCZXXNccyt5ZXMpKVxi',
  'XGIoPzpjYW5ub3R8Y2FuIG5vdHxkb2VzIG5vdHxkbyBub3R8bm8pXGJbXi47XG5dezAsODB9XGIoPzpwcm9taXNlfGd1YXJhbnRlZSlcdypcYlteLjtcbl17MCwxMjB9WzssXVteLlxuXXswLDgwfVxiKD86eW91clxzKyg/OmFwcGxpY2F0aW9ufHByb2ZpbGUpfGFwcGxpY2FudHM/XHMrbGlrZVxzK3lvdSlcYlteLlxuXXswLDUwfVxid2lsbFxzK3JlY2VpdmVccythcHByb3ZhbFxi',
]);

// R4D-01. Everything above enumerates a phrase order: a specific token sequence in a specific
// numeric form. Move the number to the other side of the clause and the same claim walks through,
// which is how seven of nine ordinary strings scored zero codes in round 4 — the noun form of the
// restricted subject was not even in the vocabulary. The detectors below describe a shape instead.
// Each one names the parts a prohibited claim is made of and requires them to co-occur inside one
// clause in ANY order, so word order stops being a way through. They stay deterministic and
// refusing: no classifier, no scoring, and a residual miss is a recorded limitation rather than a
// reason to reach for a model.
//
// Vocabulary lives encoded for the same reason the rules above do — this file is inside a scan
// root, so a plaintext pattern would make the gate fail on its own source.
// R5D-04 / R5D-05. Round 4 built the shapes but populated them from the strings in front of it:
// `approval` held six spellings of one verb, `change` held one tense family, and `quantity` was the
// only way the restricted metric could be named. That is why `accepted` walked through a rule whose
// whole subject is decision language, and why a start-to-end pair of numbers walked through a rule
// whose whole subject is a promised movement of that metric. The sets below are derived from the
// category instead of from the reproductions: every ordinary way a lending decision is named, every
// ordinary way an upward movement is named, and every ordinary way that movement is written down.
//
// Two vocabularies, not one, and the split is deliberate. `change` holds only verbs whose direct
// object is naturally a quantity of the restricted metric, because it composes with a bare quantity
// and a bare quantity is weak evidence on its own. `move` adds the ordinary transport verbs — take,
// get, bring, carry — because it only ever composes with a start-to-end pair in the metric's own
// numeric band, and that pair carries the subject matter by itself. Merging the two would put
// "take" beside any three-digit quantity in the tree.
//
// R5 second pass. The first pass bounded `cleared`, `granted` and `awarded` by their lending object
// and left `being cleared` outside the set while `being greenlit` was inside it — the same
// incomplete enumeration this round exists to repair, reproduced inside the repair. The bounding was
// distrust of the composition: C20 already demands a person and a number in the same clause, C23 a
// person and a certainty word, so the decision word does not have to disambiguate on its own.
//
// The set is now derived from a closure frame rather than a list. A lending decision has a lender
// and an applicant, and English names it as verb or noun, in either polarity, from either side, so
// the frame is {verb, noun} x {affirmative, negative} x {lender-subject, applicant-subject}. Every
// cell has to be populated: approve/accept/qualify/fund/greenlight/clear/underwrite/grant/award/
// sign off and their participles cover the affirmative verb cells from both sides, approval/
// acceptance/clearance/sign-off/green light/go-ahead the affirmative nouns, deny/decline/reject/
// turn down/pass on the negative verbs, and denial/declination/rejection/a no the negative nouns.
// The refusal half is in because a personalized *denial* percentage is the same prohibited claim
// with the sign flipped.
//
// A word is bounded for exactly one reason: it is a genuine homonym whose non-lending sense is
// common in ordinary English — pass (a test, a password, passing a value), issue (a problem), extend
// (a deadline), secure (security), in (a preposition), bare yes and no. Never because it happens to
// appear in this tree. `up` is admitted only against a digit or behind a movement verb on the same
// homonym reasoning. The bare noun for money this product is about stays out of the decision set
// entirely: it is the product's own name for itself and one of the clean controls turns on it.
const PART = Object.freeze({
  approval: atob('KD86XGJhcHByb3ZlW3NkXT9cYnxcYmFwcHJvdmluZ1xifFxiYXBwcm92YWxzP1xifFxiZGlzYXBwcm92XHcqXGJ8XGJwcmVbXHMtXT9hcHByb3ZcdypcYnxcYnByZVtccy1dP3F1YWxpZlx3KlxifFxicXVhbGlmXHcqXGJ8XGJmdW5kZWRcYnxcYmFjY2VwdCg/OnN8ZWR8aW5nfGFuY2V8YW5jZXMpP1xifFxiZ3JlZW5bXHMtXT9saXRcYnxcYmdyZWVuW1xzLV0/bGlnaHQoPzpzfGVkfGluZyk/XGJ8XGJ1bmRlcndyaXR0ZW5cYnxcYnVuZGVyd3JpdCg/OmV8ZXN8aW5nKVxifFxiY2xlYXIoPzpzfGVkfGluZ3xhbmNlfGFuY2VzKT9cYnxcYmdyYW50KD86c3xlZHxpbmcpP1xifFxiYXdhcmQoPzpzfGVkfGluZyk/XGJ8XGJzaWduZWQ/W1xzLV1vZmZcYnxcYnNpZ25bXHMtXW9mZlxifFxiZGVuKD86eXxpZXN8aWVkfHlpbmd8aWFsfGlhbHMpXGJ8XGJkZWNsaW4oPzplfGVzfGVkfGluZ3xhdGlvbnxhdGlvbnMpXGJ8XGJyZWplY3QoPzpzfGVkfGluZ3xpb258aW9ucyk/XGJ8cGFzcyg/OmVzfGVkfGluZyk/XHMrKD86dW5kZXJ3cml0aW5nfHRoZVxzKyg/OnVuZGVyd3JpdGVyfGxlbmRlcnxjcmVkaXRccytjaGVja3xjb21taXR0ZWV8cmV2aWV3KSl8cGFzcyg/OmVzfGVkfGluZyk/XHMrb25ccysoPzp5b3V8eW91cil8aXNzdSg/OmV8ZXN8ZWR8aW5nKVxzKyg/OnlvdVxzKyk/KD86dGhlXHMrfGFccyspPyg/OmxvYW58bGluZXxmdW5kaW5nfGNyZWRpdCl8ZXh0ZW5kKD86c3xlZHxpbmcpP1xzKyg/OnlvdVxzKyk/KD86dGhlXHMrfGFccyspPyg/OmNyZWRpdHxsaW5lfGxvYW58ZnVuZGluZyl8c2VjdXIoPzplfGVzfGVkfGluZylccysoPzp5b3VccyspPyg/OnRoZVxzK3xhXHMrKT8oPzpsb2FufGxpbmV8ZnVuZGluZ3xjcmVkaXQpfHR1cm4oPzpzfGVkfGluZyk/XHMrKD86eW91XHMrfHRoZW1ccyspP2Rvd258Z2V0KD86c3x0aW5nKT9ccyt5b3VccytpbnxzYXkoPzpzfGluZyk/XHMrKD86eWVzfG5vKXwoPzphfGFufHRoZSlccysoPzp5ZXN8bm8pXGJ8KD86eWVzfG5vKVxzK2Zyb21ccysoPzp0aGVccyspP2xlbmRlcnxcYmdvW1xzLV0/YWhlYWRcYig/IVxzK2FuZFxiKXwoPzp0aGV8YSlccytncmVlblxzK2xpZ2h0KQ=='),
  // R5D-05, fifth pass, rebuilt in the ninth. C23 keeps `certain` as it is: that rule already
  // demands a decision word, so a certainty governing an ordinary verb cannot reach it. C27 has no
  // such guard, so it needs its own form, and the question it has to answer is whether the figure
  // in the clause belongs to the certainty or to something else in the sentence.
  //
  // Passes six to eight answered it with a list of copular and raising verbs, and three separate
  // outside probes found holes in it — the last on the two most ordinary verbs in the sentence.
  // An open verb list is only ever as complete as the last attempt to break it. This asks about
  // position instead, from both sides: the figure has to be the governed complement, reached from
  // `to` across at most four words, none of which opens a noun phrase or marks a delta, and it has
  // to end the predicate rather than modify a noun that follows it — a figure with a noun after it
  // is a term of the product or a comparison, and that noun is what gives it away. A decision verb
  // keeps its own branch, because a figure written before the certainty never reaches the
  // complement position at all.
  //
  // Tenth pass, the trailing class. `of` is an adjunct opener here and the comparison prepositions
  // -- as, than, per, over, under, about -- still are not. The ninth pass excluded all of them
  // together for making the figure a proportion of something else, but this branch is only ever
  // reached when the figure is already the governed complement, and there `of the ask` names what
  // the proportion is taken from rather than displacing the claim, so the sentence is a promise
  // about the amount. A comparison still displaces it, so those six stay out. The inventory is
  // grouped by part of speech below because the earlier list was an incomplete enumeration of a
  // closed class rather than an approximation of an open one: prepositions, subordinators,
  // determiners and pro-forms are countable and can be checked by reading them, which is why this
  // test can be finished and the verb list never could. The one class it cannot absorb is derived
  // adverbs -- `easily` is an adjunct and `monthly` is a noun modifier, and nothing in their shape
  // separates them -- so a claim ending in a bare adverb stays outside the rule.
  certainOutcome: atob('XGIoPzooPzooPzpjZXJ0YWlufGFzc3VyZWR8ZGVzdGluZWR8aW5ldml0YWJsZXxzdXJlfGJvdW5kfG5vXHMrZG91YnR8KD86YWxsXHMrYnV0fHZpcnR1YWxseXxwcmFjdGljYWxseXxuZWFybHl8ZXNzZW50aWFsbHkpXHMrY2VydGFpbnwoPzp2ZXJ5fGhpZ2hseXxleHRyZW1lbHl8cXVpdGV8bW9zdHxyZWFsbHl8c3VwZXIpXHMrbGlrZWx5fGxpa2VseSl8KD86Z3VhcmFudGVlcz98Z3VhcmFudGVlZHwoPzphbGxccytidXR8dmlydHVhbGx5fHByYWN0aWNhbGx5fG5lYXJseXxlc3NlbnRpYWxseSlccytndWFyYW50ZWVkKSlcYig/IVxzK3RvXGIpfCg/Oig/OmNlcnRhaW58YXNzdXJlZHxkZXN0aW5lZHxpbmV2aXRhYmxlfHN1cmV8Ym91bmR8bm9ccytkb3VidHwoPzphbGxccytidXR8dmlydHVhbGx5fHByYWN0aWNhbGx5fG5lYXJseXxlc3NlbnRpYWxseSlccytjZXJ0YWlufCg/OnZlcnl8aGlnaGx5fGV4dHJlbWVseXxxdWl0ZXxtb3N0fHJlYWxseXxzdXBlcilccytsaWtlbHl8bGlrZWx5KXwoPzpndWFyYW50ZWVzP3xndWFyYW50ZWVkfCg/OmFsbFxzK2J1dHx2aXJ0dWFsbHl8cHJhY3RpY2FsbHl8bmVhcmx5fGVzc2VudGlhbGx5KVxzK2d1YXJhbnRlZWQpKVxzK3RvXHMrKD86KD8hKD86KD86YW4/fHRoZXx0aGlzfHRoYXR8dGhlc2V8dGhvc2V8bXl8eW91cnxvdXJ8dGhlaXJ8aXRzfGhpc3xoZXIpfGJ5KVxiKVthLXonXStccyspezAsNH0/ASg/IVxzKyg/ISg/Oig/OmFuZHxvcnxidXR8c298eWV0fG5vcnxpZnx3aGVufHdoZW5ldmVyfHdoaWxlfHdoaWxzdHxiZWNhdXNlfHNpbmNlfGFsdGhvdWdofHRob3VnaHx1bmxlc3N8dW50aWx8b25jZXx3aGVyZWFzfHdoZXRoZXJ8d2hlcmV2ZXJ8bGVzdHxhbGJlaXR8cHJvdmlkZWR8cHJvdmlkaW5nfHN1cHBvc2luZ3xhc3N1bWluZ3x0aGF0fHdoaWNofHdob3x3aG9tfHdob3NlfHdoYXRldmVyfHdob2V2ZXJ8d2hvbWV2ZXJ8d2hpY2hldmVyfGhvd2V2ZXJ8aW58b258YXR8dG98Zm9yfGZyb218d2l0aHxieXxvZnxpbnRvfG9udG98dXBvbnx2aWF8d2l0aGlufHdpdGhvdXR8dGhyb3VnaG91dHxkdXJpbmd8ZGVzcGl0ZXx0b3dhcmR8dG93YXJkc3xhY3Jvc3N8YWZ0ZXJ8YmVmb3JlfGFnYWluc3R8YW1vbmd8YW1vbmdzdHxhcm91bmR8YmVoaW5kfGJlbG93fGJlbmVhdGh8YmVzaWRlfGJlc2lkZXN8YmV0d2VlbnxiZXlvbmR8dGhyb3VnaHxiYXJyaW5nfHBlbmRpbmd8Z2l2ZW58Y29uc2lkZXJpbmd8Y29uY2VybmluZ3xyZWdhcmRpbmd8ZXhjbHVkaW5nfGluY2x1ZGluZ3xmb2xsb3dpbmd8bm90d2l0aHN0YW5kaW5nfGZhaWxpbmd8YW4/fHRoZXx0aGlzfHRoZXNlfHRob3NlfG15fHlvdXJ8b3VyfHRoZWlyfGl0c3xoaXN8aGVyfHJlZ2FyZGxlc3N8YW55d2F5fGFueWhvd3xpbnN0ZWFkfG90aGVyd2lzZXxsaWtld2lzZXxub25ldGhlbGVzc3xuZXZlcnRoZWxlc3N8bWVhbndoaWxlfG1vcmVvdmVyfGZ1cnRoZXJtb3JlfHRoZXJlYWZ0ZXJ8YWx0b2dldGhlcnxhZ2Fpbnxzb29ufHRvZGF5fHRvbW9ycm93fHllc3RlcmRheXxoZXJlfHRoZXJlfHRoZW58bm93fGFscmVhZHl8c3RpbGwpfGd1YXJhbnRcdyopXGIpW2Etel0pfCg/Oig/OmNlcnRhaW58YXNzdXJlZHxkZXN0aW5lZHxpbmV2aXRhYmxlfHN1cmV8Ym91bmR8bm9ccytkb3VidHwoPzphbGxccytidXR8dmlydHVhbGx5fHByYWN0aWNhbGx5fG5lYXJseXxlc3NlbnRpYWxseSlccytjZXJ0YWlufCg/OnZlcnl8aGlnaGx5fGV4dHJlbWVseXxxdWl0ZXxtb3N0fHJlYWxseXxzdXBlcilccytsaWtlbHl8bGlrZWx5KXwoPzpndWFyYW50ZWVzP3xndWFyYW50ZWVkfCg/OmFsbFxzK2J1dHx2aXJ0dWFsbHl8cHJhY3RpY2FsbHl8bmVhcmx5fGVzc2VudGlhbGx5KVxzK2d1YXJhbnRlZWQpKVxzK3RvXHMrKD86W2EteiddK1xzKyl7MCwyfT8oPzpcYmFwcHJvdmVbc2RdP1xifFxiYXBwcm92aW5nXGJ8XGJhcHByb3ZhbHM/XGJ8XGJkaXNhcHByb3ZcdypcYnxcYnByZVtccy1dP2FwcHJvdlx3KlxifFxicHJlW1xzLV0/cXVhbGlmXHcqXGJ8XGJxdWFsaWZcdypcYnxcYmZ1bmRlZFxifFxiYWNjZXB0KD86c3xlZHxpbmd8YW5jZXxhbmNlcyk/XGJ8XGJncmVlbltccy1dP2xpdFxifFxiZ3JlZW5bXHMtXT9saWdodCg/OnN8ZWR8aW5nKT9cYnxcYnVuZGVyd3JpdHRlblxifFxidW5kZXJ3cml0KD86ZXxlc3xpbmcpXGJ8XGJjbGVhcig/OnN8ZWR8aW5nfGFuY2V8YW5jZXMpP1xifFxiZ3JhbnQoPzpzfGVkfGluZyk/XGJ8XGJhd2FyZCg/OnN8ZWR8aW5nKT9cYnxcYnNpZ25lZD9bXHMtXW9mZlxifFxic2lnbltccy1db2ZmXGJ8XGJkZW4oPzp5fGllc3xpZWR8eWluZ3xpYWx8aWFscylcYnxcYmRlY2xpbig/OmV8ZXN8ZWR8aW5nfGF0aW9ufGF0aW9ucylcYnxcYnJlamVjdCg/OnN8ZWR8aW5nfGlvbnxpb25zKT9cYnxwYXNzKD86ZXN8ZWR8aW5nKT9ccysoPzp1bmRlcndyaXRpbmd8dGhlXHMrKD86dW5kZXJ3cml0ZXJ8bGVuZGVyfGNyZWRpdFxzK2NoZWNrfGNvbW1pdHRlZXxyZXZpZXcpKXxwYXNzKD86ZXN8ZWR8aW5nKT9ccytvblxzKyg/OnlvdXx5b3VyKXxpc3N1KD86ZXxlc3xlZHxpbmcpXHMrKD86eW91XHMrKT8oPzp0aGVccyt8YVxzKyk/KD86bG9hbnxsaW5lfGZ1bmRpbmd8Y3JlZGl0KXxleHRlbmQoPzpzfGVkfGluZyk/XHMrKD86eW91XHMrKT8oPzp0aGVccyt8YVxzKyk/KD86Y3JlZGl0fGxpbmV8bG9hbnxmdW5kaW5nKXxzZWN1cig/OmV8ZXN8ZWR8aW5nKVxzKyg/OnlvdVxzKyk/KD86dGhlXHMrfGFccyspPyg/OmxvYW58bGluZXxmdW5kaW5nfGNyZWRpdCl8dHVybig/OnN8ZWR8aW5nKT9ccysoPzp5b3Vccyt8dGhlbVxzKyk/ZG93bnxnZXQoPzpzfHRpbmcpP1xzK3lvdVxzK2lufHNheSg/OnN8aW5nKT9ccysoPzp5ZXN8bm8pfCg/OmF8YW58dGhlKVxzKyg/Onllc3xubylcYnwoPzp5ZXN8bm8pXHMrZnJvbVxzKyg/OnRoZVxzKyk/bGVuZGVyfFxiZ29bXHMtXT9haGVhZFxiKD8hXHMrYW5kXGIpfCg/OnRoZXxhKVxzK2dyZWVuXHMrbGlnaHQpKQ=='),
  // The guarantee family as one part, taken off the stem so no inflection of it is a hole. A stated
  // fraction of principal is a term of a lending instrument, so a clause carrying this vocabulary
  // beside an instrument is describing the product rather than the reader — and that has to hold
  // however the certainty is phrased. C27 therefore states the carve-out as an absence over the
  // whole clause instead of stripping the vocabulary out of one certainty slot, which left every
  // other path into the rule open: the seventh pass found the copular path still reaching it.
  guarantee: atob('XGJndWFyYW50XHcqXGI='),
  certain: atob('XGIoPzpjZXJ0YWlufGd1YXJhbnRlZWQ/fGFzc3VyZWR8ZGVzdGluZWR8aW5ldml0YWJsZXxzdXJlXHMrKD86dG98dGhpbmcpfGJvdW5kXHMrdG98bm9ccytkb3VidHwoPzphbGxccytidXR8dmlydHVhbGx5fHByYWN0aWNhbGx5fG5lYXJseXxlc3NlbnRpYWxseSlccysoPzpjZXJ0YWlufGd1YXJhbnRlZWQpfCg/OnZlcnl8aGlnaGx5fGV4dHJlbWVseXxxdWl0ZXxtb3N0fHJlYWxseXxzdXBlcilccytsaWtlbHl8bGlrZWx5KVxi'),
  change: atob('XGIoPzpyYWlzZXxyYWlzZXN8cmFpc2VkfHJhaXNpbmd8Ym9vc3R8Ym9vc3RzfGJvb3N0ZWR8Ym9vc3Rpbmd8aW5jcmVhc2V8aW5jcmVhc2VzfGluY3JlYXNlZHxpbmNyZWFzaW5nfGltcHJvdmV8aW1wcm92ZXN8aW1wcm92ZWR8aW1wcm92aW5nfGFkZHxhZGRzfGFkZGVkfGFkZGluZ3xnYWlufGdhaW5zfGdhaW5lZHxnYWluaW5nfGxpZnR8bGlmdHN8bGlmdGVkfGxpZnRpbmd8anVtcHxqdW1wc3xqdW1wZWR8anVtcGluZ3xyaXNlfHJpc2VzfHJpc2luZ3xyb3NlfHJpc2VufGdyb3d8Z3Jvd3N8Z3Jvd2luZ3xncmV3fGdyb3dufGNsaW1ifGNsaW1ic3xjbGltYmVkfGNsaW1iaW5nfGJ1bXB8YnVtcHN8YnVtcGVkfGJ1bXBpbmd8ZWxldmF0ZXxlbGV2YXRlc3xlbGV2YXRlZHxlbGV2YXRpbmd8cHVzaHxwdXNoZXN8cHVzaGVkfHB1c2hpbmd8aGlrZXxoaWtlc3xoaWtlZHxoaWtpbmd8c3VyZ2V8c3VyZ2VzfHN1cmdlZHxzdXJnaW5nfHNwaWtlfHNwaWtlc3xzcGlrZWR8c3Bpa2luZ3xhZHZhbmNlfGFkdmFuY2VzfGFkdmFuY2VkfGFkdmFuY2luZ3xzdHJlbmd0aGVufHN0cmVuZ3RoZW5zfHN0cmVuZ3RoZW5lZHxzdHJlbmd0aGVuaW5nfHJlY292ZXJ8cmVjb3ZlcnN8cmVjb3ZlcmVkfHJlY292ZXJpbmd8aGlnaGVyfHVwd2FyZHx1cHdhcmRzfHVwXHMrKD86YnlccyspPyg/PVxkKXwoPzpnb3xnb2VzfGdvaW5nfHdlbnR8Z29uZXxtb3ZlfG1vdmVzfG1vdmVkfG1vdmluZ3xwdXNofHB1c2hlc3xwdXNoZWR8cHVzaGluZ3x0aWNrfHRpY2tzfHRpY2tlZHx0aWNraW5nfHRyZW5kfHRyZW5kc3x0cmVuZGluZ3xoZWFkfGhlYWRzfGhlYWRpbmd8c2hvb3R8c2hvb3RzfHNob3R8c2hvb3Rpbmd8Y3JlZXB8Y3JlZXBzfGNyZXB0fGNyZWVwaW5nKVxzK3VwfHRhY2soPzpzfGVkfGluZyk/XHMrb258bmV0KD86c3x0ZWR8dGluZyk/XHMrKD86eW91fHlvdXJ8dGhlbSkp'),
  label: atob('KD86XGIoPzpjb25zdW1lcnxjbGllbnR8cGVyc29uYWx8aW5kaXZpZHVhbHxidXNpbmVzcylbXHMuXy1dKyk/XGIoPzpjcmVkaXR8ZmluYW5jaWFsKVtccy5fLV0rKD86c2VydmljZXM/fGFkdmlzb3J5fGFkdmlzb3JzP3xjb25zdWx0aW5nfGNvbnN1bHRhbmN5fGNvbnN1bHRhbnR8Y291bnNlbGluZ3xjb3Vuc2VsbGluZ3xjb2FjaGluZ3xyZXN0b3JhdGlvbnxyZXBhaXJ8aW1wcm92ZW1lbnR8bWFuYWdlbWVudCkoPzpbXHMuXy1dKyg/OmNsaWVudHxjb25zdW1lcnxwcm9ncmFtfGVucm9sbG1lbnR8c2VydmljZXM/KSk/W1xzLl8tXSsoPzphZ3JlZW1lbnR8Y29udHJhY3QpXGI='),
  move: atob('XGIoPzpyYWlzZXxyYWlzZXN8cmFpc2VkfHJhaXNpbmd8Ym9vc3R8Ym9vc3RzfGJvb3N0ZWR8Ym9vc3Rpbmd8aW5jcmVhc2V8aW5jcmVhc2VzfGluY3JlYXNlZHxpbmNyZWFzaW5nfGltcHJvdmV8aW1wcm92ZXN8aW1wcm92ZWR8aW1wcm92aW5nfGFkZHxhZGRzfGFkZGVkfGFkZGluZ3xnYWlufGdhaW5zfGdhaW5lZHxnYWluaW5nfGxpZnR8bGlmdHN8bGlmdGVkfGxpZnRpbmd8anVtcHxqdW1wc3xqdW1wZWR8anVtcGluZ3xyaXNlfHJpc2VzfHJpc2luZ3xyb3NlfHJpc2VufGdyb3d8Z3Jvd3N8Z3Jvd2luZ3xncmV3fGdyb3dufGNsaW1ifGNsaW1ic3xjbGltYmVkfGNsaW1iaW5nfGJ1bXB8YnVtcHN8YnVtcGVkfGJ1bXBpbmd8ZWxldmF0ZXxlbGV2YXRlc3xlbGV2YXRlZHxlbGV2YXRpbmd8cHVzaHxwdXNoZXN8cHVzaGVkfHB1c2hpbmd8aGlrZXxoaWtlc3xoaWtlZHxoaWtpbmd8c3VyZ2V8c3VyZ2VzfHN1cmdlZHxzdXJnaW5nfHNwaWtlfHNwaWtlc3xzcGlrZWR8c3Bpa2luZ3xhZHZhbmNlfGFkdmFuY2VzfGFkdmFuY2VkfGFkdmFuY2luZ3xzdHJlbmd0aGVufHN0cmVuZ3RoZW5zfHN0cmVuZ3RoZW5lZHxzdHJlbmd0aGVuaW5nfHJlY292ZXJ8cmVjb3ZlcnN8cmVjb3ZlcmVkfHJlY292ZXJpbmd8aGlnaGVyfHVwd2FyZHx1cHdhcmRzfHRha2V8dGFrZXN8dGFraW5nfHRvb2t8dGFrZW58Z2V0fGdldHN8Z2V0dGluZ3xnb3R8Z290dGVufG1vdmV8bW92ZXN8bW92ZWR8bW92aW5nfGJyaW5nfGJyaW5nc3xicmluZ2luZ3xicm91Z2h0fGNhcnJ5fGNhcnJpZXN8Y2FycmllZHxjYXJyeWluZ3x3YWxrfHdhbGtzfHdhbGtlZHx3YWxraW5nfGdvfGdvZXN8Z29pbmd8d2VudHxnb25lfHB1dHxwdXRzfHB1dHRpbmd8cmVhY2h8cmVhY2hlc3xyZWFjaGVkfHJlYWNoaW5nfGhpdHxoaXRzfGhpdHRpbmd8bGFuZHxsYW5kc3xsYW5kZWR8bGFuZGluZ3xkcml2ZXxkcml2ZXN8ZHJvdmV8ZHJpdmVufGRyaXZpbmd8aGVhZHxoZWFkc3xoZWFkZWR8aGVhZGluZ3xzaXR8c2l0c3xzaXR0aW5nfHNhdHxzdGFydHxzdGFydHN8c3RhcnRlZHxzdGFydGluZ3xlbmR8ZW5kc3xlbmRlZHxlbmRpbmd8ZmluaXNofGZpbmlzaGVzfGZpbmlzaGVkfGZpbmlzaGluZ3x0b3B8dG9wc3x0b3BwZWR8dG9wcGluZ3x1cFxzKyg/OmJ5XHMrKT8oPz1cZCl8KD86Z298Z29lc3xnb2luZ3x3ZW50fGdvbmV8bW92ZXxtb3Zlc3xtb3ZlZHxtb3Zpbmd8cHVzaHxwdXNoZXN8cHVzaGVkfHB1c2hpbmd8dGlja3x0aWNrc3x0aWNrZWR8dGlja2luZ3x0cmVuZHx0cmVuZHN8dHJlbmRpbmd8aGVhZHxoZWFkc3xoZWFkaW5nfHNob290fHNob290c3xzaG90fHNob290aW5nfGNyZWVwfGNyZWVwc3xjcmVwdHxjcmVlcGluZylccyt1cHx0YWNrKD86c3xlZHxpbmcpP1xzK29ufG5ldCg/OnN8dGVkfHRpbmcpP1xzKyg/OnlvdXx5b3VyfHRoZW0pKQ=='),
  numeric: atob('KD86AXxcYlxkezEsM31ccysoPzp0aW1lc1xzKyk/KD86aW58b3V0XHMrb2YpXHMrKD86ZXZlcnlccyspP1xkezEsM31cYik='),
  // R5D-05 fourth pass. The reader's outcome, which is the other half of the decision frame:
  // PART.approval names the decision, this names the thing decided about — the money, the
  // instrument it arrives in, and the vehicle the reader submits. `funding` sits here and
  // deliberately not in the decision set. On its own it is the product's own name for itself and
  // one of the clean controls turns on it, but a clause that also carries a person word, a
  // certainty word and a percentage is not describing a product. Per-rule tiering, same as the
  // decision verbs.
  // The money and the vehicle the reader submits. A guarantee percentage is not a property of
  // any of these, so the whole certainty vocabulary composes with them.
  outcomeMoney: atob('KD86XGJmdW5kaW5nXGJ8XGJmaW5hbmNpbmdcYnxcYmNhcGl0YWxcYnxcYnByb2NlZWRzXGJ8XGJwYXlvdXRzP1xifFxidGVybVxzK3NoZWV0cz9cYnxcYm9mZmVycz9cYnxcYmRlYWxzP1xifFxiYXBwbGljYXRpb25zP1xifFxic3VibWlzc2lvbnM/XGJ8XGJyZXF1ZXN0cz9cYnxcYmZpbGVzP1xiKQ=='),
  // The instruments. An SBA 7(a) guarantee is a stated fraction of principal, so a guarantee
  // percentage attached to one of these is a property of the product rather than a claim about
  // the reader's odds. Same homonym treatment as pass, issue, extend and secure: the word is
  // bounded where its non-lending-decision sense is the ordinary one.
  outcomeInstrument: atob('KD86XGJsb2Fucz9cYnxcYmxpbmVzP1xzK29mXHMrY3JlZGl0XGJ8XGJjcmVkaXRccytsaW5lcz9cYnxcYm5vdGVzP1xifFxiZmFjaWxpdCg/Onl8aWVzKVxifFxibW9ydGdhZ2VzP1xifFxiYWR2YW5jZXM/XGJ8XGI3XChhXCl8XGI1MDRcYik='),
  person: atob('KD86XGJ5b3VyP3M/XGJ8XGJhcHBsaWNhbnRzP1xzK2xpa2Vccyt5b3VcYnxcYmNsaWVudHM/XHMrKD86bGlrZXx3aXRoKVxzK3lvdXJcYnxcYnBlb3BsZVxzKyg/Omxpa2Vccyt5b3V8bWF0Y2hpbmdccysoPzp5b3VyfHRoZXNlKSlcYik='),
  promise: atob('XGIoPzp3aWxsXHMrKD86YmVccyspPyg/OmFwcHJvdmVkfGFjY2VwdGVkfHF1YWxpZmllZHxxdWFsaWZ5fGZ1bmRlZHxncmVlbltccy1dP2xpdHxjbGVhcmVkfHVuZGVyd3JpdHRlbnxncmFudGVkfHByZVtccy1dP2FwcHJvdmVkfHByZVtccy1dP3F1YWxpZmllZHxpbil8d2lsbFxzKyg/OnJlY2VpdmV8Z2V0fGhhdmV8c2VlfGxhbmQpXHMrKD86YXBwcm92YWx8YWNjZXB0YW5jZXxmdW5kaW5nfGNyZWRpdHx0aGVccytsb2FufHRoZVxzK2xpbmV8YVxzK3llcyl8d2lsbFxzK2dldFxzK3lvdVxzKyg/OmFwcHJvdmVkfGFjY2VwdGVkfHF1YWxpZmllZHxxdWFsaWZ5fGZ1bmRlZHxncmVlbltccy1dP2xpdHxjbGVhcmVkfHVuZGVyd3JpdHRlbnxncmFudGVkfHByZVtccy1dP2FwcHJvdmVkfHByZVtccy1dP3F1YWxpZmllZHxpbil8KD86YXJlfGlzfCdyZXwncylccytnb2luZ1xzK3RvXHMrKD86YmVccyspPyg/OmFwcHJvdmVkfGFjY2VwdGVkfHF1YWxpZmllZHxxdWFsaWZ5fGZ1bmRlZHxncmVlbltccy1dP2xpdHxjbGVhcmVkfHVuZGVyd3JpdHRlbnxncmFudGVkfHByZVtccy1dP2FwcHJvdmVkfHByZVtccy1dP3F1YWxpZmllZHxpbil8Z3VhcmFudGVlZFxzKyg/OmFwcHJvdmFsfGFjY2VwdGFuY2V8ZnVuZGluZykpXGI='),
  // C25 admits an impersonal subject so that a promise phrased about the book rather than about
  // the reader still lands, but only for verbs that carry an object somewhere. The stative and
  // intransitive members of `move` (sit, start, end, top, land) describe where a band already is,
  // which is ordinary factual copy about the scale, so they are admitted only through `move` where
  // C26 pairs them with a person.
  transport: atob('XGIoPzp0YWtlfHRha2VzfHRha2luZ3x0b29rfHRha2VufGdldHxnZXRzfGdldHRpbmd8Z290fGdvdHRlbnxicmluZ3xicmluZ3N8YnJpbmdpbmd8YnJvdWdodHxjYXJyeXxjYXJyaWVzfGNhcnJpZWR8Y2Fycnlpbmd8d2Fsa3x3YWxrc3x3YWxrZWR8d2Fsa2luZ3xkcml2ZXxkcml2ZXN8ZHJvdmV8ZHJpdmVufGRyaXZpbmd8cHVzaHxwdXNoZXN8cHVzaGVkfHB1c2hpbmd8bW92ZXxtb3Zlc3xtb3ZlZHxtb3Zpbmd8cHV0fHB1dHN8cHV0dGluZ3xsaWZ0fGxpZnRzfGxpZnRlZHxsaWZ0aW5nfHJhaXNlfHJhaXNlc3xyYWlzZWR8cmFpc2luZ3xib29zdHxib29zdHN8Ym9vc3RlZHxib29zdGluZ3xndWlkZXxndWlkZXN8Z3VpZGVkfGd1aWRpbmd8aGVscHxoZWxwc3xoZWxwZWR8aGVscGluZylcYg=='),
  quantity: atob('XGJcZHsxLDN9XHM/LT9ccz8oPzpwdHM/XGJ8cG9pbnRzP1xiKQ=='),
  // R5 second pass. `range` used to be one linear pattern that spelled out from-to and then
  // to-from as two alternatives, which is phrase-order enumeration wearing a compositional coat —
  // naming the destination first and the present value in a trailing subordinate clause is the
  // same claim in a third order, and it walked straight through. The two endpoints are now two
  // independent parts, so the rule that wants both of them is
  // order-independent by construction instead of by enumerating the orders. The left side of an
  // arrow is a start value and the right side an end value, which folds the arrow form in without
  // a third alternative.
  //
  // Every endpoint carries a trailing unit guard, because a three-digit number followed by a unit
  // noun is a viewport, a currency amount or a row count, and this tree is full of all three.
  bandFrom: atob('KD86XGJmcm9tXGJbXi5cbl17MCwyNX0/XGJbMy04XVxkezJ9XGIoPyFccyooPzptc3xtaWxsaXNlY29uZHxzZWN8c2Vjb25kfG1pbnxtaW51dGV8aHJ8aG91cnxkYXl8d2Vla3xtb250aHxxdWFydGVyfHllYXJ8cHh8cGl4ZWx8cmVtfGVtcz98cHR8cHRzfHBvaW50fGRwfHZofHZ3fGNofGJ8a2J8bWJ8Z2J8dGJ8Ynl0ZXxraWxvYnl0ZXxtZWdhYnl0ZXxnaWdhYnl0ZXxjaGFyYWN0ZXJ8Y2hhcnx3b3JkfHRva2VufGRvbGxhcnxjZW50fHVzZHxldXJ8Z2JwfGNsaWVudHxjdXN0b21lcnxjb25zdW1lcnx1c2VyfG1lbWJlcnx0ZW5hbnR8b3BlcmF0b3J8YWZmaWxpYXRlfGxlbmRlcnxiYW5rfHBhcnRuZXJ8cm93fHJlY29yZHxpdGVtfGZpbGV8cGFnZXxlbnRyeXxyZXN1bHR8YWNjb3VudHxhcHBsaWNhdGlvbnx0YXNrfGxlYWR8Y2FsbHxlbWFpbHxtZXNzYWdlfGhpdHxtYXRjaHxlcnJvcnx3YXJuaW5nfHRlc3R8Y2hlY2t8c3RlcHxxdWVzdGlvbnxvcHRpb258c2xvdHxzZWF0fGxpY2VuW2NzXWUpZT9zP1xifFxzKgIpfFxiWzMtOF1cZHsyfVxzKig/Oi0+fD0+fFx1MjE5MnxcdTIxRDJ8XHUyNzk0fFx1Mjc5Q3xcdTI3QTEpKQ=='),
  bandTo: atob('KD86XGIoPzp0b3x1cFxzK3RvfGludG98dGhyb3VnaCg/OlxzK3RvKT98dG93YXJkKD86cyk/fG5lYXJ8YXJvdW5kfGFib3V0fGNsb3NlXHMrdG98cmVhY2goPzplc3xlZHxpbmcpP3xoaXQoPzpzfHRpbmcpP3x0b3AoPzpzfHBpbmcpP3xhdHxvZilccysoPzphXHMrfGFuXHMrfHRoZVxzKyk/WzMtOF1cZHsyfVxiKD8hXHMqKD86bXN8bWlsbGlzZWNvbmR8c2VjfHNlY29uZHxtaW58bWludXRlfGhyfGhvdXJ8ZGF5fHdlZWt8bW9udGh8cXVhcnRlcnx5ZWFyfHB4fHBpeGVsfHJlbXxlbXM/fHB0fHB0c3xwb2ludHxkcHx2aHx2d3xjaHxifGtifG1ifGdifHRifGJ5dGV8a2lsb2J5dGV8bWVnYWJ5dGV8Z2lnYWJ5dGV8Y2hhcmFjdGVyfGNoYXJ8d29yZHx0b2tlbnxkb2xsYXJ8Y2VudHx1c2R8ZXVyfGdicHxjbGllbnR8Y3VzdG9tZXJ8Y29uc3VtZXJ8dXNlcnxtZW1iZXJ8dGVuYW50fG9wZXJhdG9yfGFmZmlsaWF0ZXxsZW5kZXJ8YmFua3xwYXJ0bmVyfHJvd3xyZWNvcmR8aXRlbXxmaWxlfHBhZ2V8ZW50cnl8cmVzdWx0fGFjY291bnR8YXBwbGljYXRpb258dGFza3xsZWFkfGNhbGx8ZW1haWx8bWVzc2FnZXxoaXR8bWF0Y2h8ZXJyb3J8d2FybmluZ3x0ZXN0fGNoZWNrfHN0ZXB8cXVlc3Rpb258b3B0aW9ufHNsb3R8c2VhdHxsaWNlbltjc11lKWU/cz9cYnxccyoCKXwoPzotPnw9PnxcdTIxOTJ8XHUyMUQyfFx1Mjc5NHxcdTI3OUN8XHUyN0ExKVxzKlszLThdXGR7Mn1cYig/IVxzKig/Om1zfG1pbGxpc2Vjb25kfHNlY3xzZWNvbmR8bWlufG1pbnV0ZXxocnxob3VyfGRheXx3ZWVrfG1vbnRofHF1YXJ0ZXJ8eWVhcnxweHxwaXhlbHxyZW18ZW1zP3xwdHxwdHN8cG9pbnR8ZHB8dmh8dnd8Y2h8YnxrYnxtYnxnYnx0YnxieXRlfGtpbG9ieXRlfG1lZ2FieXRlfGdpZ2FieXRlfGNoYXJhY3RlcnxjaGFyfHdvcmR8dG9rZW58ZG9sbGFyfGNlbnR8dXNkfGV1cnxnYnB8Y2xpZW50fGN1c3RvbWVyfGNvbnN1bWVyfHVzZXJ8bWVtYmVyfHRlbmFudHxvcGVyYXRvcnxhZmZpbGlhdGV8bGVuZGVyfGJhbmt8cGFydG5lcnxyb3d8cmVjb3JkfGl0ZW18ZmlsZXxwYWdlfGVudHJ5fHJlc3VsdHxhY2NvdW50fGFwcGxpY2F0aW9ufHRhc2t8bGVhZHxjYWxsfGVtYWlsfG1lc3NhZ2V8aGl0fG1hdGNofGVycm9yfHdhcm5pbmd8dGVzdHxjaGVja3xzdGVwfHF1ZXN0aW9ufG9wdGlvbnxzbG90fHNlYXR8bGljZW5bY3NdZSllP3M/XGJ8XHMqAikp'),
  // A destination with no starting point stated. Still a numeric promise about the metric, so it is
  // covered: either the number carries an article and stands on its own, or the metric is named in
  // the same clause and the words between them do not have to be enumerated.
  target: atob('KD86XGIoPzp0b3x1cFxzK3RvfGludG98dGhyb3VnaCg/OlxzK3RvKT98dG93YXJkKD86cyk/fG5lYXJ8YXJvdW5kfGFib3V0fGNsb3NlXHMrdG98cmVhY2goPzplc3xlZHxpbmcpP3xoaXQoPzpzfHRpbmcpP3x0b3AoPzpzfHBpbmcpP3xhdHxvZilccysoPzphfGFufHRoZSlccytbMy04XVxkezJ9XGIoPyFccyooPzptc3xtaWxsaXNlY29uZHxzZWN8c2Vjb25kfG1pbnxtaW51dGV8aHJ8aG91cnxkYXl8d2Vla3xtb250aHxxdWFydGVyfHllYXJ8cHh8cGl4ZWx8cmVtfGVtcz98cHR8cHRzfHBvaW50fGRwfHZofHZ3fGNofGJ8a2J8bWJ8Z2J8dGJ8Ynl0ZXxraWxvYnl0ZXxtZWdhYnl0ZXxnaWdhYnl0ZXxjaGFyYWN0ZXJ8Y2hhcnx3b3JkfHRva2VufGRvbGxhcnxjZW50fHVzZHxldXJ8Z2JwfGNsaWVudHxjdXN0b21lcnxjb25zdW1lcnx1c2VyfG1lbWJlcnx0ZW5hbnR8b3BlcmF0b3J8YWZmaWxpYXRlfGxlbmRlcnxiYW5rfHBhcnRuZXJ8cm93fHJlY29yZHxpdGVtfGZpbGV8cGFnZXxlbnRyeXxyZXN1bHR8YWNjb3VudHxhcHBsaWNhdGlvbnx0YXNrfGxlYWR8Y2FsbHxlbWFpbHxtZXNzYWdlfGhpdHxtYXRjaHxlcnJvcnx3YXJuaW5nfHRlc3R8Y2hlY2t8c3RlcHxxdWVzdGlvbnxvcHRpb258c2xvdHxzZWF0fGxpY2VuW2NzXWUpZT9zP1xifFxzKgIpfFxiKD86c2NvcmVzP3xmaWNvfHZhbnRhZ2VcdyopXGJbXi5cbl17MCw0MH0/XGIoPzp0b3x1cFxzK3RvfGludG98dGhyb3VnaCg/OlxzK3RvKT98dG93YXJkKD86cyk/fG5lYXJ8YXJvdW5kfGFib3V0fGNsb3NlXHMrdG98cmVhY2goPzplc3xlZHxpbmcpP3xoaXQoPzpzfHRpbmcpP3x0b3AoPzpzfHBpbmcpP3xhdHxvZilccysoPzphXHMrfGFuXHMrfHRoZVxzKyk/WzMtOF1cZHsyfVxiKD8hXHMqKD86bXN8bWlsbGlzZWNvbmR8c2VjfHNlY29uZHxtaW58bWludXRlfGhyfGhvdXJ8ZGF5fHdlZWt8bW9udGh8cXVhcnRlcnx5ZWFyfHB4fHBpeGVsfHJlbXxlbXM/fHB0fHB0c3xwb2ludHxkcHx2aHx2d3xjaHxifGtifG1ifGdifHRifGJ5dGV8a2lsb2J5dGV8bWVnYWJ5dGV8Z2lnYWJ5dGV8Y2hhcmFjdGVyfGNoYXJ8d29yZHx0b2tlbnxkb2xsYXJ8Y2VudHx1c2R8ZXVyfGdicHxjbGllbnR8Y3VzdG9tZXJ8Y29uc3VtZXJ8dXNlcnxtZW1iZXJ8dGVuYW50fG9wZXJhdG9yfGFmZmlsaWF0ZXxsZW5kZXJ8YmFua3xwYXJ0bmVyfHJvd3xyZWNvcmR8aXRlbXxmaWxlfHBhZ2V8ZW50cnl8cmVzdWx0fGFjY291bnR8YXBwbGljYXRpb258dGFza3xsZWFkfGNhbGx8ZW1haWx8bWVzc2FnZXxoaXR8bWF0Y2h8ZXJyb3J8d2FybmluZ3x0ZXN0fGNoZWNrfHN0ZXB8cXVlc3Rpb258b3B0aW9ufHNsb3R8c2VhdHxsaWNlbltjc11lKWU/cz9cYnxccyoCKSk='),
});

/**
 * One clause containing every part, in any order.
 *
 * The lookahead form is what buys the order independence: anchoring at a clause boundary and then
 * asserting each part somewhere in the rest of the clause means no part has to precede another, and
 * two parts that overlap in the text (a percentage that is also part of the rate phrase) cannot
 * defeat the match the way a concatenated sequence would. `[^.\n]` is the clause bound the rules
 * above already use.
 */
function clauseContains(...parts) {
  return `(?:^|[.\\n])${parts.map((part) => `(?=[^.\\n]*${part})`).join('')}`;
}

/**
 * One clause satisfying any one of several part groups.
 *
 * Same lookahead form as clauseContains, so every group stays order-independent; the alternation is
 * over the groups, not over word orders. It exists because one rule can need different evidence
 * depending on which subject it found — a guarantee percentage is a domain fact about an instrument
 * and an odds claim about a sum of money, and that is one rule with two pairings rather than two
 * rules or a looser single one.
 */
function clauseContainsAny(...groups) {
  const alternatives = groups
    .map((group) => {
      const { absent = [], parts } = Array.isArray(group) ? { parts: group } : group;
      return [
        ...absent.map((part) => `(?![^.\\n]*${part})`),
        ...parts.map((part) => `(?=[^.\\n]*${part})`),
      ].join('');
    })
    .join('|');
  return `(?:^|[.\\n])(?:${alternatives})`;
}

const COMPOSED_SOURCES = Object.freeze([
  // The restricted decision vocabulary, addressed to the reader, carrying any numeric expression.
  clauseContains(PART.person, PART.approval, PART.numeric),
  // A numeric point quantity connected to a promised change.
  clauseContains(PART.quantity, PART.change),
  // The service-agreement contract label family, as a bounded name grammar.
  PART.label,
  // A personalized certainty of approval, with or without the disclaimer that precedes it.
  clauseContains(PART.person, PART.certain, PART.approval),
  // A flat personalized approval promise.
  clauseContains(PART.person, PART.promise),
  // R5D-04. A start-to-end pair in the metric's band, held either by the reader it is addressed to
  // or by the movement verb that makes it a claim rather than an observation. Both anchors are
  // needed and neither is enough alone: a band pair with no anchor is an eligibility range, which
  // is ordinary and legitimate copy, and an anchor with no band pair is most of the English
  // language. The two endpoints are separate parts, so the endpoints may appear in either order and
  // any number of words apart. Appended after C24 so every existing rule id stays where it was.
  clauseContains(`(?:${PART.person}|${PART.transport})`, PART.bandFrom, PART.bandTo),
  // R5D-04. The same claim with the starting point left out. One number is weaker evidence than
  // two, so this one wants all three parts rather than two.
  clauseContains(PART.person, PART.move, PART.target),
  // R5D-05, fourth pass. A certainty word bound to a percentage about the reader's own result.
  // C14 used to reach part of this family through a subject list that included the bare noun for
  // money, which is why removing that noun looked safe and was not: C14's other branch requires the
  // percentage, then the certainty word, then the subject, in that order, so the possessive form
  // walks past it. That is phrase-order enumeration in the rule that was supposed to be the
  // backstop. This one composes the parts instead, so both orderings and any distance between them
  // are covered by construction rather than by writing the orders out.
  clauseContainsAny(
    [PART.person, `(?:${PART.outcomeMoney}|${PART.approval})`, PART.certainOutcome, PERCENT_VALUE_SLOT],
    {
      absent: [PART.guarantee],
      parts: [PART.person, PART.outcomeInstrument, PART.certainOutcome, PERCENT_VALUE_SLOT],
    },
  ),
]);

export const COMPLIANCE_LANGUAGE_RULES = Object.freeze(
  [...SOURCES.map(atob), ...COMPOSED_SOURCES].map(withPercent).map((source, index) => Object.freeze({
    id: `C${String(index + 1).padStart(2, '0')}`,
    code: `LANGUAGE_C${String(index + 1).padStart(2, '0')}`,
    pattern: new RegExp(source, 'i'),
  })),
);

function collectStrings(value, output) {
  if (typeof value === 'string') {
    output.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, output);
  } else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      output.push(key);
      collectStrings(item, output);
    }
  }
}

const SMALL_NUMBER_WORDS = Object.freeze({
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90,
});

const NUMBER_WORD = Object.keys(SMALL_NUMBER_WORDS).join('|');
const UNIT_WORD = 'one|two|three|four|five|six|seven|eight|nine';
// R5D-04. The fold stopped at two digits, which was enough while the only spelled-out claim the
// corpus carried was a quantity. The restricted metric is a three-digit number, so a claim written
// out in words sat entirely outside every numeric rule. Hundreds first in the alternation: the
// two-digit branch would otherwise consume the leading word and leave the rest unfolded.
const NUMBER_WORD_PATTERN = new RegExp(
  `\\b(?:(${UNIT_WORD})\\s+hundred(?:\\s+and)?(?:[\\s-]+(${NUMBER_WORD})(?:[- ](${UNIT_WORD}))?)?`
  + `|(${NUMBER_WORD})(?:[- ](${UNIT_WORD}))?)\\b`,
  'gi',
);

function foldNumberWords(_match, hundreds, hundredsTens, hundredsUnits, tens, units) {
  const value = (word) => (word ? SMALL_NUMBER_WORDS[word.toLowerCase()] : 0);
  return String(hundreds
    ? value(hundreds) * 100 + value(hundredsTens) + value(hundredsUnits)
    : value(tens) + value(units));
}

const PROTECTED_RULE_IDS = new Set(['C12', 'C15']);
const LOOKALIKE_FOLD = Object.freeze({
  '\u0410': 'A', '\u0430': 'a', '\u0415': 'E', '\u0435': 'e', '\u0406': 'I', '\u0456': 'i',
  '\u041E': 'O', '\u043E': 'o', '\u0420': 'P', '\u0440': 'p', '\u0421': 'C', '\u0441': 'c',
  '\u0425': 'X', '\u0445': 'x', '\u0391': 'A', '\u03B1': 'a', '\u0395': 'E', '\u03B5': 'e',
  '\u0399': 'I', '\u03B9': 'i', '\u039F': 'O', '\u03BF': 'o', '\u03A1': 'P', '\u03C1': 'p',
  '\u03A4': 'T', '\u03C4': 't', '\u03A7': 'X', '\u03C7': 'x',
});
const PROTECTED_VARIANT = new RegExp(atob(
  'Q3JlZGl0W1xzLl8tXStTZXJ2aWNlW1xzLl8tXStBZ3JlZW1lbnR8Q3JlZGl0W1xzLl8tXStTZXJ2aWNlc1tccy5fLV0rQ29udHJhY3R8KD86Q29uc3VtZXJbXHMuXy1dKyk/Q3JlZGl0W1xzLl8tXStDb25zdWx0aW5nW1xzLl8tXStBZ3JlZW1lbnQ='
), 'gi');
const PROTECTED_CANONICAL = atob('Q3JlZGl0IFNlcnZpY2VzIEFncmVlbWVudA==');
const LOOKALIKE_PATTERN =
  /[\u0391\u03B1\u0395\u03B5\u0399\u03B9\u039F\u03BF\u03A1\u03C1\u03A4\u03C4\u03A7\u03C7\u0406\u0410\u0415\u041E\u0420\u0421\u0425\u0430\u0435\u043E\u0440\u0441\u0445\u0456]/gu;

// R4D-01. The homoglyph fold used to run only for the two agreement-label rules, so a single
// Cyrillic character inside an approval word walked every other rule past its own vocabulary. Fold
// once, for every rule: legitimate English copy has no Cyrillic or Greek lookalikes in it, so this
// costs nothing and closes the substitution for the whole battery rather than for two rows of it.
function normalizeComplianceText(value) {
  return value
    .normalize('NFKC')
    .replace(/\p{Cf}/gu, '')
    .replace(/[\p{Z}\s]+/gu, ' ')
    .replace(/\p{Dash_Punctuation}/gu, '-')
    .replace(LOOKALIKE_PATTERN, (character) => LOOKALIKE_FOLD[character])
    .replace(/\bper[\s-]+cent\b/gi, 'percent')
    .replace(NUMBER_WORD_PATTERN, foldNumberWords);
}

function normalizeProtectedTerms(value) {
  return normalizeComplianceText(value).replace(PROTECTED_VARIANT, PROTECTED_CANONICAL);
}

export function complianceLanguageCodes(value) {
  const strings = [];
  collectStrings(value, strings);
  const normalized = strings.map(normalizeComplianceText);
  const protectedTerms = strings.map(normalizeProtectedTerms);
  return COMPLIANCE_LANGUAGE_RULES
    .filter((rule) => (PROTECTED_RULE_IDS.has(rule.id) ? protectedTerms : normalized)
      .some((item) => rule.pattern.test(item)))
    .map((rule) => rule.code);
}
