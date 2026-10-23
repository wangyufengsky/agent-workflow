import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { ErrorState } from '../../components/error-state.tsx';
import { useUiStore } from '../../state/ui.store.ts';
import { conversationsQuery, useBindPreview } from './assistant.queries.ts';

/** 路由或对话切换即更新关联；助手浮层隐藏原生视图但不改变当前预览。 */
export function PreviewBinding() {
  const conversations = useQuery(conversationsQuery);
  const selected = useUiStore((s) => s.activeConversationId);
  const preview = useUiStore((s) => s.activePreview);
  const id = (conversations.data?.find((conversation) => conversation.id === selected) ?? conversations.data?.[0])?.id;
  const { mutate, error } = useBindPreview();
  useEffect(() => {
    if (id === undefined) return;
    mutate({ id, preview });
    return () => mutate({ id, preview: null });
  }, [id, preview, mutate]);
  return error === null ? null : <ErrorState error={error} />;
}
