// Immigration profile: per person, user-entered. The USCIS case payload carries
// no priority date, category or chargeability (checked against every key the
// normalizer passes through), so nothing here can be prefilled from it.

export type ProfileFields = {
  category: string | null;
  chargeability: string | null;
  priorityDate: string | null;
};

export type PersonProfileInput = ProfileFields & {
  id: string;
  principalPersonId: string | null;
};

export type ProfileField = keyof ProfileFields;

export type ResolvedProfile = {
  /** What the person entered themselves. */
  own: ProfileFields;
  principalPersonId: string | null;
  /** What applies: own values, falling back to the principal's. */
  effective: ProfileFields;
  /** Which effective fields came from the principal. */
  inherited: Record<ProfileField, boolean>;
  /** Category, chargeability and priority date are all present (or category is an immediate relative). */
  complete: boolean;
};

/** Immediate relatives have no queue: no priority date or chargeability matters. */
export function isImmediateRelative(category: string | null | undefined): boolean {
  return /^(IR|CR)[0-9]?$/.test(category ?? "");
}

const FIELDS: ProfileField[] = ["category", "chargeability", "priorityDate"];

/**
 * A derivative beneficiary inherits category, PD and chargeability from the
 * principal unless they set their own. Follows the principal chain a few hops
 * (a principal can itself be a derivative) and stops on a cycle.
 */
export function resolveProfile(person: PersonProfileInput, all: Map<string, PersonProfileInput>): ResolvedProfile {
  const own: ProfileFields = { category: person.category, chargeability: person.chargeability, priorityDate: person.priorityDate };
  const effective: ProfileFields = { ...own };
  const inherited: Record<ProfileField, boolean> = { category: false, chargeability: false, priorityDate: false };

  const seen = new Set([person.id]);
  let next = person.principalPersonId ? all.get(person.principalPersonId) : undefined;
  for (let hops = 0; next && !seen.has(next.id) && hops < 4; hops += 1) {
    seen.add(next.id);
    for (const field of FIELDS) {
      if (effective[field] === null && next[field] !== null) {
        effective[field] = next[field];
        inherited[field] = true;
      }
    }
    next = next.principalPersonId ? all.get(next.principalPersonId) : undefined;
  }

  const complete = isImmediateRelative(effective.category) || FIELDS.every((field) => effective[field] !== null);
  return { own, principalPersonId: person.principalPersonId, effective, inherited, complete };
}
