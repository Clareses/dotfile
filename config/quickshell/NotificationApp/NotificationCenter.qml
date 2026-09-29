import Quickshell
import Quickshell.Wayland
import Quickshell.Hyprland
import Quickshell.Services.Notifications
import QtQuick
import QtQuick.Layouts
import QtQuick.Effects
import qs.CustomTheme
import qs.NotificationApp

// Native notification center, attached directly under the bar (same window
// stack as the bar, so there is no seam).
PanelWindow {
    id: root

    WlrLayershell.layer: WlrLayer.Overlay
    exclusionMode: WlrLayershell.Ignore
    color: "transparent"
    visible: Notifications.centerOpen

    anchors {
        top: true
        left: true
        bottom: true
    }

    margins {
        top: 36
        left: 5
        bottom: 0
    }

    implicitWidth: 430

    screen: {
        const m = Hyprland.focusedMonitor
        if (m) {
            for (let i = 0; i < Quickshell.screens.length; i++)
                if (Quickshell.screens[i].name === m.name)
                    return Quickshell.screens[i]
        }
        return Quickshell.screens.length > 0 ? Quickshell.screens[0] : null
    }

    HyprlandFocusGrab {
        windows: [root]
        active: Notifications.centerOpen
        onCleared: Notifications.closeCenter()
    }

    Shortcut {
        sequence: "Escape"
        onActivated: Notifications.closeCenter()
    }

    // Background: square top (flush with the bar), rounded bottom.
    Rectangle {
        anchors.fill: parent
        color: Qt.rgba(0, 0, 0, 0.78)
        radius: 14
        topLeftRadius: 0
        topRightRadius: 0
        bottomLeftRadius: 0
        bottomRightRadius: 0
    }

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 12
        spacing: 8

        // ---- Header ----
        RowLayout {
            Layout.fillWidth: true
            spacing: 8

            Text {
                text: "Notifications"
                color: Theme.on_surface
                font.family: Theme.fontFamily
                font.pixelSize: 16
                font.bold: true
                Layout.fillWidth: true
            }

            Rectangle {
                implicitWidth: clearText.implicitWidth + 20
                implicitHeight: 28
                radius: 8
                color: clearArea.containsMouse ? Theme.primary : Theme.surface_container

                Text {
                    id: clearText
                    anchors.centerIn: parent
                    text: "Clear"
                    color: clearArea.containsMouse ? Theme.on_primary : Theme.on_surface
                    font.family: Theme.fontFamily
                    font.pixelSize: 12
                }

                MouseArea {
                    id: clearArea
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: Notifications.clearAll()
                }
            }
        }

        // ---- Empty placeholder ----
        Text {
            Layout.fillWidth: true
            Layout.topMargin: 40
            visible: Notifications.history.count === 0
            horizontalAlignment: Text.AlignHCenter
            text: "No notifications"
            color: Theme.outline
            font.family: Theme.fontFamily
            font.pixelSize: 13
        }

        // ---- History list ----
        ListView {
            id: list
            Layout.fillWidth: true
            Layout.fillHeight: true
            clip: true
            spacing: 8
            model: Notifications.history
            boundsBehavior: Flickable.StopAtBounds

            delegate: Rectangle {
                required property var model
                width: list.width
                height: itemContent.implicitHeight + 20
                radius: 10
                color: Theme.surface_container
                border.width: 1
                border.color: (model.urgency === NotificationUrgency.Critical)
                    ? "#ffb4ab" : Theme.outline_variant

                RowLayout {
                    id: itemContent
                    anchors.fill: parent
                    anchors.margins: 10
                    spacing: 10

                    Image {
                        Layout.alignment: Qt.AlignTop
                        source: Notifications.iconFor(model.notif)
                        sourceSize.width: 32
                        sourceSize.height: 32
                        Layout.preferredWidth: 32
                        Layout.preferredHeight: 32
                        fillMode: Image.PreserveAspectFit
                        visible: source != ""
                    }

                    ColumnLayout {
                        Layout.fillWidth: true
                        spacing: 2

                        Text {
                            Layout.fillWidth: true
                            text: model.summary
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
                            text: model.body
                            color: Theme.on_surface_variant
                            font.family: Theme.fontFamily
                            font.pixelSize: 12
                            wrapMode: Text.WordWrap
                            maximumLineCount: 3
                            elide: Text.ElideRight
                            visible: text.length > 0
                        }

                        Text {
                            text: model.appName
                            color: Theme.outline
                            font.family: Theme.fontFamily
                            font.pixelSize: 10
                            visible: text.length > 0
                        }
                    }

                    Rectangle {
                        Layout.alignment: Qt.AlignTop
                        implicitWidth: 22
                        implicitHeight: 22
                        radius: 11
                        color: hisClose.containsMouse ? Theme.primary : "transparent"

                        Text {
                            anchors.centerIn: parent
                            text: "✕"
                            color: hisClose.containsMouse ? Theme.on_primary : Theme.on_surface_variant
                            font.pixelSize: 12
                        }

                        MouseArea {
                            id: hisClose
                            anchors.fill: parent
                            hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: {
                                if (model.notif)
                                    model.notif.dismiss()
                            }
                        }
                    }
                }
            }
        }
    }
}
