import { zhCN } from './messages.zh-CN';

export type MessageKey = keyof typeof zhCN;
type PlaceholderNames<Message extends string> =
  Message extends `${string}{${infer Name}}${infer Rest}`
    ? Name | PlaceholderNames<Rest>
    : never;

export type PlainMessageKey = {
  [Key in MessageKey]: [PlaceholderNames<(typeof zhCN)[Key]>] extends [never]
    ? Key
    : never;
}[MessageKey];

export type InterpolatedMessageKey = Exclude<MessageKey, PlainMessageKey>;

type MessageValues<Key extends InterpolatedMessageKey> = {
  [Name in PlaceholderNames<(typeof zhCN)[Key]>]: number | string;
};

export function t<Key extends PlainMessageKey>(key: Key): string;
export function t<Key extends InterpolatedMessageKey>(
  key: Key,
  values: MessageValues<Key>
): string;
export function t(
  key: MessageKey,
  values: Record<string, number | string> = {}
): string {
  return zhCN[key].replace(/\{(\w+)\}/g, (_placeholder, name: string) => {
    if (!Object.hasOwn(values, name)) {
      throw new Error(`Missing message value "${name}" for "${key}".`);
    }
    return String(values[name]);
  });
}
