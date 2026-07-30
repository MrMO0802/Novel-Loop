# Novel Loop Prototype Test Script

## Purpose

Verify the integrated Electron chapter milestone and run invited-author sessions against clearly identified current or forward-looking prototype surfaces. The facilitator evaluates whether authors understand the manuscript workflow and the difference between a non-canonical draft and formally committed story state without being taught internal system terminology.

## Integrated Electron Chapter Milestone

### Requirements And Launch

- Ubuntu 24.04 with Node.js 20 or newer and Corepack.
- A local Codex CLI installation that is already logged in and passes the application's environment check.
- The repository dependencies installed with `corepack pnpm install`.

Launch the source build:

```bash
corepack pnpm desktop:dev
```

The Vite URL printed by the development command serves only the Electron
renderer. Use the Electron window, not a separate browser tab.

### Current Manual Flow

1. Open an initialized Novel Loop project whose Story Foundation and global planning are available.
2. Open the global planning review and choose `创建第 1 章`.
3. Confirm preparation of the chapter direction. Check that progress covers mission, alternatives, ranking, and review preparation.
4. Review the complete chapter mission, selected direction, and collapsed alternatives.
5. Choose `确认方向并生成草稿`, then make the second explicit confirmation.
6. Wait for scene planning, per-scene drafting, and initial-draft assembly.
7. Confirm the Chapter Workspace labels the result `初稿` and states that it has not been written to formal Story State.

Acceptance evidence:

- `mission.json`, three plan candidates, `ranking.json`, `selected_plan.md`, `scene_cards.json`, individual scene files, and `draft_v1.md` exist for the chapter.
- `state/story_state.json` is byte-for-byte unchanged and `latestCommittedChapter` has not advanced.
- No diagnostics, revision plan, `final.md`, canon patch, commit report, or commit snapshot is created.
- Renderer access remains limited to the typed preload API; it has no Node.js, filesystem, shell, provider-selection, or Codex-command capability.

This milestone uses real local Codex when run manually. The required Electron
regression test uses an exact allowlisted fake Codex so it is deterministic and
does not consume local Codex quota.

## Facilitator Preparation

- Use the current Electron build at 1440 x 900 or 1024 x 720 and confirm zoom is 100 percent.
- Prepare a separate fresh local project for each integrated-flow participant. Use a separate fixture context only for the forward-looking research tasks that are not implemented in Electron yet.
- Confirm the timeout and crash routes open their recovery guidance.
- Record screen and audio only after consent. Keep notes under a participant code, not a real name.
- Do not expose source code, test output, technical details, or engine terminology during the session.

## Consent And Privacy

Explain that this is a non-production pilot. The integrated chapter path uses
the participant's real local Codex installation to generate a local initial
draft, but it does not create canonical chapter artifacts or modify formal Story
State. Forward-looking research surfaces and the required fake-Codex regression
fixtures use simulated content and actions and must be identified as
simulations. Participation is voluntary; participants may skip a task, take a
break, or stop the session without explanation. Do not collect their
manuscript, account credentials, project files, or personally identifying story
material. Store recordings and notes in the approved research location, limit
access to the research team, and remove identifying details from synthesis
quotes.

## Neutral Prompts

Use: "What are you looking at now?", "What would you expect to happen next?", "Please say what you are thinking.", and "What, if anything, makes that unclear?" Do not explain labels, suggest controls, confirm assumptions, or rescue a task until the participant explicitly gives up or a stop condition is met.

## Session Tasks

1. **Create a new novel from a short idea.** Start at `/new`; ask the participant to enter or adjust a short idea and move forward. Acceptance signal: they can name the next creative step and understand the Story Bible remains editable before creation.
2. **Find the next chapter action.** Start at `/project/rain-radio`; ask what they would do next. Acceptance signal: they locate the recommended action or Chapter Workspace without reading technical details.
3. **Continue editing an existing draft.** Start at `/project/rain-radio/chapter/2`; ask for a small manual edit. Acceptance signal: they identify the editable draft and do not treat a candidate or preview as the active canonical text.
4. **Identify why a timeline finding is critical.** Start at `/project/rain-radio/chapter/2/review`; ask what makes the finding important. Acceptance signal: they locate the passage evidence, rule consequence, and return safely to the finding.
5. **Compare and reject or accept a revision candidate.** Start at `/project/rain-radio/chapter/2/revision`; ask for a decision. Acceptance signal: they compare the draft and candidate, understand text labels for removed and added passages, and complete a choice without technical details.
6. **Explain whether the chapter is already canonical.** Continue after accepting the candidate in task 5 and opening its Story Record change preview; ask what has changed already. Acceptance signal: they say the preview has not formally changed the Story Record.
7. **Review what will change in the Story Record.** Continue in the accepted candidate's Story Record change preview; ask them to review the high-risk change. Acceptance signal: they can identify the proposed change, make or withhold the explicit decision, and understand the final confirmation is simulated.
8. **Recover from a simulated Codex timeout.** Start at `/tasks?recovery=timeout`; ask for the safest next step. Acceptance signal: they can resume or choose a safe alternative and explain that draft work is protected.
9. **Find an open mystery and its planned relevance.** Start at `/project/rain-radio/story-record`; ask them to find an unresolved question that needs attention. Acceptance signal: they find a 待兑现悬念 and describe why it matters for later writing.
10. **Locate a previous safe restore point.** Start at `/tasks?recovery=crash`; ask where they would inspect recovery options. Acceptance signal: they identify a dated safe restore point in the recovery summary and do not expect automatic continuation or formal commit.

## Per-Participant Record

Use one record for each of the five sessions.

```text
Participant:
Task completion:
Observed hesitation:
Terminology misunderstanding:
Canonical-state misunderstanding:
Recovery success:
Follow-up quote:
```

## Stop Conditions

Stop a task after five minutes, after two unsuccessful attempts at the same action, when the participant asks to stop, or when the participant becomes distressed. Mark the task incomplete, record the last understood state, and proceed only with the participant's permission. Stop the session immediately if consent is withdrawn or if privacy-sensitive information is entered.

## Prototype Limitations

The integrated Electron path uses the local Novel Loop Engine, project files,
and read-only `codex-text` provider through initial draft. It does not yet
support manual draft editing, diagnostics, revision comparison, `final.md`,
canon patch review, formal commit, or automatic recovery. Tasks in this script
that exercise those later surfaces remain forward-looking fixture research and
must be introduced to participants as simulations. Do not infer production
model quality, commit safety, or recovery guarantees from fixture-only tasks.

## Post-Session Synthesis Checklist

- Calculate completion for each task and the percentage who distinguish draft from committed state without prompting.
- Confirm whether every participant understood that commit preview did not modify Story Record.
- Calculate the percentage completing revision comparison without technical details.
- Confirm whether every participant recovered from the simulated failed task.
- Identify whether any participant expected Codex to edit canonical state automatically.
- Record time to resume the current chapter; target a median below 20 seconds.
- Group terminology confusion around 故事档案 and 待兑现悬念, using de-identified quotes.
- Prioritize issues that affect canonical-state understanding, recovery safety, or evidence comprehension before visual polish.

## Acceptance Signals

- At least 80 percent identify draft versus committed state without prompting.
- All participants understand commit preview has not modified Story Record.
- At least 80 percent complete revision comparison without opening technical details.
- All participants recover from a simulated failed task.
- No participant expects Codex to edit canonical state automatically.
- Median time to resume the current chapter is under 20 seconds.
- Authors can explain 故事档案 and 待兑现悬念 in their own words.
