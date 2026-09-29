import QtQuick
import QtQuick.Effects
import qs.CustomTheme

// Reusable round icon button used across the status bar modules.
Rectangle {
    id: btn
    property string iconSrc: ""
    property bool colorize: true
    // Set by the keyboard navigation in StatusbarWindow to highlight the
    // currently selected module.
    property bool focused: false
    // Optional small dot under the icon (e.g. pending notifications).
    property bool badge: false
    // When non-empty, the badge renders as a count pill instead of a plain dot.
    property string badgeText: ""
    signal clicked()

    // Run the button's action (mouse click or keyboard Return).
    function activate(): void { btn.clicked() }

    // Highlighted when hovered with the mouse or selected via the keyboard.
    readonly property bool active: mouseArea.containsMouse || btn.focused

    implicitWidth: 30
    implicitHeight: 30
    radius: 15

    // Every button gets the same accent-filled circle on hover/selection.
    // (colorize only controls whether the icon itself is recolored, so the
    // ML4W logo keeps its own colors while still matching the others.)
    color: btn.active ? Theme.workspaceActive : "transparent"

    // Fade the accent circle in on hover/selection and out again on leave.
    Behavior on color {
        ColorAnimation { duration: 500; easing.type: Easing.OutQuint }
    }

    Image {
        anchors.centerIn: parent
        source: btn.iconSrc
        width: 16
        height: 16
        sourceSize.width: 16
        sourceSize.height: 16
        fillMode: Image.PreserveAspectFit
        layer.enabled: btn.colorize
        layer.effect: MultiEffect {
            colorization: 1.0
            colorizationColor: Theme.barForeground

            // Recolor the icon in step with the circle fade.
            Behavior on colorizationColor {
                ColorAnimation { duration: 500; easing.type: Easing.OutQuint }
            }
        }
    }

    MouseArea {
        id: mouseArea
        anchors.fill: parent
        hoverEnabled: true
        cursorShape: Qt.PointingHandCursor
        onClicked: btn.clicked()
    }

    // Android-style notification badge anchored to the icon's top-right
    // corner: a count pill when `badgeText` is set, otherwise a small dot.
    // Declared after the MouseArea so it draws on top; it has no input
    // handling, so clicks still reach the MouseArea.
    Rectangle {
        id: badgeBubble
        visible: btn.badge
        readonly property int count: Math.max(0, parseInt(btn.badgeText) || 0)
        readonly property bool withCount: badgeBubble.count > 0
        implicitWidth: badgeBubble.withCount ? Math.max(12, badgeLabel.implicitWidth + 6) : 8
        implicitHeight: badgeBubble.withCount ? 12 : 8
        radius: height / 2
        color: Theme.error

        // Overlap the 16x16 icon's top-right corner (the icon is centered).
        x: parent.width / 2 + 8 - width / 2 + 1
        y: parent.height / 2 - 8 - height / 2 + 1

        Text {
            id: badgeLabel
            anchors.centerIn: parent
            visible: badgeBubble.withCount
            text: badgeBubble.count > 99 ? "99+" : ("" + badgeBubble.count)
            color: Theme.on_error
            font.family: Theme.fontFamily
            font.pixelSize: 8
            font.bold: true
        }
    }
}
