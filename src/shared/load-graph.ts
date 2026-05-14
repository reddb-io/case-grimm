import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'
import yaml from 'js-yaml'

export type GraphPropertyValue = string | number | boolean | null
export type GraphProperties = Record<string, GraphPropertyValue>

export interface GrimmNode {
  label: string
  node_type: string
  name: string
  properties?: GraphProperties
}
export interface GrimmEdge {
  from: string
  to: string
  label: string
  properties?: GraphProperties
}
export interface GrimmGraph {
  collection: string
  nodes: GrimmNode[]
  edges: GrimmEdge[]
}

type UnknownRecord = Record<string, unknown>

const ONTOLOGY_NODE_TYPES: Record<string, string> = {
  archetypes: 'archetype',
  world_laws: 'world_law',
  agency_modes: 'agency_mode',
  existential_states: 'existential_state',
  threshold_types: 'threshold_type',
  transformation_modes: 'transformation_mode',
  speech_acts: 'speech_act',
  moral_regimes: 'moral_regime',
  affects: 'affect',
  narrative_functions: 'narrative_function',
  species: 'species',
  being_types: 'being_type',
  symbol_numbers: 'symbol_number',
  locations: 'location',
  magic_objects: 'magic_object',
  edge_labels: 'edge_label',
}

const CLASSIFICATION_EDGES: Record<string, string> = {
  themes: 'CONTAINS_THEME',
  world_laws: 'HAS_WORLD_LAW',
  moral_regimes: 'HAS_MORAL_REGIME',
  agency_modes_dominant: 'HAS_AGENCY_MODE',
  affects_driving: 'HAS_AFFECT',
  symbol_numbers: 'CONTAINS_NUMBER',
  threshold_types: 'HAS_THRESHOLD_TYPE',
}

const CHARACTER_LIST_EDGES: Record<string, string> = {
  archetypes: 'IS_ARCHETYPE',
  agency_modes: 'GAINS_AGENCY_THROUGH',
  existential_states: 'EXISTS_IN_STATE',
  transformations: 'UNDERGOES_TRANSFORMATION',
  speech_acts_performed: 'PERFORMS_SPEECH_ACT',
  affects: 'HAS_AFFECT',
}

function walkFiles(
  dir: string,
  predicate: (entry: string) => boolean,
  acc: string[] = [],
): string[] {
  if (!existsSync(dir)) return acc
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    const st = statSync(p)
    if (st.isDirectory()) walkFiles(p, predicate, acc)
    else if (predicate(entry)) acc.push(p)
  }
  return acc
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : []
}

function scalar(value: unknown): GraphPropertyValue | undefined {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (value === null) return null
  return undefined
}

function compactProperties(props: Record<string, unknown>): GraphProperties {
  const out: GraphProperties = {}
  for (const [key, value] of Object.entries(props)) {
    const v = scalar(value)
    if (v !== undefined) out[key] = v
  }
  return out
}

function columnPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function slugLabel(slug: string): string {
  return slug.replace(/-/g, '_')
}

function slugifyLabelPart(value: string): string {
  return columnPart(value) || 'unnamed'
}

type CanonicalTrait = {
  label: string
  name: string
  family: string
  description: string
  patterns: RegExp[]
}

type CanonicalTraitMatch = {
  trait: CanonicalTrait
  rawTraits: string[]
}

const CHARACTER_TRAITS: CanonicalTrait[] = [
  trait('trait_clever', 'Clever', 'cognition', 'Solves problems through intelligence, wit, or practical judgment.', ['clever', 'wise', 'cunning', 'crafty', 'riddle-solver', 'answerer', 'solver']),
  trait('trait_foolish', 'Foolish', 'cognition', 'Misreads danger, advice, or social reality.', ['fool', 'foolish', 'stupid', 'simpleton', 'simple', 'silly']),
  trait('trait_curious', 'Curious', 'cognition', 'Crosses into knowledge because they want to see, ask, or know.', ['curious', 'questioner', 'inquisitive']),
  trait('trait_brave', 'Brave', 'cognition', 'Acts despite danger, fear, violence, or supernatural risk.', ['brave', 'fearless', 'bold', 'courageous']),
  trait('trait_fearful', 'Fearful', 'cognition', 'Defined by fear, alarm, dread, or panic.', ['afraid', 'fearful', 'frightened', 'terrified', 'alarm-raiser']),
  trait('trait_kind', 'Kind', 'moral', 'Shows care, help, hospitality, tenderness, or compassion.', ['kind', 'good-hearted', 'compassionate', 'tender-hearted', 'hospitable', 'gentle']),
  trait('trait_generous', 'Generous', 'moral', 'Gives food, shelter, objects, money, mercy, or opportunity.', ['generous', 'giver', 'givers', 'bestower', 'bestowers', 'sharer', 'sharers', 'reward-giver', 'kingdom-giver', 'daughter-giver', 'blessing-giver']),
  trait('trait_merciful', 'Merciful', 'moral', 'Spare, forgive, or plead for life instead of punishment.', ['merciful', 'mercy', 'forgiving', 'spared', 'pardoner']),
  trait('trait_loyal', 'Loyal', 'moral', 'Keeps faith with kin, lord, promise, companion, or beloved.', ['loyal', 'faithful', 'devoted', 'true', 'trustworthy', 'trusting']),
  trait('trait_pious', 'Pious', 'moral', 'Acts through prayer, holiness, devotion, blessing, or sacred duty.', ['pious', 'devout', 'holy', 'prayerful', 'saintly']),
  trait('trait_obedient', 'Obedient', 'moral', 'Accepts commands, prohibitions, social rules, or parental demands.', ['obedient', 'submissive', 'compliant']),
  trait('trait_rebellious', 'Rebellious', 'moral', 'Breaks commands, prohibitions, social place, or expected obedience.', ['rebellious', 'disobedient', 'defiant', 'runaway']),
  trait('trait_wicked', 'Wicked', 'moral', 'Marked by moral corruption, malice, or destructive intent.', ['wicked', 'evil', 'sinful', 'bad', 'malicious']),
  trait('trait_cruel', 'Cruel', 'moral', 'Harms others through violence, neglect, humiliation, or needless punishment.', ['cruel', 'brutal', 'hard-hearted', 'murderous', 'death-sentencer', 'death-threatener']),
  trait('trait_greedy', 'Greedy', 'moral', 'Desires food, wealth, status, or reward beyond right measure.', ['greedy', 'avaricious', 'gluttonous', 'covetous']),
  trait('trait_proud', 'Proud', 'moral', 'Acts from pride, haughtiness, vanity, contempt, or rank-conscious arrogance.', ['proud', 'haughty', 'vain', 'arrogant', 'mocker']),
  trait('trait_envious', 'Envious', 'moral', "Resents another person's beauty, fortune, rank, or love.", ['envious', 'jealous', 'envier']),
  trait('trait_deceptive', 'Deceptive', 'moral', 'Uses lies, disguise, fraud, false accusation, or betrayal.', ['false', 'deceitful', 'deceiver', 'liar', 'fraud', 'betrayer', 'treacherous', 'impostor']),
  trait('trait_industrious', 'Industrious', 'labor', 'Works diligently, spins, serves, gathers, cooks, cleans, or completes practical tasks.', ['industrious', 'hard-working', 'worker', 'workers', 'maker', 'makers', 'spinner', 'cook', 'servant', 'servants', 'gardener', 'woodcutter', 'carrier']),
  trait('trait_lazy', 'Lazy', 'labor', 'Avoids work, delays effort, idles, or tries to gain without labor.', ['lazy', 'idle', 'work-shy']),
  trait('trait_poor', 'Poor', 'social', 'Lives under scarcity, poverty, hunger, or low material power.', ['poor', 'beggar', 'beggar-maid', 'penniless']),
  trait('trait_rich', 'Rich', 'social', 'Has money, land, treasure, abundance, or high material power.', ['rich', 'wealthy', 'merchant']),
  trait('trait_royal', 'Royal', 'social', 'Belongs to kingly, queenly, princely, princessly, or courtly power.', ['king', 'queen', 'prince', 'princess', 'royal']),
  trait('trait_low_status', 'Low Status', 'social', 'Occupies a marginal, despised, peasant, servant, or socially humiliated position.', ['peasant', 'servant', 'maid', 'kitchen-servant', 'despised', 'outcast', 'low-born']),
  trait('trait_old', 'Old', 'life-stage', 'Age grants weakness, wisdom, liminality, need, or authority.', ['old', 'aged', 'elderly']),
  trait('trait_young', 'Young', 'life-stage', 'Childhood or youth shapes vulnerability, testing, innocence, or promise.', ['young', 'child', 'boy', 'girl', 'daughter', 'son', 'newborn', 'little']),
  trait('trait_beautiful', 'Beautiful', 'embodiment', 'Beauty changes desire, rank, danger, recognition, or rivalry.', ['beautiful', 'pretty', 'fair', 'golden-haired', 'lovely']),
  trait('trait_ugly', 'Ugly', 'embodiment', 'Ugliness, deformity, dirt, or repulsiveness affects status or recognition.', ['ugly', 'dirty', 'deformed', 'misshapen', 'blackened']),
  trait('trait_hungry', 'Hungry', 'embodiment', 'Need for food drives action, vulnerability, bargaining, or danger.', ['hungry', 'starving', 'famished']),
  trait('trait_parent', 'Kin Parent', 'kinship', 'Acts as mother, father, step-parent, adoptive parent, or foster parent.', ['mother', 'father', 'stepmother', 'step-father', 'parent', 'adoptive-father', 'foster']),
  trait('trait_sibling', 'Kin Sibling', 'kinship', 'Acts through brotherhood, sisterhood, or sibling rivalry/support.', ['brother', 'sister', 'sibling']),
  trait('trait_spouse_or_suitor', 'Spouse Or Suitor', 'kinship', 'Acts as bride, bridegroom, husband, wife, betrothed, lover, or suitor.', ['bride', 'bridegroom', 'husband', 'wife', 'betrothed', 'suitor', 'wooer', 'lover']),
  trait('trait_helper', 'Helper', 'narrative-role', 'Aids another character with advice, labor, magic, rescue, objects, or timing.', ['helper', 'helpers', 'aid', 'rescuer', 'rescuers', 'protective', 'shelterer', 'shelterers', 'guide', 'guides', 'adviser', 'advisers', 'advisor', 'advisors', 'instructor', 'instructors', 'companion']),
  trait('trait_adversary', 'Adversary', 'narrative-role', 'Opposes, harms, captures, deceives, hunts, tests, or blocks another character.', ['enemy', 'opponent', 'adversary', 'villain', 'persecutor', 'threatener', 'murderer', 'robber', 'captor', 'captors', 'killer', 'killers', 'thief', 'thieves', 'devourer', 'devourers']),
  trait('trait_victim', 'Victim', 'narrative-role', 'Suffers abandonment, capture, false accusation, violence, curse, or dispossession.', ['victim', 'falsely-accused', 'abandoned', 'betrayed', 'persecuted', 'rejected', 'robbed']),
  trait('trait_donor', 'Donor', 'narrative-role', 'Provides a gift, blessing, knowledge, object, test, or reward that changes the plot.', ['donor', 'donors', 'gift', 'gift-giver', 'gift-givers', 'blessing-giver', 'reward-giver', 'provider', 'providers']),
  trait('trait_seeker', 'Seeker', 'narrative-role', 'Searches, travels, wanders, follows, or quests toward restoration or discovery.', ['seeker', 'searcher', 'wanderer', 'traveller', 'traveler', 'passenger', 'quester', 'pursuer']),
  trait('trait_judge', 'Judge', 'narrative-role', 'Judges guilt, merit, hospitality, truth, or punishment.', ['judge', 'judgment', 'hospitality-judge', 'tester']),
  trait('trait_witness', 'Witness', 'narrative-role', 'Sees, overhears, verifies, or preserves knowledge that matters later.', ['witness', 'witnesses', 'observer', 'observers', 'overhearer', 'watcher']),
  trait('trait_messenger', 'Messenger', 'narrative-role', 'Carries speech, warning, summons, prophecy, formula, or public announcement.', ['messenger', 'warning', 'warning-giver', 'danger-warner', 'speaker', 'caller', 'herald', 'announcer', 'formula-speaker']),
  trait('trait_task_setter', 'Task Setter', 'narrative-role', 'Creates impossible tasks, riddles, trials, commands, or marriage conditions.', ['task-setter', 'impossible-task-setter', 'riddle-setter', 'condition-setter']),
  trait('trait_task_solver', 'Task Solver', 'narrative-role', 'Solves riddles, completes impossible tasks, answers tests, or breaks conditions.', ['task-solver', 'riddle-solver', 'answerer', 'solver']),
  trait('trait_oath_bound', 'Oath Bound', 'obligation', 'Is bound by promise, oath, debt, vow, taboo, or contract.', ['oath-bound', 'promise-bound', 'vow-bound', 'debt-bound', 'bound']),
  trait('trait_hidden', 'Hidden Or Disguised', 'state', 'Identity, body, knowledge, or presence is concealed.', ['hidden', 'disguised', 'concealed', 'secret', 'unrecognized']),
  trait('trait_lost_or_exiled', 'Lost Or Exiled', 'state', 'Removed from home, lost in a threshold space, banished, rejected, or displaced.', ['lost', 'exiled', 'banished', 'rejected', 'forest-lost', 'outcast']),
  trait('trait_imprisoned', 'Imprisoned', 'state', 'Held in tower, pit, cage, cellar, enchantment, captivity, or forced enclosure.', ['imprisoned', 'captive', 'trapped', 'locked', 'cellar', 'tower-prisoner']),
  trait('trait_dead_or_wounded', 'Dead Or Wounded', 'state', 'Killed, beheaded, drowned, wounded, dismembered, executed, or made deathlike.', ['dead', 'death', 'drowned', 'drowning-victim', 'beheaded', 'wounded', 'dismembered', 'executed']),
  trait('trait_cursed_or_transformed', 'Cursed Or Transformed', 'state', 'Altered by curse, enchantment, animal form, restoration, or disenchantment.', ['cursed', 'enchanted', 'transformed', 'disenchanted', 'restored', 'released-bridegroom', 'restored-bride']),
  trait('trait_rewarded', 'Rewarded', 'outcome', 'Receives compensation, marriage, kingdom, wealth, restoration, or public elevation.', ['rewarded', 'compensated', 'restored', 'enriched', 'kingdom-giver']),
  trait('trait_punished', 'Punished', 'outcome', 'Receives execution, humiliation, mutilation, exile, exposure, or violent justice.', ['punished', 'executed', 'banished', 'beheaded', 'death-sentencer']),
]

function trait(
  label: string,
  name: string,
  family: string,
  description: string,
  keywords: string[],
): CanonicalTrait {
  return {
    label,
    name,
    family,
    description,
    patterns: keywords.map((keyword) => {
      const part = slugifyLabelPart(keyword).replace(/_/g, '-')
      return new RegExp(`(^|-)${part}($|-)`)
    }),
  }
}

function canonicalTraitMatches(rawTraits: string[]): CanonicalTraitMatch[] {
  const normalized = rawTraits.map((raw) => ({
    raw,
    label: slugifyLabelPart(raw).replace(/_/g, '-'),
  }))
  const matches: CanonicalTraitMatch[] = []

  for (const traitDef of CHARACTER_TRAITS) {
    const rawMatches = normalized
      .filter(({ label }) => traitDef.patterns.some((pattern) => pattern.test(label)))
      .map(({ raw }) => raw)
    if (rawMatches.length) matches.push({ trait: traitDef, rawTraits: rawMatches })
  }

  return matches
}

function proppEventLabel(taleSlug: string, order: number): string {
  return `propp_${slugLabel(taleSlug)}_${String(order).padStart(2, '0')}`
}

function displayName(entry: unknown, fallback: string): string {
  if (isRecord(entry) && typeof entry.name === 'string' && entry.name.trim()) return entry.name
  return fallback
}

function inferNodeType(label: string): string {
  if (label.endsWith('_tale')) return 'tale'
  if (label.startsWith('arc_')) return 'archetype'
  if (label.startsWith('law_')) return 'world_law'
  if (label.startsWith('agency_')) return 'agency_mode'
  if (label.startsWith('state_')) return 'existential_state'
  if (label.startsWith('threshold_')) return 'threshold_type'
  if (label.startsWith('transform_')) return 'transformation_mode'
  if (label.startsWith('speech_')) return 'speech_act'
  if (label.startsWith('moral_')) return 'moral_regime'
  if (label.startsWith('affect_')) return 'affect'
  if (label.startsWith('func_')) return 'narrative_function'
  if (label.startsWith('sp_')) return 'species'
  if (label.startsWith('being_')) return 'being_type'
  if (label.startsWith('num_')) return 'symbol_number'
  if (label.startsWith('loc_')) return 'location'
  if (label.startsWith('obj_')) return 'magic_object'
  if (label.startsWith('atu_')) return 'atu_type'
  if (label.startsWith('trait_')) return 'trait'
  if (label.startsWith('propp_')) return 'propp_event'
  return 'reference'
}

function addNode(
  nodes: GrimmNode[],
  seenLabels: Set<string>,
  label: string,
  node_type: string,
  name = label,
  properties: GraphProperties = {},
): void {
  if (seenLabels.has(label)) return
  seenLabels.add(label)
  nodes.push(Object.keys(properties).length ? { label, node_type, name, properties } : { label, node_type, name })
}

function addEdge(
  edges: GrimmEdge[],
  from: unknown,
  to: unknown,
  label: string,
  properties: GraphProperties = {},
): void {
  if (typeof from !== 'string' || typeof to !== 'string' || !from || !to) return
  edges.push(Object.keys(properties).length ? { from, to, label, properties } : { from, to, label })
}

function addScalarAttributes(props: GraphProperties, value: unknown): void {
  if (!isRecord(value)) return
  for (const [key, raw] of Object.entries(value)) {
    const v = scalar(raw)
    if (v !== undefined) props[`attribute_${columnPart(key)}`] = v
  }
}

function cleanEvidence(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  return text ? text : undefined
}

function addOntologyYaml(
  goldDir: string,
  nodes: GrimmNode[],
  edges: GrimmEdge[],
  seenLabels: Set<string>,
): void {
  const ontologyPath = join(goldDir, 'ontology.yaml')
  if (existsSync(ontologyPath)) {
    const ontology = yaml.load(readFileSync(ontologyPath, 'utf8'))
    if (isRecord(ontology)) {
      for (const [category, nodeType] of Object.entries(ONTOLOGY_NODE_TYPES)) {
        const entries = ontology[category]
        if (!isRecord(entries)) continue
        for (const [label, entry] of Object.entries(entries)) {
          addNode(
            nodes,
            seenLabels,
            label,
            nodeType,
            displayName(entry, label),
            isRecord(entry)
              ? compactProperties({
                  description: entry.description,
                  tier: entry.tier,
                  scope: entry.scope,
                  lens: entry.lens,
                })
              : {},
          )
          if (isRecord(entry)) {
            for (const related of stringArray(entry.related)) {
              addEdge(edges, label, related, 'RELATED_TO', {
                source_kind: 'ontology.related',
                source_field: 'related',
              })
            }
          }
        }
      }
    }
  }

  const atuPath = join(goldDir, 'atu.yaml')
  if (!existsSync(atuPath)) return
  const atu = yaml.load(readFileSync(atuPath, 'utf8'))
  if (!isRecord(atu) || !isRecord(atu.atu_types)) return
  for (const [label, entry] of Object.entries(atu.atu_types)) {
    addNode(
      nodes,
      seenLabels,
      label,
      'atu_type',
      displayName(entry, label),
      isRecord(entry)
        ? compactProperties({
            description: entry.description,
            tier: entry.tier,
            scope: entry.scope,
            lens: entry.lens,
          })
        : {},
    )
    if (isRecord(entry)) {
      for (const related of stringArray(entry.related)) {
        addEdge(edges, label, related, 'RELATED_TO', {
          source_kind: 'atu.related',
          source_field: 'related',
        })
      }
    }
  }
}

function characterEdgeProps(taleSlug: string, field: string, evidence?: string): GraphProperties {
  return compactProperties({
    tale_slug: taleSlug,
    source_kind: `character.${field}`,
    source_field: field,
    evidence,
  })
}

function addCharacterEdges(
  edges: GrimmEdge[],
  label: string,
  character: UnknownRecord,
  taleSlug: string,
): void {
  const evidence = cleanEvidence(character.evidence)
  if (typeof character.species === 'string') {
    addEdge(edges, label, character.species, 'IS_SPECIES', characterEdgeProps(taleSlug, 'species', evidence))
  }
  if (typeof character.being_type === 'string') {
    addEdge(edges, label, character.being_type, 'IS_BEING_TYPE', characterEdgeProps(taleSlug, 'being_type', evidence))
  }
  for (const [field, edgeLabel] of Object.entries(CHARACTER_LIST_EDGES)) {
    for (const target of stringArray(character[field])) {
      addEdge(edges, label, target, edgeLabel, characterEdgeProps(taleSlug, field, evidence))
    }
  }
}

function loadGoldYamlGraph(goldDir: string): GrimmGraph | null {
  const talesDir = join(goldDir, 'tales')
  const files = walkFiles(talesDir, (entry) => entry.endsWith('.yaml') || entry.endsWith('.yml')).sort()
  if (files.length === 0) return null

  const seenLabels = new Set<string>()
  const nodes: GrimmNode[] = []
  const edges: GrimmEdge[] = []

  addOntologyYaml(goldDir, nodes, edges, seenLabels)

  for (const path of files) {
    const tale = yaml.load(readFileSync(path, 'utf8'))
    if (!isRecord(tale) || typeof tale.slug !== 'string') continue

    const taleLabel = `${slugLabel(tale.slug)}_tale`
    addNode(
      nodes,
      seenLabels,
      taleLabel,
      'tale',
      displayName(tale, slugLabel(tale.slug)),
      compactProperties({
        slug: tale.slug,
        title: tale.title,
        khm: tale.khm,
        khm_variant: tale.khm_variant,
        legend_number: tale.legend_number,
        atu: tale.atu,
        atu_name: tale.atu_name,
        canonical_source: tale.canonical_source,
      }),
    )

    if (typeof tale.atu === 'string' && tale.atu.trim()) {
      const atuLabel = `atu_${tale.atu.toLowerCase().replace(/[^a-z0-9]+/g, '')}`
      addEdge(edges, taleLabel, atuLabel, 'HAS_ATU_TYPE', {
        tale_slug: tale.slug,
        source_kind: 'tale.atu',
        source_field: 'atu',
      })
    }

    if (isRecord(tale.entities)) {
      const characters = tale.entities.characters
      if (isRecord(characters)) {
        for (const [label, character] of Object.entries(characters)) {
          const characterRecord = isRecord(character) ? character : {}
          const evidence = cleanEvidence(characterRecord.evidence)
          const rawTraits = stringArray(characterRecord.traits)
          const canonicalTraits = canonicalTraitMatches(rawTraits)
          addNode(
            nodes,
            seenLabels,
            label,
            'character',
            displayName(character, label),
            compactProperties({
              tale_slug: tale.slug,
              species: characterRecord.species,
              being_type: characterRecord.being_type,
              raw_traits: rawTraits.join('|'),
              raw_trait_count: rawTraits.length,
              canonical_trait_count: canonicalTraits.length,
              evidence,
            }),
          )
          addEdge(edges, label, taleLabel, 'APPEARS_IN', {
            tale_slug: tale.slug,
            source_kind: 'character',
          })
          for (const match of canonicalTraits) {
            addNode(
              nodes,
              seenLabels,
              match.trait.label,
              'trait',
              match.trait.name,
              {
                family: match.trait.family,
                description: match.trait.description,
              },
            )
            addEdge(edges, label, match.trait.label, 'HAS_TRAIT', {
              ...characterEdgeProps(tale.slug, 'traits', evidence),
              raw_traits: match.rawTraits.join('|'),
            })
          }
          if (isRecord(character)) addCharacterEdges(edges, label, character, tale.slug)
        }
      }

      const magicObjects = tale.entities.magic_objects
      if (isRecord(magicObjects)) {
        for (const [label, object] of Object.entries(magicObjects)) {
          const objectRecord = isRecord(object) ? object : {}
          const evidence = cleanEvidence(objectRecord.evidence)
          const properties = compactProperties({
            tale_slug: tale.slug,
            instance_of: objectRecord.instance_of,
            object_kind: objectRecord.object_kind,
            evidence,
          })
          addScalarAttributes(properties, objectRecord.attributes)
          addNode(nodes, seenLabels, label, 'magic_object', displayName(object, label), properties)
          addEdge(edges, taleLabel, label, 'HAS_MAGIC_OBJECT', {
            tale_slug: tale.slug,
            source_kind: 'entities.magic_objects',
          })
          addEdge(edges, label, taleLabel, 'APPEARS_IN', {
            tale_slug: tale.slug,
            source_kind: 'magic_object',
          })
          if (typeof objectRecord.instance_of === 'string') {
            addEdge(edges, label, objectRecord.instance_of, 'IS_INSTANCE_OF', {
              tale_slug: tale.slug,
              source_kind: 'magic_object.instance_of',
              source_field: 'instance_of',
              ...(evidence ? { evidence } : {}),
            })
            addEdge(edges, taleLabel, objectRecord.instance_of, 'HAS_MAGIC_OBJECT', {
              tale_slug: tale.slug,
              source_kind: 'magic_object.instance_of',
              source_field: 'instance_of',
            })
          }
        }
      }

      const locations = tale.entities.locations
      if (isRecord(locations)) {
        for (const [label, location] of Object.entries(locations)) {
          const locationRecord = isRecord(location) ? location : {}
          const evidence = cleanEvidence(locationRecord.evidence)
          const properties = compactProperties({
            tale_slug: tale.slug,
            instance_of: locationRecord.instance_of,
            threshold_type: locationRecord.threshold_type,
            evidence,
          })
          addScalarAttributes(properties, locationRecord.attributes)
          addNode(nodes, seenLabels, label, 'location', displayName(location, label), properties)
          addEdge(edges, taleLabel, label, 'HAS_LOCATION', {
            tale_slug: tale.slug,
            source_kind: 'entities.locations',
          })
          addEdge(edges, label, taleLabel, 'APPEARS_IN', {
            tale_slug: tale.slug,
            source_kind: 'location',
          })
          if (typeof locationRecord.instance_of === 'string') {
            addEdge(edges, label, locationRecord.instance_of, 'IS_INSTANCE_OF', {
              tale_slug: tale.slug,
              source_kind: 'location.instance_of',
              source_field: 'instance_of',
              ...(evidence ? { evidence } : {}),
            })
            addEdge(edges, taleLabel, locationRecord.instance_of, 'HAS_LOCATION', {
              tale_slug: tale.slug,
              source_kind: 'location.instance_of',
              source_field: 'instance_of',
            })
          }
          if (typeof locationRecord.threshold_type === 'string') {
            addEdge(edges, label, locationRecord.threshold_type, 'IS_THRESHOLD_TYPE', {
              tale_slug: tale.slug,
              source_kind: 'location.threshold_type',
              source_field: 'threshold_type',
              ...(evidence ? { evidence } : {}),
            })
            addEdge(edges, taleLabel, locationRecord.threshold_type, 'HAS_THRESHOLD_TYPE', {
              tale_slug: tale.slug,
              source_kind: 'location.threshold_type',
              source_field: 'threshold_type',
            })
          }
        }
      }
    }

    if (isRecord(tale.classifications)) {
      for (const [field, edgeLabel] of Object.entries(CLASSIFICATION_EDGES)) {
        for (const target of stringArray(tale.classifications[field])) {
          addEdge(edges, taleLabel, target, edgeLabel, {
            tale_slug: tale.slug,
            source_kind: 'classification',
            source_field: field,
          })
        }
      }
    }

    for (const step of Array.isArray(tale.propp) ? tale.propp : []) {
      if (!isRecord(step) || typeof step.function !== 'string') continue
      const order = typeof step.order === 'number' ? step.order : 0
      const eventLabel = proppEventLabel(tale.slug, order)
      const eventProps = compactProperties({
        tale_slug: tale.slug,
        propp_order: order || undefined,
        propp_function: step.function,
        actor: step.actor,
        beneficiary: step.beneficiary,
        victim: step.victim,
        scene: step.scene,
        evidence: step.evidence,
      })
      addNode(nodes, seenLabels, eventLabel, 'propp_event', `${displayName(tale, tale.slug)} #${order}`, eventProps)
      addEdge(edges, taleLabel, step.function, 'HAS_NARRATIVE_FUNCTION', {
        tale_slug: tale.slug,
        source_kind: 'propp_summary',
        source_field: 'propp',
        ...(order ? { propp_order: order } : {}),
        ...compactProperties({
          actor: step.actor,
          beneficiary: step.beneficiary,
          victim: step.victim,
          scene: step.scene,
          evidence: step.evidence,
        }),
      })
      addEdge(edges, taleLabel, eventLabel, 'HAS_PROPP_EVENT', {
        tale_slug: tale.slug,
        source_kind: 'propp_sequence',
        source_field: 'propp',
        ...(order ? { propp_order: order } : {}),
      })
      addEdge(edges, eventLabel, step.function, 'HAS_NARRATIVE_FUNCTION', {
        tale_slug: tale.slug,
        source_kind: 'propp_sequence',
        source_field: 'function',
        ...(order ? { propp_order: order } : {}),
      })
      if (typeof step.actor === 'string') {
        addEdge(edges, eventLabel, step.actor, 'HAS_ACTOR', {
          tale_slug: tale.slug,
          source_kind: 'propp_sequence',
          source_field: 'actor',
          ...(order ? { propp_order: order } : {}),
        })
      }
      if (typeof step.beneficiary === 'string') {
        addEdge(edges, eventLabel, step.beneficiary, 'HAS_BENEFICIARY', {
          tale_slug: tale.slug,
          source_kind: 'propp_sequence',
          source_field: 'beneficiary',
          ...(order ? { propp_order: order } : {}),
        })
      }
      if (typeof step.victim === 'string') {
        addEdge(edges, eventLabel, step.victim, 'HAS_VICTIM', {
          tale_slug: tale.slug,
          source_kind: 'propp_sequence',
          source_field: 'victim',
          ...(order ? { propp_order: order } : {}),
        })
      }
    }

    for (const edge of Array.isArray(tale.edges) ? tale.edges : []) {
      if (!isRecord(edge) || typeof edge.label !== 'string') continue
      const edgeProps = compactProperties({
        tale_slug: tale.slug,
        source_kind: 'narrative_edge',
        evidence: edge.evidence,
      })
      addScalarAttributes(edgeProps, edge.attributes)
      addEdge(edges, edge.from, edge.to, edge.label, edgeProps)
    }
  }

  for (const edge of edges) {
    if (!seenLabels.has(edge.from)) addNode(nodes, seenLabels, edge.from, inferNodeType(edge.from))
    if (!seenLabels.has(edge.to)) addNode(nodes, seenLabels, edge.to, inferNodeType(edge.to))
  }

  return { collection: 'tales', nodes, edges }
}

/**
 * Reads every *.json file under `dataDir` recursively. Only files that
 * declare a `collection` field are treated as graph data — manifests like
 * `tales.json` (no `collection`) are skipped.
 * Nodes are deduped by `label` (first occurrence wins).
 * All graph files must declare the same `collection`.
 */
export function loadGraph(dataDir: string): GrimmGraph {
  const root = resolve(dataDir)
  const goldGraph = loadGoldYamlGraph(
    root.endsWith('/3-gold') ? root : join(root, '3-gold'),
  )
  if (goldGraph) return goldGraph

  const files = walkFiles(root, (entry) => entry.endsWith('.json')).sort()

  const seenLabels = new Set<string>()
  const nodes: GrimmNode[] = []
  const edges: GrimmEdge[] = []
  let collection: string | undefined

  for (const path of files) {
    const part = JSON.parse(readFileSync(path, 'utf8')) as Partial<GrimmGraph>

    if (!part.collection || !Array.isArray(part.nodes) || !Array.isArray(part.edges)) {
      continue
    }

    if (collection === undefined) {
      collection = part.collection
    } else if (part.collection !== collection) {
      throw new Error(
        `Collection mismatch in ${path}: got '${part.collection}', expected '${collection}'`,
      )
    }

    for (const n of part.nodes) {
      if (seenLabels.has(n.label)) continue
      seenLabels.add(n.label)
      nodes.push(n)
    }
    edges.push(...part.edges)
  }

  if (!collection) throw new Error(`No graph JSON files found under ${dataDir}`)
  return { collection, nodes, edges }
}
