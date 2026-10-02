# Advisor Stage Read-Evidence Repair (Local, Unreleased)

## Changes

- Generic report example and each staged request provide actual checkId JSON templates. The tool loop repeats the template with its current evidence manifest.
- Full reports omitting all IDs can recover IDs only through exact unique criterion matches forming a bijection with the declared checkpoints. Mixed IDs, incorrect IDs, rewritten/duplicate criteria and missing rows are refused. No positional identity guessing.
- Each model round gets allowedEvidenceRefs and satisfiedEvidenceRefs from actual current read trace and initial evidence; undeclared citations remain rejected. Missing reads may support missing-file findings but cannot support satisfied. Read-path matching no longer accepts arbitrary suffixes. Existing Windows slash/case normalization remains.
- toolRead stores full-file SHA256 at the moment its bounded bytes are read, plus selected line range/completeness. Loop trace retains this snapshot. The advisor backfills these real read materials into stage recording instead of rereading changed files at completion.
- materials-nonempty freshness remains intact. Source changes after the read still stale the stage; truncation remains an explicit limitation.

## Evidence

Final regression: 274/274 pass. tmp-pack/advisor-vmake-fixes-full.log
Focused integration: 11/11 pass, including actual read loop S1/S2 (three checkpoints each) with empty files/evidenceRefs, citation rejection, ID recovery negative cases and changed-after-read staleness. The LLM streams are deterministic fixtures, not actual model reliability evidence.
Independent review c97c6811-3883-44a7-9c05-255262b17c11 marked all eight code checks satisfied, but wrapper verdict/reviewPassed stayed unverified/false for evidence-range coverage. This is not independent overall acceptance. Earlier attempts had an oversized excerpt, invalid endLine and invalid citation; retained as failures, not passes.
Current vmake task T2f7491be-9311-4cd5-bf5d-2f05ece81626 was located under po06-advisor-stages/session-1427f028-f49b-4a92-a2df-d912917a7659.json. Observed S1 materials=4 with advisor-invalid-check; S2 materials=0 with stage-check-id-mismatch. No historical state was edited or retroactively accepted.

## Runtime And Remaining Check

The web profile junction resolves to this development package; hashes for the linked advisor.js and read-tools.js match. Evidence: tmp-pack/advisor-vmake-fixes-linked-source.json. A full DSH restart loads the new host modules; no restart or release was performed. After restart, the original vmake session should activate/re-review S1 then S2 using its original stable IDs. Their success is not yet established by this repair session. No changes to vmake source or task technology were made.
