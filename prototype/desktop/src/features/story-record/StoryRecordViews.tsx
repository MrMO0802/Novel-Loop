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

export type StoryRecordTab =
  | 'characters'
  | 'timeline'
  | 'reader'
  | 'mysteries'
  | 'foreshadowing'
  | 'relationships'
  | 'world-rules'
  | 'canon-facts'
  | 'pending';

const tabs = [
  { value: 'characters', labelKey: 'record.tab.characters' },
  { value: 'timeline', labelKey: 'record.tab.timeline' },
  { value: 'reader', labelKey: 'record.tab.readerKnowledge' },
  { value: 'mysteries', labelKey: 'record.tab.mysteries' },
  { value: 'foreshadowing', labelKey: 'record.tab.foreshadowing' },
  { value: 'relationships', labelKey: 'record.tab.relationships' },
  { value: 'world-rules', labelKey: 'record.tab.worldRules' },
  { value: 'canon-facts', labelKey: 'record.tab.canonFacts' },
  { value: 'pending', labelKey: 'record.tab.pending' }
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
            <li
              aria-label={t('record.timeline.eventLabel', { title: event.title })}
              key={event.key}
            >
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
        description={t('record.reader.description')}
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
      <div className="nl-record-filters" aria-label={t('record.filter.mysteriesLabel')}>
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
            <article
              aria-label={t('record.mystery.entryLabel', { question: mystery.question })}
              key={mystery.key}
            >
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
      <div className="nl-record-filters" aria-label={t('record.filter.foreshadowingLabel')}>
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
            <article
              aria-label={t('record.foreshadowing.entryLabel', { clue: thread.clue })}
              key={thread.key}
            >
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
  title
}: {
  description: string;
  facts: RainRadioProject['canonFacts'];
  query: string;
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
        <EmptySearchState />
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
  return (
    <StoryFactList
      description={t('record.canon.description')}
      facts={project.canonFacts}
      query={query}
      title={t('record.tab.canonFacts')}
    />
  );
}

function PendingChangesView({
  pending,
  query
}: {
  pending: RainRadioProject['pendingChanges'];
  query: string;
}) {
  const characters = pending.characters.filter((character) => includesQuery(
    query,
    character.name,
    character.role,
    character.currentGoal,
    character.currentState,
    character.pressure,
    character.lastSeen
  ));
  const timeline = pending.timeline.filter((event) => includesQuery(
    query,
    event.when,
    event.title,
    event.summary,
    event.source
  ));
  const foreshadowing = pending.foreshadowing.filter((thread) => includesQuery(
    query,
    thread.clue,
    thread.placement,
    thread.intendedPayoff,
    thread.evidence
  ));
  const relationships = pending.relationships.filter((relationship) => includesQuery(
    query,
    relationship.people,
    relationship.relation,
    relationship.currentState
  ));
  const changes = pending.changes.filter((change) => includesQuery(
    query,
    change.category,
    change.change,
    change.evidence
  ));
  const hasResults = characters.length
    + timeline.length
    + foreshadowing.length
    + relationships.length
    + changes.length > 0;

  return (
    <section className="nl-pending-changes" aria-labelledby="pending-record-title">
      <header>
        <div>
          <h2 id="pending-record-title">{t('record.pending.title')}</h2>
          <p>{t('record.pending.description')}</p>
          <p>{pending.note}</p>
        </div>
        <span>{pending.status}</span>
      </header>

      {!hasResults ? <EmptySearchState /> : (
        <div className="nl-pending-changes__groups">
          {characters.length > 0 && (
            <section>
              <h3>{t('record.pending.characters')}</h3>
              <ul>
                {characters.map((character) => (
                  <li key={character.key}>
                    <strong>{character.name}</strong>
                    <p>{character.currentState}</p>
                    <span>{character.lastSeen}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {timeline.length > 0 && (
            <section>
              <h3>{t('record.pending.timeline')}</h3>
              <ul>
                {timeline.map((event) => (
                  <li key={event.key}>
                    <strong>{event.title}</strong>
                    <p>{event.summary}</p>
                    <span>{event.when}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {foreshadowing.length > 0 && (
            <section>
              <h3>{t('record.pending.foreshadowing')}</h3>
              <ul>
                {foreshadowing.map((thread) => (
                  <li key={thread.key}>
                    <strong>{thread.clue}</strong>
                    <p>{thread.intendedPayoff}</p>
                    <span>{thread.placement}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {relationships.length > 0 && (
            <section>
              <h3>{t('record.pending.relationships')}</h3>
              <ul>
                {relationships.map((relationship) => (
                  <li key={relationship.key}>
                    <strong>{relationship.people}</strong>
                    <p>{relationship.currentState}</p>
                    <span>{relationship.relation}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {changes.length > 0 && (
            <section>
              <h3>{t('record.pending.changes')}</h3>
              <ul>
                {changes.map((change) => (
                  <li key={`${change.category}-${change.change}`}>
                    <strong>{change.category}</strong>
                    <p>{change.change}</p>
                    <span>{change.evidence}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </section>
  );
}

export function StoryRecordViews({
  initialTab = 'characters',
  project
}: {
  initialTab?: StoryRecordTab;
  project: RainRadioProject;
}) {
  const [query, setQuery] = useState('');
  const searchDescription = useMemo(
    () => query.trim()
      ? t('record.search.current', { query: query.trim() })
      : t('record.search'),
    [query]
  );

  return (
    <Tabs.Root className="nl-story-record" defaultValue={initialTab} orientation="horizontal">
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
        <span aria-live="polite" className="nl-visually-hidden" role="status">
          {searchDescription}
        </span>
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
        <Tabs.Content value="pending">
          <PendingChangesView pending={project.pendingChanges} query={query} />
        </Tabs.Content>
      </div>
    </Tabs.Root>
  );
}
