import { describe, expect, it } from "vitest";
import { deriveStage } from "../shared/stage.js";
import { normalizeTimeline, type ChangeRecord, type FactRecord } from "../shared/timeline.js";
import type { PersonPrediction } from "../shared/predict.js";

let n = 0;
const ev = (code: string, at: string): ChangeRecord => mk("event", at, { eventCode: code, eventId: `${code}${n}` });
const notice = (action: string, at: string, extra: Record<string, unknown> = {}): ChangeRecord => mk("notice", at, { actionType: action, letterId: `L${n}`, ...extra });
function mk(changeType: ChangeRecord["changeType"], at: string, payload: Record<string, unknown>): ChangeRecord {
  n += 1;
  return { id: `c${n}`, caseId: "c", snapshotId: "s", changeType, fieldPath: null, label: "", occurredAt: at, payload, source: "uscis", firstSeenAt: at, acknowledgedAt: null };
}

const TODAY = "2026-09-29";
const stage = (changes: ChangeRecord[], opts: { closed?: boolean; form?: string; facts?: FactRecord[]; ctx?: Parameters<typeof deriveStage>[3] } = {}) =>
  deriveStage({ formType: opts.form ?? "I-485", closed: opts.closed ?? false }, normalizeTimeline(changes, opts.facts ?? []), opts.facts ?? [], { today: TODAY, ...opts.ctx });

const notCurrent = { status: "ok", isCurrent: false } as PersonPrediction;

describe("deriveStage", () => {
  it.each([
    ["only filed", [ev("IAF", "2026-01-05T15:00:00Z")], "filed"],
    ["biometrics scheduled (past)", [ev("IAF", "2026-01-05T15:00:00Z"), notice("Appointment Scheduled", "2026-02-01T15:00:00Z", { appointmentDateTime: "2026-03-01T15:00:00Z" })], "biometrics"],
    ["actively reviewing", [ev("IAF", "2026-01-05T15:00:00Z"), ev("IMAG", "2026-02-01T15:00:00Z"), ev("FTA0", "2026-04-01T15:00:00Z")], "review"],
    ["review after interview does not regress", [ev("FTA0", "2026-01-01T15:00:00Z"), notice("Interview Was Scheduled", "2026-02-01T15:00:00Z"), ev("FTA0", "2026-03-01T15:00:00Z")], "interview"],
    ["approved", [ev("FTA0", "2026-01-01T15:00:00Z"), notice("Case Was Approved", "2026-05-01T15:00:00Z")], "decision"],
    ["card produced", [notice("Case Was Approved", "2026-05-01T15:00:00Z"), notice("New Card Is Being Produced", "2026-05-03T15:00:00Z")], "card"],
    ["card delivered", [notice("Card Was Delivered To Me By The Post Office", "2026-06-01T15:00:00Z")], "card"],
  ] as const)("%s", (_name, changes, expected) => {
    expect(stage([...changes]).stage).toBe(expected);
  });

  it("closed wins and keeps the outcome", () => {
    const closed = mk("closed", "2026-06-10T15:00:00Z", { new: true });
    const info = stage([notice("Case Was Approved", "2026-05-01T15:00:00Z"), closed], { closed: true });
    expect(info).toMatchObject({ stage: "closed", outcome: "approved", nextStep: null, since: "2026-06-10T15:00:00Z" });
  });

  it("denial hands the next step to the person", () => {
    const info = stage([notice("Case Was Denied", "2026-05-01T15:00:00Z")]);
    expect(info).toMatchObject({ stage: "decision", outcome: "denied", waitingOn: "you" });
  });

  it("an unanswered RFE means waiting on you, until the response is received", () => {
    const rfe = notice("Request For Evidence Was Sent", "2026-03-01T15:00:00Z");
    expect(stage([ev("FTA0", "2026-02-01T15:00:00Z"), rfe]).waitingOn).toBe("you");
    const answered = stage([ev("FTA0", "2026-02-01T15:00:00Z"), rfe, notice("Response To Request For Evidence Was Received", "2026-03-20T15:00:00Z")]);
    expect(answered.waitingOn).toBe("uscis");
  });

  it("an upcoming appointment is on you; a past one without an outcome is noted", () => {
    const upcoming = stage([notice("Appointment Scheduled", "2026-09-01T15:00:00Z", { appointmentDateTime: "2026-10-05T13:00:00Z" })]);
    expect(upcoming).toMatchObject({ waitingOn: "you" });
    expect(upcoming.nextStep?.label).toContain("biometrics appointment on Oct 5, 2026");

    const appt = notice("Appointment Scheduled", "2026-06-05T15:00:00Z", { appointmentDateTime: "2026-06-22T13:00:00Z" });
    const letterId = (appt.payload as { letterId: string }).letterId;
    expect(stage([appt]).note).toMatch(/Record whether you attended/);
    const fact: FactRecord = { id: "f", caseId: "c", kind: "appointment_attended", occurredOn: "2026-06-22", letterId, note: null, createdAt: "2026-06-23T00:00:00Z" };
    expect(stage([appt], { facts: [fact] }).note).toBeNull();
  });

  it("I-485 waits on visa availability when the priority date is not current", () => {
    const changes = [ev("IAF", "2026-01-05T15:00:00Z"), ev("FTA0", "2026-04-01T15:00:00Z")];
    expect(stage(changes, { ctx: { prediction: notCurrent } }).waitingOn).toBe("visa_availability");
    expect(stage(changes, { ctx: { prediction: { ...notCurrent, isCurrent: true } } }).waitingOn).toBe("uscis");
    // A form with no queue never waits on the bulletin.
    expect(stage(changes, { form: "I-765", ctx: { prediction: notCurrent } }).waitingOn).toBe("uscis");
  });

  it("I-765 and I-131 note that they are tied to an open I-485", () => {
    const changes = [ev("IAF", "2026-01-05T15:00:00Z")];
    const info = stage(changes, { form: "I-765", ctx: { siblings: [{ formType: "I-485", closed: false }] } });
    expect(info.note).toContain("Tied to your I-485");
    expect(stage(changes, { form: "I-765", ctx: { siblings: [{ formType: "I-485", closed: true }] } }).note).toBeNull();
  });

  it("only USCIS-source entries move the stage", () => {
    const tracker = { ...ev("H008", "2026-05-01T15:00:00Z"), source: "tracker" as const };
    expect(stage([tracker]).stage).toBe("filed");
  });
});
