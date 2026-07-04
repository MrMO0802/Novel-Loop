export type TemplateValues = Record<string, unknown>;

export class TemplateRenderer {
  render(template: string, values: TemplateValues): string {
    return template.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_match: string, key: string) => {
      if (!(key in values)) {
        throw new Error(`Missing template value for ${key}`);
      }

      return String(values[key]);
    });
  }
}
