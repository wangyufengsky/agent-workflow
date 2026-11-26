import { readFile, realpath, stat } from 'node:fs/promises';
import { relative, sep } from 'node:path';
import {
  AppError,
  DESIGN_SCAN_MAX_FILE_BYTES,
  DesignDiagramKind,
  type DesignEvidence,
  DesignEvidenceClass,
  ErrorCode,
  type SubmitDesignReviewInput,
  type SubmitDesignSectionInput,
} from '@aw/shared';
import { linesOf, locateRepoFile } from '../../core/repo-files.ts';

type Field = (string | number)[];
type AuthorizedFile = { relPath: string };
type Context = { root: string; files: readonly AuthorizedFile[]; targetSectionIds: readonly string[] };

function invalid(path: Field, message: string): never {
  throw new AppError(ErrorCode.ValidationFailed, message, { issues: [{ path, message }] });
}

export function validateDesignOutline(
  sections: readonly { scopePaths: readonly string[] }[],
  files: readonly AuthorizedFile[],
): void {
  const scopes = new Set<string>();
  for (const { relPath } of files) {
    let current = '';
    for (const part of relPath.split('/')) {
      current = current === '' ? part : `${current}/${part}`;
      scopes.add(current);
    }
  }
  for (const [i, section] of sections.entries()) {
    section.scopePaths.forEach((scope, j) => {
      if (!scopes.has(scope)) invalid(['sections', i, 'scopePaths', j], 'Choose a scanned file or directory');
    });
  }
}

function requireUnique(values: readonly string[], field: Field, key: string) {
  const seen = new Set<string>();
  values.forEach((value, i) => {
    if (seen.has(value)) invalid([...field, i, key], 'Duplicate identifier or path');
    seen.add(value);
  });
}

/** 行数按本次提交实际引用的文件读取；重写和复审均重新确认路径仍在扫描清单内。 */
async function sourceChecks(context: Context) {
  const authorized = new Set(context.files.map((file) => file.relPath));
  const root = await realpath(context.root);
  const contents = new Map<string, string[]>();
  const resolved = new Map<string, string>();
  async function path(relPath: string, field: Field) {
    const cached = resolved.get(relPath);
    if (cached !== undefined) return cached;
    if (!authorized.has(relPath)) invalid(field, 'Path is not in the scanned inventory');
    const file = await locateRepoFile(root, relPath);
    if (typeof file === 'string' || !authorized.has(relative(root, file.real).split(sep).join('/')))
      invalid(field, 'Source is no longer an authorized file');
    if ((await stat(file.real)).size > DESIGN_SCAN_MAX_FILE_BYTES) invalid(field, 'Source exceeds scan limit');
    resolved.set(relPath, file.real);
    return file.real;
  }
  async function lines(relPath: string, start: number, end: number, field: Field) {
    const real = await path(relPath, field);
    let text = contents.get(relPath);
    if (text === undefined) {
      text = linesOf(await readFile(real, 'utf8'));
      contents.set(relPath, text);
    }
    if (end < start || end > text.length) invalid(field, 'Line range is outside the source file');
    return text;
  }
  async function evidence(entries: readonly DesignEvidence[], field: Field) {
    for (const [index, entry] of entries.entries()) {
      if (entry.evidenceClass === DesignEvidenceClass.Static)
        await lines(entry.relPath, entry.lineStart, entry.lineEnd, [...field, index]);
    }
  }
  return { path, lines, evidence };
}

export async function validateDesignSection(input: SubmitDesignSectionInput, context: Context) {
  if (!context.targetSectionIds.includes(input.sectionId))
    invalid(['sectionId'], 'Section is not a target of this run');
  const source = await sourceChecks(context);
  requireUnique(
    input.files.map((file) => file.relPath),
    ['files'],
    'relPath',
  );
  requireUnique(
    input.diagrams.map((diagram) => diagram.id),
    ['diagrams'],
    'id',
  );
  const diagrams = new Map(input.diagrams.map((diagram) => [diagram.id, diagram]));
  const transactionFlows = new Set<string>();
  const chapterFiles = new Set(input.files.map(({ relPath }) => relPath));
  const assignedFiles = new Set<string>();
  const submodules = new Set<string>();
  for (const [i, block] of input.blocks.entries()) {
    const field = ['blocks', i];
    if (block.type === 'diagram_ref' && !diagrams.has(block.diagramId))
      invalid([...field, 'diagramId'], 'Diagram is not part of this section');
    if (block.type === 'transaction') {
      const graph = diagrams.get(block.diagramId);
      if (graph?.kind !== DesignDiagramKind.BusinessFlow || graph.nodes.length === 0)
        invalid([...field, 'diagramId'], 'Reference a non-empty business flow in this section');
      if (transactionFlows.has(block.diagramId))
        invalid([...field, 'diagramId'], 'Use a separate flow diagram for each transaction profile');
      transactionFlows.add(block.diagramId);
      const steps = new Set(graph.nodes.map(({ id }) => id));
      for (const key of ['fields', 'boundaries'] as const) {
        for (const [index, trace] of (block[key] ?? []).entries()) {
          for (const [j, step] of trace.steps.entries())
            if (!steps.has(step))
              invalid([...field, key, index, 'steps', j], 'Choose a step from this transaction flow');
          await source.evidence(trace.evidence, [...field, key, index, 'evidence']);
        }
      }
      await source.evidence(block.evidence, [...field, 'evidence']);
    }
    if (block.type === 'code') {
      const lines = await source.lines(block.relPath, block.lineStart, block.lineEnd, [...field, 'lineEnd']);
      if (linesOf(block.code).join('\n') !== lines.slice(block.lineStart - 1, block.lineEnd).join('\n'))
        invalid([...field, 'code'], 'Quote the exact source lines in the specified range');
    }
    if (block.type === 'markdown' && block.evidence) await source.evidence(block.evidence, [...field, 'evidence']);
    if (block.type === 'submodule') {
      if (submodules.has(block.id)) invalid([...field, 'id'], 'Duplicate submodule identifier');
      submodules.add(block.id);
      for (const [j, path] of block.files.entries()) {
        if (!chapterFiles.has(path) || assignedFiles.has(path))
          invalid([...field, 'files', j], 'Assign a file listed in this section to only one submodule');
        assignedFiles.add(path);
      }
      for (const [j, behavior] of block.behaviors.entries())
        await source.evidence(behavior.evidence, [...field, 'behaviors', j, 'evidence']);
    }
  }
  for (const [i, file] of input.files.entries()) {
    const field = ['files', i];
    await source.path(file.relPath, [...field, 'relPath']);
    requireUnique(
      file.symbols.map((symbol) => symbol.id),
      [...field, 'symbols'],
      'id',
    );
    for (const [j, symbol] of file.symbols.entries())
      await source.lines(file.relPath, symbol.lineStart, symbol.lineEnd, [...field, 'symbols', j, 'lineEnd']);
  }
  for (const [i, diagram] of input.diagrams.entries()) {
    const field = ['diagrams', i];
    const ids = diagram.nodes.map((n) => n.id);
    requireUnique(ids, [...field, 'nodes'], 'id');
    requireUnique(
      diagram.edges.map((e) => e.id),
      [...field, 'edges'],
      'id',
    );
    const nodes = new Set(ids);
    for (const [j, node] of diagram.nodes.entries()) {
      if (node.relPath !== undefined) await source.path(node.relPath, [...field, 'nodes', j, 'relPath']);
    }
    for (const [j, edge] of diagram.edges.entries()) {
      const at = [...field, 'edges', j];
      if (!nodes.has(edge.from)) invalid([...at, 'from'], 'Unknown start node');
      if (!nodes.has(edge.to)) invalid([...at, 'to'], 'Unknown end node');
      if (edge.from === edge.to && !(diagram.kind === DesignDiagramKind.BusinessFlow && edge.kind === 'retry'))
        invalid([...at, 'to'], 'Only an explicit business-flow retry can loop to itself');
      if (edge.evidencePath !== undefined) await source.path(edge.evidencePath, [...at, 'evidencePath']);
      if (edge.lineStart !== undefined || edge.lineEnd !== undefined) {
        if (edge.evidencePath === undefined || edge.lineStart === undefined || edge.lineEnd === undefined)
          invalid([...at, 'evidencePath'], 'A line range requires a path, start and end');
        await source.lines(edge.evidencePath, edge.lineStart, edge.lineEnd, [...at, 'lineEnd']);
      }
    }
  }
}

export async function validateDesignReview(input: SubmitDesignReviewInput, context: Context) {
  const source = await sourceChecks(context);
  requireUnique(
    input.findings.map((finding) => finding.sectionId),
    ['findings'],
    'sectionId',
  );
  for (const [i, finding] of input.findings.entries()) {
    if (!context.targetSectionIds.includes(finding.sectionId))
      invalid(['findings', i, 'sectionId'], 'Section is not a review target');
    for (const [j, note] of finding.notes.entries()) {
      const at = ['findings', i, 'notes', j];
      if (note.relPath !== undefined) await source.path(note.relPath, [...at, 'relPath']);
      if (note.lineStart !== undefined) {
        if (note.relPath === undefined) invalid([...at, 'relPath'], 'A review line requires a source path');
        await source.lines(note.relPath, note.lineStart, note.lineStart, [...at, 'lineStart']);
      }
    }
  }
}
