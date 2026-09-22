# Manual launcher design contract

UI implementation exists; the stopped state has been reviewed in actual Tauri/
WebView2 output at desktop and narrow widths. Full interaction/accessibility
acceptance is still outstanding; no WCAG or ADA conformance is claimed.

A compact utility: one content rail, plain status text and one primary action.
Local reference: `packages/app/src/theme.ts` charcoal surfaces, warm accent,
4-point spacing and 20px rail. Do not import the React Native theme at runtime.
Use Windows Segoe UI/system fonts; no external fonts, fake terminal or dashboard.

## State map

Stopped → Starting → Ready without phone ↔ Authenticated phone connected.
Running → Stop requested → Stopping → Stopped when idle; when busy, require an
explicit confirmation with cancel returning to running. Window-close follows
the same contract. Unexpected exit, incompatible protocol, missing binary/profile
and port conflict have explicit text and deliberate retry, never restart loops.

Do not infer phone connectivity from health, or model readiness from connectivity.
The selected data location is visible before Start. Pairing is a separate explicit
reveal/hide interaction with local SVG modules and four-module quiet zone.
Diagnostics are bounded, redacted and exclude pairing secrets.

## Accessibility acceptance

Native button/dialog semantics, keyboard-only flow, focus containment and return,
polite status announcements, visible focus, non-colour labels, high contrast,
measured text/control contrast, 200% scaling, narrow-window reflow, long paths and
reduced motion. Rendered review and manual Narrator verification are separate
checks; neither is established by TypeScript or a frontend build.

## Design read and review evidence

The leading archetype is a native desktop utility for people uncomfortable with
terminals. Its single job is deliberately starting and stopping local phone
access. Native window controls and one vertical content rail preserve orientation;
status and the main action precede settings/help. The costly mistakes are stopping
active agent work and exposing pairing credentials, so both get separate explicit
interactions with conservative initial focus.

Local evidence is pew2's phone theme, not a third-party dashboard. The design
corpus has no direct native examples, so it does not establish a desktop house
style. Charcoal belongs because it matches this product; the warm solid CTA is
the principal visual cue. The rendered review removed a redundant accent divider
and the technical extended-path display prefix. No icons or extra framework were
needed. Segoe UI/system fallback keeps fonts local.

Tokens: canvas #111111, surface #1b1b1e, raised #26262a, text #f2f2f3,
secondary #aaaaaf, border #86868c, accent #d97757, focus #ed9679,
error #ffb4ab; 4px base, 20px rail, 44px minimum buttons. Measured contrast is
recorded in the verification report. Responsive layout uses natural block flow;
long paths wrap. Dialogs use the platform modal primitive, focus return and Escape;
the safest action receives initial focus. QR has an exact four-module quiet zone.

Scope: this one window and its pairing/stop dialogs, on Windows 11 x64 with
WebView2, keyboard/pointer and Narrator. Automated state checks and stopped-state
native captures pass. Full keyboard flow, Narrator, 200% text, forced colours,
all recovery states and the per-criterion accessibility audit remain unverified.
A visual impression or contrast calculation does not replace those release gates.

## Provisional rendered review

One review/revision cycle used real stopped/ready/confirmation windows and desktop/
narrow captures. This is **19/24**, not broad-UI release approval; incomplete
state/accessibility verification is not awarded full credit.

| Criterion | Score / 2 | Evidence / remaining gap |
| --- | --- | --- |
| Brief specificity | 2 | Manual local phone access and selected profile are explicit |
| Hierarchy | 2 | Status, one primary action, then profile/help |
| Composition | 2 | Shared rail remains aligned in the settled narrow capture |
| Consistency/flow | 2 | Start/Stop and conservative confirmation retain control anatomy |
| Typography | 2 | Local Segoe hierarchy and real long paths wrap visibly |
| Surface logic | 2 | Main rail and modal only; redundant divider removed |
| State completeness | 1 | Real ready/busy/retry checks exist; not every recovery view was captured |
| Responsive behaviour | 1 | Native narrow capture passes; 200% and localisation stress remain |
| Accessibility | 1 | Contrast/semantics/browser-keyboard checks; full Tab/Narrator audit pending |
| Motion | 1 | Restrained static surfaces; reduced-motion interaction review pending |
| Content authenticity | 2 | Real native status and explicitly isolated test profiles, no model-ready claim |
| Distinctiveness | 1 | Deliberately restrained product tokens, not an ornamental showcase |

Windows-wide injected Enter events proved intermittent in the test harness.
Repeatable browser-keyboard activation now uses an ownership-checked loopback
WebView debugger in the test process only. That does not prove physical keyboard
routing or a complete native Tab flow. These remain manual acceptance gates.
