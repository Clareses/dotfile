//@ pragma UseQApplication

import Quickshell
import Quickshell.Io
import "WelcomeApp"
import "PowerApp"
import "SidebarApp"
import "CalendarApp"
import "WallpaperApp"
import "StatusbarApp"
import "CustomTheme"
// import "PetApp"

ShellRoot {
    // Test IPC tools: qs ipc show

    IpcHandler {
        target: "theme-manager" 
        function reload(): void {
            Theme.reloadTheme()
        }
    }

    // Single, shell-wide IPC surface for the status bar. The bar itself is
    // instantiated once per screen via Variants below, so registering this
    // handler inside StatusbarWindow would register the same "statusbar"
    // target N times.
    IpcHandler {
        target: "statusbar"

        // Re-read statusbar.json on every bar except the first (which already
        // applied the change). No arguments so IPC can introspect the function.
        function _sync(): void {
            const list = statusbars.instances
            for (let i = 1; i < list.length; i++)
                list[i].reloadSettings()
        }

        function toggle(): void {
            const list = statusbars.instances
            if (!list || list.length === 0)
                return
            list[0].setEnabled(!list[0].settings.bar.enabled)
            _sync()
        }
        // Named enable/disable rather than show/hide: "show" is a reserved
        // subcommand of "qs ipc" and would never reach the function.
        function enable(): void {
            const list = statusbars.instances
            if (!list || list.length === 0)
                return
            list[0].setEnabled(true)
            _sync()
        }
        function disable(): void {
            const list = statusbars.instances
            if (!list || list.length === 0)
                return
            list[0].setEnabled(false)
            _sync()
        }
        function alwaysExpand(): void {
            const list = statusbars.instances
            if (!list || list.length === 0)
                return
            list[0].setAlwaysExpanded(true)
            _sync()
        }
        function autoCollapse(): void {
            const list = statusbars.instances
            if (!list || list.length === 0)
                return
            list[0].setAlwaysExpanded(false)
            _sync()
        }
        function refresh(): void {
            for (const b of statusbars.instances)
                b.reloadSettings()
        }
        function reload(): void {
            for (const b of statusbars.instances)
                b.reloadSettings()
        }
        function expand(): void {
            for (const b of statusbars.instances)
                b.barExpanded = !b.barExpanded
        }
        function collapse(): void {
            for (const b of statusbars.instances)
                b.barExpanded = false
        }
        function focus(): void {
            for (const b of statusbars.instances)
                b.requestKeyFocus()
        }
    }

    WelcomeWindow {}
    PowerWindow {}
    SidebarWindow {}
    CalendarWindow {}
    WallpaperWindow {}
    // PetWindow {}

    // One status bar per monitor (waybar parity). Each bar filters its
    // workspace module to the monitor it is placed on.
    Variants {
        id: statusbars
        model: Quickshell.screens
        StatusbarWindow {}
    }
}
