import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/sessionMemory';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function useAndroidPush() {
  const pushSupported =
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window;

  const [permission, setPermission] = useState<NotificationPermission>(
    pushSupported ? Notification.permission : 'denied'
  );
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const syncSubscriptionState = useCallback(async () => {
    if (!pushSupported) return;
    setPermission(Notification.permission);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) {
        setSubscribed(false);
        return;
      }
      const existing = await reg.pushManager.getSubscription();
      setSubscribed(Boolean(existing));
    } catch {
      setSubscribed(false);
    }
  }, [pushSupported]);

  useEffect(() => {
    void syncSubscriptionState();
  }, [syncSubscriptionState]);

  const enableAndroidPush = async (): Promise<boolean> => {
    if (!pushSupported) {
      setError('Push notifications require a modern mobile or desktop browser.');
      return false;
    }
    setBusy(true);
    setError('');
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') {
        setError('Notification permission was denied in browser settings.');
        return false;
      }

      const keyRes = await apiFetch('/api/notifications/push-key');
      const keyData = await keyRes.json();
      if (!keyRes.ok || !keyData.publicKey) {
        throw new Error('Could not retrieve VAPID push key from server.');
      }

      const reg = await navigator.serviceWorker.ready;
      let subscription = await reg.pushManager.getSubscription();
      if (!subscription) {
        const applicationServerKey = urlBase64ToUint8Array(keyData.publicKey);
        subscription = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey.buffer as ArrayBuffer,
        });
      }

      const subRes = await apiFetch('/api/notifications/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      });
      const subData = await subRes.json();
      if (!subRes.ok) throw new Error(subData.error || 'Failed to save push subscription.');

      setSubscribed(true);
      return true;
    } catch (err: any) {
      setError(err?.message || 'Failed to enable Android push notifications.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const disableAndroidPush = async (): Promise<void> => {
    if (!pushSupported) return;
    setBusy(true);
    setError('');
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      const endpoint = sub?.endpoint;
      if (sub) {
        await sub.unsubscribe();
      }
      await apiFetch('/api/notifications/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint }),
      });
      setSubscribed(false);
    } catch (err: any) {
      setError(err?.message || 'Failed to disable push alerts.');
    } finally {
      setBusy(false);
    }
  };

  const sendTestPush = async (sendTestEmail = true): Promise<{ pushSent: number; emailSent: boolean }> => {
    setBusy(true);
    setError('');
    try {
      const res = await apiFetch('/api/notifications/test-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sendTestEmail }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Test push failed.');
      return {
        pushSent: data.pushResult?.sent || 0,
        emailSent: Boolean(data.emailSent),
      };
    } catch (err: any) {
      setError(err?.message || 'Could not dispatch test notification.');
      return { pushSent: 0, emailSent: false };
    } finally {
      setBusy(false);
    }
  };

  return {
    pushSupported,
    permission,
    subscribed,
    busy,
    error,
    enableAndroidPush,
    disableAndroidPush,
    sendTestPush,
  };
}
