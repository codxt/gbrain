// v0.41 T5 — extract_atoms cycle phase.
//
// SHIPPED IN T9 AS A STUB to unblock the orchestrator pack-gating test.
// The real implementation lands in T5: walks transcripts/articles via
// discoverTranscripts(), runs Haiku 3-check quality gate (truism /
// punchline / entity-page reject), writes atom-typed pages via standard
// put_page with frontmatter validators read from the active pack at
// runtime (D11). Reads atom_type closed 11-value enum from gbrain-creator
// manifest. Skips pages with `imported_from` frontmatter marker (D7).
// Idempotency via op_checkpoint extractFingerprint. Source-scoped.
// Budget cap $0.30/source/run.
//
// Until T5 ships the real body, this stub returns a 'skipped' PhaseResult
// with reason='stub_pending_t5'. The orchestrator-level pack gate (T9)
// already short-circuits when the active pack doesn't declare extract_atoms
// in its `phases:` list, so this stub only runs when the user intentionally
// opted in to a creator-flavored pack — and even then it returns a clear
// "not implemented yet" marker, not a silent no-op.

import type { BrainEngine } from '../engine.ts';
import type { PhaseResult } from '../cycle.ts';

export interface ExtractAtomsOpts {
  brainDir?: string;
  sourceId?: string;
  dryRun?: boolean;
  /** Hint from sync: only these slugs were affected this cycle. */
  affectedSlugs?: string[];
}

/**
 * v0.41 T5 stub. Returns 'skipped' with the reason marker until the real
 * implementation lands. Pinned by test/cycle-pack-gating.test.ts which
 * exercises the orchestrator dispatch path against this stub.
 */
export async function runPhaseExtractAtoms(
  _engine: BrainEngine,
  _opts: ExtractAtomsOpts = {},
): Promise<PhaseResult> {
  return {
    phase: 'extract_atoms',
    status: 'skipped',
    duration_ms: 0,
    summary: 'extract_atoms: stub (T5 not yet implemented)',
    details: {
      reason: 'stub_pending_t5',
      note: 'orchestrator dispatch is wired; real body lands in T5',
    },
  };
}
