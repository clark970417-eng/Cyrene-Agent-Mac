// useStreamThrottle -- React 流式 Token 高频打字机渲染节流 Hook
//
// 解决 LLM 高速吐字（100+ tokens/s）导致 React 每秒触发数十次
// 重复 Re-render、Markdown 解析和 DOM 树抖动的问题。
// 使用 requestAnimationFrame 进行帧率同步与微批处理，确保 60 FPS 流畅打字体验。

import { useState, useEffect, useRef, useCallback } from "react";

export interface StreamThrottleOptions {
  /** 最小刷新间隔毫秒（默认 20ms，对应 ~50-60 FPS） */
  throttleMs?: number;
  /** 是否在流结束时立即无延迟刷新 */
  flushOnEnd?: boolean;
}

export function useStreamThrottle(
  incomingText: string,
  isStreaming = false,
  options: StreamThrottleOptions = {},
): string {
  const throttleMs = options.throttleMs ?? 20;
  const [displayValue, setDisplayValue] = useState(incomingText);
  const bufferRef = useRef(incomingText);
  const lastFlushTimeRef = useRef(0);
  const rafIdRef = useRef<number | null>(null);
  const timerIdRef = useRef<NodeJS.Timeout | null>(null);

  bufferRef.current = incomingText;

  const flush = useCallback(() => {
    setDisplayValue(bufferRef.current);
    lastFlushTimeRef.current = Date.now();
  }, []);

  useEffect(() => {
    // 1. 如果非流式状态，立即同步
    if (!isStreaming) {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      if (timerIdRef.current) clearTimeout(timerIdRef.current);
      flush();
      return;
    }

    // 2. 流式传输中：节流调度
    const now = Date.now();
    const elapsed = now - lastFlushTimeRef.current;

    if (elapsed >= throttleMs) {
      flush();
    } else {
      if (!timerIdRef.current) {
        timerIdRef.current = setTimeout(() => {
          timerIdRef.current = null;
          if (typeof window !== "undefined" && window.requestAnimationFrame) {
            rafIdRef.current = window.requestAnimationFrame(() => flush());
          } else {
            flush();
          }
        }, throttleMs - elapsed);
      }
    }
  }, [incomingText, isStreaming, throttleMs, flush]);

  useEffect(() => {
    return () => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      if (timerIdRef.current) clearTimeout(timerIdRef.current);
    };
  }, []);

  return displayValue;
}
