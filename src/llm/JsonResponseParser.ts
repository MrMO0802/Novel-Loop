export class JsonResponseParseError extends Error {
  readonly code = 'LLM_INVALID_JSON';

  constructor(message: string) {
    super(message);
    this.name = 'JsonResponseParseError';
  }
}

export class JsonResponseParser {
  parse(text: string): unknown {
    const jsonText = this.extractJsonText(text);

    try {
      return JSON.parse(jsonText);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new JsonResponseParseError(`Invalid JSON response: ${message}`);
    }
  }

  parseWithRepair(text: string): unknown {
    try {
      return this.parse(text);
    } catch (originalError) {
      const repaired = this.repairJsonText(text);

      try {
        return JSON.parse(repaired);
      } catch {
        throw originalError;
      }
    }
  }

  private extractJsonText(text: string): string {
    const trimmed = text.trim();
    const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(trimmed);

    return fenced?.[1]?.trim() ?? trimmed;
  }

  private repairJsonText(text: string): string {
    const extracted = this.extractJsonText(text);
    const objectStart = extracted.indexOf('{');
    const arrayStart = extracted.indexOf('[');
    const starts = [objectStart, arrayStart].filter((index) => index >= 0);
    const start = starts.length === 0 ? 0 : Math.min(...starts);
    const objectEnd = extracted.lastIndexOf('}');
    const arrayEnd = extracted.lastIndexOf(']');
    const end = Math.max(objectEnd, arrayEnd);
    const sliced = end >= start ? extracted.slice(start, end + 1) : extracted;

    return sliced.replace(/,\s*([}\]])/g, '$1').trim();
  }
}
