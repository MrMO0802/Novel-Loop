---
promptId: planning.plan_chapter_mission_slim
task: compact chapter mission
expectedOutput: JSON matching output schema
contextBudget: compact
qualityRisks: ignoring open debts, overloading mission
---
Return only JSON that matches the provided output schema.

Task:
Create a minimal chapter mission.

Rules:
- No markdown.
- No explanation.
- No extra fields.
- Use exactly these top-level keys: chapterNumber, chapterFunction, objectives, debtsToPayOrAdvance, debtsToIntroduce, participatingCharacterIds, charactersToIntroduce, characterDeltas, readerKnowledge, readerQuestions, forbiddenMoves.
- chapterNumber must equal {{CHAPTER_NUMBER}}.
- chapterFunction must be one concise sentence.
- debtsToPayOrAdvance contains only existing narrative debt IDs from the supplied summary.
- debtsToIntroduce contains only concise type, promise, and importance objects for new promises.
- charactersToIntroduce explicitly declares a character needed in this chapter but not yet present in Story State. Use only characterId, name, and role, with at most eight entries.
- Do not put an existing Story State character in charactersToIntroduce.
- When committed characters are empty, charactersToIntroduce must declare every named participant needed by this chapter. participatingCharacterIds must reference only committed or introduced character IDs. Never return an empty total participant roster for a chapter that will generate scenes.
- characterDeltas contains only characterId, from, to, and evidenceRequired objects.
- characterDeltas may use IDs listed in story_state_summary.characters or charactersToIntroduce; use an empty array when no supplied or introduced character changes.
- Do not invent undeclared debt or character IDs.
- Keep context bounded to the chapter.
- Include readerKnowledge, readerQuestions, and forbiddenMoves as arrays.
- Use empty arrays when a field has no items.
- Keep output deterministic: do not invent extra IDs, nested objects, prose blocks, or commentary.

Valid shape example:
{
  "chapterNumber": {{CHAPTER_NUMBER}},
  "chapterFunction": "Advance the committed chapter queue item without resolving the final mystery.",
  "objectives": ["Advance one queued plot objective."],
  "debtsToPayOrAdvance": [],
  "debtsToIntroduce": [{"type": "mystery", "promise": "Why does the radio speak without power?", "importance": 8}],
  "participatingCharacterIds": ["char_example_participant"],
  "charactersToIntroduce": [{"characterId": "char_example_participant", "name": "Example Participant", "role": "investigator"}],
  "characterDeltas": [],
  "readerKnowledge": ["State one concrete thing the reader learns."],
  "readerQuestions": ["State one question the reader should carry forward."],
  "forbiddenMoves": ["Do not reveal the final answer."]
}

<chapter_number>
{{CHAPTER_NUMBER}}
</chapter_number>

<story_state_summary>
{{STORY_STATE_SUMMARY}}
</story_state_summary>

<chapter_queue_ITEM>
{{CHAPTER_QUEUE_ITEM}}
</chapter_queue_ITEM>
