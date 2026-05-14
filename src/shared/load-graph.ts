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

function traitLabel(trait: string): string {
  return `trait_${slugifyLabelPart(trait)}`
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
              evidence,
            }),
          )
          addEdge(edges, label, taleLabel, 'APPEARS_IN', {
            tale_slug: tale.slug,
            source_kind: 'character',
          })
          for (const trait of stringArray(characterRecord.traits)) {
            const traitNode = traitLabel(trait)
            addNode(nodes, seenLabels, traitNode, 'trait', trait)
            addEdge(edges, label, traitNode, 'HAS_TRAIT', characterEdgeProps(tale.slug, 'traits', evidence))
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
