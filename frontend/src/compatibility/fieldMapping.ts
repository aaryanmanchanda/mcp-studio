import type { FieldMapping } from './types';

// Rule-based field matching for the shape-adapter branch (CANVAS-04). Two passes
// over the property names: an exact pass (JavaScript string identity), then a
// case-insensitive pass using plain `.toLowerCase()` — never the locale-sensitive
// `.toLocaleLowerCase()`, so the result does not vary by the user's locale.
//
// Deliberate boundary — DO NOT widen this without a spec change:
//   - no Unicode normalization: "é" and "é" are different names
//   - no whitespace trimming: " name" and "name" are different names
//   - no fuzzy / edit-distance / similarity matching of any kind
// The mapping this produces is cached on the wire and never re-inferred, so it
// has to be a rule a test can pin down exactly, not a heuristic that drifts
// between library or runtime versions. Anything cleverer is a v1.1 concern
// (see PROJECT.md Out of Scope: LLM-assisted mapping suggestions).

function parseProps(schemaJson: string): Record<string, { type?: string }>{
  try {
    const parsed = JSON.parse(schemaJson);
    const props = parsed?.properties;
    if (typeof props !== "object" || props === null || Array.isArray(props)) return {};
    return props;
  } catch {
    return {};
  }
}
export function buildFieldMapping(
  sourceSchemaJson: string,
  targetSchemaJson: string,
): { mapping: FieldMapping[]; unmappedSource: string[]; unmappedTarget: string[] }
{
  const sourceKeys = Object.keys(parseProps(sourceSchemaJson));
  const targetKeys = Object.keys(parseProps(targetSchemaJson));

  const claimedTargets = new Set<string>();
  const usedSources = new Set<string>();
  const mapping: FieldMapping[] = [];

  //pass #1 (exact match)
  for (const s of sourceKeys){
    if (targetKeys.includes(s) && !claimedTargets.has(s) ) { // if exact field exists in target mappings and hasn't yet been claimed
      mapping.push({ from: s, to: s, via: "exact" } );
      claimedTargets.add(s);
      usedSources.add(s);
    }
  }

  //pass #2 (case insensitive)
  for (const s of sourceKeys) {
    if (usedSources.has(s)) continue;

    const t = targetKeys.find(t => t.toLowerCase() === s.toLowerCase() && !claimedTargets.has(t)); //if exact matches weren't found in the first pass, check if source in lower case maps to target in lowercase
    if (t){
      mapping.push({  from: s, to: t, via: "caseInsensitive" });
      claimedTargets.add(t);
      usedSources.add(s);
    }
  }

  const unmappedSource = sourceKeys.filter(s => !usedSources.has(s));
  const unmappedTarget = targetKeys.filter(t => !claimedTargets.has(t));

  return { mapping, unmappedSource, unmappedTarget };
}
