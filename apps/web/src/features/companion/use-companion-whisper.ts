import { stopWhisperOp, whisperOp } from '@aw/shared';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { callOperation } from '../../api/client.ts';
import { useSettings } from '../settings/settings.queries.ts';

const BUBBLE_DURATION_MS = 12_000;

/** 自动计时只在空闲时触发；用户打开聊天、处理通知时取消在途的自动碎碎念。 */
export function useCompanionWhisper(available: boolean) {
  const settings = useSettings();
  const automatic = settings['companion.whisper'];
  const minutes = settings['companion.whisperMinutes'];
  const [text, setText] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const running = useRef(false);
  const generation = useRef(0);
  const speak = async () => {
    if (running.current) return;
    const id = ++generation.current;
    running.current = true;
    setPending(true);
    setError(null);
    setText(null);
    try {
      const result = await callOperation(whisperOp, {});
      if (generation.current === id) setText(result.text);
    } catch (failure) {
      if (generation.current === id) setError(failure);
    } finally {
      running.current = false;
      if (generation.current === id) setPending(false);
    }
  };
  const stop = useEffectEvent(() => {
    generation.current += 1;
    setPending(false);
    if (running.current) void callOperation(stopWhisperOp, {}).catch(setError);
  });
  const tick = useEffectEvent(() => {
    if (available && text === null) void speak();
  });
  useEffect(() => {
    if (text === null) return;
    const timer = window.setTimeout(() => setText(null), BUBBLE_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [text]);
  useEffect(() => {
    if (!automatic || !available) {
      stop();
      return;
    }
    const timer = window.setInterval(tick, minutes * 60_000);
    return () => window.clearInterval(timer);
  }, [automatic, available, minutes]);
  useEffect(
    () => () => {
      generation.current += 1;
      if (running.current) void callOperation(stopWhisperOp, {}).catch(console.error);
    },
    [],
  );
  return { text, pending, error, speak, dismiss: () => setText(null) };
}
