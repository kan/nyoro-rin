// The daily notice (DESIGN.md 25.8, src/worker/push.ts), imported by the
// service worker that vite-plugin-pwa builds (vite.config.ts), as TAKO-SEN's
// public/push-sw.js.

self.addEventListener("push", (event) => {
  // The wording comes with the message (DAILY_NOTICE in src/worker/push.ts);
  // these fallbacks are for one that cannot be read.
  let notice = {};
  try {
    notice = event.data?.json() ?? {};
  } catch {
    // A message that is not JSON still says that something happened.
  }
  event.waitUntil(
    self.registration.showNotification(notice.title ?? "NYORO-RIN", {
      body: notice.body ?? "",
      icon: "/pwa-192.png",
      badge: "/pwa-192.png",
      // One notice a day: a new one replaces yesterday's if still there.
      tag: "daily",
      data: { url: notice.url ?? "/" },
    }),
  );
});

// The push service replaced the subscription (Firefox does): the new one goes
// to the server at once, under the device's ID cookie, so the notice keeps
// coming to a player who opens the game only through it. The page sends it
// again at its next start too (src/ui/push.ts), which is harmless.
self.addEventListener("pushsubscriptionchange", (event) => {
  const options = event.oldSubscription?.options;
  event.waitUntil(
    Promise.resolve(
      event.newSubscription ??
        (options && self.registration.pushManager.subscribe(options)),
    )
      .then(
        (subscription) =>
          subscription &&
          fetch("/api/push/subscription", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(subscription.toJSON()),
          }),
      )
      .catch(() => undefined),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url ?? "/", self.location.origin)
    .href;
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windows) => {
        // A window already showing the game (the one in front first) loads
        // the notice's address: even one still running an older version
        // then opens the daily (src/ui/daily-request.ts), and the game keeps
        // its board in storage. A window that cannot be navigated (not yet
        // controlled by this worker) leaves it to a new one.
        const mine = windows.filter(
          (client) => new URL(client.url).origin === self.location.origin,
        );
        const open =
          mine.find((client) => client.focused) ??
          mine.find((client) => client.visibilityState === "visible") ??
          mine[0];
        if (!open) return self.clients.openWindow(url);
        return open
          .focus()
          .then((client) => client.navigate(url))
          .then((client) => client ?? self.clients.openWindow(url))
          .catch(() => self.clients.openWindow(url));
      }),
  );
});
