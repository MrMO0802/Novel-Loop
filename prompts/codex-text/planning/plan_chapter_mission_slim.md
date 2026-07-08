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
- Use exactly these top-level keys: chapterNumber, chapterFunction, objectives, readerKnowledge, readerQuestions, forbiddenMoves.
- chapterNumber must equal {{CHAPTER_NUMBER}}.
- chapterFunction must be one concise sentence.
- Every array must contain strings only.
- Keep context bounded to the chapter.
- Include readerKnowledge, readerQuestions, and forbiddenMoves as arrays.
- Use empty arrays when a field has no items.
- Keep output deterministic: do not invent extra IDs, nested objects, prose blocks, or commentary.

Valid shape example:
{
  "chapterNumber": {{CHAPTER_NUMBER}},
  "chapterFunction": "Advance the committed chapter queue item without resolving the final mystery.",
  "objectives": ["Advance one queued plot objective."],
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
