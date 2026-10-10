import Quickshell
import QtQuick
import QtQuick.Layouts
import qs.CustomTheme

// Themed replacement for QsMenuAnchor.
//
// QsMenuAnchor renders a real Qt Widgets QMenu (quickshell runs with
// `//@ pragma UseQApplication`), which uses the light Fusion palette and square
// corners and therefore looks out of place next to the rest of the shell.
// QsMenuOpener exposes the same DBus menu entries so we can draw them with our
// own dark, rounded styling instead.
//
// One level of submenu is rendered as a side popup. Deeper nesting is not
// rendered (tray menus in practice only use one level) which keeps this
// component from having to instantiate itself, something QML rejects.
PopupWindow {
    id: root

    // The SystemTrayItem's `.menu` to render.
    required property var menuHandle

    // Row whose submenu is currently open, or -1.
    property int activeIndex: -1

    // Emitted when an action was chosen.
    signal dismissed()

    QsMenuOpener {
        id: opener
        menu: root.menuHandle
    }

    color: "transparent"
    implicitWidth: Math.max(190, column.implicitWidth + 16)
    implicitHeight: column.implicitHeight + 16
    grabFocus: true

    // Forget the open submenu whenever the menu closes, including dismissals
    // done by the compositor on an outside click.
    onVisibleChanged: if (!visible) root.activeIndex = -1

    TrayMenuBackground {
        anchors.fill: parent
    }

    ColumnLayout {
        id: column
        anchors.fill: parent
        anchors.margins: 8
        spacing: 1

        Repeater {
            model: opener.children

            delegate: TrayMenuItem {
                id: topItem
                required property var modelData
                required property int index

                entry: topItem.modelData
                selected: root.activeIndex === topItem.index && !topItem.separator

                onHovered: root.activeIndex = (topItem.hasChildren && topItem.enabled) ? topItem.index : -1
                onActivated: {
                    if (topItem.hasChildren) {
                        root.activeIndex = root.activeIndex === topItem.index ? -1 : topItem.index
                    } else {
                        topItem.modelData.triggered()
                        root.dismissed()
                    }
                }

                // Side submenu, anchored to the right edge of this row and shown
                // only while this row is the active one.
                PopupWindow {
                    id: submenu
                    visible: root.visible && root.activeIndex === topItem.index && topItem.hasChildren
                    anchor.item: topItem
                    anchor.edges: Edges.Right
                    anchor.gravity: Edges.Right
                    anchor.margins.left: 4
                    color: "transparent"
                    grabFocus: true
                    implicitWidth: Math.max(170, subColumn.implicitWidth + 16)
                    implicitHeight: subColumn.implicitHeight + 16

                    QsMenuOpener {
                        id: subOpener
                        menu: topItem.modelData
                    }

                    TrayMenuBackground {
                        anchors.fill: parent
                    }

                    ColumnLayout {
                        id: subColumn
                        anchors.fill: parent
                        anchors.margins: 8
                        spacing: 1

                        Repeater {
                            model: subOpener.children

                            delegate: TrayMenuItem {
                                id: subItem
                                required property var modelData

                                entry: subItem.modelData
                                onActivated: {
                                    subItem.modelData.triggered()
                                    root.dismissed()
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
