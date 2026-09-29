import Quickshell
import Quickshell.Io
import QtQuick
import QtQuick.Layouts
import QtQuick.Effects
import qs.CustomTheme

// Combined CPU + memory load indicator, in the spirit of waybar's cpu and
// memory modules (waybar shows "/ C {usage}%  / M {}%").
//   • left click / Return → open the system monitor
// Polls /proc/stat (CPU usage from the idle/total delta) and /proc/meminfo
// (used memory via MemAvailable) once every 2 seconds.
Rectangle {
    id: res

    // Set by the keyboard navigation in StatusbarWindow.
    property bool focused: false

    property real cpuPercent: 0
    property real memPercent: 0

    // Previous /proc/stat sample, used to compute the CPU delta between ticks.
    property real _prevIdle: -1
    property real _prevTotal: -1

    readonly property bool active: mouseArea.containsMouse || res.focused

    // Left click / keyboard Return: open the ML4W system monitor.
    function activate(): void {
        Quickshell.execDetached(["bash", "-c",
            Quickshell.env("HOME") + "/.config/ml4w/settings/system-monitor.sh"])
    }

    implicitWidth: row.implicitWidth + 12
    implicitHeight: 30
    radius: 15

    color: active ? Theme.workspaceActive : "transparent"
    Behavior on color {
        ColorAnimation { duration: 500; easing.type: Easing.OutQuint }
    }

    RowLayout {
        id: row
        anchors.centerIn: parent
        spacing: 10

        // --- CPU: icon + percent ---
        RowLayout {
            Layout.alignment: Qt.AlignVCenter
            spacing: 4

            Image {
                Layout.alignment: Qt.AlignVCenter
                source: "../shared/icons/cpu.svg"
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
                text: Math.round(res.cpuPercent) + "%"
                color: Theme.barForeground
                font.family: Theme.fontFamily
                font.pixelSize: 14
            }
        }

        // --- Memory: icon + percent ---
        RowLayout {
            Layout.alignment: Qt.AlignVCenter
            spacing: 4

            Image {
                Layout.alignment: Qt.AlignVCenter
                source: "../shared/icons/memory.svg"
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
                text: Math.round(res.memPercent) + "%"
                color: Theme.barForeground
                font.family: Theme.fontFamily
                font.pixelSize: 14
            }
        }
    }

    MouseArea {
        id: mouseArea
        anchors.fill: parent
        hoverEnabled: true
        cursorShape: Qt.PointingHandCursor
        onClicked: res.activate()
    }

    // One `cat` for both pseudo-files: the first /proc/stat line carries the
    // aggregate CPU counters, the Mem* lines carry memory. Parsed in one shot.
    Process {
        id: statsProc
        command: ["cat", "/proc/stat", "/proc/meminfo"]
        stdout: StdioCollector {
            onStreamFinished: res.parse(this.text)
        }
    }

    Timer {
        interval: 2000
        repeat: true
        running: true
        triggeredOnStart: true
        onTriggered: statsProc.running = true
    }

    function parse(text: string): void {
        // --- CPU: first "cpu" line = user nice system idle iowait irq ... ---
        const line = (text.split("\n")[0] || "").trim()
        const f = line.split(/\s+/).slice(1).map(Number)
        if (f.length >= 4 && !f.some(isNaN)) {
            const idle = f[3] + (f[4] || 0) // idle + iowait
            const total = f.reduce((a, b) => a + b, 0)
            if (res._prevTotal >= 0) {
                const dTotal = total - res._prevTotal
                const dIdle = idle - res._prevIdle
                if (dTotal > 0)
                    res.cpuPercent = Math.max(0, Math.min(100,
                        (dTotal - dIdle) / dTotal * 100))
            }
            res._prevTotal = total
            res._prevIdle = idle
        }

        // --- Memory: used = MemTotal - MemAvailable ---
        const t = /MemTotal:\s+(\d+)/.exec(text)
        const a = /MemAvailable:\s+(\d+)/.exec(text)
        if (t && a) {
            const total = Number(t[1])
            const avail = Number(a[1])
            if (total > 0)
                res.memPercent = Math.max(0, Math.min(100,
                    (total - avail) / total * 100))
        }
    }
}
