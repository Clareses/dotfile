import Quickshell
import QtQuick
import QtQuick.Effects
import QtQuick.Layouts
import qs.CustomTheme

// One row of a tray context menu: a separator, or an item with an optional
// check indicator, icon, label and submenu chevron. Hover/activation are
// reported to the owning menu so it can manage submenus; the row itself has no
// knowledge of them.
Rectangle {
    id: item

    required property var entry

    // Kept highlighted by the owner while this row's submenu is open.
    property bool selected: false

    signal activated()
    signal hovered()

    readonly property bool separator: item.entry.isSeparator
    readonly property bool enabled: item.entry.enabled
    readonly property bool hasChildren: item.entry.hasChildren
    readonly property bool checked: item.entry.checkState === Qt.Checked
    readonly property bool isHighlighted: !item.separator && item.enabled
        && (item.selected || mouseArea.containsMouse)

    Layout.fillWidth: true
    implicitWidth: item.separator ? 0 : rowLayout.implicitWidth
    implicitHeight: item.separator ? 9 : 30
    radius: 8
    color: item.isHighlighted ? Theme.primary : "transparent"
    Behavior on color {
        ColorAnimation { duration: 150; easing.type: Easing.OutQuint }
    }

    Rectangle {
        visible: item.separator
        anchors.verticalCenter: parent.verticalCenter
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.leftMargin: 8
        anchors.rightMargin: 8
        height: 1
        color: Theme.outline_variant
    }

    RowLayout {
        id: rowLayout
        visible: !item.separator
        anchors.fill: parent
        anchors.leftMargin: 10
        anchors.rightMargin: 10
        spacing: 8

        // Checkbox / radiobutton indicator.
        Text {
            Layout.preferredWidth: 14
            Layout.alignment: Qt.AlignVCenter
            visible: item.entry.buttonType !== QsMenuButtonType.None
            text: item.checked ? "✓" : ""
            color: item.isHighlighted ? Theme.background : Theme.primary
            font.family: Theme.fontFamily
            font.pixelSize: 13
        }

        Image {
            Layout.alignment: Qt.AlignVCenter
            Layout.preferredWidth: visible ? 16 : 0
            Layout.preferredHeight: 16
            visible: item.entry.icon !== ""
            source: item.entry.icon
            sourceSize.width: 16
            sourceSize.height: 16
            fillMode: Image.PreserveAspectFit
        }

        Text {
            Layout.fillWidth: true
            Layout.alignment: Qt.AlignVCenter
            text: item.entry.text
            color: item.isHighlighted
                ? Theme.background
                : (item.enabled ? Theme.on_surface : Theme.outline)
            font.family: Theme.fontFamily
            font.pixelSize: 13
            elide: Text.ElideRight
        }

        Image {
            Layout.alignment: Qt.AlignVCenter
            Layout.preferredWidth: item.hasChildren ? 14 : 0
            Layout.preferredHeight: 14
            visible: item.hasChildren
            source: "../shared/icons/chevron-right.svg"
            sourceSize.width: 14
            sourceSize.height: 14
            fillMode: Image.PreserveAspectFit
            layer.enabled: true
            layer.effect: MultiEffect {
                colorization: 1.0
                colorizationColor: item.isHighlighted ? Theme.background : Theme.on_surface
            }
        }
    }

    MouseArea {
        id: mouseArea
        anchors.fill: parent
        enabled: !item.separator && item.enabled
        hoverEnabled: true
        cursorShape: item.hasChildren ? Qt.ArrowCursor : Qt.PointingHandCursor
        onClicked: item.activated()
        onEntered: item.hovered()
    }
}
