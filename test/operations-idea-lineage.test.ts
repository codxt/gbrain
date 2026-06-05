/**
 * idea_lineage op — feature-recovery + contract tests (PGLite, in-memory).
 *
 * Seeds a synthetic, anonymized lineage corpus (never real brain content) with
 * a known ground truth — a concept anchor, a first-mention note, an explicitly
 * abandoned branch, an outbound related concept, a timeline anchor, an
 * attributed take, and a cached contradiction touching the anchor — then
 * asserts the op recovers each moment. Also pins the contract: local-only
 * (remote reject), resolve→candidates disambiguation, evidence-gather (no
 * invented narrative), and the embedding-stripped wire shape.
 *
 * No API key is configured, so hybridSearch runs keyword-only and the op
 * reports `degraded: true` — the deterministic path we assert against.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { PGLiteEngine } from '../src/core/pglite-engine.ts';
import { operationsByName, OperationError } from '../src/core/operations.ts';
import type { OperationContext } from '../src/core/operations.ts';
import { resetGateway } from '../src/core/ai/gateway.ts';
import type { ChunkInput } from '../src/core/types.ts';

let engine: PGLiteEngine;

const ANCHOR = 'concepts/founder-led-sales';
const FIRST_MENTION = 'originals/2026-01-05-founder-notes';
// Abandoned branch: titled so it does NOT trigram-collide with the idea phrase
// (it is recovered as a related backlink, not as a competing concept anchor).
const ABANDONED = 'concepts/self-serve-experiment';
const RELATED_OUT = 'concepts/go-to-market';
const ENTITY = 'companies/widget-co';

// Matches the default embedding-column dimension PGLite bootstraps when no
// gateway model is configured (zeroentropy 1280d). Keyword-only path uses FTS,
// not these vectors, but the column dimension must still line up on insert.
function basisEmbedding(idx: number, dim = 1280): Float32Array {
  const e = new Float32Array(dim);
  e[idx % dim] = 1.0;
  return e;
}

async function seedPage(slug: string, type: string, title: string, body: string, embIdx: number): Promise<number> {
  const { id } = await engine.putPage(slug, {
    type: type as never,
    title,
    compiled_truth: body,
    timeline: '',
  });
  const chunks: ChunkInput[] = [{
    chunk_index: 0,
    chunk_text: body,
    chunk_source: 'compiled_truth',
    embedding: basisEmbedding(embIdx),
    token_count: body.split(/\s+/).length,
  }];
  await engine.upsertChunks(slug, chunks);
  return id;
}

function mkCtx(overrides: Partial<OperationContext> = {}): OperationContext {
  return {
    engine,
    config: {} as never,
    logger: { info: () => {}, warn: () => {}, error: () => {} } as never,
    dryRun: false,
    remote: false,
    sourceId: 'default',
    ...overrides,
  } as OperationContext;
}

const op = () => operationsByName['idea_lineage'];

beforeAll(async () => {
  resetGateway(); // keyword-only path → deterministic, no network
  engine = new PGLiteEngine();
  await engine.connect({});
  await engine.initSchema();

  const anchorId = await seedPage(ANCHOR, 'concept', 'Founder-Led Sales',
    'Founder-led sales: the founder runs sales until product-market fit.', 11);
  await seedPage(FIRST_MENTION, 'note', '2026-01-05 founder notes',
    'Early note: founder-led sales might be the right wedge for us.', 12);
  await seedPage(ABANDONED, 'concept', 'Self-Serve Experiment (rejected)',
    'Abandoned branch: a self-serve twist on founder-led sales we explicitly rejected.', 13);
  await seedPage(RELATED_OUT, 'concept', 'Go To Market',
    'Go-to-market motion overview and adjacent strategy.', 14);

  // Inbound edges (backlinks): first mention + abandoned branch reference the anchor.
  await engine.addLink(FIRST_MENTION, ANCHOR, 'first mention', 'mentions', 'markdown');
  await engine.addLink(ABANDONED, ANCHOR, 'rejected variant', 'mentions', 'markdown');
  // Outbound edge (graph): anchor → related concept.
  await engine.addLink(ANCHOR, RELATED_OUT, 'descends-into', 'relates_to', 'markdown');

  // Timeline anchor on the concept.
  await engine.addTimelineEntry(ANCHOR, {
    date: '2026-01-05',
    source: '',
    summary: 'First mention of founder-led sales',
    detail: '',
  });

  // Attributed take whose claim matches the idea phrase.
  await engine.addTakesBatch([
    { page_id: anchorId, row_num: 1, claim: 'Founder-led sales is the right wedge for us', kind: 'take', holder: 'garry', weight: 0.8 },
  ]);

  // Cached contradiction run: one finding touches the anchor, one does not.
  await engine.writeContradictionsRun({
    run_id: '2026-02-01T00:00:00Z',
    judge_model: 'test',
    prompt_version: 'test',
    queries_evaluated: 1,
    queries_with_contradiction: 1,
    total_contradictions_flagged: 2,
    wilson_ci_lower: 0,
    wilson_ci_upper: 0,
    judge_errors_total: 0,
    cost_usd_total: 0,
    duration_ms: 0,
    source_tier_breakdown: {},
    report_json: {
      per_query: [{
        contradictions: [
          {
            kind: 'stance_reversal', severity: 'medium', axis: 'strategy', confidence: 0.7,
            a: { slug: ANCHOR, chunk_id: null, take_id: null },
            b: { slug: ABANDONED, chunk_id: null, take_id: null },
            resolution_kind: 'supersede', resolution_command: '',
          },
          {
            kind: 'unrelated', severity: 'low', axis: 'other', confidence: 0.5,
            a: { slug: 'concepts/unrelated-x', chunk_id: null, take_id: null },
            b: { slug: 'concepts/unrelated-y', chunk_id: null, take_id: null },
            resolution_kind: 'none', resolution_command: '',
          },
        ],
      }],
    },
  });
});

afterAll(async () => {
  await engine.disconnect();
  resetGateway();
});

describe('idea_lineage — registration + local-only contract', () => {
  test('is a local-only read op', () => {
    expect(op().scope).toBe('read');
    expect(op().localOnly).toBe(true);
  });

  test('rejects remote callers (permission_denied)', async () => {
    await expect(op().handler(mkCtx({ remote: true }), { idea: 'Founder-Led Sales' }))
      .rejects.toThrow(/local-only/i);
  });

  test('rejects empty idea', async () => {
    await expect(op().handler(mkCtx(), { idea: '   ' })).rejects.toBeInstanceOf(OperationError);
  });
});

describe('idea_lineage — feature recovery on a known lineage', () => {
  test('resolves the idea to the concept anchor (unambiguous)', async () => {
    const r = await op().handler(mkCtx(), { idea: 'Founder-Led Sales' }) as any;
    expect(r.resolved).toBe(ANCHOR);
    expect(r.disambiguation_needed).toBe(false);
    expect(r.schema_version).toBe(1);
    // Keyword-only path (no embedding provider) is flagged degraded.
    expect(r.degraded).toBe(true);
    expect(r.matches.length).toBeGreaterThan(0);
  });

  test('recovers related concepts via backlinks + depth-2 graph', async () => {
    const r = await op().handler(mkCtx(), { idea: 'Founder-Led Sales' }) as any;
    const relatedSlugs = r.related.map((x: { slug: string }) => x.slug);
    expect(relatedSlugs).toContain(FIRST_MENTION);   // inbound (first mention)
    expect(relatedSlugs).toContain(ABANDONED);       // inbound (abandoned branch)
    expect(relatedSlugs).toContain(RELATED_OUT);     // outbound graph neighbor
    expect(relatedSlugs).not.toContain(ANCHOR);      // anchor excluded from its own related set
  });

  test('recovers the first-mention timeline anchor and the attributed take', async () => {
    const r = await op().handler(mkCtx(), { idea: 'Founder-Led Sales' }) as any;
    expect(r.timeline.some((t: { date: string }) => t.date === '2026-01-05')).toBe(true);
    expect(r.takes.some((t: { claim: string }) => /right wedge/.test(t.claim))).toBe(true);
  });

  test('scopes contradictions to the anchor (no global leak)', async () => {
    const r = await op().handler(mkCtx(), { idea: 'Founder-Led Sales' }) as any;
    expect(r.contradictions.length).toBe(1);
    expect(r.contradictions[0].kind).toBe('stance_reversal');
    expect(r.contradiction_run?.run_id).toBe('2026-02-01T00:00:00Z');
  });

  test('does not call the trajectory side-channel for a plain concept anchor (A3)', async () => {
    const r = await op().handler(mkCtx(), { idea: 'Founder-Led Sales' }) as any;
    expect(r.trajectory).toEqual([]);
  });
});

describe('idea_lineage — disambiguation + empty evidence', () => {
  test('flags disambiguation when two concept pages match the idea', async () => {
    // Two pages whose titles both fuzzy-match "self serve" → 2 slug-tier candidates.
    await seedPage('concepts/self-serve-a', 'concept', 'Self Serve Onboarding', 'self serve onboarding flow', 21);
    await seedPage('concepts/self-serve-b', 'concept', 'Self Serve Billing', 'self serve billing flow', 22);
    const r = await op().handler(mkCtx(), { idea: 'Self Serve' }) as any;
    expect(r.candidates.length).toBeGreaterThanOrEqual(2);
    expect(r.disambiguation_needed).toBe(true);
  });

  test('unknown idea → null anchor, empty buckets, no invented lineage', async () => {
    const r = await op().handler(mkCtx(), { idea: 'zxqw nonexistent concept 9981' }) as any;
    expect(r.resolved).toBeNull();
    expect(r.related).toEqual([]);
    expect(r.timeline).toEqual([]);
    expect(r.takes).toEqual([]);
    expect(r.contradictions).toEqual([]);
    expect(r.trajectory).toEqual([]);
  });
});
