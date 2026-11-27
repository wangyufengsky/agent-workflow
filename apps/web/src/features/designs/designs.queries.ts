import {
  createDesignOp,
  createDesignTemplateOp,
  type DesignDTO,
  deleteDesignOp,
  deleteDesignTemplateOp,
  exportDesignOp,
  generateDesignOp,
  getDesignOp,
  getDesignSourceOp,
  getDesignStalenessOp,
  incrementalUpdateDesignOp,
  listDesignsOp,
  listDesignTemplatesOp,
  type OperationContract,
  restoreDesignSectionOp,
  reviewDesignOp,
  reviseDesignOutlineOp,
  reviseDesignSectionOp,
  stopDesignOp,
  updateDesignOp,
  updateDesignOutlineOp,
  updateDesignTemplateOp,
} from '@aw/shared';
import { infiniteQueryOptions, queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import { callOperation } from '../../api/client.ts';
import { queryKeys } from '../../api/query-keys.ts';

export const designQuery = (id: string) =>
  queryOptions({ queryKey: queryKeys.design(id), queryFn: () => callOperation(getDesignOp, { id }) });

export const designStalenessQuery = (id: string, commitSha?: string) =>
  queryOptions({
    queryKey: [...queryKeys.design(id), 'staleness', ...(commitSha === undefined ? [] : [commitSha])],
    queryFn: () => callOperation(getDesignStalenessOp, { id, commitSha }),
  });

export const designSourceQuery = (id: string, fileId: string) =>
  queryOptions({
    queryKey: [...queryKeys.design(id), 'source', fileId],
    queryFn: () => callOperation(getDesignSourceOp, { id, fileId }),
    refetchOnMount: 'always',
  });

export const designPagesQuery = (filter: { projectId?: string; query?: string }) =>
  infiniteQueryOptions({
    queryKey: queryKeys.designPages(filter),
    queryFn: ({ pageParam }) =>
      callOperation(listDesignsOp, { ...filter, cursor: pageParam === '' ? undefined : pageParam }),
    initialPageParam: '',
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

export const designTemplatesQuery = (projectId?: string) =>
  queryOptions({
    queryKey: queryKeys.designTemplates(projectId),
    queryFn: () => callOperation(listDesignTemplatesOp, { projectId }),
  });

function useDesignMutation<I extends z.ZodObject>(operation: OperationContract<I, typeof getDesignOp.output>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: z.input<I>) => callOperation(operation, input),
    onSuccess: (design: DesignDTO) => {
      client.setQueryData(queryKeys.design(design.id), design);
      // 写请求已返回保存后的设计，后台刷新不应继续锁住工作台上的操作。
      void client.invalidateQueries({ queryKey: queryKeys.designs });
    },
  });
}

export const useCreateDesign = () => useDesignMutation(createDesignOp);
export const useUpdateDesign = () => useDesignMutation(updateDesignOp);
export const useUpdateDesignOutline = () => useDesignMutation(updateDesignOutlineOp);
export const useReviseDesignOutline = () => useDesignMutation(reviseDesignOutlineOp);
export const useGenerateDesign = () => useDesignMutation(generateDesignOp);
export const useIncrementalUpdateDesign = () => useDesignMutation(incrementalUpdateDesignOp);
export const useReviseDesignSection = () => useDesignMutation(reviseDesignSectionOp);
export const useRestoreDesignSection = () => useDesignMutation(restoreDesignSectionOp);
export const useReviewDesign = () => useDesignMutation(reviewDesignOp);
export const useExportDesign = () => useDesignMutation(exportDesignOp);

export function useStopDesign() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => callOperation(stopDesignOp, { id }),
    onSuccess: (design) => {
      client.setQueryData(queryKeys.design(design.id), design);
      return client.invalidateQueries({ queryKey: queryKeys.designs });
    },
  });
}

export function useDeleteDesign(onDeleted: () => Promise<void>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => callOperation(deleteDesignOp, { id }),
    onSuccess: async () => {
      // 删除事件可能先让详情页卸载，变更回调仍需完成导航。
      await onDeleted();
      await client.invalidateQueries({ queryKey: queryKeys.designs });
    },
  });
}

function useTemplateMutation<I extends z.ZodObject, O extends z.ZodType>(operation: OperationContract<I, O>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: z.input<I>) => callOperation(operation, input),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.designTemplateLists }),
  });
}

export const useCreateDesignTemplate = () => useTemplateMutation(createDesignTemplateOp);
export const useUpdateDesignTemplate = () => useTemplateMutation(updateDesignTemplateOp);
export const useDeleteDesignTemplate = () => useTemplateMutation(deleteDesignTemplateOp);
