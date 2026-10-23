import { COMPANION_PATH, stopWhisperOp } from '@aw/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { callOperation } from '../../api/client.ts';
import { COMPANION_COPY as C } from '../../copy/companion.ts';
import { useUiStore } from '../../state/ui.store.ts';
import { conversationsQuery } from '../assistant/assistant.queries.ts';
import { useSettings } from '../settings/settings.queries.ts';

export const isCompanionWindow = () => window.location.pathname === COMPANION_PATH;

export function useCompanionSync(): unknown {
  const settings = useSettings();
  const enabled = settings['companion.enabled'];
  const size = settings['companion.size'];
  const router = useRouter();
  const qc = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    const bridge = window.aw?.companion;
    if (bridge === undefined || bridge.surface !== 'main') return;
    let cancelled = false;
    const configure = async () => {
      if (!enabled) await callOperation(stopWhisperOp, {});
      if (cancelled) return;
      await bridge.configure({ enabled, size }, { open: C.openApp, hide: C.hide, quit: C.quit });
    };
    void configure().catch(setError);
    return () => {
      cancelled = true;
    };
  }, [enabled, size]);
  useEffect(() => {
    const bridge = window.aw?.companion;
    if (bridge === undefined || bridge.surface === null) return;
    let received = false;
    const apply = (id: string | null) => {
      useUiStore.setState({ activeConversationId: id });
      void qc.invalidateQueries(conversationsQuery);
      if (router.state.location.pathname === '/') {
        void router.navigate({ to: '/', search: (s) => ({ ...s, conversation: id ?? undefined }), replace: true });
      }
    };
    const off = bridge.onConversation((id) => {
      received = true;
      apply(id);
    });
    const current =
      useUiStore.getState().activeConversationId ??
      (window.location.pathname === '/' ? new URLSearchParams(window.location.search).get('conversation') : null);
    if (current !== null) bridge.selectConversation(current);
    else {
      const restore = async () => {
        const id = await bridge.getConversation();
        if (!received && useUiStore.getState().activeConversationId === null) apply(id);
      };
      void restore().catch(setError);
    }
    const offNavigate = bridge.onNavigate((path) => {
      if (!isCompanionWindow()) router.history.push(path);
    });
    const unsubscribe = useUiStore.subscribe((state, before) => {
      if (state.activeConversationId !== before.activeConversationId)
        bridge.selectConversation(state.activeConversationId);
    });
    // 所有共享消息卡片的路由跳转集中转交主窗口；桌宠始终留在自己的路由。
    const unblock = isCompanionWindow()
      ? router.history.block({
          blockerFn: ({ nextLocation }) => {
            if (nextLocation.pathname === COMPANION_PATH) return false;
            void bridge.openMain(nextLocation.href).catch(setError);
            return true;
          },
          enableBeforeUnload: false,
        })
      : () => {};
    return () => {
      received = true;
      off();
      offNavigate();
      unsubscribe();
      unblock();
    };
  }, [router, qc]);
  return error;
}
