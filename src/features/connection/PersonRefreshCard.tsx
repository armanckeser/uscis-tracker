import { ExternalLink } from "lucide-react";
import { uscisCaseApiUrl } from "../../lib/uscis";
import { formatDay } from "../../../shared/predict";
import type { CaseRecord, PersonRecord } from "../../lib/types";
import { categoryName, countryName } from "../../lib/uscisCopy";

// One person and the raw USCIS link for each of their cases. There is no session
// to connect and no per-person bookmark any more: a single refresh bookmark
// covers every case, so this card is just the map from person to receipts.
export function PersonRefreshCard({
  person,
  personCases,
}: {
  person: PersonRecord;
  personCases: CaseRecord[];
}) {
  const { profile } = person;
  return (
    <article className="person-session-card">
      <div className="person-session-header">
        <div>
          <h3>{person.name}</h3>
          <p className="muted">
            {person.caseCount} {person.caseCount === 1 ? "case" : "cases"}
            {" · "}
            {profile.effective.category
              ? `${categoryName(profile.effective.category)} ${countryName(profile.effective.chargeability)}${profile.effective.priorityDate ? ` · PD ${formatDay(profile.effective.priorityDate)}` : ""}`
              : "no priority date yet"}
          </p>
        </div>
      </div>

      <div className="api-case-links" aria-label={`USCIS API links for ${person.name}`}>
        {personCases.length === 0 ? (
          <p>No cases yet. They appear here after a refresh.</p>
        ) : (
          personCases.map((caseRecord) => (
            <a
              key={caseRecord.id}
              className="case-api-link"
              href={uscisCaseApiUrl(caseRecord.receiptNumber)}
              target="_blank"
              rel="noreferrer"
            >
              <span className="mono">{caseRecord.receiptNumber}</span>
              <ExternalLink size={15} />
            </a>
          ))
        )}
      </div>
    </article>
  );
}
