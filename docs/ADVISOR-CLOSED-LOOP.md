# Advisor Collaboration Contract (Local, Unreleased)

## Purpose

Coordinate reviews by declared task outcomes, not by industry or technology. No prescribed engine, fixed phase template, model benchmark, push or release is included.

## Stage Workflow

1. For a compound task, advisor_stage start_task binds an explicit task to the actual human request. Follow-ups keep taskId; a user-directed task switch starts a new task and archives the old one.
2. define_stage declares one related object group and at most eight result checkpoints. Plugin-owned taskId/stageId/checkId remain stable through wording changes. subjectPaths names the actual artifact and relevant dependencies; visual stages require these targets, not only images.
3. consult_task receives taskId/stageId plus evidence. Scope/focus and check IDs come from the registered stage. Undeclared IDs, omitted required checks, partial or unsuccessful reports cannot advance.
4. Confirmed failures require repair; stale/missing evidence requires collection; disabled evidence access requires user involvement. No operation accepts failed requirements on behalf of the user. A caller can pause and report failure, but cannot call it satisfied.
5. advance and defining another stage reject unresolved current/prerequisite stages. activate_stage revisits a prior stage for focused re-review. set_subjects corrects evidence paths without deleting checkpoint IDs or failures and revokes previous advance permission.

ok/invocationSucceeded describes invocation, not acceptance. reviewPassed is only the reviewed current stage. stageState.advanceAllowed includes prerequisites and storage validity. completionClaimAllowed remains false for stage reviews: passing a caller-declared subset does not certify the whole user request. Tool results remain valid JSON, with acceptanceBanner as a field; the client also reads old banner-prefixed results conservatively.

## Evidence And Version Binding

Material selection retains the authorized-workspace, byte/count, capability and attachment rules. Four large files each get 12K characters under the 48K total and 16K/file caps. Optional inclusive startLine/endLine identifies selected evidence; selectionComplete is not wholeFileComplete. The hash is of full file bytes. Excluded-by-scope material is not an evidence gap.

Review subjects are fingerprinted before the model is called. All positive checks remain tied to those subjects and the supplied evidence; edits during or after review revoke permission. Starting another review revokes the older pass until a valid new report is recorded. Attempts cannot be replayed after path correction or successful consumption.

If a visual subject changed or a new subject was declared, each reused old non-reference image is rejected, even when mixed with a fresh image or renamed. Reference images cannot serve as current-product evidence. Correcting subjectPaths preserves the latest reviewed fingerprint baseline. Identical bytes after a genuinely fresh capture can therefore be conservatively refused; capture provenance is not authenticated, and no claim of runtime image authenticity is made.

Unknown dependencies, semantic coupling not declared in subjectPaths, environment changes and identical-content target substitutions are not completely tracked. Whole-file fingerprinting conservatively invalidates all stages sharing that file, not only the edited function. These are version-scope boundaries, not evidence of a whole-task pass.

## Context And Bounds

Only active task/stage IDs, actions, checkpoints, dependencies and limitations enter the dynamic summary. The protocol is about 1.2K characters; the summary is bounded at 2.2K with omitted counts. Legacy fallback shows only the latest report under the current real-human request and does not reread artifact files or expand historical reports. Explicit staged tasks never mix archived legacy issues into current feedback.

Stage reviewers receive the declared checkpoint contract, current materials and explicitly requested evidenceRefs, not automatic replay of past successes or source rewrites. Missing explicit references and material truncation remain visible and block acceptance.

Persistence: po06-advisor-stages/<session-id>.json, at most eight retained tasks, twelve stages/task, eight checks/stage, 512KiB serialized state. Single-process single-writer is the supported deployment; multiple independent hosts writing the same session file are not covered. Artifact reads are workspace-bounded, capped per file and at 20MiB/32 unique paths per status/advance operation with within-operation deduplication. Storage errors are explicit, not empty successful state.

## Diagnostics And Deployment

/po06/api/status exposes advisorCollaboration.protocolVersion=2 and stored stage diagnostics without implicit file rereads. This helps identify which host build actually loaded; diagnostic-only state is not acceptance. The existing local profile junction remains the runtime source. Host changes require a complete DSH restart; client changes require browser refresh. No automatic restart was performed.

## Remaining Validation Boundary

The plugin mechanically restricts its own stage-advance API. It does not intercept all final model text or guarantee that a model calls stage tools at the appropriate time. Caller checkpoint selection is not semantic proof that every user requirement is covered. Real GUI appearance, real model compliance, subjective output quality and billing improvements need user-level evidence; deterministic/VM tests and independent source review do not substitute for them.
