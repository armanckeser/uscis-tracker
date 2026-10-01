import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, ArrowRight, Minus } from "lucide-react";
import { formatDay, formatMonth } from "../../../shared/predict";
import { getBulletinHistory } from "../../lib/api";
import type { BulletinHistory, PersonRecord } from "../../lib/types";
import { chartName, countryName } from "../../lib/uscisCopy";
import { CONFIDENCE_LABEL, deltaFor, explanationBody, headlineFor } from "./predictionCopy";
import { PriorityChart } from "./PriorityChart";

/** The card that answers "where am I in line?" for one person. */
export function PlaceInLine({
  person,
  people,
  onEditProfile,
}: {
  person: PersonRecord;
  people: PersonRecord[];
  onEditProfile: () => void;
}) {
  const { profile, prediction } = person;

  if (prediction.status === "needs_profile") {
    return (
      <button type="button" className="setup-card pressable" onClick={onEditProfile}>
        <span>
          <strong>Your place in line</strong>
          <span className="muted">Add priority date to see predictions</span>
        </span>
        <ArrowRight size={18} aria-hidden="true" />
      </button>
    );
  }

  const principalName = profile.principalPersonId ? people.find((p) => p.id === profile.principalPersonId)?.name : null;

  if (prediction.status === "no_queue" || prediction.status === "no_data") {
    return (
      <section className="card place-card" aria-labelledby={`place-${person.id}`}>
        <PlaceHeader id={person.id} onEdit={onEditProfile} />
        <p className="place-note">{prediction.explanation}</p>
      </section>
    );
  }

  return <PlaceCard person={person} principalName={principalName ?? null} onEditProfile={onEditProfile} />;
}

function PlaceHeader({ id, onEdit }: { id: string; onEdit: () => void }) {
  return (
    <header className="place-head">
      <h3 id={`place-${id}`} className="label">
        Your place in line
      </h3>
      <button type="button" className="text-button" onClick={onEdit}>
        Edit
      </button>
    </header>
  );
}

function useHistory(category: string | null, chargeability: string | null, latestBulletin: string | null) {
  const [history, setHistory] = useState<BulletinHistory | null>(null);
  useEffect(() => {
    if (!category || !chargeability) return;
    let cancelled = false;
    getBulletinHistory(category, chargeability)
      .then((data) => {
        if (!cancelled) setHistory(data);
      })
      .catch(() => {
        if (!cancelled) setHistory(null);
      });
    return () => {
      cancelled = true;
    };
  }, [category, chargeability, latestBulletin]);
  return history;
}

function cutoffText(point: { status: "date" | "current" | "unavailable"; date: string | null } | null | undefined): string {
  if (!point) return "Unknown";
  if (point.status === "current") return "Current";
  if (point.status === "unavailable") return "Unavailable";
  return point.date ? formatDay(point.date) : "Unknown";
}

function PlaceCard({ person, principalName, onEditProfile }: { person: PersonRecord; principalName: string | null; onEditProfile: () => void }) {
  const { profile, prediction } = person;
  const history = useHistory(prediction.category, prediction.chargeability, prediction.latestBulletin);
  const headline = headlineFor(prediction);
  const delta = deltaFor(prediction.sinceLastBulletin.finalAction);
  const DeltaIcon = delta?.direction === "up" ? ArrowUp : delta?.direction === "down" ? ArrowDown : Minus;
  const inheritedFrom = (field: "category" | "chargeability" | "priorityDate") =>
    profile.inherited[field] && principalName ? <span className="muted"> from {principalName}</span> : null;

  return (
    <section className="card place-card" aria-labelledby={`place-${person.id}`}>
      <PlaceHeader id={person.id} onEdit={onEditProfile} />

      <div className={`place-headline place-${headline.kind}`}>
        <p className="t-display">{headline.title}</p>
        {headline.sub &&
          (headline.kind === "eta" ? (
            <p className="place-sub">
              most likely <strong>{headline.sub.replace(/^most likely /, "")}</strong>
            </p>
          ) : (
            <p className="place-sub">{headline.sub}</p>
          ))}
      </div>

      {history && prediction.priorityDate && (
        <PriorityChart
          history={history}
          priorityDate={prediction.priorityDate}
          prediction={prediction}
          drawKey={`${prediction.category}|${prediction.chargeability}`}
        />
      )}

      {delta && (
        <div className={`since-row tone-${delta.tone}`}>
          <span className="since-icon" aria-hidden="true">
            <DeltaIcon size={18} />
          </span>
          <span className="since-main">
            <span className="since-label">Since last bulletin</span>
            <span className="since-value">{delta.text}</span>
          </span>
          {prediction.latestBulletin && (
            <span className="since-date">
              <span className="since-label">Bulletin</span>
              <span className="since-when">{formatMonth(prediction.latestBulletin)}</span>
            </span>
          )}
        </div>
      )}

      <dl className="facts">
        <div>
          <dt>Category</dt>
          <dd>
            {prediction.category} · {countryName(prediction.chargeability)}
            {inheritedFrom("category")}
          </dd>
        </div>
        <div>
          <dt>Priority date</dt>
          <dd>
            {prediction.priorityDate ? formatDay(prediction.priorityDate) : "Not set"}
            {inheritedFrom("priorityDate")}
          </dd>
        </div>
        <div>
          <dt>Final action cutoff</dt>
          <dd>{cutoffText(prediction.current.finalAction)}</dd>
        </div>
        <div>
          <dt>Chart USCIS is using</dt>
          <dd>{chartName(prediction.chartInUse)}</dd>
        </div>
      </dl>

      <p className="place-explain">{explanationBody(prediction.explanation)}</p>

      <footer className="place-foot">
        {prediction.confidence && <span className={`chip chip-${prediction.confidence}`}>{CONFIDENCE_LABEL[prediction.confidence]}</span>}
        <span className="label muted">Estimate from past bulletin movement. Not legal advice.</span>
      </footer>
    </section>
  );
}
