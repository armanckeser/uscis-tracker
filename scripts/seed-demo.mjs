// Seeds a tracker with a fictional household, for screenshots and demos.
// Every name, receipt number and date here is made up.
//
//   node scripts/seed-demo.mjs http://localhost:4000
const base = process.argv[2] ?? "http://localhost:4000";

async function api(path, method = "GET", body) {
  const res = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${JSON.stringify(data)}`);
  return data;
}

const ev = (code, at) => ({ eventId: `${code}-${at}`, eventCode: code, createdAtTimestamp: at, eventTimestamp: at });
const notice = (actionType, at, extra = {}) => ({ letterId: `${actionType.length}${Date.parse(at) % 1e8}`, actionType, generationDate: at, ...extra });

function snapshot(receiptNumber, formType, { events, notices, updated, status = "Case Was Received", closed = false }) {
  return {
    data: {
      receiptNumber,
      formType,
      caseStatus: status,
      closed,
      submissionTimestamp: "2026-04-28T14:02:11.000Z",
      updatedAtTimestamp: updated,
      events,
      notices,
    },
  };
}

const filed = "2026-04-28T14:02:11.000Z";
const received = [ev("IAF", filed)];
const receipt = [notice("Receipt Notice Was Sent", "2026-05-01T09:00:00.000Z")];
const bio = (day) => notice("Biometrics Appointment Was Scheduled", "2026-05-20T10:00:00.000Z", { appointmentDateTime: `2026-06-${day}T14:00:00.000Z` });

const alex = (await api("/api/people", "POST", { name: "Alex" })).person;
const sam = (await api("/api/people", "POST", { name: "Sam" })).person;
await api(`/api/people/${alex.id}`, "PATCH", { category: "EB3", chargeability: "ROW", priority_date: "2024-09-12" });
await api(`/api/people/${sam.id}`, "PATCH", { principal_person_id: alex.id });

const cases = [
  ["IOE9912345601", "I-485", alex, [...received, ev("IMAG", "2026-05-20T10:00:00.000Z"), ev("FTA0", "2026-06-11T16:20:00.000Z")], [...receipt, bio("11")], "2026-06-11T16:20:00.000Z"],
  ["IOE9912345602", "I-765", alex, [...received, ev("FTA0", "2026-06-11T16:21:00.000Z"), ev("H008", "2026-08-04T13:10:00.000Z")], [...receipt, notice("Case Was Approved", "2026-08-04T13:10:00.000Z"), notice("New Card Is Being Produced", "2026-08-05T13:10:00.000Z")], "2026-08-05T13:10:00.000Z", "New Card Is Being Produced"],
  ["IOE9912345603", "I-485", sam, [...received, ev("IMAG", "2026-05-20T10:05:00.000Z"), ev("FTA0", "2026-06-12T15:00:00.000Z")], [...receipt, bio("12")], "2026-06-12T15:00:00.000Z"],
  ["IOE9912345604", "I-765", sam, [...received, ev("FTA0", "2026-06-12T15:01:00.000Z"), ev("H008", "2026-08-06T12:00:00.000Z")], [...receipt, notice("Case Was Approved", "2026-08-06T12:00:00.000Z")], "2026-08-06T12:00:00.000Z", "Case Was Approved"],
];

for (const [receiptNumber, form, person, events, notices, updated, status] of cases) {
  await api("/api/cases", "POST", { receiptNumber, personId: person.id });
  await api("/api/snapshots/import", "POST", { raw: snapshot(receiptNumber, form, { events, notices, updated, status }), personId: person.id });
}
await api("/api/changes/acknowledge", "POST");

// A later refresh: Alex's card goes out, and Alex's I-485 is touched without any
// visible change (a silent update), which is what the tracker exists to catch.
const [a485, a765] = cases;
await api("/api/snapshots/import", "POST", {
  raw: snapshot(a765[0], a765[1], {
    events: [...a765[3], ev("LEE", "2026-09-28T18:30:00.000Z")],
    notices: [...a765[4], notice("Card Was Mailed To Me", "2026-09-28T12:00:00.000Z")],
    updated: "2026-09-28T18:30:00.000Z",
    status: "Card Was Mailed To Me",
  }),
});
await api("/api/snapshots/import", "POST", {
  raw: snapshot(a485[0], a485[1], { events: a485[3], notices: a485[4], updated: "2026-09-29T21:14:00.000Z" }),
});
console.log("seeded");
