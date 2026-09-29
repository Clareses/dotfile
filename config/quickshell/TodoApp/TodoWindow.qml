import Quickshell
import Quickshell.Wayland
import Quickshell.Hyprland
import Quickshell.Io
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls
import qs.CustomTheme

// Centered modal popup holding a lightweight todo list + a sticky-notes board.
// Triggered with `qs ipc call todo toggle` (bound to ALT+T) or the status bar
// button. Styled to match the sidebar / swaync panel (semi-transparent dark
// card, hairline border, teal accent).
PanelWindow {
    id: root

    WlrLayershell.layer: WlrLayer.Overlay
    exclusionMode: WlrLayershell.Ignore

    anchors {
        top: true
        bottom: true
        left: true
        right: true
    }
    color: "transparent"

    property bool isOpen: false
    property bool showWindow: false
    property int currentTab: 0 // 0 = 待办, 1 = 便签

    visible: showWindow

    onIsOpenChanged: {
        if (isOpen) {
            showWindow = true
            Qt.callLater(function () {
                if (root.currentTab === 0)
                    todoPane.focusInput()
                else
                    notesPane.focusInput()
            })
        }
    }

    property real progress: isOpen ? 1 : 0
    Behavior on progress {
        NumberAnimation {
            id: openAnim
            duration: 200
            easing.type: Easing.OutCubic
            onRunningChanged: {
                if (!running && !root.isOpen)
                    root.showWindow = false
            }
        }
    }

    HyprlandFocusGrab {
        windows: [root]
        active: root.isOpen
        onCleared: {
            if (root.isOpen)
                root.isOpen = false
        }
    }

    Shortcut {
        sequence: "Escape"
        onActivated: {
            if (root.isOpen)
                root.isOpen = false
        }
    }

    IpcHandler {
        target: "todo"
        function toggle(): void { root.isOpen = !root.isOpen }
        function open(): void { root.isOpen = true }
        function close(): void { root.isOpen = false }
        function state(): bool { return root.isOpen }
        function todos(): void { root.currentTab = 0; root.isOpen = true }
        function notes(): void { root.currentTab = 1; root.isOpen = true }
    }

    // ---- dim backdrop (click to close) ----
    Rectangle {
        anchors.fill: parent
        color: Qt.rgba(0, 0, 0, 0.30)
        opacity: root.progress
        MouseArea {
            anchors.fill: parent
            onClicked: root.isOpen = false
        }
    }

    // ---- centered card (semi-transparent, matching the sidebar panel) ----
    Rectangle {
        id: card
        anchors.centerIn: parent
        implicitWidth: 920
        implicitHeight: 650
        radius: 20
        color: Qt.rgba(0, 0, 0, 0.75)
        border.width: 1
        border.color: Qt.rgba(1, 1, 1, 0.10)
        opacity: root.progress
        scale: 0.96 + 0.04 * root.progress
        focus: true

        // Swallow clicks on the card background so they don't hit the backdrop.
        MouseArea { anchors.fill: parent }

        ColumnLayout {
            anchors.fill: parent
            anchors.margins: 22
            spacing: 16

            // ---------------- header ----------------
            RowLayout {
                Layout.fillWidth: true
                spacing: 12

                Repeater {
                    model: [
                        { name: "待办", glyph: "✓" },
                        { name: "便签", glyph: "▤" }
                    ]
                    delegate: Rectangle {
                        required property var modelData
                        required property int index
                        implicitWidth: tabLabel.implicitWidth + 34
                        implicitHeight: 40
                        radius: 10
                        color: root.currentTab === index
                            ? Theme.primary
                            : (tabArea.hovered ? Qt.rgba(1, 1, 1, 0.12) : Qt.rgba(1, 1, 1, 0.06))
                        Behavior on color { ColorAnimation { duration: 120 } }

                        Text {
                            id: tabLabel
                            anchors.centerIn: parent
                            text: modelData.glyph + "  " + modelData.name
                            color: root.currentTab === index ? Theme.on_primary : Theme.on_surface
                            font.family: Theme.fontFamily
                            font.pixelSize: 16
                        }
                        HoverHandler { id: tabArea }
                        TapHandler {
                            cursorShape: Qt.PointingHandCursor
                            onTapped: root.currentTab = index
                        }
                    }
                }

                Item { Layout.fillWidth: true }

                Rectangle {
                    implicitWidth: 40
                    implicitHeight: 40
                    radius: 10
                    color: closeArea.hovered ? Qt.rgba(1, 1, 1, 0.12) : "transparent"
                    Text {
                        anchors.centerIn: parent
                        text: "✕"
                        color: Theme.on_surface_variant
                        font.pixelSize: 18
                    }
                    HoverHandler { id: closeArea }
                    TapHandler {
                        cursorShape: Qt.PointingHandCursor
                        onTapped: root.isOpen = false
                    }
                }
            }

            // ---------------- content ----------------
            StackLayout {
                Layout.fillWidth: true
                Layout.fillHeight: true
                currentIndex: root.currentTab

                TodoListPane { id: todoPane }
                StickyNotesPane { id: notesPane }
            }
        }
    }
}
