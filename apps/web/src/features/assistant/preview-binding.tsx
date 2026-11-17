import { controlAssistantBrowserOp } from '@aw/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { callOperation } from '../../api/client.ts';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { ASSISTANT_BROWSER_COPY as C } from '../../copy/assistant.ts';
import { useUiStore } from '../../state/ui.store.ts';
import { conversationsQuery, PREVIEW_BINDING_SCOPE, useBindPreview } from './assistant.queries.ts';

function useSelectedConversation() {
  const conversations = useQuery(conversationsQuery);
  const selected = useUiStore((s) => s.activeConversationId);
  return (conversations.data?.find((conversation) => conversation.id === selected) ?? conversations.data?.[0])?.id;
}

/** 路由或对话切换即更新关联；助手浮层隐藏原生视图但不改变当前预览。 */
export function PreviewBinding() {
  const id = useSelectedConversation();
  const preview = useUiStore((s) => s.activePreview);
  const { mutate, error } = useBindPreview();
  useEffect(() => {
    if (id === undefined) return;
    mutate({ id, preview });
    return () => mutate({ id, preview: null });
  }, [id, preview, mutate]);
  return error === null ? null : <ErrorState error={error} />;
}

export function PreviewControl({ taskId, tabId }: { taskId: string; tabId: string }) {
  const id = useSelectedConversation();
  return id === undefined ? null : (
    <BrowserControlButton key={`${id}:${tabId}`} id={id} taskId={taskId} tabId={tabId} />
  );
}

function BrowserControlButton({ id, taskId, tabId }: { id: string; taskId: string; tabId: string }) {
  const control = useMutation({
    scope: PREVIEW_BINDING_SCOPE,
    mutationFn: async (enabled: boolean) => {
      const selected = useUiStore.getState().activePreview;
      if (enabled && (selected?.tabId !== tabId || selected.taskId !== taskId)) return { enabled: false };
      return callOperation(controlAssistantBrowserOp, { id, tabId, enabled });
    },
  });
  const enabled = control.data?.enabled === true || (control.isPending && control.variables === false);
  return (
    <>
      <Button
        size="sm"
        type="button"
        pending={control.isPending}
        aria-pressed={enabled}
        title={enabled ? C.active : C.enableHelp}
        onClick={() => control.mutate(!enabled)}
      >
        {enabled ? C.stop : C.enable}
      </Button>
      {control.isError && <ErrorState error={control.error} />}
    </>
  );
}
