# Novel Loop Prototype Test Script

## Purpose

Run five invited-author sessions against the fixture-driven desktop prototype. The facilitator evaluates whether authors understand the manuscript workflow, evidence, non-canonical revision states, formal commit preview, and safe recovery without being taught internal system terminology.

## Facilitator Preparation

- Use the current fixture build at 1440 x 900 or 1024 x 720 and confirm the browser zoom is 100 percent.
- Prepare a separate fresh browser context for each participant so draft and decision fixtures begin in their default state.
- Confirm the timeout and crash routes open their recovery guidance.
- Record screen and audio only after consent. Keep notes under a participant code, not a real name.
- Do not expose source code, test output, technical details, or engine terminology during the session.

## Consent And Privacy

Explain that this is a non-production prototype with simulated content and actions. Participation is voluntary; participants may skip a task, take a break, or stop the session without explanation. Do not collect their manuscript, account credentials, project files, or personally identifying story material. Store recordings and notes in the approved research location, limit access to the research team, and remove identifying details from synthesis quotes.

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

All content and task results are controlled fixtures. The prototype has no engine, Codex, Electron, provider, filesystem, project-file, persistence, or real Story Record integration. Formal commit, recovery, and saved draft outcomes are visual simulations. Do not draw conclusions about performance, model quality, or real data safety from these sessions.

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
