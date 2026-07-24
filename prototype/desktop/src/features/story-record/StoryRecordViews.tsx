import * as Tabs from '@radix-ui/react-tabs';
import { MagnifyingGlass } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import type {
  ForeshadowingStatus,
  MysteryStatus,
  RainRadioProject,
  ReaderKnowledgeKind,
  StoryCharacter
} from '../../fixtures/rainRadio';
import { t, type PlainMessageKey } from '../../i18n/t';

type StoryRecordTab =
  | 'characters'
  | 'timeline'
  | 'reader'
  | 'mysteries'
  | 'foreshadowing'
  | 'relationships'
  | 'world-rules'
  | 'canon-facts';

const tabs = [
  { value: 'characters', labelKey: 'record.tab.characters' },
  { value: 'timeline', labelKey: 'record.tab.timeline' },
  { value: 'reader', labelKey: 'record.tab.readerKnowledge' },
  { value: 'mysteries', labelKey: 'record.tab.mysteries' },
  { value: 'foreshadowing', labelKey: 'record.tab.foreshadowing' },
  { value: 'relationships', labelKey: 'record.tab.relationships' },
  { value: 'world-rules', labelKey: 'record.tab.worldRules' },
  { value: 'canon-facts', labelKey: 'record.tab.canonFacts' }
] as const satisfies readonly { value: StoryRecordTab; labelKey: PlainMessageKey }[];

const readerLabels: Record<ReaderKnowledgeKind, PlainMessageKey> = {
  known: 'record.reader.known',
  suspected: 'record.reader.suspected',
  questioned: 'record.reader.questioned',
  expected: 'record.reader.expected'
};

const mysteryStatusLabels: Record<MysteryStatus, PlainMessageKey> = {
  attention: 'record.mystery.status.attention',
  advancing: 'record.mystery.status.advancing',
  open: 'record.mystery.status.open'
};

function includesQuery(query: string, ...values: string[]) {
  const normalized = query.trim().toLocaleLowerCase('zh-CN');
  return normalized.length === 0
    || values.some((value) => value.toLocaleLowerCase('zh-CN').includes(normalized));
}

function EmptySearchState() {
  return (
    <div className="nl-record-empty" role="status">
      <strong>{t('record.empty.searchTitle')}</strong>
      <span>{t('record.empty.searchBody')}</span>
    </div>
  );
}

function RecordViewHeader({
  description,
  title
}: {
  description: string;
  title: string;
}) {
  return (
    <header className="nl-record-view__header">
      <h2>{title}</h2>
      <p>{description}</p>
    </header>
  );
}

function CharacterDetail({ character }: { character: StoryCharacter }) {
  const details = [
    [t('record.characters.currentGoal'), character.currentGoal],
    [t('record.characters.currentState'), character.currentState],
    [t('record.characters.pressure'), character.pressure],
    [t('record.characters.lastSeen'), character.lastSeen]
  ];

  return (
    <article className="nl-character-detail" aria-labelledby={`character-${character.key}`}>
      <header>
        <p>{character.role}</p>
        <h2 id={`character-${character.key}`}>{character.name}</h2>
      </header>
      <dl>
        {details.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

function CharactersView({
  characters,
  query
}: {
  characters: RainRadioProject['characters'];
  query: string;
}) {
  const visibleCharacters = characters.filter((character) => includesQuery(
    query,
    character.name,
    character.role,
    character.currentGoal,
    character.currentState,
    character.pressure
  ));
  const [selectedKey, setSelectedKey] = useState(characters[0]?.key ?? '');
  const selected = visibleCharacters.find((character) => character.key === selectedKey)
    ?? visibleCharacters[0];

  if (!selected) return <EmptySearchState />;

  return (
    <div className="nl-character-browser">
      <ul className="nl-character-list" aria-label={t('record.characters.list')}>
        {visibleCharacters.map((character) => (
          <li key={character.key}>
            <button
              aria-current={character.key === selected.key ? 'true' : undefined}
              className="nl-character-list__button"
              onClick={() => setSelectedKey(character.key)}
              type="button"
            >
              <strong>{character.name}</strong>
              <span>{character.role}</span>
            </button>
          </li>
        ))}
      </ul>
      <CharacterDetail character={selected} />
    </div>
  );
}

function TimelineView({
  events,
  query
}: {
  events: RainRadioProject['timeline'];
  query: string;
}) {
  const visibleEvents = events.filter((event) => includesQuery(
    query,
    event.when,
    event.title,
    event.summary,
    event.source
  ));

  return (
    <>
      <RecordViewHeader
        description={t('record.timeline.description')}
        title={t('record.timeline.title')}
      />
      {visibleEvents.length === 0 ? <EmptySearchState /> : (
        <ol className="nl-timeline">
          {visibleEvents.map((event) => (
            <li aria-label={`时间线事件：${event.title}`} key={event.key}>
              <time>{event.when}</time>
              <div>
                <h3>{event.title}</h3>
                <p>{event.summary}</p>
                <span>{event.source}</span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

function ReaderKnowledgeView({
  groups,
  query
}: {
  groups: RainRadioProject['readerKnowledge'];
  query: string;
}) {
  const visibleGroups = groups.map((group) => ({
    ...group,
    items: group.items.filter((item) => includesQuery(query, item))
  })).filter((group) => group.items.length > 0);

  return (
    <>
      <RecordViewHeader
        description="把读者已经掌握的信息与仍在形成的猜测分开，避免正文提前确认答案。"
        title={t('record.tab.readerKnowledge')}
      />
      {visibleGroups.length === 0 ? <EmptySearchState /> : (
        <div className="nl-reader-knowledge">
          {visibleGroups.map((group) => (
            <section aria-labelledby={`reader-${group.kind}`} key={group.kind}>
              <h3 id={`reader-${group.kind}`}>{t(readerLabels[group.kind])}</h3>
              <ul>
                {group.items.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

type MysteryFilter = 'all' | MysteryStatus;

function MysteryView({
  mysteries,
  query
}: {
  mysteries: RainRadioProject['mysteries'];
  query: string;
}) {
  const [filter, setFilter] = useState<MysteryFilter>('all');
  const filters = [
    ['all', 'record.filter.all'],
    ['attention', 'record.filter.attention'],
    ['advancing', 'record.filter.advancing'],
    ['open', 'record.filter.open']
  ] as const satisfies readonly [MysteryFilter, PlainMessageKey][];
  const visibleMysteries = mysteries.filter((mystery) => (
    (filter === 'all' || mystery.status === filter)
    && includesQuery(
      query,
      mystery.question,
      mystery.evidence,
      mystery.source,
      mystery.writingQuestion
    )
  ));

  return (
    <>
      <RecordViewHeader
        description={t('record.mysteries.description')}
        title={t('record.tab.mysteries')}
      />
      <div className="nl-record-filters" aria-label="筛选待兑现悬念">
        {filters.map(([value, labelKey]) => (
          <button
            aria-pressed={filter === value}
            key={value}
            onClick={() => setFilter(value)}
            type="button"
          >
            {t(labelKey)}
          </button>
        ))}
      </div>
      {visibleMysteries.length === 0 ? <EmptySearchState /> : (
        <div className="nl-record-entries">
          {visibleMysteries.map((mystery) => (
            <article aria-label={`悬念：${mystery.question}`} key={mystery.key}>
              <header>
                <h3>{mystery.question}</h3>
                <span className={`nl-record-status nl-record-status--${mystery.status}`}>
                  {t(mysteryStatusLabels[mystery.status])}
                </span>
              </header>
              <dl>
                <div>
                  <dt>{t('record.mystery.evidence')}</dt>
                  <dd>{mystery.evidence}</dd>
                </div>
                <div>
                  <dt>{t('record.mystery.writingQuestion')}</dt>
                  <dd>{mystery.writingQuestion}</dd>
                </div>
              </dl>
              <p className="nl-record-entries__source">{mystery.source}</p>
            </article>
          ))}
        </div>
      )}
    </>
  );
}

type ForeshadowingFilter = 'all' | ForeshadowingStatus;

function ForeshadowingView({
  query,
  threads
}: {
  query: string;
  threads: RainRadioProject['foreshadowing'];
}) {
  const [filter, setFilter] = useState<ForeshadowingFilter>('all');
  const filters = [
    ['all', 'record.filter.all'],
    ['planted', 'record.foreshadowing.planted'],
    ['returned', 'record.foreshadowing.returned']
  ] as const satisfies readonly [ForeshadowingFilter, PlainMessageKey][];
  const visibleThreads = threads.filter((thread) => (
    (filter === 'all' || thread.status === filter)
    && includesQuery(
      query,
      thread.clue,
      thread.placement,
      thread.intendedPayoff,
      thread.evidence
    )
  ));
  const isReturnedEmpty = filter === 'returned' && query.trim().length === 0;

  return (
    <>
      <RecordViewHeader
        description={t('record.foreshadowing.description')}
        title={t('record.tab.foreshadowing')}
      />
      <div className="nl-record-filters" aria-label="筛选伏笔">
        {filters.map(([value, labelKey]) => (
          <button
            aria-pressed={filter === value}
            key={value}
            onClick={() => setFilter(value)}
            type="button"
          >
            {t(labelKey)}
          </button>
        ))}
      </div>
      {visibleThreads.length === 0 ? (
        isReturnedEmpty ? (
          <div className="nl-record-empty" role="status">
            <strong>{t('record.foreshadowing.empty.title')}</strong>
            <span>{t('record.foreshadowing.empty.body')}</span>
          </div>
        ) : <EmptySearchState />
      ) : (
        <div className="nl-record-entries">
          {visibleThreads.map((thread) => (
            <article aria-label={`伏笔：${thread.clue}`} key={thread.key}>
              <header>
                <h3>{thread.clue}</h3>
                <span className="nl-record-status">{t('record.foreshadowing.planted')}</span>
              </header>
              <dl>
                <div>
                  <dt>{t('record.foreshadowing.placement')}</dt>
                  <dd>{thread.placement}</dd>
                </div>
                <div>
                  <dt>{t('record.foreshadowing.payoff')}</dt>
                  <dd>{thread.intendedPayoff}</dd>
                </div>
                <div>
                  <dt>{t('record.foreshadowing.evidence')}</dt>
                  <dd>{thread.evidence}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      )}
    </>
  );
}

function RelationshipsView({
  query,
  relationships
}: {
  query: string;
  relationships: RainRadioProject['relationships'];
}) {
  const visibleRelationships = relationships.filter((relationship) => includesQuery(
    query,
    relationship.people,
    relationship.relation,
    relationship.currentState
  ));

  return (
    <>
      <RecordViewHeader
        description={t('record.relationships.description')}
        title={t('record.tab.relationships')}
      />
      {visibleRelationships.length === 0 ? <EmptySearchState /> : (
        <ul className="nl-relationship-list" aria-label={t('record.tab.relationships')}>
          {visibleRelationships.map((relationship) => (
            <li key={relationship.key}>
              <div>
                <h3>{relationship.people}</h3>
                <span>{relationship.relation}</span>
              </div>
              <p>{relationship.currentState}</p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function StoryFactList({
  description,
  facts,
  query,
  suppressEmpty = false,
  title
}: {
  description: string;
  facts: RainRadioProject['canonFacts'];
  query: string;
  suppressEmpty?: boolean;
  title: string;
}) {
  const visibleFacts = facts.filter((fact) => includesQuery(
    query,
    fact.statement,
    fact.source
  ));

  return (
    <>
      <RecordViewHeader description={description} title={title} />
      {visibleFacts.length === 0 ? (
        suppressEmpty ? null : <EmptySearchState />
      ) : (
        <ul className="nl-fact-list">
          {visibleFacts.map((fact) => (
            <li key={fact.key}>
              <p>{fact.statement}</p>
              <span>{fact.source}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function CanonFactsView({
  project,
  query
}: {
  project: RainRadioProject;
  query: string;
}) {
  const visibleChanges = project.pendingChanges.changes.filter((change) => includesQuery(
    query,
    change.category,
    change.change,
    change.evidence
  ));

  return (
    <>
      <StoryFactList
        description={t('record.canon.description')}
        facts={project.canonFacts}
        query={query}
        suppressEmpty={visibleChanges.length > 0}
        title={t('record.tab.canonFacts')}
      />
      {(query.trim().length === 0 || visibleChanges.length > 0) && (
        <section className="nl-pending-changes" aria-labelledby="pending-record-title">
          <header>
            <div>
              <h3 id="pending-record-title">{t('record.pending.title')}</h3>
              <p>{project.pendingChanges.note}</p>
            </div>
            <span>{project.pendingChanges.status}</span>
          </header>
          <h4>{t('record.pending.changes')}</h4>
          <ul>
            {visibleChanges.map((change) => (
              <li key={`${change.category}-${change.change}`}>
                <strong>{change.category}</strong>
                <p>{change.change}</p>
                <span>{change.evidence}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

export function StoryRecordViews({ project }: { project: RainRadioProject }) {
  const [query, setQuery] = useState('');
  const searchDescription = useMemo(
    () => query.trim() ? `当前搜索：${query.trim()}` : t('record.search'),
    [query]
  );

  return (
    <Tabs.Root className="nl-story-record" defaultValue="characters" orientation="horizontal">
      <div className="nl-story-record__controls">
        <Tabs.List aria-label={t('record.title')} className="nl-story-record__tabs">
          {tabs.map((tab) => (
            <Tabs.Trigger
              className="nl-story-record__tab"
              key={tab.value}
              value={tab.value}
            >
              {t(tab.labelKey)}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <label className="nl-record-search">
          <span>{t('record.search')}</span>
          <MagnifyingGlass aria-hidden="true" size={17} weight="regular" />
          <input
            aria-description={searchDescription}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('record.searchPlaceholder')}
            type="search"
            value={query}
          />
        </label>
      </div>

      <div className="nl-story-record__view">
        <Tabs.Content value="characters">
          <CharactersView characters={project.characters} query={query} />
        </Tabs.Content>
        <Tabs.Content value="timeline">
          <TimelineView events={project.timeline} query={query} />
        </Tabs.Content>
        <Tabs.Content value="reader">
          <ReaderKnowledgeView groups={project.readerKnowledge} query={query} />
        </Tabs.Content>
        <Tabs.Content value="mysteries">
          <MysteryView mysteries={project.mysteries} query={query} />
        </Tabs.Content>
        <Tabs.Content value="foreshadowing">
          <ForeshadowingView query={query} threads={project.foreshadowing} />
        </Tabs.Content>
        <Tabs.Content value="relationships">
          <RelationshipsView query={query} relationships={project.relationships} />
        </Tabs.Content>
        <Tabs.Content value="world-rules">
          <StoryFactList
            description={t('record.worldRules.description')}
            facts={project.worldRules}
            query={query}
            title={t('record.tab.worldRules')}
          />
        </Tabs.Content>
        <Tabs.Content value="canon-facts">
          <CanonFactsView project={project} query={query} />
        </Tabs.Content>
      </div>
    </Tabs.Root>
  );
}
