import { useContext, useEffect } from 'react';
import { NavigationContext } from '@react-navigation/native';
import { useRuntimeStore } from '../state/runtimeStore';

/**
 * Bell unread = new since last look. Leaving Alerts (bell page or History → Alerts)
 * marks the current list read. History → Trades does not.
 */
export function useMarkAlertsSeenOnLeave(enabled = true): void {
  const markAllRead = useRuntimeStore((s) => s.markAllRead);
  const nav = useContext(NavigationContext);

  useEffect(() => {
    if (!enabled) return;
    const onLeave = () => {
      void markAllRead();
    };
    const unsub = nav?.addListener?.('blur', onLeave);
    return () => {
      if (typeof unsub === 'function') unsub();
      onLeave();
    };
  }, [enabled, nav, markAllRead]);
}
