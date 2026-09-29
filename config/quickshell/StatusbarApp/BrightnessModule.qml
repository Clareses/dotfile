import Quickshell
import Quickshell.Io
import QtQuick
import QtQuick.Effects
import QtQuick.Layouts
import qs.CustomTheme

// Screen backlight level, read from brightnessctl (the same tool the Waybar
// backlight module uses).
//   • mouse wheel (hovered)      → raise/lower brightness in 2% steps
//   • Up / Down arrows (focused) → raise/lower brightness
Rectangle {
    id: brightness

    // Current backlight percentage (0-100).
    property int percent: 0
    // Set by the keyboard navigation in StatusbarWindow.
    property bool focused: false

    readonly property bool active: mouseArea.containsMouse || brightness.focused

    implicitWidth: row.implicitWidth + 6
    implicitHeight: 30
    radius: 15

    // Same accent-filled highlight as the other modules on hover/selection.
    color: active ? Theme.workspaceActive : "transparent"
    Behavior on color {
        ColorAnimation { duration: 500; easing.type: Easing.OutQuint }
    }

    // Left click / keyboard Return: nothing to open for backlight.
    function activate(): void {}

    // Raise (dir > 0) or lower (dir < 0) brightness by one step.
    function step(dir: int): void {
        setProc.command = ["brightnessctl", "set", "2%" + (dir > 0 ? "+" : "-")]
        setProc.running = false
        setProc.running = true
    }

    // Re-read the current level.
    function refresh(): void {
        readProc.running = false
        readProc.running = true
    }

    // `brightnessctl -m` prints: device,class,current,percent%,max
    Process {
        id: readProc
        command: ["brightnessctl", "-m"]
        running: true
        stdout: StdioCollector {
            onStreamFinished: {
                const parts = this.text.trim().split(",")
                if (parts.length >= 4) {
                    const p = parseInt(parts[3].replace("%", ""))
                    if (!isNaN(p))
                        brightness.percent = p
                }
            }
        }
    }

    Process {
        id: setProc
        onExited: brightness.refresh()
    }

    RowLayout {
        id: row
        anchors.centerIn: parent
        spacing: 4

        Image {
            Layout.alignment: Qt.AlignVCenter
            source: "../shared/icons/brightness.svg"
            sourceSize.width: 16
            sourceSize.height: 16
            width: 16
            height: 16
            fillMode: Image.PreserveAspectFit
            layer.enabled: true
            layer.effect: MultiEffect {
                colorization: 1.0
                colorizationColor: Theme.barForeground
            }
        }

        Text {
            Layout.alignment: Qt.AlignVCenter
            text: brightness.percent + "%"
            color: Theme.barForeground
            font.family: Theme.fontFamily
            font.pixelSize: 14
            font.bold: false
        }
    }

    MouseArea {
        id: mouseArea
        anchors.fill: parent
        hoverEnabled: true
        cursorShape: Qt.PointingHandCursor
        onWheel: wheel => brightness.step(wheel.angleDelta.y > 0 ? 1 : -1)
    }
}
