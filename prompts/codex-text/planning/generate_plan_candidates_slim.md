Return only JSON that matches the provided output schema.

Task:
Generate minimal plan candidates for the chapter.

Rules:
- No markdown outside JSON.
- No explanation.
- Produce exactly {{CANDIDATE_COUNT}} candidates.

<chapter_number>
{{CHAPTER_NUMBER}}
</chapter_number>

<mission_summary>
{{MISSION_SUMMARY}}
</mission_summary>
