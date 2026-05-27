/**
 * SkillOpt bootstrap benchmark generator (D15).
 *
 * Reads `skills/<name>/routing-eval.jsonl` and asks the optimizer model:
 * "given this skill's SKILL.md + this user intent, what would a successful
 *  output look like? Emit 2-4 rule checks per intent."
 *
 * Writes the generated benchmark to `skills/<name>/skillopt-benchmark.jsonl`
 * with the BOOTSTRAP_PENDING_REVIEW sentinel as the final line. The user
 * must hand-review + delete the sentinel + re-run with --bootstrap-reviewed.
 *
 * Refuses to overwrite an existing benchmark file unless --force is passed.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { chat as gatewayChat } from '../ai/gateway.ts';
import { errorFor } from '../errors.ts';
import { atomicWrite } from './apply-edits.ts';
import { BOOTSTRAP_PENDING_REVIEW, type RuleCheck } from './types.ts';

const BOOTSTRAP_SYSTEM = `You are SkillOpt's bootstrap-benchmark generator. Given a user intent that triggers a SKILL, generate 2-4 deterministic rule checks that would verify a successful execution.

Output ONLY a single JSON object on one line:
{"checks": [{"op": "<op>", "arg": <arg>}, ...]}

Valid ops:
  - contains:        arg: string — output must contain this substring
  - regex:           arg: regex string — output must match
  - section_present: arg: heading text — output must have this ## heading
  - max_chars:       arg: number — output ≤ N chars
  - min_citations:   arg: number — output has ≥N citations
  - tool_called:     arg: tool name — agent called this tool
  - tool_not_called: arg: tool name — agent avoided this tool

Be SPECIFIC. "max_chars: 4000" is more useful than "max_chars: 999999". A skill that should produce a structured report should have section_present checks.`;

export interface BootstrapOpts {
  skillsDir: string;
  skillName: string;
  optimizerModel: string;
  force?: boolean;
  /** Test seam — substitute gateway.chat. */
  chatFn?: typeof gatewayChat;
}

export interface BootstrapResult {
  outputPath: string;
  rowsGenerated: number;
  rowsSkipped: number;
}

export async function runBootstrap(opts: BootstrapOpts): Promise<BootstrapResult> {
  const { skillsDir, skillName, optimizerModel, force } = opts;
  const chat = opts.chatFn ?? gatewayChat;

  const routingPath = path.join(skillsDir, skillName, 'routing-eval.jsonl');
  if (!fs.existsSync(routingPath)) {
    throw errorFor({
      class: 'NoRoutingEval',
      code: 'no_routing_eval',
      message: `Cannot bootstrap: ${routingPath} does not exist.`,
      hint: `Create a routing-eval.jsonl file first (gbrain skillify scaffold <name> generates one).`,
    });
  }

  const outputPath = path.join(skillsDir, skillName, 'skillopt-benchmark.jsonl');
  if (fs.existsSync(outputPath) && !force) {
    throw errorFor({
      class: 'BenchmarkExists',
      code: 'benchmark_exists',
      message: `Benchmark already exists at ${outputPath}.`,
      hint: `Pass --force to overwrite, or remove the file first.`,
    });
  }

  // Read the skill body for context.
  const skillPath = path.join(skillsDir, skillName, 'SKILL.md');
  let skillBody = '';
  try {
    skillBody = fs.readFileSync(skillPath, 'utf8');
  } catch {
    throw errorFor({
      class: 'NoSkill',
      code: 'no_skill_md',
      message: `Cannot read ${skillPath}.`,
      hint: `The skill must exist before bootstrapping its benchmark.`,
    });
  }

  // Parse routing-eval rows.
  const routingRows = fs.readFileSync(routingPath, 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as { intent: string; expected_skill: string });

  const generated: string[] = [];
  let skipped = 0;
  for (let i = 0; i < routingRows.length; i++) {
    const row = routingRows[i]!;
    if (row.expected_skill !== skillName) continue; // Only generate for our skill.
    const userMsg = `SKILL BODY:\n${skillBody.slice(0, 4000)}\n\nUSER INTENT:\n${row.intent}\n\nGenerate 2-4 rule checks the agent's response should pass.`;
    try {
      const result = await chat({
        model: optimizerModel,
        system: BOOTSTRAP_SYSTEM,
        messages: [{ role: 'user', content: userMsg }],
        maxTokens: 500,
        cacheSystem: true,
      });
      const checks = parseChecksResponse(result.text);
      if (checks.length === 0) {
        skipped += 1;
        continue;
      }
      generated.push(JSON.stringify({
        task_id: `bootstrap-${String(i + 1).padStart(3, '0')}`,
        task: row.intent,
        judge: { kind: 'rule', checks },
      }));
    } catch (err) {
      skipped += 1;
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[skillopt] bootstrap row ${i + 1} failed: ${msg}\n`);
    }
  }

  if (generated.length === 0) {
    throw errorFor({
      class: 'BootstrapEmpty',
      code: 'bootstrap_empty',
      message: `Bootstrap generated 0 tasks (all rows skipped or routing-eval has no matching rows for '${skillName}').`,
      hint: `Check that routing-eval.jsonl has rows where expected_skill='${skillName}' and the optimizer model is reachable.`,
    });
  }

  const output = [...generated, BOOTSTRAP_PENDING_REVIEW, ''].join('\n');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  atomicWrite(outputPath, output);

  process.stderr.write(`[skillopt] Bootstrap wrote ${generated.length} tasks to ${outputPath} (${skipped} rows skipped).\n`);
  process.stderr.write(`[skillopt] REVIEW the file, then delete the trailing '${BOOTSTRAP_PENDING_REVIEW}' line and re-run with --bootstrap-reviewed.\n`);

  return { outputPath, rowsGenerated: generated.length, rowsSkipped: skipped };
}

function parseChecksResponse(raw: string): RuleCheck[] {
  try {
    const fenced = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/i);
    const cleaned = (fenced ? fenced[1]! : raw).trim();
    const parsed = JSON.parse(cleaned) as { checks?: unknown };
    if (parsed && Array.isArray(parsed.checks)) {
      return validateChecks(parsed.checks);
    }
  } catch { /* try fallback */ }
  // Fallback: first {...} substring.
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]) as { checks?: unknown };
    if (parsed && Array.isArray(parsed.checks)) {
      return validateChecks(parsed.checks);
    }
  } catch { /* fall through */ }
  return [];
}

function validateChecks(raw: unknown[]): RuleCheck[] {
  const VALID = new Set(['contains', 'regex', 'section_present', 'max_chars', 'min_citations', 'tool_called', 'tool_not_called']);
  const out: RuleCheck[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    if (typeof o.op === 'string' && VALID.has(o.op) && (typeof o.arg === 'string' || typeof o.arg === 'number')) {
      out.push({ op: o.op as RuleCheck['op'], arg: o.arg });
    }
  }
  return out;
}
