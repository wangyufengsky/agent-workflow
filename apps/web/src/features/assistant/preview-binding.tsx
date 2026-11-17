import {
  AssistantBrowserMode,
  controlAssistantBrowserOp,
  getAssistantBrowserControlOp,
  handoffAssistantBrowserOp,
} from '@aw/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { callOperation } from '../../api/client.ts';
import { queryKeys } from '../../api/query-keys.ts';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { ASSISTANT_BROWSER_COPY as C } from '../../copy/assistant.ts';
import { useUiStore } from '../../state/ui.store.ts';
import { conversationsQuery, PREVIEW_BINDING_SCOPE, useBindPreview } from './assistant.queries.ts';
import { BrowserActivityDrawer } from './browser-activity-drawer.tsx';

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
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const queryKey = [...queryKeys.assistantBrowserControl(id), tabId];
  const info = useQuery({ queryKey, queryFn: () => callOperation(getAssistantBrowserControlOp, { id, tabId }) });
  const mode = info.data?.mode ?? AssistantBrowserMode.Off;
  const control = useMutation({
    scope: PREVIEW_BINDING_SCOPE,
    mutationFn: async (action: 'enable' | 'stop' | 'take' | 'return') => {
      const selected = useUiStore.getState().activePreview;
      if (selected?.tabId !== tabId || selected.taskId !== taskId) return;
      if (action === 'enable' || action === 'stop') {
        await callOperation(controlAssistantBrowserOp, { id, tabId, enabled: action === 'enable' });
      } else {
        await callOperation(handoffAssistantBrowserOp, { id, tabId, manual: action === 'take' });
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });
  const disabled = info.isPending || control.isPending;
  return (
    <>
      {mode === AssistantBrowserMode.Off ? (
        <Button
          size="sm"
          type="button"
          disabled={disabled}
          title={C.enableHelp}
          onClick={() => control.mutate('enable')}
        >
          {C.enable}
        </Button>
      ) : (
        <>
          <span className="hint" aria-live="polite">
            {mode === AssistantBrowserMode.Assistant ? C.active : C.manual}
          </span>
          <Button
            size="sm"
            type="button"
            disabled={disabled}
            title={C.takeHelp}
            onClick={() => control.mutate(mode === AssistantBrowserMode.Assistant ? 'take' : 'return')}
          >
            {mode === AssistantBrowserMode.Assistant ? C.take : C.giveBack}
          </Button>
          <Button size="sm" type="button" variant="ghost" disabled={disabled} onClick={() => control.mutate('stop')}>
            {C.stop}
          </Button>
        </>
      )}
      <Button size="sm" type="button" variant="ghost" onClick={() => setOpen(true)}>
        {C.history}
      </Button>
      <BrowserActivityDrawer open={open} onOpenChange={setOpen} activity={info.data?.activity ?? []} />
      {info.isError && <ErrorState error={info.error} onRetry={() => void info.refetch()} />}
      {control.isError && <ErrorState error={control.error} />}
    </>
  );
}
