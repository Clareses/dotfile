import Quickshell
import Quickshell.Wayland
import Quickshell.Hyprland
import Quickshell.Services.Notifications
import QtQuick
import QtQuick.Layouts
import QtQuick.Effects
import qs.CustomTheme
import qs.NotificationApp

// Floating notification popups, drawn by quickshell itself so they match the bar.
PanelWindow {
    id: root

    WlrLayershell.layer: WlrLayer.Overlay
    exclusionMode: WlrLayershell.Ignore
    color: "transparent"

    anchors {
        top: true
        left: true
    }

    margins {
        top: 42
        left: 8
    }

    implicitWidth: 380
    implicitHeight: column.implicitHeight

    // Follow the focused monitor.
    screen: {
        const m = Hyprland.focusedMonitor
        if (m) {
            for (let i = 0; i < Quickshell.screens.length; i++)
                if (Quickshell.screens[i].name === m.name)
                    return Quickshell.screens[i]
        }
        return Quickshell.screens.length > 0 ? Quickshell.screens[0] : null
    }

    Column {
        id: column
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        spacing: 8

        Repeater {
            model: Notifications.popups

            delegate: Rectangle {
                id: card
                required property var model

                width: column.width
                implicitHeight: content.implicitHeight + 20
                radius: 12
                color: Qt.rgba(0, 0, 0, 0.85)
                border.width: 2
                border.color: (card.model.urgency === NotificationUrgency.Critical)
                    ? "#ffb4ab" : Theme.primary

                // Auto-expire: honour the app's requested timeout, else 5s.
                // Critical notifications stay until dismissed.
                property bool autoExpire: card.model.urgency !== NotificationUrgency.Critical
                Timer {
                    running: card.autoExpire
                    interval: {
                        const t = card.model.notif ? card.model.notif.expireTimeout : 0
                        return (t && t > 0) ? t * 1000 : 5000
                    }
                    onTriggered: {
                        if (card.model.notif)
                            card.model.notif.expire()
                    }
                }

                RowLayout {
                    id: content
                    anchors.fill: parent
                    anchors.margins: 10
                    spacing: 10

                    Image {
                        Layout.alignment: Qt.AlignTop
                        source: Notifications.iconFor(card.model.notif)
                        sourceSize.width: 40
                        sourceSize.height: 40
                        Layout.preferredWidth: 40
                        Layout.preferredHeight: 40
                        fillMode: Image.PreserveAspectFit
                        visible: source != ""
                    }

                    ColumnLayout {
                        Layout.fillWidth: true
                        spacing: 2

                        Text {
                            Layout.fillWidth: true
                            text: card.model.summary
                            color: Theme.on_surface
                            font.family: Theme.fontFamily
                            font.pixelSize: 14
                            font.bold: true
                            wrapMode: Text.WordWrap
                            maximumLineCount: 2
                            elide: Text.ElideRight
                            visible: text.length > 0
                        }

                        Text {
                            Layout.fillWidth: true
                            text: card.model.body
                            color: Theme.on_surface_variant
                            font.family: Theme.fontFamily
                            font.pixelSize: 12
                            wrapMode: Text.WordWrap
                            maximumLineCount: 3
                            elide: Text.ElideRight
                            visible: text.length > 0
                        }

                        Text {
                            text: card.model.appName
                            color: Theme.outline
                            font.family: Theme.fontFamily
                            font.pixelSize: 10
                            visible: text.length > 0
                        }
                    }

                    // Close button
                    Rectangle {
                        Layout.alignment: Qt.AlignTop
                        implicitWidth: 22
                        implicitHeight: 22
                        radius: 11
                        color: closeArea.containsMouse ? Theme.primary : "transparent"

                        Text {
                            anchors.centerIn: parent
                            text: "✕"
                            color: closeArea.containsMouse ? Theme.on_primary : Theme.on_surface_variant
                            font.pixelSize: 12
                        }

                        MouseArea {
                            id: closeArea
                            anchors.fill: parent
                            hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: {
                                if (card.model.notif)
                                    card.model.notif.dismiss()
                            }
                        }
                    }
                }

                MouseArea {
                    anchors.fill: parent
                    z: -1
                    onClicked: {
                        if (card.model.notif)
                            card.model.notif.dismiss()
                    }
                }
            }
        }
    }
}
