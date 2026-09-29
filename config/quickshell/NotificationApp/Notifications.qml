pragma Singleton

import Quickshell
import Quickshell.Services.Notifications
import QtQuick

// Native Quickshell notification service.
// Owns org.freedesktop.Notifications (so swaync/mako must not run), keeps a
// live list of popups and a history for the control center.
QtObject {
    id: root

    // Currently displayed popups (also present in history until dismissed).
    readonly property ListModel popups: ListModel {}
    // Full history shown in the notification center.
    readonly property ListModel history: ListModel {}

    property bool centerOpen: false
    readonly property int count: history.count

    function openCenter(): void { root.centerOpen = true }
    function closeCenter(): void { root.centerOpen = false }
    function toggleCenter(): void { root.centerOpen = !root.centerOpen }

    function clearAll(): void {
        for (let i = root.history.count - 1; i >= 0; i--) {
            const n = root.history.get(i).notif
            if (n)
                n.dismiss()
        }
    }

    function removePopup(n): void {
        for (let i = root.popups.count - 1; i >= 0; i--)
            if (root.popups.get(i).notif === n)
                root.popups.remove(i)
    }

    function removeHistory(n): void {
        for (let i = root.history.count - 1; i >= 0; i--)
            if (root.history.get(i).notif === n)
                root.history.remove(i)
    }

    // Resolve a usable image URL for a notification (image path, app icon, or
    // a generic fallback from the icon theme).
    function fileUrl(p): string {
        if (!p || p.length === 0)
            return ""
        if (p.startsWith("/"))
            return "file://" + p
        return p
    }

    function iconFor(notif): string {
        if (!notif)
            return fileUrl(Quickshell.iconPath("dialog-information", true))
        const img = notif.image
        if (img && img.length > 0)
            return fileUrl(img)
        const ic = notif.appIcon
        if (ic && ic.length > 0)
            return fileUrl(ic.startsWith("/") ? ic : Quickshell.iconPath(ic, true))
        return fileUrl(Quickshell.iconPath("dialog-information", true))
    }

    function urgencyOf(notif): int {
        if (!notif)
            return NotificationUrgency.Normal
        return notif.urgency
    }

    property NotificationServer server: NotificationServer {
        keepOnReload: false
        persistenceSupported: true
        bodySupported: true
        bodyMarkupSupported: true
        bodyHyperlinksSupported: false
        bodyImagesSupported: false
        actionsSupported: true
        actionIconsSupported: false
        imageSupported: true
        inlineReplySupported: false

        onNotification: (n) => {
            n.tracked = true
            const entry = {
                "notif": n,
                "appName": n.appName,
                "appIcon": n.appIcon,
                "summary": n.summary,
                "body": n.body,
                "image": n.image,
                "urgency": n.urgency,
                "timestamp": Date.now()
            }
            root.history.insert(0, entry)
            root.popups.append(entry)
            n.closed.connect((reason) => {
                root.removePopup(n)
                if (reason === NotificationCloseReason.Dismissed)
                    root.removeHistory(n)
            })
        }
    }
}
