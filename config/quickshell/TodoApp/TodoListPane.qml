import Quickshell
import Quickshell.Io
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls
import qs.CustomTheme

// Lightweight todo checklist, independent from the sidebar's dated schedule.
// Data: ~/.local/share/quickshell/todo-list.json  ->  [{ uid, text, done }]
Item {
    id: root

    readonly property string dataDir: Quickshell.env("HOME") + "/.local/share/quickshell"
    readonly property string filePath: dataDir + "/todo-list.json"

    ListModel { id: model }
    property int pending: 0

    Component.onCompleted: Quickshell.execDetached(["mkdir", "-p", root.dataDir])

    FileView {
        id: file
        path: root.filePath
        blockLoading: true
        watchChanges: true
        printErrors: false
        onLoaded: root.load()
        onFileChanged: file.reload()
    }

    // ---------------- data ----------------
    function load() {
        var arr = []
        try { arr = JSON.parse(file.text()) } catch (e) { arr = [] }
        if (!Array.isArray(arr))
            arr = []
        model.clear()
        for (var i = 0; i < arr.length; i++) {
            var t = arr[i]
            if (!t || typeof t.text !== "string")
                continue
            model.append({ uid: t.uid || makeUid(), text: t.text, done: !!t.done })
        }
        recount()
    }

    function makeUid() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
    }

    function save() {
        var arr = []
        for (var i = 0; i < model.count; i++) {
            var o = model.get(i)
            arr.push({ uid: o.uid, text: o.text, done: o.done })
        }
        file.setText(JSON.stringify(arr, null, 2) + "\n")
        recount()
    }

    function recount() {
        var n = 0
        for (var i = 0; i < model.count; i++)
            if (!model.get(i).done)
                n++
        root.pending = n
    }

    function add(text) {
        text = ("" + text).trim()
        if (text === "")
            return
        model.append({ uid: makeUid(), text: text, done: false })
        save()
    }

    function toggle(i) {
        if (i < 0 || i >= model.count)
            return
        model.setProperty(i, "done", !model.get(i).done)
        save()
    }

    function remove(i) {
        if (i < 0 || i >= model.count)
            return
        model.remove(i)
        save()
    }

    function focusInput() {
        input.forceActiveFocus()
    }

    // ---------------- ui ----------------
    ColumnLayout {
        anchors.fill: parent
        spacing: 14

        // input row
        Rectangle {
            Layout.fillWidth: true
            implicitHeight: 52
            radius: 12
            color: Qt.rgba(1, 1, 1, 0.06)
            border.width: 1
            border.color: input.activeFocus ? Theme.primary : Qt.rgba(1, 1, 1, 0.10)

            TextField {
                id: input
                anchors.fill: parent
                anchors.leftMargin: 16
                anchors.rightMargin: 96
                placeholderText: "添加待办，回车确认…"
                placeholderTextColor: Theme.on_surface_variant
                color: Theme.on_surface
                font.family: Theme.fontFamily
                font.pixelSize: 17
                background: Item {}
                verticalAlignment: TextInput.AlignVCenter
                onAccepted: {
                    root.add(text)
                    text = ""
                }
            }

            Rectangle {
                anchors.right: parent.right
                anchors.rightMargin: 10
                anchors.verticalCenter: parent.verticalCenter
                implicitWidth: 74
                implicitHeight: 36
                radius: 9
                color: addHover.hovered ? Theme.primary : Qt.rgba(1, 1, 1, 0.08)
                Text {
                    anchors.centerIn: parent
                    text: "添加"
                    color: addHover.hovered ? Theme.on_primary : Theme.on_surface
                    font.family: Theme.fontFamily
                    font.pixelSize: 16
                }
                HoverHandler { id: addHover }
                TapHandler {
                    cursorShape: Qt.PointingHandCursor
                    onTapped: {
                        root.add(input.text)
                        input.text = ""
                        input.forceActiveFocus()
                    }
                }
            }
        }

        RowLayout {
            Layout.fillWidth: true
            Text {
                text: "未完成 " + root.pending + " / 共 " + model.count
                color: Theme.on_surface_variant
                font.family: Theme.fontFamily
                font.pixelSize: 15
            }
            Item { Layout.fillWidth: true }
            Text {
                visible: model.count > 0
                text: "点击圆圈勾选 · 点 ✕ 删除"
                color: Theme.outline
                font.family: Theme.fontFamily
                font.pixelSize: 14
            }
        }

        // list
        ListView {
            id: list
            Layout.fillWidth: true
            Layout.fillHeight: true
            clip: true
            spacing: 10
            model: model
            boundsBehavior: Flickable.StopAtBounds
            ScrollBar.vertical: ScrollBar {}

            delegate: Rectangle {
                id: row
                required property int index
                required property string uid
                required property string text
                required property bool done
                width: list.width
                implicitHeight: 58
                radius: 12
                color: rowHover.hovered ? Qt.rgba(1, 1, 1, 0.09) : Qt.rgba(1, 1, 1, 0.04)
                border.width: 1
                border.color: Qt.rgba(1, 1, 1, 0.06)
                Behavior on color { ColorAnimation { duration: 120 } }

                HoverHandler { id: rowHover }

                RowLayout {
                    anchors.fill: parent
                    anchors.leftMargin: 14
                    anchors.rightMargin: 10
                    spacing: 14

                    // checkbox
                    Rectangle {
                        implicitWidth: 26
                        implicitHeight: 26
                        radius: 7
                        color: row.done ? Theme.primary : "transparent"
                        border.width: 1.5
                        border.color: row.done ? Theme.primary : Theme.outline
                        Text {
                            anchors.centerIn: parent
                            text: "✓"
                            visible: row.done
                            color: Theme.on_primary
                            font.pixelSize: 16
                            font.bold: true
                        }
                        HoverHandler { id: checkHover }
                        TapHandler {
                            cursorShape: Qt.PointingHandCursor
                            onTapped: root.toggle(row.index)
                        }
                    }

                    Text {
                        Layout.fillWidth: true
                        text: row.text
                        color: row.done ? Theme.on_surface_variant : Theme.on_surface
                        font.family: Theme.fontFamily
                        font.pixelSize: 17
                        font.strikeout: row.done
                        elide: Text.ElideRight
                        verticalAlignment: Text.AlignVCenter
                    }

                    // delete
                    Rectangle {
                        implicitWidth: 36
                        implicitHeight: 36
                        radius: 9
                        color: delHover.hovered
                            ? Qt.rgba(Theme.error.r, Theme.error.g, Theme.error.b, 0.18)
                            : "transparent"
                        Text {
                            anchors.centerIn: parent
                            text: "✕"
                            color: delHover.hovered ? Theme.error : Theme.on_surface_variant
                            font.pixelSize: 17
                        }
                        HoverHandler { id: delHover }
                        TapHandler {
                            cursorShape: Qt.PointingHandCursor
                            onTapped: root.remove(row.index)
                        }
                    }
                }
            }
        }

        // empty state
        Item {
            Layout.fillWidth: true
            Layout.fillHeight: true
            visible: model.count === 0
            Text {
                anchors.centerIn: parent
                text: "还没有待办，在上面输入一条吧"
                color: Theme.outline
                font.family: Theme.fontFamily
                font.pixelSize: 15
            }
        }
    }
}
