// v0.41 T6 — synthesize_concepts cycle phase.
//
// SHIPPED IN T9 AS A STUB to unblock the orchestrator pack-gating test.
// The real implementation lands in T6: aggregates atoms by topic cluster,
// dedups via Jaccard + substring + semantic, tiers T1-T4 by composite_score
// (mention_count × distinct_months × breadth), Sonnet-synthesizes T1/T2
// narratives gated by the same voice_gate() the calibration_profile phase
// uses. Concept-typed pages with tier in frontmatter. Skips pages with
// `imported_from` frontmatter marker (D7). Global scope. Budget $1.50/run.
//
// Until T6 ships the real body, this stub returns 'skipped' with marker.

import type { BrainEngine } from '../engine.ts';
import type { PhaseResult } from '../cycle.ts';

export interface SynthesizeConceptsOpts {
  brainDir?: string;
  dryRun?: boolean;
  yieldDuringPhase?: (() => Promise<void>) | undefined;
}

/**
 * v0.41 T6 stub. Same shape as runPhaseExtractAtoms stub — orchestrator
 * dispatch is wired in T9, real body lands in T6.
 */
export async function runPhaseSynthesizeConcepts(
  _engine: BrainEngine,
  _opts: SynthesizeConceptsOpts = {},
): Promise<PhaseResult> {
  return {
    phase: 'synthesize_concepts',
    status: 'skipped',
    duration_ms: 0,
    summary: 'synthesize_concepts: stub (T6 not yet implemented)',
    details: {
      reason: 'stub_pending_t6',
      note: 'orchestrator dispatch is wired; real body lands in T6',
    },
  };
}
