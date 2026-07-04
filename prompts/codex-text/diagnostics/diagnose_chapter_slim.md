Return only JSON that matches the provided output schema.

Task:
Give a minimal diagnostics result for the draft.

Rules:
- No markdown.
- No explanation.
- Set `passed` false if any hard continuity problem is present.
- If `passed` is true, set `averageScore` to 8.5 or higher.
- Include issues as an array; use an empty array if there are no issues.

<chapter_number>
{{CHAPTER_NUMBER}}
</chapter_number>

<draft_version>
{{DRAFT_VERSION}}
</draft_version>

<draft_summary>
{{DRAFT_SUMMARY}}
</draft_summary>
