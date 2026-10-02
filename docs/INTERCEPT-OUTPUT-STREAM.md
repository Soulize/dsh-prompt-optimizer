# Interception Output Streaming (Local, Unreleased)

This patch changes only the interception output pane in client.js. It reuses the existing host onDelta -> progressAppend -> /interpret-progress -> client polling flow. It does not animate completed text, alter model generation, change the thinking pane, or replace the final packet.

While optimizing, the output pane decodes the received item.text strings from the actual interpreter protocol. Unfinished JSON strings are displayed progressively; unfinished escape sequences are withheld until the next fragment. Rationale, quote and candidate text are not presented as the main output. Text is rendered as React text nodes, not HTML.

The growing output is read-only and explicitly unvalidated. It follows scrolling until the reader scrolls back. The original skip/cancel controls remain available; confirm/edit controls only exist in review. At completion the server-validated packet is used normally. A rejected or budget-dropped candidate may not be retained by the compiler: this preview is not permission to bypass validation or claim it is the final injection.

## Evidence

- Complete regression: 278/278 pass. Raw log: tmp-pack/intercept-output-stream-full.log.
- New actual client module tests: progressive text across snapshots, partial escapes/Unicode, read-only during generation, final editable packet preserving accepted text, cancellation/next empty stream. Raw log: tmp-pack/intercept-output-stream-focused.log.
- Independent code review passed the selected reset, output streaming and state-boundary focus. Raw review: tmp-pack/intercept-output-stream-review.json. Real browser layout, scrolling and model-driven screen behavior remain unverified.
- Linked web-profile client source hash equals edited client.js. Proof: tmp-pack/intercept-output-stream-linked.json.
- Browser tooling was not installed in the plugin and an unauthenticated request to the existing http://127.0.0.1:3080 GUI returned HTTP401. No authenticated screenshot or live user generation was observed. No replacement webserver, host restart, commit or release was performed.

## Try In The Existing GUI

Refresh the existing DSH browser page to load the client change. If its cached client bundle still has the older behavior, restart DSH then refresh; automatic HMR was not verified or promised. During a new interception, the Output pane should start with the first item text and grow as new fragments arrive, then switch to the validated packet. Only reasoning/no text emitted by the model cannot make output content grow.
