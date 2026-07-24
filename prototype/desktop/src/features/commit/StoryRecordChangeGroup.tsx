import type {
  CommitChangeGroupFixture,
  CommitChangeGroupKind
} from '../../fixtures/commitPreview';
import { t, type PlainMessageKey } from '../../i18n/t';

const groupMessageKeys: Record<CommitChangeGroupKind, PlainMessageKey> = {
  facts: 'commit.group.facts',
  character: 'commit.group.character',
  timeline: 'commit.group.timeline',
  mystery: 'commit.group.mystery',
  foreshadowing: 'commit.group.foreshadowing',
  reader: 'commit.group.reader'
};

interface StoryRecordChangeGroupProps {
  group: CommitChangeGroupFixture;
}

export function StoryRecordChangeGroup({ group }: StoryRecordChangeGroupProps) {
  const label = t(groupMessageKeys[group.kind]);
  const titleId = `commit-change-group-${group.kind}`;

  return (
    <section
      aria-labelledby={titleId}
      className="nl-commit-change-group"
    >
      <header className="nl-commit-change-group__header">
        <h2 id={titleId}>{label}</h2>
        <span>{t('commit.group.count', { count: group.items.length })}</span>
      </header>
      <ul>
        {group.items.map((item) => (
          <li key={item.title}>
            <strong>{item.title}</strong>
            <span>{item.detail}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
