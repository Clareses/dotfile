import Quickshell
import Quickshell.Networking
import QtQuick
import QtQuick.Effects
import QtQuick.Layouts
import qs.CustomTheme

// Network status indicator: shows how the machine is connected and how strong
// the signal is. Icon-only by default; the connection name appears on click.
//   • wired connected      → cable icon
//   • Wi-Fi connected      → signal icon (1–4 arcs by strength)
//   • nothing connected    → crossed-out Wi-Fi icon
//   • left click / Return  → expand/collapse the connection name (SSID / Wired)
//   • right click           → open NetworkManager's connection editor
// The icon is picked from the signal strength of the connected Wi-Fi network
// (0.0–1.0 from NetworkManager). Where both a cable and Wi-Fi are up the cable
// wins, which is normally the route the system actually uses.
Rectangle {
    id: net

    // Every network device the backend knows about (Wi-Fi and wired).
    readonly property var devices: Networking.devices.values

    // The first Wi-Fi device, or null on a machine with no Wi-Fi hardware.
    readonly property var wifiDevice: {
        let list = net.devices
        for (let i = 0; i < list.length; i++)
            if (list[i].type === DeviceType.Wifi)
                return list[i]
        return null
    }

    // The first wired device, or null on a machine with no Ethernet port.
    readonly property var wiredDevice: {
        let list = net.devices
        for (let i = 0; i < list.length; i++)
            if (list[i].type === DeviceType.Wired)
                return list[i]
        return null
    }

    // The Wi-Fi network this device is currently associated with (the one whose
    // `connected` flag is set), or null while disconnected.
    readonly property var wifiNetwork: {
        if (!net.wifiDevice)
            return null
        let nets = net.wifiDevice.networks.values
        // Read *every* network's `connected` flag (not an early `return` inside
        // the guard) so this binding depends on each one. The networks model only
        // emits `values` on insert/remove, so without reading the flags a switch
        // between two already-known networks would not re-evaluate this binding.
        let found = null
        for (let i = 0; i < nets.length; i++) {
            const connected = nets[i].connected
            if (connected)
                found = nets[i]
        }
        return found
    }

    // Signal quality of the connected Wi-Fi network as a 0.0–1.0 fraction.
    readonly property real signalStrength: net.wifiNetwork ? net.wifiNetwork.signalStrength : 0

    // True while NetworkManager reports the wired link as *connected* (has an
    // active connection). Deliberately not `hasLink`: that only means a cable is
    // plugged in with carrier, which is also true for an unmanaged dock cable,
    // and would pin the bar on "Wired" while traffic still goes over Wi-Fi.
    readonly property bool wiredConnected: net.wiredDevice ? net.wiredDevice.connected : false

    // Preview switch: while true a demo Wi-Fi state is shown so the layout can
    // be reviewed on a machine with no network. Set to false for real use.
    property bool preview: false

    // "wired" | "wifi" | "wifi-off"
    readonly property string kind: {
        if (net.wiredConnected)
            return "wired"
        if (net.wifiNetwork)
            return "wifi"
        return "wifi-off"
    }

    // Text shown next to the icon once expanded: the SSID for Wi-Fi,
    // "Wired" for a cable, and nothing when offline.
    readonly property string label: {
        if (net.preview)
            return "ExampleWiFi"
        if (net.kind === "wired")
            return "Wired"
        if (net.kind === "wifi")
            return net.wifiNetwork.name
        return ""
    }

    // Pick the icon from the connection kind and (for Wi-Fi) the signal level.
    readonly property string iconSource: {
        if (!net.preview && net.kind === "wired")
            return "../shared/icons/ethernet.svg"
        let strength = net.preview ? 0.8 : net.signalStrength
        if (net.preview || net.kind === "wifi") {
            if (strength > 0.75)
                return "../shared/icons/wifi.svg"
            if (strength > 0.5)
                return "../shared/icons/wifi-high.svg"
            if (strength > 0.25)
                return "../shared/icons/wifi-low.svg"
            return "../shared/icons/wifi-zero.svg"
        }
        return "../shared/icons/wifi-off.svg"
    }

    // Set by the keyboard navigation in StatusbarWindow.
    property bool focused: false

    // Whether the connection name is shown next to the icon. Off by default so
    // the bar stays compact; left click / Return toggle it.
    property bool expanded: false

    // Highlight on hover or while keyboard-selected, like the other modules.
    readonly property bool active: mouseArea.containsMouse || net.focused

    // Left click / keyboard Return: expand/collapse the connection name.
    function activate(): void {
        net.expanded = !net.expanded
    }

    // Right click: open the NetworkManager connection editor.
    function openEditor(): void {
        Quickshell.execDetached(["nm-connection-editor"])
    }

    implicitWidth: row.implicitWidth + 6
    implicitHeight: 30
    radius: 15
    color: net.active ? Theme.workspaceActive : "transparent"

    // Fade the accent circle in/out like BarButton does.
    Behavior on color {
        ColorAnimation { duration: 500; easing.type: Easing.OutQuint }
    }

    RowLayout {
        id: row
        anchors.centerIn: parent
        spacing: 4

        Image {
            Layout.alignment: Qt.AlignVCenter
            source: net.iconSource
            sourceSize.width: 20
            sourceSize.height: 20
            width: 20
            height: 20
            fillMode: Image.PreserveAspectFit
            layer.enabled: true
            layer.effect: MultiEffect {
                colorization: 1.0
                colorizationColor: Theme.barForeground
                Behavior on colorizationColor {
                    ColorAnimation { duration: 500; easing.type: Easing.OutQuint }
                }
            }
        }

        Text {
            Layout.alignment: Qt.AlignVCenter
            visible: net.expanded && net.label !== ""
            text: net.label
            // Keep a long SSID from pushing the rest of the bar around.
            Layout.maximumWidth: 140
            elide: Text.ElideRight
            color: Theme.barForeground
            font.family: Theme.fontFamily
            font.pixelSize: 14
            font.bold: false
            Behavior on color {
                ColorAnimation { duration: 500; easing.type: Easing.OutQuint }
            }
        }
    }

    MouseArea {
        id: mouseArea
        anchors.fill: parent
        hoverEnabled: true
        acceptedButtons: Qt.LeftButton | Qt.RightButton
        cursorShape: Qt.PointingHandCursor
        onClicked: mouse => {
            if (mouse.button === Qt.RightButton)
                net.openEditor()
            else
                net.activate()
        }
    }
}
