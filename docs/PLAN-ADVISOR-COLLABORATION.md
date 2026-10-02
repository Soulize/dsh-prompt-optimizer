# Advisor Collaboration Refactor (Local / Unreleased)

## Objective

Replace report accumulation with a small, generic collaboration contract. No task/domain defaults or restrictions on implementation technology. No new model benchmark, push or release.

## Plan

1. Restore tool-result producer/consumer compatibility: canonical JSON, explicit failure/pass fields, legacy result reading; excluded-by-scope materials are not evidence gaps.
2. Introduce plugin-owned task, stage and checkpoint IDs. Caller declares outcome checkpoints for a stage before work is depended upon; no fixed industry or mandatory number of reviews. Task changes are explicit, not inferred from every follow-up human message.
3. Tie review checks to existing checkpoint IDs. Reviews update statuses, not wording-based identities. Evidence changes stale only the affected stage; report text cannot close another checkpoint.
4. Derive actions: confirmed failure -> repair; evidence absent/stale -> collect evidence; inaccessible evidence -> ask user; all necessary checkpoints satisfied -> permit stage advancement. A failed check is never user acceptance. No autonomous requirement waiver.
5. Expose a deterministic stage-advance operation refusing unresolved stages. Keep ordinary text output outside the claimed enforcement boundary: host final-answer veto is not implemented by a status field. Do not promise a hard gate on final chat responses.
6. Project only the active task/stage status summary into context, with a fixed small budget. Archive remains inspectable but is not repeatedly expanded. Legacy reviews must not silently leak across explicit new tasks.
7. Regressions use generic code/document/interaction cases, including same criterion wording changes, failed review + local tests, changed evidence, missing material, task switch, blocked advancement, retries and restart. Capture raw logs and independent review.

## Boundaries And Migration

Preserve existing read authorization, relative-path enforcement, image capability checks, fair material budget and pre-existing configuration. Do not rewrite user input. Stage outcomes are grounded in actual source requests; advisor/caller text is not permission to accept failure. Keep legacy consult_task support but label it non-staged/untracked; staged pass applies only to its declared checkpoints.

The existing working tree includes earlier unreleased advisor changes and unrelated runtime changes. Respect them; no reset/rollback or runtime edits. The current profile links the development directory; verify it, then report full host restart/browser refresh needed instead of silently restarting this conversation.

## Local Implementation Status

The local implementation goal is finished within the documented boundary. No commit/push/release or automatic host restart. Unrelated runtime changes were not edited or reverted.

- Canonical result JSON and legacy client decoding are verified using the actual producer and VM consumer.
- Stages and checkpoints have plugin-owned IDs, declared subject version snapshots, unique attempt IDs, failure/omission/partial/mismatch handling and dependency-aware advance permission.
- Subject-path correction preserves the last reviewed baseline. Edited/new subjects cannot reuse old visual evidence, even mixed with new images. Successful, cancelled and path-corrected attempts cannot be replayed.
- The registered advisor_stage tool and consult_task are covered by the actual apply/unload lifecycle test. Stage reviews use declared checkpoints and explicit evidence references, not automatic history replay.
- Production context reads stage state once. Fixed workflow text is 1164 characters; active stage summary is bounded at 2200 characters and valid JSON with omissions. Legacy fallback is current-request-only.
- Stage card shows task/stage/action/check IDs, checkpoint status, dependency and limitation fields; positive display requires global advanceAllowed, no unresolved dependency, no partial or failed recording from either top-level or presentationMeta.

## Verification And Remaining Manual Acceptance

- Final whole regression: 269 pass / 0 fail. Raw log: tmp-pack/advisor-collaboration-round2-full.log.
- Profile junction resolves to the edited development package; host-entry and client hashes match. Proof: tmp-pack/advisor-collaboration-linked-source.json.
- Live GET http://127.0.0.1:3080/po06/api/status returns HTTP200/version0.8.0-preview but lacks advisorCollaboration.protocolVersion. This running host has not loaded this round. After a full DSH restart and browser refresh, protocolVersion must be 2. No restart was initiated here.
- Independent review found and led to fixes for bounded reads, restore-path tests, set_subjects baseline loss, mixed-image reuse, cancelled attempt replay and nested card recording state. Evidence: tmp-pack/advisor-collaboration-independent-reviews.json.
- Final independent run f26f12da-0845-4e09-aa6b-c1609143ac3a reported pass only for nested recording-failure/partial display. Earlier reviews satisfied the other reviewed code criteria but retained actual GUI/model boundaries. Do not describe this as whole-task independent acceptance.
- The still-running older advisor wrapper repeatedly returned non-lossless JSON to PTC. Consultations completed and their reports were recovered from persisted runtime records. The new execute wrapper normalizes lossless JSON, but its live transport needs verification after restart. No failed transport was silently counted as a whole acceptance pass.
- Large client.js could not be directly reread by the advisor (204800-byte supplemental-read limit); the actual client VM tests and bounded source excerpts support only the selected display paths, not an independent whole-file audit.
- Real GUI appearance, timely work-model adoption, subjective output quality and cost reduction remain manual evidence. No large prior artifact was recreated, and none was retroactively declared passed.


## Completion Evidence

- Canonical tool output is consumed by client without progress-cache dependence.
- Explicit IDs survive wording changes and persisted restart.
- Stage advance fails for failed/unverified/stale checkpoints and succeeds only for fresh satisfied necessary checkpoints.
- Task switch removes old-task items from injected summary, without erasing archive.
- Summary size remains bounded regardless of historical report count.
- Full suite passes, independent review findings are handled, runtime-side source link matches.
- Real model compliance, full GUI restart and subjective output quality remain unverified unless actual evidence is obtained.
