Return only JSON that matches the provided output schema.

Task:
Create a minimal chapter mission.

Rules:
- No markdown.
- No explanation.
- No extra fields.
- Keep context bounded to the chapter.
- Include readerKnowledge, readerQuestions, and forbiddenMoves as arrays.
- Use empty arrays when a field has no items.

<chapter_number>
{{CHAPTER_NUMBER}}
</chapter_number>

<story_state_summary>
{{STORY_STATE_SUMMARY}}
</story_state_summary>

<chapter_queue_ITEM>
{{CHAPTER_QUEUE_ITEM}}
</chapter_queue_ITEM>
