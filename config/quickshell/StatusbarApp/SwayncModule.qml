import Quickshell
import Quickshell.Io
import QtQuick

// Toggles the SwayNotificationCenter panel. Shows a filled bell while there
// are pending notifications.
BarButton {
    id: swaync

    property int notificationCount: 0
    readonly property bool hasNotifications: notificationCount > 0

    iconSrc: hasNotifications
        ? "../shared/icons/bell-filled.svg"
        : "../shared/icons/bell.svg"

    // Android-style count badge in the bell's top-right corner.
    badge: hasNotifications
    badgeText: notificationCount > 0 ? ("" + notificationCount) : ""

    onClicked: {
        Quickshell.execDetached(["swaync-client", "-t", "-sw"])
    }

    // Live notification count via swaync's waybar subscription, which emits a
    // JSON line (e.g., {"text": "3", ...}) on every add/close event.
    Process {
        id: swayncProc
        command: ["swaync-client", "-swb"]
        running: true
        stdout: SplitParser {
            onRead: data => {
                try {
                    swaync.notificationCount = parseInt(JSON.parse(data).text) || 0
                } catch (e) {
                    // Ignore malformed lines.
                }
            }
        }
    }
}
