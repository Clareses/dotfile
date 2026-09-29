import Quickshell
import Quickshell.Io
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls
import qs.CustomTheme

// Colorful sticky-note board stored as free-positioned cards.
// Data: ~/.local/share/quickshell/sticky-notes.json
//   [{ uid, text, color, x, y }]   (x/y are pixels inside the board)
Item {
    id: root

    readonly property string dataDir: Quickshell.env("HOME") + "/.local/share/quickshell"
    readonly property string filePath: dataDir + "/sticky-notes.json"

    readonly property int noteW: 230
    readonly property int noteH: 195

    readonly property var palette: [
        "#f9e2af", // yellow
        "#a6e3a1", // green
        "#89b4fa", // blue
        "#f5c2e7", // pink
        "#fab387", // peach
        "#cba6f7"  // mauve
    ]
    readonly property color noteInk: "#1e1e2e"

    ListModel { id: model }

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

    Timer {
        id: saveTimer
        interval: 400
        repeat: false
        onTriggered: root.save()
    }

    // ---------------- data ----------------
    function makeUid() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
    }

    function load() {
        var arr = []
        try { arr = JSON.parse(file.text()) } catch (e) { arr = [] }
        if (!Array.isArray(arr))
            arr = []
        model.clear()
        for (var i = 0; i < arr.length; i++) {
            var n = arr[i]
            if (!n || typeof n.text !== "string")
                continue
            model.append({
                uid: n.uid || makeUid(),
                text: n.text,
                noteColor: (typeof n.color === "string" && n.color !== "") ? n.color : root.palette[i % root.palette.length],
                noteX: (typeof n.x === "number") ? n.x : 20,
                noteY: (typeof n.y === "number") ? n.y : 20
            })
        }
    }

    function save() {
        var arr = []
        for (var i = 0; i < model.count; i++) {
            var o = model.get(i)
            arr.push({ uid: o.uid, text: o.text, color: o.noteColor, x: Math.round(o.noteX), y: Math.round(o.noteY) })
        }
        file.setText(JSON.stringify(arr, null, 2) + "\n")
    }

    function scheduleSave() {
        saveTimer.restart()
    }

    function addNote() {
        var n = model.count
        var x = 20 + (n % 3) * (root.noteW + 16)
        var y = 20 + Math.floor(n / 3) * (root.noteH + 16)
        model.append({
            uid: makeUid(),
            text: "",
            noteColor: root.palette[n % root.palette.length],
            noteX: Math.round(Math.min(x, Math.max(20, board.width - root.noteW - 20))),
            noteY: Math.round(Math.min(y, Math.max(20, board.height - root.noteH - 20)))
        })
        scheduleSave()
    }

    function removeNote(i) {
        if (i < 0 || i >= model.count)
            return
        model.remove(i)
        scheduleSave()
    }

    function setColor(i, c) {
        if (i < 0 || i >= model.count)
            return
        model.setProperty(i, "noteColor", c)
        scheduleSave()
    }

    function focusInput() {
        board.forceActiveFocus()
    }

    // ---------------- ui ----------------
    ColumnLayout {
        anchors.fill: parent
        spacing: 14

        RowLayout {
            Layout.fillWidth: true
            spacing: 12

            Rectangle {
                implicitWidth: 132
                implicitHeight: 38
                radius: 10
                color: newHover.hovered ? Theme.primary : Qt.rgba(1, 1, 1, 0.08)
                Text {
                    anchors.centerIn: parent
                    text: "＋ 新建便签"
                    color: newHover.hovered ? Theme.on_primary : Theme.on_surface
                    font.family: Theme.fontFamily
                    font.pixelSize: 15
                }
                HoverHandler { id: newHover }
                TapHandler {
                    cursorShape: Qt.PointingHandCursor
                    onTapped: root.addNote()
                }
            }

            Item { Layout.fillWidth: true }

            Text {
                visible: model.count > 0
                text: "拖动顶部移动 · 点色点换色 · ✕ 删除"
                color: Theme.outline
                font.family: Theme.fontFamily
                font.pixelSize: 13
            }
        }

        // board
        Item {
            id: board
            Layout.fillWidth: true
            Layout.fillHeight: true
            clip: true
            focus: true

            Rectangle {
                anchors.fill: parent
                radius: 14
                color: Qt.rgba(1, 1, 1, 0.02)
                border.width: 1
                border.color: Qt.rgba(1, 1, 1, 0.05)
            }

            Repeater {
                model: model

                delegate: Rectangle {
                    id: note
                    required property int index
                    required property string uid
                    required property string text
                    required property string noteColor
                    required property real noteX
                    required property real noteY

                    width: root.noteW
                    height: root.noteH
                    x: Math.max(0, Math.min(note.noteX, board.width - width))
                    y: Math.max(0, Math.min(note.noteY, board.height - height))
                    radius: 12
                    color: note.noteColor
                    border.width: 1
                    border.color: Qt.rgba(0, 0, 0, 0.25)

                    // ---- drag handle ----
                    Rectangle {
                        id: handle
                        anchors { top: parent.top; left: parent.left; right: parent.right }
                        height: 34
                        radius: note.radius
                        color: Qt.rgba(0, 0, 0, 0.10)

                        Rectangle {
                            anchors { left: parent.left; right: parent.right; bottom: parent.bottom }
                            height: parent.radius
                            color: parent.color
                        }

                        Text {
                            anchors.left: parent.left
                            anchors.leftMargin: 12
                            anchors.verticalCenter: parent.verticalCenter
                            text: "☰"
                            color: root.noteInk
                            opacity: 0.5
                            font.pixelSize: 15
                        }

                        MouseArea {
                            id: dragArea
                            anchors.fill: parent
                            cursorShape: Qt.SizeAllCursor
                            drag.target: note
                            drag.axis: Drag.XAndYAxis
                            onReleased: {
                                model.setProperty(note.index, "noteX", Math.round(note.x))
                                model.setProperty(note.index, "noteY", Math.round(note.y))
                                root.scheduleSave()
                            }
                        }

                        // color dots (on top of the drag area)
                        Row {
                            anchors.right: parent.right
                            anchors.rightMargin: 36
                            anchors.verticalCenter: parent.verticalCenter
                            spacing: 5
                            Repeater {
                                model: root.palette
                                delegate: Rectangle {
                                    required property var modelData
                                    width: 15
                                    height: 15
                                    radius: 8
                                    color: modelData
                                    border.width: note.noteColor === modelData ? 2 : 1
                                    border.color: note.noteColor === modelData ? root.noteInk : Qt.rgba(0, 0, 0, 0.35)
                                    HoverHandler { id: dotHover }
                                    TapHandler {
                                        cursorShape: Qt.PointingHandCursor
                                        onTapped: root.setColor(note.index, modelData)
                                    }
                                }
                            }
                        }

                        // delete
                        Rectangle {
                            anchors.right: parent.right
                            anchors.rightMargin: 8
                            anchors.verticalCenter: parent.verticalCenter
                            width: 22
                            height: 22
                            radius: 11
                            color: delNote.hovered ? Qt.rgba(0.8, 0.1, 0.1, 0.85) : Qt.rgba(0, 0, 0, 0.15)
                            Text {
                                anchors.centerIn: parent
                                text: "✕"
                                color: root.noteInk
                                font.pixelSize: 11
                            }
                            HoverHandler { id: delNote }
                            TapHandler {
                                cursorShape: Qt.PointingHandCursor
                                onTapped: root.removeNote(note.index)
                            }
                        }
                    }

                    // ---- body ----
                    TextEdit {
                        id: body
                        anchors {
                            top: handle.bottom
                            left: parent.left
                            right: parent.right
                            bottom: parent.bottom
                            margins: 12
                        }
                        wrapMode: TextEdit.Wrap
                        selectByMouse: true
                        color: root.noteInk
                        selectionColor: Qt.rgba(0, 0, 0, 0.20)
                        font.family: Theme.fontFamily
                        font.pixelSize: 15
                        textFormat: TextEdit.PlainText
                        Component.onCompleted: text = note.text
                        onTextChanged: {
                            if (model.get(note.index) && model.get(note.index).text !== body.text) {
                                model.setProperty(note.index, "text", body.text)
                                root.scheduleSave()
                            }
                        }
                    }

                    Text {
                        anchors { top: handle.bottom; left: parent.left; right: parent.right; margins: 12 }
                        text: "写点什么…"
                        visible: body.text.length === 0
                        color: root.noteInk
                        opacity: 0.35
                        font.family: Theme.fontFamily
                        font.pixelSize: 15
                    }
                }
            }

            Text {
                anchors.centerIn: parent
                visible: model.count === 0
                text: "点「＋ 新建便签」开始记录"
                color: Theme.outline
                font.family: Theme.fontFamily
                font.pixelSize: 15
            }
        }
    }
}
