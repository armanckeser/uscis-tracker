---
name: USCIS Tracker
description: A calm, private, self-hosted USCIS movement monitor.
colors:
  monitor-bg: "oklch(0.115 0.004 230)"
  monitor-rail: "oklch(0.095 0.004 230)"
  monitor-panel: "oklch(0.18 0.006 230)"
  monitor-panel-strong: "oklch(0.225 0.007 230)"
  ink: "oklch(0.965 0.003 230)"
  muted-ink: "oklch(0.71 0.006 230)"
  soft-ink: "oklch(0.52 0.006 230)"
  rule-line: "oklch(1 0 0 / 0.105)"
  rule-line-strong: "oklch(1 0 0 / 0.18)"
  signal-lime: "oklch(0.82 0.12 118)"
  signal-lime-soft: "oklch(0.29 0.055 118)"
  notice-blue: "oklch(0.69 0.11 235)"
  notice-blue-soft: "oklch(0.26 0.045 235)"
  approval-green: "oklch(0.72 0.13 152)"
  approval-green-soft: "oklch(0.25 0.055 152)"
  attention-amber: "oklch(0.76 0.13 78)"
  attention-amber-soft: "oklch(0.29 0.055 78)"
  blocked-red: "oklch(0.68 0.16 28)"
  blocked-red-soft: "oklch(0.28 0.06 28)"
typography:
  display:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "1.72rem"
    fontWeight: 780
    lineHeight: 1.16
    letterSpacing: "0"
  headline:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "1.1rem"
    fontWeight: 760
    lineHeight: 1.25
    letterSpacing: "0"
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0"
  label:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "0.84rem"
    fontWeight: 720
    lineHeight: 1.35
    letterSpacing: "0"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
    fontSize: "0.86rem"
    fontWeight: 500
    lineHeight: 1.45
    letterSpacing: "0"
rounded:
  sm: "0.375rem"
  md: "0.5rem"
  lg: "0.75rem"
  full: "999px"
spacing:
  xs: "0.25rem"
  sm: "0.5rem"
  md: "0.75rem"
  lg: "1rem"
  xl: "1.5rem"
  xxl: "2rem"
components:
  button-primary:
    backgroundColor: "{colors.signal-lime}"
    textColor: "oklch(0.15 0.03 118)"
    rounded: "{rounded.md}"
    height: "2.5rem"
  button-secondary:
    backgroundColor: "oklch(1 0 0 / 0.045)"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    height: "2.5rem"
  panel:
    backgroundColor: "{colors.monitor-panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "1.5rem"
  input:
    backgroundColor: "oklch(0.11 0.004 230)"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0.72rem 0.85rem"
    height: "2.75rem"
---

# Design System: USCIS Tracker

## 1. Overview

**Creative North Star: "The Quiet Monitor"**

USCIS Tracker is not a dashboard and not a settings console. It is a private monitor for two people who want the fastest possible answer to "did anything change?" The product shape is a routed app with focused destinations:

- **Today:** the default answer surface. It says all quiet, new movement, connection needed, or check attention.
- **Cases:** the watchlist, add/manage receipts, inspect latest evidence.
- **Activity:** the full movement timeline.
- **Connection:** USCIS session and device notifications.
- **Settings:** buried operational details, not daily-use UI.

Manual JSON import is recovery tooling only. Scheduled polling cadence is not front-page information. Manual "run checks" is not a primary workflow; monitoring is the default.

## 2. Product Rules

**The Anxiety Reduction Rule.** The first screen answers one question. If nothing changed, say so plainly. Do not fill the page with metrics, timers, or operational trivia.

**The Automation Rule.** Users add receipt numbers and connect USCIS once. The server does the repetitive checking. The UI should not train users to press a refresh button.

**The Buried Operations Rule.** Polling cadence, VAPID status, connector status, and recovery import belong under Settings or Connection details.

**The Evidence Rule.** Raw USCIS responses remain inspectable from case rows and timeline events, but raw JSON is never the default experience.

**The No Ambient Gradients Rule.** Product state is expressed with text, icons, borders, and small indicators. Do not wash large panels with warning or info gradients; it makes neutral waiting feel like an alert.

## 3. Visual Direction

The interface uses a dark, quiet, Raycast-like monitor surface: dense enough to scan, restrained enough not to dramatize waiting. It borrows from the wishlist app's mobile-first app shell and high-contrast dark treatment, but it avoids luxury/editorial type because this is a factual tool.

Color is semantic:

- **Signal Lime:** selected navigation, primary actions, timeline dots, healthy live state.
- **Notice Blue:** new informational USCIS movement.
- **Approval Green:** completed cases and enabled notification state.
- **Attention Amber:** missing session or check attention.
- **Blocked Red:** destructive deletion and failed checks.

The surface is intentionally dark neutral rather than official-government blue, AI-purple, or beige SaaS.

## 4. Navigation

Desktop uses a sticky left rail. Mobile uses a top status bar plus bottom nav with only daily-use destinations: Today, Cases, Activity, Connection. Settings stays off the mobile primary nav.

Routes are real app destinations (`/`, `/cases`, `/activity`, `/connection`, `/settings`) so each screen has one job and can evolve independently.

## 5. Components

### Signal Panel
The Today screen's top panel. It contains the current answer, one supporting sentence, and at most one useful action. It must never show polling intervals or generic metric tiles.

### Case Rows
Rows are compact records with form/person, receipt number, status, last checked, raw evidence, and delete. Refresh controls are intentionally absent from the primary row.

### Activity Timeline
Grouped by case, then by date inside each case. Each case should read as one continuous timeline, and each item names the change, timestamp, severity, explanation, and raw evidence affordance.

### Connection
Connection explains per-person USCIS sessions and makes connector-based capture the primary action. Manual Cookie header paste and recovery import live in collapsed details sections.

### Settings
Settings exposes monitor health and technical details: automation active/paused, notification device state, session source, push-key presence, and cadence.

## 6. Do's and Don'ts

Do:
- Lead with "did anything change?"
- Keep settings and recovery out of the daily path.
- Make receipt add/manage fast on mobile.
- Use visible labels, 16px inputs, stable tap targets, and keyboard focus rings.
- Let notifications carry meaningful changes, not routine no-change checks.

Don't:
- Put scheduled polling intervals on Today.
- Ask users to paste USCIS API JSON as a normal workflow.
- Build one long page with every control visible.
- Use decorative metric cards.
- Make waiting look dangerous.
