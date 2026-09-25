"use client";

import { useState } from "react";
import { Button } from "@/components/ui/primitives";
import { savePushSubscriptionAction } from "@/server/use-cases/notification-preferences";

export function PushOptInButton({ vapidPublicKey }: { vapidPublicKey: string | null }) {
  const [status, setStatus] = useState<"idle" | "unsupported" | "denied" | "on" | "blocked">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function enable() {
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setStatus("unsupported");
      return;
    }
    if (!vapidPublicKey) {
      setStatus("blocked");
      setMessage("مفتاح VAPID غير مُعد على الخادم.");
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setStatus("denied");
      return;
    }
    const reg = await navigator.serviceWorker.ready;
    const bytes = Uint8Array.from(atob(vapidPublicKey.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
    const json = sub.toJSON();
    const result = await savePushSubscriptionAction({
      endpoint: json.endpoint ?? "",
      keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
    });
    if (!result.ok) {
      setStatus("blocked");
      setMessage(result.reason === "migration_062" ? "ترحيل 062 غير مطبّق بعد." : "تعذر حفظ الاشتراك.");
      return;
    }
    setStatus("on");
  }

  return (
    <div data-testid="push-opt-in">
      <Button type="button" onClick={() => void enable()}>
        تفعيل الإشعارات
      </Button>
      {status === "unsupported" ? <p className="mt-2 text-sm text-muted">المتصفح لا يدعم Web Push.</p> : null}
      {status === "denied" ? <p className="mt-2 text-sm text-danger">تم رفض الإذن.</p> : null}
      {status === "on" ? <p className="mt-2 text-sm text-success">تم تفعيل إشعارات هذا الجهاز.</p> : null}
      {message ? <p className="mt-2 text-sm text-muted">{message}</p> : null}
    </div>
  );
}
