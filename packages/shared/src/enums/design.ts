import { z } from 'zod';

export const DesignStatus = {
  Outlining: 'outlining',
  OutlineReady: 'outline_ready',
  Generating: 'generating',
  Reviewing: 'reviewing',
  Incomplete: 'incomplete',
  Ready: 'ready',
  Failed: 'failed',
} as const;
export type DesignStatus = (typeof DesignStatus)[keyof typeof DesignStatus];
export const designStatusSchema = z.enum(DesignStatus);

export const DesignKnowledgeMatch = {
  Exact: 'exact',
  Reference: 'reference',
  Missing: 'missing',
} as const;
export type DesignKnowledgeMatch = (typeof DesignKnowledgeMatch)[keyof typeof DesignKnowledgeMatch];
export const designKnowledgeMatchSchema = z.enum(DesignKnowledgeMatch);

export const DesignFileChangeKind = { Added: 'added', Removed: 'removed', Modified: 'modified' } as const;
export type DesignFileChangeKind = (typeof DesignFileChangeKind)[keyof typeof DesignFileChangeKind];
export const designFileChangeKindSchema = z.enum(DesignFileChangeKind);

export const DesignStalenessState = {
  Fresh: 'fresh',
  Stale: 'stale',
  Unknown: 'unknown',
} as const;
export type DesignStalenessState = (typeof DesignStalenessState)[keyof typeof DesignStalenessState];
export const designStalenessStateSchema = z.enum(DesignStalenessState);

export const DesignDepth = {
  Quick: 'quick',
  Standard: 'standard',
  Deep: 'deep',
} as const;
export type DesignDepth = (typeof DesignDepth)[keyof typeof DesignDepth];
export const designDepthSchema = z.enum(DesignDepth);

export const DesignLayoutStyle = {
  Doc: 'doc',
  Arch: 'arch',
} as const;
export type DesignLayoutStyle = (typeof DesignLayoutStyle)[keyof typeof DesignLayoutStyle];
export const designLayoutStyleSchema = z.enum(DesignLayoutStyle);

export const DesignSectionKind = {
  Overview: 'overview',
  Architecture: 'architecture',
  Module: 'module',
  Flow: 'flow',
  Custom: 'custom',
} as const;
export type DesignSectionKind = (typeof DesignSectionKind)[keyof typeof DesignSectionKind];
export const designSectionKindSchema = z.enum(DesignSectionKind);

export const DesignDiagramKind = {
  Architecture: 'architecture',
  CallGraph: 'call_graph',
  BusinessFlow: 'business_flow',
} as const;
export type DesignDiagramKind = (typeof DesignDiagramKind)[keyof typeof DesignDiagramKind];
export const designDiagramKindSchema = z.enum(DesignDiagramKind);

export const DesignEvidenceClass = {
  Static: 'static',
  Inferred: 'inferred',
} as const;
export type DesignEvidenceClass = (typeof DesignEvidenceClass)[keyof typeof DesignEvidenceClass];
export const designEvidenceClassSchema = z.enum(DesignEvidenceClass);

export const DesignReviewState = {
  None: 'none',
  Passed: 'passed',
  NeedsAttention: 'needs_attention',
} as const;
export type DesignReviewState = (typeof DesignReviewState)[keyof typeof DesignReviewState];
export const designReviewStateSchema = z.enum(DesignReviewState);

export const DesignTemplateKind = {
  Builtin: 'builtin',
  Custom: 'custom',
} as const;
export type DesignTemplateKind = (typeof DesignTemplateKind)[keyof typeof DesignTemplateKind];
export const designTemplateKindSchema = z.enum(DesignTemplateKind);

export const DesignRunKind = {
  Outline: 'outline',
  Generate: 'generate',
  Revise: 'revise',
  Review: 'review',
} as const;
export type DesignRunKind = (typeof DesignRunKind)[keyof typeof DesignRunKind];
export const designRunKindSchema = z.enum(DesignRunKind);
