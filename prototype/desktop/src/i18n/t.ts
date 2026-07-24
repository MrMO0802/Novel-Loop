import { zhCN } from './messages.zh-CN';

export type MessageKey = keyof typeof zhCN;
type MessageValues = Record<string, number | string>;

export function t(key: MessageKey, values: MessageValues = {}): string {
  return zhCN[key].replace(/\{(\w+)\}/g, (placeholder, name: string) => (
    Object.hasOwn(values, name) ? String(values[name]) : placeholder
  ));
}
