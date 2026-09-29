import Quickshell
import Quickshell.Wayland
import Quickshell.Hyprland
import Quickshell.Io
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls
import QtQuick.Effects
import qs.CustomTheme

PanelWindow {
    id: root

    // --- WAYLAND CONFIGURATION ---
    WlrLayershell.layer: WlrLayer.Overlay
    exclusionMode: WlrLayershell.Ignore

    implicitWidth: 560
    color: "transparent"

    anchors {
        right: true
        top: true
        bottom: true
    }

    margins {
        top: 36
        bottom: 0
    }

    // --- CLICK OUTSIDE TO CLOSE ---
    HyprlandFocusGrab {
        windows: [root]
        active: root.isOpen
        onCleared: {
            if (root.isOpen)
                root.isOpen = false
        }
    }

    // NOTE: the Hyprland focus-change auto-collapse (Connections on
    // Hyprland.activeToplevelChanged / focusedWorkspaceChanged) is temporarily
    // disabled while debugging the sidebar IME — it can close the panel mid-
    // composition. Re-add once the IME path is confirmed.

    // Opening the sidebar focuses the field before the compositor has actually
    // activated the layer surface, so fcitx5's Qt plugin sends its FocusIn too
    // early and the IME stays inactive until you focus away and back. After the
    // focus grab settles, cycle the focus once so the plugin re-sends FocusIn.
    Item {
        id: focusAnchor
        width: 1
        height: 1
    }
    Timer {
        id: refocusTimer
        interval: 200
        repeat: false
        onTriggered: {
            if (!root.isOpen)
                return
            focusAnchor.forceActiveFocus()
            Qt.callLater(function () {
                if (root.isOpen)
                    todoInput.forceActiveFocus()
            })
        }
    }

    // --- ESCAPE KEY LISTENER ---
    Shortcut {
        sequence: "Escape"
        onActivated: {
            if (root.isOpen)
                root.isOpen = false
        }
    }

    // --- ANIMATION (slide in from the right) ---
    property bool isOpen: false
    visible: isOpen || slideAnim.running
    margins { right: root.currentMargin }
    property real currentMargin: isOpen ? 0 : -(root.implicitWidth + 50)

    Behavior on currentMargin {
        NumberAnimation {
            id: slideAnim
            duration: 350
            easing.type: Easing.OutQuint
        }
    }

    IpcHandler {
        target: "sidebar"
        function toggle(): void { root.isOpen = !root.isOpen }
        function open(): void { root.isOpen = true }
        function close(): void { root.isOpen = false }
        function isOpen(): bool { return root.isOpen }
        function add(text: string, start: string, end: string): void { root.addTodo(text, start, end) }
        function listView(): void { root.listMode = true }
        function timelineView(): void { root.listMode = false }
        function pomodoro(): void { root.pomoToggle() }
        function pomodoroReset(): void { root.pomoReset() }
        function pomodoroState(): string { return root.pomoPhase + " " + root.pomoDisplay() + (root.pomoRunning ? " running" : " paused") }
        function selectDay(key: string): void { root.selectedKey = key }
    }

    // ==================================================================
    // SCHEDULE DATA
    // Stored as a JSON array in ~/.config/ml4w/settings/todos.json
    //   [{ "uid": "...", "text": "...", "date": "YYYY-MM-DD",
    //      "start": "HH:MM", "end": "HH:MM", "done": false }]
    // start/end may be empty -> shown in the "unscheduled" list.
    // ==================================================================
    property var marked: ({})
    property string selectedKey: ""
    property string todayKey: ""
    property var nowDate: new Date()
    property var remindedKeys: ({})
    property bool listMode: true

    // --- panel theme (mirrors the swaync control-center) ---
    readonly property color panelColor: Qt.rgba(0, 0, 0, 0.75)
    readonly property color cardColor: "#000000"
    readonly property color fieldColor: Qt.rgba(1, 1, 1, 0.06)
    readonly property color hairline: Qt.rgba(1, 1, 1, 0.10)

    // --- pomodoro ---
    readonly property int pomoFocus: 25 * 60
    readonly property int pomoShort: 5 * 60
    readonly property int pomoLong: 15 * 60
    property string pomoPhase: "focus"
    property int pomoRemaining: 25 * 60
    property bool pomoRunning: false
    property int pomoCount: 0
    // keep cycling focus -> rest -> focus without a manual start
    property bool pomoAutoContinue: true

    // timeline metrics
    readonly property int hourHeight: 46
    readonly property int axisW: 44
    readonly property int minBlockH: 26

    ListModel { id: todos }         // all todos
    ListModel { id: timedTodos }    // selected day, has a start time
    ListModel { id: untimedTodos }  // selected day, no time
    ListModel { id: dayList }       // selected day, list form (all items)

    // writer + external-change watcher
    FileView {
        id: todosFile
        path: Quickshell.env("HOME") + "/.config/ml4w/settings/todos.json"
        watchChanges: true
        onFileChanged: root.loadTodos()
        onLoaded: root.loadTodos()
    }

    // reader: always cat fresh from disk (FileView's cached text can go stale)
    Process {
        id: readProc
        command: ["cat", Quickshell.env("HOME") + "/.config/ml4w/settings/todos.json"]
        stdout: StdioCollector {
            onStreamFinished: root.applyTodos(this.text)
        }
    }

    // --- POMODORO TICK ---
    Timer {
        id: pomoTimer
        interval: 1000
        repeat: true
        running: root.pomoRunning
        onTriggered: {
            if (root.pomoRemaining > 0) {
                root.pomoRemaining = root.pomoRemaining - 1
                if (root.pomoRemaining === 0)
                    root.pomoComplete()
            }
        }
    }

    // --- REMINDER TICKER (every 30s) ---
    Timer {
        interval: 30000
        running: true
        repeat: true
        triggeredOnStart: true
        onTriggered: {
            root.nowDate = new Date()
            var t = root.ymd(root.nowDate)
            if (t !== root.todayKey) {
                if (root.selectedKey === root.todayKey || root.selectedKey === "")
                    root.selectedKey = t
                root.todayKey = t
                root.updateCalendar(root.currentYear, root.currentMonth)
            }
            root.checkReminders()
        }
    }


    // ==================================================================
    // HELPERS
    // ==================================================================
    function pad2(n) { return (n < 10 ? "0" : "") + n }
    function ymd(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) }
    function makeUid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7) }

    // normalize "9:5", "0905", "9:05" ... -> "09:05" ; invalid -> ""
    function normTime(s) {
        if (s === undefined || s === null)
            return ""
        s = ("" + s).trim()
        if (s === "")
            return ""
        var m = s.match(/^(\d{1,2})[:：.．]?(\d{2})$/)
        if (!m)
            return ""
        var h = parseInt(m[1])
        var mi = parseInt(m[2])
        if (h > 23 || mi > 59)
            return ""
        return pad2(h) + ":" + pad2(mi)
    }

    function toMin(t) {
        var n = normTime(t)
        if (n === "")
            return -1
        var p = n.split(":")
        return parseInt(p[0]) * 60 + parseInt(p[1])
    }

    function minToStr(m) {
        m = Math.max(0, Math.min(1439, Math.round(m)))
        return pad2(Math.floor(m / 60)) + ":" + pad2(m % 60)
    }

    function bumpTime(input, delta) {
        if (!input)
            return
        var cur = toMin(input.text)
        if (cur < 0)
            cur = 0
        input.text = minToStr(cur + delta)
    }

    // fill the add row for a click on the timeline; snap to 15 min, default 1h
    function createAt(min) {
        min = Math.max(0, Math.min(1425, Math.round(min / 15) * 15))
        startInput.text = minToStr(min)
        endInput.text = minToStr(min + 60)
        todoInput.forceActiveFocus()
    }

    // move an event by deltaMin (drag on the timeline)
    function moveTodo(uid, deltaMin) {
        for (var i = 0; i < todos.count; i++) {
            if (todos.get(i).uid !== uid)
                continue
            var s = toMin(todos.get(i).start)
            if (s < 0)
                return
            var e = toMin(todos.get(i).end)
            if (e <= s)
                e = s + 30
            var dur = e - s
            var ns = Math.max(0, Math.min(1440 - dur, s + deltaMin))
            todos.setProperty(i, "start", minToStr(ns))
            todos.setProperty(i, "end", minToStr(ns + dur))
            break
        }
        layoutDay()
        saveTodos()
    }

    // resize an event's end (drag its bottom edge)
    function setTodoEnd(uid, newEndMin) {
        for (var i = 0; i < todos.count; i++) {
            if (todos.get(i).uid !== uid)
                continue
            var s = toMin(todos.get(i).start)
            if (s < 0)
                return
            var ne = Math.max(s + 15, Math.min(1439, Math.round(newEndMin)))
            todos.setProperty(i, "end", minToStr(ne))
            break
        }
        layoutDay()
        saveTodos()
    }

    // ---- pomodoro ----
    function pomoPhaseLen() {
        return pomoPhase === "focus" ? pomoFocus : (pomoPhase === "long" ? pomoLong : pomoShort)
    }
    function pomoDisplay() {
        return pad2(Math.floor(pomoRemaining / 60)) + ":" + pad2(pomoRemaining % 60)
    }
    function pomoPhaseName() {
        return pomoPhase === "focus" ? "专注" : (pomoPhase === "long" ? "长休息" : "短休息")
    }
    function pomoToggle() {
        pomoRunning = !pomoRunning
    }
    function pomoReset() {
        pomoRunning = false
        pomoRemaining = pomoPhaseLen()
    }
    function pomoSetPhase(p) {
        pomoPhase = p
        pomoRemaining = pomoPhaseLen()
    }
    function pomoComplete() {
        if (pomoPhase === "focus") {
            pomoCount = pomoCount + 1
            pomoSetPhase(pomoCount % 4 === 0 ? "long" : "short")
            Quickshell.execDetached(["notify-send", "-a", "番茄钟", "-u", "normal", "-i", "alarm-clock",
                                     "专注结束 🍅", "休息 " + Math.round(pomoPhaseLen() / 60) + " 分钟"])
        } else {
            pomoSetPhase("focus")
            Quickshell.execDetached(["notify-send", "-a", "番茄钟", "-u", "normal", "-i", "alarm-clock",
                                     "休息结束", "开始新的专注 25 分钟"])
        }
        // Previously the phase was changed but the timer was left stopped,
        // so the cycle died after every phase. Auto-start the next phase.
        pomoRunning = root.pomoAutoContinue
    }

    function formatKey(k) {
        var p = k.split("-")
        if (p.length !== 3)
            return k
        var d = new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]))
        var wd = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][d.getDay()]
        return (d.getMonth() + 1) + "月" + d.getDate() + "日 " + wd
    }

    // ==================================================================
    // DATA LOAD / SAVE
    // ==================================================================
    function loadTodos() {
        readProc.running = false
        readProc.running = true
    }

    function applyTodos(raw) {
        var arr = []
        try { arr = JSON.parse(raw) } catch (e) { arr = [] }
        if (!Array.isArray(arr))
            arr = []
        todos.clear()
        for (var i = 0; i < arr.length; i++) {
            var t = arr[i]
            if (!t || typeof t.text !== "string")
                continue
            todos.append({
                uid: t.uid || makeUid(),
                text: t.text,
                date: t.date || root.selectedKey,
                start: normTime(t.start || t.time || ""),
                end: normTime(t.end || ""),
                done: !!t.done
            })
        }
        rebuildMarked()
        layoutDay()
        Qt.callLater(root.scrollToNow)
    }

    function saveTodos() {
        var arr = []
        for (var i = 0; i < todos.count; i++) {
            var o = todos.get(i)
            arr.push({ uid: o.uid, text: o.text, date: o.date, start: o.start, end: o.end, done: o.done })
        }
        todosFile.setText(JSON.stringify(arr, null, 2))
    }

    function rebuildMarked() {
        var m = ({})
        for (var i = 0; i < todos.count; i++)
            m[todos.get(i).date] = true
        marked = m
    }

    // ==================================================================
    // LAYOUT: split selected day into timed (blocks) + untimed, assign lanes
    // ==================================================================
    function layoutDay() {
        var unt = []
        var timed = []
        for (var i = 0; i < todos.count; i++) {
            var o = todos.get(i)
            if (o.date !== root.selectedKey)
                continue
            var s = toMin(o.start)
            if (s < 0) {
                unt.push({ uid: o.uid, text: o.text, done: o.done, start: "", end: "" })
            } else {
                var e = toMin(o.end)
                if (e <= s)
                    e = Math.min(s + 30, 1440)
                timed.push({
                    uid: o.uid, text: o.text, done: o.done,
                    start: normTime(o.start), end: minToStr(e),
                    s: s, e: e
                })
            }
        }

        unt.sort(function (a, b) { return (a.done ? 1 : 0) - (b.done ? 1 : 0) })
        untimedTodos.clear()
        for (i = 0; i < unt.length; i++)
            untimedTodos.append(unt[i])

        timed.sort(function (a, b) { return a.s - b.s || a.e - b.e })

        // split into clusters of transitively-overlapping events
        var clusters = []
        var cur = null
        for (i = 0; i < timed.length; i++) {
            var t = timed[i]
            if (cur === null || t.s >= cur.maxEnd) {
                cur = { ev: [t], maxEnd: t.e }
                clusters.push(cur)
            } else {
                cur.ev.push(t)
                if (t.e > cur.maxEnd)
                    cur.maxEnd = t.e
            }
        }

        timedTodos.clear()
        for (var c = 0; c < clusters.length; c++) {
            var evs = clusters[c].ev
            var laneEnds = []
            for (var j = 0; j < evs.length; j++) {
                var ev = evs[j]
                var placed = false
                for (var l = 0; l < laneEnds.length; l++) {
                    if (laneEnds[l] <= ev.s) {
                        ev.lane = l
                        laneEnds[l] = ev.e
                        placed = true
                        break
                    }
                }
                if (!placed) {
                    ev.lane = laneEnds.length
                    laneEnds.push(ev.e)
                }
            }
            var n = laneEnds.length
            for (j = 0; j < evs.length; j++) {
                var e2 = evs[j]
                timedTodos.append({
                    uid: e2.uid,
                    text: e2.text,
                    start: e2.start,
                    end: e2.end,
                    done: e2.done,
                    by: e2.s / 60 * root.hourHeight,
                    bh: Math.max(root.minBlockH, (e2.e - e2.s) / 60 * root.hourHeight),
                    lane: e2.lane,
                    lanes: n
                })
            }
        }

        // unified list form: timed by start time, untimed afterwards
        dayList.clear()
        for (i = 0; i < timed.length; i++) {
            var lt = timed[i]
            dayList.append({
                uid: lt.uid, text: lt.text, done: lt.done, timed: true,
                timeText: lt.start + (lt.end !== "" ? " – " + lt.end : "")
            })
        }
        for (i = 0; i < unt.length; i++) {
            var lu = unt[i]
            dayList.append({
                uid: lu.uid, text: lu.text, done: lu.done, timed: false,
                timeText: "未排"
            })
        }
    }

    // ==================================================================
    // MUTATIONS
    // ==================================================================
    function addTodo(text, start, end) {
        text = (text !== undefined && text !== null ? "" + text : todoInput.text).trim()
        if (text === "") {
            todoInput.forceActiveFocus()
            return
        }
        var s = normTime(start !== undefined && start !== null ? start : startInput.text)
        var e = normTime(end !== undefined && end !== null ? end : endInput.text)
        if (s === "") {
            e = ""
        } else if (e === "" || toMin(e) <= toMin(s)) {
            e = pad2(Math.min(23, parseInt(s.split(":")[0]) + 1)) + ":" + s.split(":")[1]
        }
        todos.append({ uid: makeUid(), text: text, date: root.selectedKey, start: s, end: e, done: false })
        todoInput.text = ""
        endInput.text = ""
        rebuildMarked()
        layoutDay()
        saveTodos()
        todoInput.forceActiveFocus()
    }

    function toggleTodo(uid) {
        for (var i = 0; i < todos.count; i++) {
            if (todos.get(i).uid === uid) {
                todos.setProperty(i, "done", !todos.get(i).done)
                break
            }
        }
        layoutDay()
        saveTodos()
    }

    function deleteTodo(uid) {
        for (var i = 0; i < todos.count; i++) {
            if (todos.get(i).uid === uid) {
                todos.remove(i)
                break
            }
        }
        rebuildMarked()
        layoutDay()
        saveTodos()
    }

    function checkReminders() {
        var now = root.nowDate
        var todayKey = ymd(now)
        var hhmm = pad2(now.getHours()) + ":" + pad2(now.getMinutes())
        for (var i = 0; i < todos.count; i++) {
            var o = todos.get(i)
            if (o.done || o.date !== todayKey || o.start === "" || o.start !== hhmm)
                continue
            var k = o.uid + "@" + todayKey + "@" + o.start
            if (root.remindedKeys[k])
                continue
            root.remindedKeys[k] = true
            var body = o.end !== "" ? (o.start + " – " + o.end) : o.start
            Quickshell.execDetached(["notify-send", "-a", "日程", "-u", "normal",
                                     "-i", "appointment-soon", o.text, body])
        }
    }

    // ==================================================================
    // CALENDAR
    // ==================================================================
    property var monthNames: ["January", "February", "March", "April", "May", "June",
                              "July", "August", "September", "October", "November", "December"]
    property var dayNames: ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]

    property int currentMonth: new Date().getMonth()
    property int currentYear: new Date().getFullYear()

    ListModel { id: dayModel }

    function updateCalendar(year, month) {
        dayModel.clear()
        var first = new Date(year, month, 1)
        var startCell = (first.getDay() + 6) % 7 // Monday = 0
        for (var i = 0; i < 42; i++) {
            var d = new Date(year, month, 1 - startCell + i)
            var key = ymd(d)
            dayModel.append({
                day: d.getDate(),
                isCurrentMonth: (d.getMonth() === month && d.getFullYear() === year),
                isToday: (key === root.todayKey),
                key: key
            })
        }
    }

    function prevMonth() {
        if (currentMonth === 0) { currentMonth = 11; currentYear-- }
        else currentMonth--
        updateCalendar(currentYear, currentMonth)
    }

    function nextMonth() {
        if (currentMonth === 11) { currentMonth = 0; currentYear++ }
        else currentMonth++
        updateCalendar(currentYear, currentMonth)
    }

    function goToday() {
        var now = new Date()
        currentMonth = now.getMonth()
        currentYear = now.getFullYear()
        root.selectedKey = ymd(now)
        updateCalendar(currentYear, currentMonth)
    }

    onIsOpenChanged: {
        if (isOpen) {
            root.nowDate = new Date()
            loadTodos()
            Qt.callLater(function () {
                todoInput.forceActiveFocus()
                root.scrollToNow()
            })
            // Nudge the input-method focus once the compositor focus settles.
            refocusTimer.restart()
        }
    }

    onSelectedKeyChanged: {
        layoutDay()
        root.scrollToNow()
    }

    function scrollToNow() {
        // prefer showing the first scheduled block; else center on now for today
        var firstS = -1
        for (var i = 0; i < timedTodos.count; i++) {
            var s = toMin(timedTodos.get(i).start)
            if (s >= 0 && (firstS < 0 || s < firstS))
                firstS = s
        }
        var target = 0
        if (firstS >= 0)
            target = firstS / 60 * root.hourHeight - 12
        else if (root.selectedKey === root.todayKey)
            target = (root.nowDate.getHours() * 60 + root.nowDate.getMinutes()) / 60 * root.hourHeight - tlFlick.height / 2
        tlFlick.contentY = Math.max(0, Math.min(tlFlick.contentHeight - tlFlick.height, target))
    }

    Component.onCompleted: {
        var now = new Date()
        root.todayKey = ymd(now)
        root.selectedKey = ymd(now)
        updateCalendar(currentYear, currentMonth)
        loadTodos()
    }

    // ==================================================================
    // UI
    // ==================================================================
    component IconButton: Rectangle {
        id: ib
        property string glyph: ""
        signal clicked()
        implicitWidth: 30
        implicitHeight: 30
        radius: 7
        color: ibArea.containsMouse ? Theme.primary_container : "transparent"
        Text {
            anchors.centerIn: parent
            text: ib.glyph
            color: Theme.primary
            font.pixelSize: 20
            font.family: Theme.fontFamily
        }
        MouseArea {
            id: ibArea
            anchors.fill: parent
            hoverEnabled: true
            onClicked: ib.clicked()
        }
    }
    Item {
        anchors.fill: parent
        anchors.margins: 20

        Rectangle {
            id: mainBgRect
            anchors.fill: parent
            radius: 14
            color: root.panelColor
            border.width: 1
            border.color: Qt.rgba(1, 1, 1, 0.06)
        }

        ColumnLayout {
            anchors.fill: parent
            anchors.margins: 20
            spacing: 10

            // --- POMODORO ---
            Rectangle {
                Layout.fillWidth: true
                implicitHeight: 58
                radius: 12
                color: root.cardColor
                border.color: root.hairline
                border.width: 1
                clip: true

                WheelHandler {
                    onWheel: function (event) {
                        root.pomoRemaining = Math.max(0, Math.min(99 * 60, root.pomoRemaining + (event.angleDelta.y > 0 ? 60 : -60)))
                        event.accepted = true
                    }
                }

                Rectangle {
                    anchors.left: parent.left
                    anchors.bottom: parent.bottom
                    height: 4
                    width: parent.width * Math.max(0, Math.min(1, (root.pomoPhaseLen() - root.pomoRemaining) / root.pomoPhaseLen()))
                    color: root.pomoPhase === "focus" ? Theme.primary : Theme.secondary
                    Behavior on width { NumberAnimation { duration: 250 } }
                }

                RowLayout {
                    anchors.fill: parent
                    anchors.leftMargin: 14
                    anchors.rightMargin: 8
                    anchors.topMargin: 4
                    anchors.bottomMargin: 6
                    spacing: 10

                    ColumnLayout {
                        spacing: -2
                        Text {
                            text: root.pomoPhaseName()
                            color: root.pomoPhase === "focus" ? Theme.primary : Theme.secondary
                            font.family: Theme.fontFamily
                            font.pixelSize: 13
                            font.bold: true
                        }
                        Text {
                            text: root.pomoDisplay()
                            color: Theme.on_surface
                            font.family: Theme.fontFamily
                            font.pixelSize: 26
                            font.bold: true
                        }
                    }

                    Item { Layout.fillWidth: true }

                    Rectangle {
                        implicitWidth: 44
                        implicitHeight: 38
                        Layout.alignment: Qt.AlignVCenter
                        radius: 9
                        color: root.pomoRunning
                               ? (pomoPlayArea.containsMouse ? Theme.error : Theme.error_container)
                               : (pomoPlayArea.containsMouse ? Theme.inverse_primary : Theme.primary)
                        Text {
                            anchors.centerIn: parent
                            text: root.pomoRunning ? "\uF04C" : "\uF04B"
                            color: root.pomoRunning ? Theme.on_error_container : Theme.on_primary
                            font.family: Theme.fontFamily
                            font.pixelSize: 16
                        }
                        MouseArea { id: pomoPlayArea; anchors.fill: parent; hoverEnabled: true; onClicked: root.pomoToggle() }
                    }

                    Rectangle {
                        implicitWidth: 44
                        implicitHeight: 38
                        Layout.alignment: Qt.AlignVCenter
                        radius: 9
                        color: pomoResetArea.containsMouse ? root.hairline : root.fieldColor
                        border.color: root.hairline
                        border.width: 1
                        Text {
                            anchors.centerIn: parent
                            text: "\uF01E"
                            color: Theme.on_surface_variant
                            font.family: Theme.fontFamily
                            font.pixelSize: 16
                        }
                        MouseArea { id: pomoResetArea; anchors.fill: parent; hoverEnabled: true; onClicked: root.pomoReset() }
                    }
                }
            }

            // --- MONTH HEADER ---
            Item {
                Layout.fillWidth: true
                Layout.preferredHeight: 32

                RowLayout {
                    anchors.centerIn: parent
                    spacing: 6
                    IconButton {
                        glyph: "\u2039"
                        onClicked: root.prevMonth()
                    }
                    Text {
                        Layout.preferredWidth: 150
                        text: root.monthNames[root.currentMonth] + " " + root.currentYear
                        color: Theme.primary
                        font.family: Theme.fontFamily
                        font.pixelSize: 19
                        font.bold: true
                        horizontalAlignment: Text.AlignHCenter
                    }
                    IconButton {
                        glyph: "\u203A"
                        onClicked: root.nextMonth()
                    }
                }

                Rectangle {
                    anchors.right: parent.right
                    anchors.verticalCenter: parent.verticalCenter
                    implicitWidth: todayTxt.implicitWidth + 18
                    implicitHeight: 26
                    radius: 7
                    color: todayArea.containsMouse ? Theme.primary_container : "transparent"
                    border.color: Theme.primary
                    border.width: 1
                    opacity: (root.currentMonth !== new Date().getMonth() || root.currentYear !== new Date().getFullYear()) ? 1.0 : 0.0
                    enabled: opacity > 0
                    Behavior on opacity { NumberAnimation { duration: 200 } }
                    Text {
                        id: todayTxt
                        anchors.centerIn: parent
                        text: "今天"
                        color: Theme.primary
                        font.family: Theme.fontFamily
                        font.pixelSize: 14
                    }
                    MouseArea {
                        id: todayArea
                        anchors.fill: parent
                        hoverEnabled: true
                        onClicked: root.goToday()
                    }
                }
            }

            Rectangle { Layout.fillWidth: true; implicitHeight: 1; color: Theme.primary; opacity: 0.3 }

            // --- WEEKDAY ROW ---
            Row {
                Layout.alignment: Qt.AlignHCenter
                spacing: 0
                Repeater {
                    model: root.dayNames
                    Text {
                        width: calGrid.cellW
                        height: 20
                        text: modelData
                        color: Theme.primary
                        font.family: Theme.fontFamily
                        font.pixelSize: 14
                        font.bold: true
                        horizontalAlignment: Text.AlignHCenter
                        verticalAlignment: Text.AlignVCenter
                    }
                }
            }

            // --- CALENDAR GRID ---
            Grid {
                id: calGrid
                Layout.alignment: Qt.AlignHCenter
                columns: 7
                property int cellW: 58
                property int cellH: 40
                Repeater {
                    model: dayModel
                    Rectangle {
                        id: cell
                        property var m: model
                        width: calGrid.cellW
                        height: calGrid.cellH
                        radius: 8
                        color: (m.key === root.selectedKey)
                               ? Theme.primary
                               : (cellArea.containsMouse ? Theme.primary_container : "transparent")
                        border.width: (m.isToday && m.key !== root.selectedKey) ? 1 : 0
                        border.color: Theme.primary

                        Text {
                            anchors.centerIn: parent
                            anchors.verticalCenterOffset: -2
                            text: cell.m.day
                            color: (cell.m.key === root.selectedKey)
                                   ? Theme.on_primary
                                   : (cell.m.isCurrentMonth ? Theme.on_surface : Theme.outline)
                            font.family: Theme.fontFamily
                            font.pixelSize: 14
                            font.bold: cell.m.isCurrentMonth
                        }

                        Rectangle {
                            visible: root.marked[cell.m.key] === true
                            width: 5
                            height: 5
                            radius: 3
                            anchors.horizontalCenter: parent.horizontalCenter
                            anchors.bottom: parent.bottom
                            anchors.bottomMargin: 3
                            color: (cell.m.key === root.selectedKey) ? Theme.on_primary : Theme.primary
                        }

                        MouseArea {
                            id: cellArea
                            anchors.fill: parent
                            hoverEnabled: true
                            onClicked: root.selectedKey = cell.m.key
                        }
                    }
                }
            }

            Rectangle { Layout.fillWidth: true; implicitHeight: 1; color: Theme.primary; opacity: 0.3 }

            // --- SELECTED DAY LABEL ---
            RowLayout {
                Layout.fillWidth: true
                spacing: 8

                Text {
                    Layout.fillWidth: true
                    text: root.formatKey(root.selectedKey)
                    color: Theme.on_surface
                    font.family: Theme.fontFamily
                    font.pixelSize: 16
                    font.bold: true
                }
            }

            // --- ADD ROW ---
            RowLayout {
                Layout.fillWidth: true
                spacing: 6

                // start: − field +
                RowLayout {
                    spacing: 2

                    Rectangle {
                        implicitWidth: 20
                        implicitHeight: 38
                        radius: 6
                        color: startMinus.containsMouse ? Theme.primary_container : root.fieldColor
                        border.color: root.hairline
                        border.width: 1
                        Text { anchors.centerIn: parent; text: "\u2212"; color: Theme.on_surface; font.pixelSize: 16 }
                        MouseArea { id: startMinus; anchors.fill: parent; hoverEnabled: true; onClicked: root.bumpTime(startInput, -15) }
                    }

                    Rectangle {
                        implicitWidth: 56
                        implicitHeight: 38
                        radius: 8
                        color: root.fieldColor
                        border.color: startInput.activeFocus ? Theme.primary : root.hairline
                        border.width: 1
                        TextInput {
                            id: startInput
                            WheelHandler {
                                onWheel: function (event) {
                                    root.bumpTime(startInput, event.angleDelta.y > 0 ? 15 : -15)
                                    event.accepted = true
                                }
                            }
                            anchors.fill: parent
                            anchors.leftMargin: 6
                            anchors.rightMargin: 6
                            horizontalAlignment: TextInput.AlignHCenter
                            verticalAlignment: TextInput.AlignVCenter
                            color: Theme.on_surface
                            selectionColor: Theme.primary
                            selectedTextColor: Theme.on_primary
                            font.family: Theme.fontFamily
                            font.pixelSize: 15
                            clip: true
                            onAccepted: todoInput.forceActiveFocus()
                            Text {
                                anchors.centerIn: parent
                                visible: startInput.text.length === 0 && !startInput.activeFocus
                                text: "开始"
                                color: Theme.outline
                                font.family: Theme.fontFamily
                                font.pixelSize: 14
                            }
                        }
                    }

                    Rectangle {
                        implicitWidth: 20
                        implicitHeight: 38
                        radius: 6
                        color: startPlus.containsMouse ? Theme.primary_container : root.fieldColor
                        border.color: root.hairline
                        border.width: 1
                        Text { anchors.centerIn: parent; text: "+"; color: Theme.on_surface; font.pixelSize: 16 }
                        MouseArea { id: startPlus; anchors.fill: parent; hoverEnabled: true; onClicked: root.bumpTime(startInput, 15) }
                    }
                }

                // end: − field +
                RowLayout {
                    spacing: 2

                    Rectangle {
                        implicitWidth: 20
                        implicitHeight: 38
                        radius: 6
                        color: endMinus.containsMouse ? Theme.primary_container : root.fieldColor
                        border.color: root.hairline
                        border.width: 1
                        Text { anchors.centerIn: parent; text: "\u2212"; color: Theme.on_surface; font.pixelSize: 16 }
                        MouseArea { id: endMinus; anchors.fill: parent; hoverEnabled: true; onClicked: root.bumpTime(endInput, -15) }
                    }

                    Rectangle {
                        implicitWidth: 56
                        implicitHeight: 38
                        radius: 8
                        color: root.fieldColor
                        border.color: endInput.activeFocus ? Theme.primary : root.hairline
                        border.width: 1
                        TextInput {
                            id: endInput
                            WheelHandler {
                                onWheel: function (event) {
                                    root.bumpTime(endInput, event.angleDelta.y > 0 ? 15 : -15)
                                    event.accepted = true
                                }
                            }
                            anchors.fill: parent
                            anchors.leftMargin: 6
                            anchors.rightMargin: 6
                            horizontalAlignment: TextInput.AlignHCenter
                            verticalAlignment: TextInput.AlignVCenter
                            color: Theme.on_surface
                            selectionColor: Theme.primary
                            selectedTextColor: Theme.on_primary
                            font.family: Theme.fontFamily
                            font.pixelSize: 15
                            clip: true
                            onAccepted: root.addTodo()
                            Text {
                                anchors.centerIn: parent
                                visible: endInput.text.length === 0 && !endInput.activeFocus
                                text: "结束"
                                color: Theme.outline
                                font.family: Theme.fontFamily
                                font.pixelSize: 14
                            }
                        }
                    }

                    Rectangle {
                        implicitWidth: 20
                        implicitHeight: 38
                        radius: 6
                        color: endPlus.containsMouse ? Theme.primary_container : root.fieldColor
                        border.color: root.hairline
                        border.width: 1
                        Text { anchors.centerIn: parent; text: "+"; color: Theme.on_surface; font.pixelSize: 16 }
                        MouseArea { id: endPlus; anchors.fill: parent; hoverEnabled: true; onClicked: root.bumpTime(endInput, 15) }
                    }
                }

                Rectangle {
                    Layout.fillWidth: true
                    implicitHeight: 38
                    radius: 8
                    color: root.fieldColor
                    border.color: todoInput.activeFocus ? Theme.primary : Theme.outline_variant
                    border.width: 1
                    TextInput {
                        id: todoInput
                        anchors.fill: parent
                        anchors.leftMargin: 8
                        anchors.rightMargin: 8
                        verticalAlignment: TextInput.AlignVCenter
                        color: Theme.on_surface
                        selectionColor: Theme.primary
                        selectedTextColor: Theme.on_primary
                        font.family: Theme.fontFamily
                        font.pixelSize: 15
                        clip: true
                        onAccepted: root.addTodo()
                        Text {
                            anchors.verticalCenter: parent.verticalCenter
                            visible: todoInput.text.length === 0 && !todoInput.activeFocus
                            text: "添加日程…"
                            color: Theme.outline
                            font.family: Theme.fontFamily
                            font.pixelSize: 15
                        }
                    }
                }

                Rectangle {
                    implicitWidth: 34
                    implicitHeight: 38
                    radius: 8
                    color: addArea.pressed ? Theme.primary_container : Theme.primary
                    Text {
                        anchors.centerIn: parent
                        text: "\uFF0B"
                        color: Theme.on_primary
                        font.pixelSize: 19
                    }
                    MouseArea {
                        id: addArea
                        anchors.fill: parent
                        onClicked: root.addTodo()
                    }
                }
            }

            // --- LIST VIEW ---
            ListView {
                id: dayListView
                Layout.fillWidth: true
                Layout.fillHeight: false
                Layout.preferredHeight: dayList.count === 0 ? 0 : Math.min(dayList.count * 52 + 6, 260)
                spacing: 6
                clip: true
                model: dayList

                ScrollBar.vertical: ScrollBar {
                    policy: ScrollBar.AsNeeded
                    interactive: true
                    contentItem: Rectangle { implicitWidth: 6; radius: 3; color: Theme.primary; opacity: parent.pressed ? 1.0 : (parent.active ? 0.8 : 0.4) }
                }

                delegate: Rectangle {
                    id: listCard
                    required property string uid
                    required property string text
                    required property bool done
                    required property bool timed
                    required property string timeText

                    width: dayListView.width
                    height: 46
                    radius: 8
                    color: root.cardColor
                    border.color: listHover.hovered ? Theme.primary : root.hairline
                    border.width: 1

                    HoverHandler { id: listHover }

                    RowLayout {
                        anchors.fill: parent
                        anchors.leftMargin: 10
                        anchors.rightMargin: 8
                        spacing: 10

                        Text {
                            Layout.preferredWidth: 112
                            text: listCard.timeText
                            color: listCard.timed ? Theme.primary : Theme.outline
                            font.family: Theme.fontFamily
                            font.pixelSize: 14
                            font.bold: listCard.timed
                            elide: Text.ElideRight
                        }

                        Rectangle {
                            implicitWidth: 20
                            implicitHeight: 20
                            radius: 5
                            color: listCard.done ? Theme.primary : "transparent"
                            border.color: Theme.primary
                            border.width: 1
                            Text {
                                anchors.centerIn: parent
                                visible: listCard.done
                                text: "\u2713"
                                color: Theme.on_primary
                                font.pixelSize: 15
                            }
                            MouseArea {
                                anchors.fill: parent
                                onClicked: root.toggleTodo(listCard.uid)
                            }
                        }

                        Text {
                            Layout.fillWidth: true
                            text: listCard.text
                            color: listCard.done ? Theme.outline : Theme.on_surface
                            font.family: Theme.fontFamily
                            font.pixelSize: 16
                            font.strikeout: listCard.done
                            elide: Text.ElideRight
                        }

                        Rectangle {
                            implicitWidth: 24
                            implicitHeight: 24
                            radius: 6
                            color: listDel.containsMouse ? Theme.error_container : "transparent"
                            Text {
                                anchors.centerIn: parent
                                text: "\u2715"
                                color: Theme.on_surface_variant
                                font.pixelSize: 14
                            }
                            MouseArea {
                                id: listDel
                                anchors.fill: parent
                                hoverEnabled: true
                                onClicked: root.deleteTodo(listCard.uid)
                            }
                        }
                    }
                }
            }

            Text {
                Layout.fillWidth: true
                Layout.preferredHeight: 40
                visible: dayList.count === 0
                text: "这一天还没有日程"
                color: Theme.outline
                font.family: Theme.fontFamily
                font.pixelSize: 15
                horizontalAlignment: Text.AlignHCenter
                topPadding: 20
            }

            // --- BOTTOM HALF: unscheduled + timeline ---
            ColumnLayout {
                id: bottomHalf
                Layout.fillWidth: true
                Layout.fillHeight: true
                spacing: 6

            // --- UNSCHEDULED (no time) ---
            Text {
                Layout.fillWidth: true
                visible: untimedTodos.count > 0
                text: "未排时间"
                color: Theme.outline
                font.family: Theme.fontFamily
                font.pixelSize: 13
            }

            ListView {
                Layout.fillWidth: true
                Layout.preferredHeight: untimedTodos.count > 0 ? Math.min(untimedTodos.count * 32 + 4, 128) : 0
                visible: untimedTodos.count > 0
                spacing: 4
                clip: true
                model: untimedTodos

                ScrollBar.vertical: ScrollBar {
                    policy: ScrollBar.AsNeeded
                    contentItem: Rectangle { implicitWidth: 5; radius: 3; color: Theme.primary; opacity: parent.active ? 0.7 : 0.3 }
                }

                delegate: Rectangle {
                    id: untCard
                    required property string uid
                    required property string text
                    required property bool done

                    width: parent ? parent.width : 0
                    height: 30
                    radius: 8
                    color: root.cardColor
                    border.color: root.hairline
                    border.width: 1

                    RowLayout {
                        anchors.fill: parent
                        anchors.leftMargin: 8
                        anchors.rightMargin: 6
                        spacing: 8

                        Rectangle {
                            implicitWidth: 15
                            implicitHeight: 15
                            radius: 4
                            color: untCard.done ? Theme.primary : "transparent"
                            border.color: Theme.primary
                            border.width: 1
                            Text {
                                anchors.centerIn: parent
                                visible: untCard.done
                                text: "\u2713"
                                color: Theme.on_primary
                                font.pixelSize: 12
                            }
                            MouseArea {
                                anchors.fill: parent
                                onClicked: root.toggleTodo(untCard.uid)
                            }
                        }

                        Text {
                            Layout.fillWidth: true
                            text: untCard.text
                            color: untCard.done ? Theme.outline : Theme.on_surface
                            font.family: Theme.fontFamily
                            font.pixelSize: 14
                            font.strikeout: untCard.done
                            elide: Text.ElideRight
                        }

                        Text {
                            text: "\u2715"
                            color: untDel.containsMouse ? Theme.error : Theme.outline
                            font.pixelSize: 13
                            MouseArea {
                                id: untDel
                                anchors.fill: parent
                                hoverEnabled: true
                                onClicked: root.deleteTodo(untCard.uid)
                            }
                        }
                    }
                }
            }

            // --- TIMELINE ---
            Item {
                Layout.fillWidth: true
                Layout.fillHeight: true

                Flickable {
                    id: tlFlick
                    anchors.fill: parent
                    contentWidth: width
                    contentHeight: 24 * root.hourHeight + 10
                    boundsBehavior: Flickable.StopAtBounds
                    clip: true

                    ScrollBar.vertical: ScrollBar {
                        policy: ScrollBar.AsNeeded
                        interactive: true
                        contentItem: Rectangle { implicitWidth: 6; radius: 3; color: Theme.primary; opacity: parent.pressed ? 1.0 : (parent.active ? 0.8 : 0.4) }
                    }

                    Item {
                        id: tlCanvas
                        width: tlFlick.width
                        height: tlFlick.contentHeight

                        // hour grid + labels
                        Repeater {
                            model: 24
                            Item {
                                width: tlCanvas.width
                                height: root.hourHeight
                                y: index * root.hourHeight

                                Rectangle {
                                    anchors.left: parent.left
                                    anchors.right: parent.right
                                    anchors.top: parent.top
                                    height: 1
                                    color: Theme.outline_variant
                                    opacity: 0.45
                                }
                                Rectangle {
                                    anchors.left: parent.left
                                    anchors.right: parent.right
                                    anchors.top: parent.top
                                    anchors.topMargin: root.hourHeight / 2
                                    height: 1
                                    color: Theme.outline_variant
                                    opacity: 0.18
                                }
                                Text {
                                    anchors.left: parent.left
                                    width: root.axisW - 8
                                    anchors.top: parent.top
                                    anchors.topMargin: 1
                                    horizontalAlignment: Text.AlignRight
                                    text: root.pad2(index) + ":00"
                                    color: Theme.outline
                                    font.family: Theme.fontFamily
                                    font.pixelSize: 12
                                }
                            }
                        }

                        // axis line
                        Rectangle {
                            x: root.axisW - 1
                            y: 0
                            width: 1
                            height: tlCanvas.height
                            color: Theme.outline_variant
                            opacity: 0.6
                        }

                        // now indicator
                        Rectangle {
                            visible: root.selectedKey === root.todayKey
                            x: root.axisW
                            width: tlCanvas.width - root.axisW
                            height: 2
                            color: Theme.error
                            y: (root.nowDate.getHours() * 60 + root.nowDate.getMinutes()) / 60 * root.hourHeight

                            Rectangle {
                                anchors.left: parent.left
                                anchors.verticalCenter: parent.verticalCenter
                                width: 6
                                height: 6
                                radius: 3
                                color: Theme.error
                            }
                        }

                        // click empty area to create an event at that time
                        MouseArea {
                            anchors.fill: parent
                            acceptedButtons: Qt.LeftButton
                            z: 0
                            onClicked: function (mouse) {
                                if (mouse.x < root.axisW)
                                    return
                                root.createAt((mouse.y / root.hourHeight) * 60)
                            }
                        }

                        // event blocks
                        Repeater {
                            model: timedTodos
                            Rectangle {
                                id: blk
                                required property string uid
                                required property string text
                                required property string start
                                required property string end
                                required property bool done
                                required property real by
                                required property real bh
                                required property int lane
                                required property int lanes

                                property real availW: Math.max(40, tlCanvas.width - root.axisW)
                                property real laneW: availW / Math.max(1, lanes)
                                property real dragOff: 0
                                property real resizeOff: 0

                                x: root.axisW + lane * laneW
                                y: by + dragOff
                                width: Math.max(30, laneW - 4)
                                height: Math.max(16, bh + resizeOff)
                                radius: 6
                                clip: true
                                z: (blkArea.dragging || blkResize.pressed) ? 10 : 1
                                color: done ? Theme.surface_container_high
                                             : ((blkArea.containsMouse || blkResize.containsMouse) ? Theme.inverse_primary : Theme.primary)
                                border.width: done ? 1 : 0
                                border.color: root.hairline

                                RowLayout {
                                    anchors.fill: parent
                                    anchors.leftMargin: 6
                                    anchors.rightMargin: 4
                                    anchors.topMargin: 1
                                    anchors.bottomMargin: 1
                                    spacing: 6

                                    Rectangle {
                                        implicitWidth: 13
                                        implicitHeight: 13
                                        radius: 4
                                        color: blk.done ? Theme.on_primary : "transparent"
                                        border.color: blk.done ? Theme.on_primary : Theme.on_primary
                                        border.width: 1
                                        Text {
                                            anchors.centerIn: parent
                                            visible: blk.done
                                            text: "\u2713"
                                            color: Theme.primary
                                            font.pixelSize: 11
                                        }
                                    }

                                    ColumnLayout {
                                        Layout.fillWidth: true
                                        spacing: 0

                                        Text {
                                            Layout.fillWidth: true
                                            text: blk.text
                                            color: blk.done ? Theme.outline : Theme.on_primary
                                            font.family: Theme.fontFamily
                                            font.pixelSize: blk.bh < 30 ? 13 : 14
                                            font.strikeout: blk.done
                                            elide: Text.ElideRight
                                        }
                                        Text {
                                            Layout.fillWidth: true
                                            visible: blk.bh >= 36 && blk.start !== ""
                                            text: blk.start + (blk.end !== "" ? " – " + blk.end : "")
                                            color: blk.done ? Theme.outline : Theme.on_primary
                                            opacity: 0.8
                                            font.family: Theme.fontFamily
                                            font.pixelSize: 12
                                            elide: Text.ElideRight
                                        }
                                    }
                                }

                                // move: drag the block body
                                MouseArea {
                                    id: blkArea
                                    anchors.fill: parent
                                    anchors.bottomMargin: 7
                                    hoverEnabled: true
                                    acceptedButtons: Qt.LeftButton | Qt.RightButton
                                    cursorShape: dragging ? Qt.ClosedHandCursor : Qt.OpenHandCursor
                                    // Keep the Flickable from stealing the press,
                                    // which would scroll the timeline instead of
                                    // moving the block.
                                    preventStealing: true

                                    property bool dragging: false
                                    property bool moved: false
                                    property real pressY: 0

                                    // Pointer position in the stationary timeline
                                    // canvas: blk moves underneath the cursor, so
                                    // local mouse coords alone would double-count
                                    // that movement.
                                    function contentY(mouse) {
                                        return blkArea.mapToItem(tlCanvas, mouse.x, mouse.y).y
                                    }

                                    onPressed: function (mouse) {
                                        pressY = contentY(mouse)
                                        moved = false
                                        dragging = true
                                    }
                                    onPositionChanged: function (mouse) {
                                        if (!pressed)
                                            return
                                        var dy = contentY(mouse) - pressY
                                        if (Math.abs(dy) > 4)
                                            moved = true
                                        if (moved)
                                            blk.dragOff = dy
                                    }
                                    onReleased: function (mouse) {
                                        dragging = false
                                        if (moved) {
                                            var deltaMin = Math.round((blk.dragOff / root.hourHeight) * 60 / 15) * 15
                                            blk.dragOff = 0
                                            root.moveTodo(blk.uid, deltaMin)
                                        } else {
                                            blk.dragOff = 0
                                        }
                                    }
                                    onClicked: function (mouse) {
                                        if (moved)
                                            return
                                        if (mouse.button === Qt.RightButton)
                                            root.deleteTodo(blk.uid)
                                        else
                                            root.toggleTodo(blk.uid)
                                    }
                                }

                                // resize: drag the bottom edge
                                MouseArea {
                                    id: blkResize
                                    anchors.left: parent.left
                                    anchors.right: parent.right
                                    anchors.bottom: parent.bottom
                                    height: 7
                                    hoverEnabled: true
                                    cursorShape: Qt.SizeVerCursor
                                    preventStealing: true
                                    property real pressY: 0

                                    function contentY(mouse) {
                                        return blkResize.mapToItem(tlCanvas, mouse.x, mouse.y).y
                                    }

                                    onPressed: function (mouse) {
                                        pressY = contentY(mouse)
                                    }
                                    onPositionChanged: function (mouse) {
                                        if (pressed)
                                            blk.resizeOff = contentY(mouse) - pressY
                                    }
                                    onReleased: function (mouse) {
                                        var dyMin = Math.round((blk.resizeOff / root.hourHeight) * 60 / 15) * 15
                                        blk.resizeOff = 0
                                        var base = toMin(blk.end)
                                        if (base < 0)
                                            base = toMin(blk.start) + 30
                                        root.setTodoEnd(blk.uid, base + dyMin)
                                    }
                                }

                                // resize grip indicator
                                Rectangle {
                                    anchors.horizontalCenter: parent.horizontalCenter
                                    anchors.bottom: parent.bottom
                                    anchors.bottomMargin: 3
                                    width: 16
                                    height: 2
                                    radius: 1
                                    color: blk.done ? Theme.outline : Theme.on_primary
                                    opacity: blkResize.containsMouse ? 0.9 : 0.35
                                }
                            }
                        }
                    }
                }

                // empty hint
                Text {
                    anchors.centerIn: parent
                    visible: timedTodos.count === 0 && untimedTodos.count === 0
                    text: "这一天还没有日程"
                    color: Theme.outline
                    font.family: Theme.fontFamily
                    font.pixelSize: 15
                }
            }
            }
        }
    }
}
