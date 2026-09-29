import QtQuick
import Quickshell
import Quickshell.Wayland

// Minimal desktop pet — visual layer only (no trigger/state logic yet).
//   - one looping animation, stored as a PNG sprite sheet (full color + full
//     alpha, keyed out of the dsh-pet-indesktop assets)
//   - draggable with the mouse
PanelWindow {
    id: pet

    // ---- animation ------------------------------------------------
    // sheet layout: cols x rows, each cell cellW x cellH (source pixels)
    readonly property int cellW: 240
    readonly property int cellH: 286
    readonly property int cols: 9
    readonly property int rows: 9
    readonly property int frameCount: 80
    readonly property int fps: 8
    property int frame: 0

    // ---- placement ------------------------------------------------
    // monitor to live on ("" = first screen), e.g. "HDMI-A-1" / "DP-2" / "eDP-1"
    property string screenName: "HDMI-A-1"
    screen: {
        var list = Quickshell.screens
        if (!list || list.length === 0)
            return null
        for (var i = 0; i < list.length; i++)
            if (list[i].name === pet.screenName)
                return list[i]
        return list[0]
    }

    // offsets from the bottom-right corner of that screen (logical px)
    property real offRight: 60
    property real offBottom: 60

    color: "transparent"
    anchors { bottom: true; right: true }
    // display size = source cell x petScale
    property real petScale: 0.75
    implicitWidth: Math.round(pet.cellW * pet.petScale)
    implicitHeight: Math.round(pet.cellH * pet.petScale)
    exclusiveZone: -1

    margins { right: pet.offRight; bottom: pet.offBottom }

    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.namespace: "quickshell-pet"
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.None

    Image {
        anchors.fill: parent
        source: "assets/pet-sheet.png"
        fillMode: Image.Stretch
        smooth: true
        sourceClipRect: Qt.rect((pet.frame % pet.cols) * pet.cellW,
                                Math.floor(pet.frame / pet.cols) * pet.cellH,
                                pet.cellW, pet.cellH)
    }

    Timer {
        interval: Math.round(1000 / pet.fps)
        running: true
        repeat: true
        onTriggered: pet.frame = (pet.frame + 1) % pet.frameCount
    }

    // drag the window around the screen
    DragHandler {
        id: drag
        target: null
        property real startR: 0
        property real startB: 0

        onActiveChanged: {
            if (active) {
                startR = pet.offRight
                startB = pet.offBottom
            }
        }
        onTranslationChanged: {
            if (!drag.active)
                return
            pet.offRight = Math.max(0, startR - drag.translation.x)
            pet.offBottom = Math.max(0, startB - drag.translation.y)
        }
    }
}
