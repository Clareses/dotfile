import Quickshell.Hyprland
import QtQuick
import QtQuick.Layouts
import qs.CustomTheme

// Hyprland workspace switcher.
RowLayout {
    id: wsRoot
    spacing: 10

    // Minimum number of workspaces to always display, even when empty. The list
    // still grows beyond this to reveal any higher-numbered workspace that
    // exists (e.g. switching to workspace 6 while this is 5 adds a 6th dot).
    property int minWorkspaces: 5

    // The individual workspace buttons, exposed so StatusbarWindow can splice
    // them into its keyboard-navigation list. Rebuilt whenever workspaces are
    // added or removed.
    property var navButtons: []

    function rebuildNavButtons(): void {
        let a = []
        for (let i = 0; i < rep.count; i++)
            a.push(rep.itemAt(i))
        wsRoot.navButtons = a
    }

    // Name of the Hyprland monitor whose workspaces this module shows. Set by
    // StatusbarWindow so each per-screen bar only lists its own workspaces
    // (waybar's `all-outputs: false` behaviour).
    property string monitorName: ""

    // The workspace ids to render: the workspaces that currently exist on this
    // module's monitor, sorted ascending. Empty workspaces are not shown —
    // exactly like the user's waybar.
    readonly property var workspaceIds: {
        const list = Hyprland.workspaces.values
        let ids = []
        for (let i = 0; i < list.length; i++) {
            const w = list[i]
            if (wsRoot.monitorName !== "" && w.monitor
                    && w.monitor.name !== wsRoot.monitorName)
                continue
            if (ids.indexOf(w.id) === -1)
                ids.push(w.id)
        }
        return ids.sort((a, b) => a - b)
    }

    // The live Hyprland workspace for an id, or null when it is empty (Hyprland
    // only tracks workspaces that hold windows or are focused).
    function workspaceById(id: int): var {
        const list = Hyprland.workspaces.values
        for (let i = 0; i < list.length; i++)
            if (list[i].id === id)
                return list[i]
        return null
    }

    Repeater {
        id: rep
        model: wsRoot.workspaceIds

        onItemAdded: wsRoot.rebuildNavButtons()
        onItemRemoved: wsRoot.rebuildNavButtons()

        delegate: Rectangle {
            id: ws
            required property var modelData   // the workspace id (int)
            // Set by StatusbarWindow's keyboard navigation.
            property bool focused: false

            // Only the bar on the currently focused monitor highlights its
            // active workspace; the other screens' bars stay unhighlighted.
            // (Workspace ids are globally unique, so comparing against the
            // focused workspace never lights up a bar for another monitor.)
            readonly property bool isActive: Hyprland.focusedWorkspace
                && Hyprland.focusedWorkspace.id === ws.modelData
            // Whether the workspace currently holds windows (exists in Hyprland).
            readonly property bool occupied: wsRoot.workspaceById(ws.modelData) !== null

            // Run this workspace's action (mouse click or keyboard Return).
            // Hyprland with Lua dispatchers ignores the plain "workspace N"
            // string, so branch on usingLua the same way the overview does.
            function activate(): void {
                if (Hyprland.usingLua)
                    Hyprland.dispatch("hl.dsp.focus({workspace = '" + ws.modelData + "'})")
                else
                    Hyprland.dispatch("workspace " + ws.modelData)
            }

            // waybar-style workspace buttons: #181818 pill, #5E94A2 when
            // active. Kept shorter than the bar (22 < 30) and the active one
            // widens into a wide ellipse, matching waybar's `padding: 0 22px`.
            implicitWidth: ws.isActive ? 54 : 30
            implicitHeight: 22
            radius: 11

            Behavior on implicitWidth {
                NumberAnimation { duration: 300; easing.type: Easing.OutQuint }
            }

            opacity: 1

            color: ws.isActive
                ? Theme.workspaceActive
                : (wsMouse.containsMouse ? "#2a2a2a" : Theme.workspaceButton)
            border.width: 0

            // Crossfade the fill between active / hover / inactive states so the
            // background of the active button fades in and the previous one out.
            Behavior on color {
                ColorAnimation { duration: 500; easing.type: Easing.OutQuint }
            }

            // Keyboard-selection ring, distinct from the active-workspace fill.
            Rectangle {
                anchors.fill: parent
                anchors.margins: -3
                radius: width / 2
                color: "transparent"
                border.color: Theme.primary
                border.width: 2
                opacity: ws.focused ? 1 : 0
                Behavior on opacity {
                    NumberAnimation { duration: 150 }
                }
            }

            Text {
                anchors.centerIn: parent
                text: ws.modelData
                color: Theme.barForeground
                font.family: Theme.fontFamily
                font.pixelSize: 13
                font.bold: true

                // Match the fill crossfade so the label recolors in step.
                Behavior on color {
                    ColorAnimation { duration: 500; easing.type: Easing.OutQuint }
                }
            }

            MouseArea {
                id: wsMouse
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onClicked: ws.activate()
            }
        }
    }
}
