pragma Singleton
import QtQuick
import Quickshell 
import Quickshell.Io 

QtObject { 
    id: root
    
    // Static properties
    readonly property string fontFamily: "JetBrainsMono Nerd Font"

    // --- waybar-style flat tokens ---
    // Not part of the matugen palette in colors.json, so the runtime merge in
    // `themeReader` below never overwrites them. The status bar modules use
    // these to mirror the user's waybar look.
    readonly property color barBackground: "#b3000000"
    readonly property color barForeground: "#ffffff"
    readonly property color workspaceButton: "#181818"
    readonly property color workspaceActive: "#5EA8CC"
    
    // Dynamic color properties — dark neutral palette with a muted teal
    // accent, matched to the status bar. Kept in sync with
    // ~/.config/ml4w/colors/colors.json.
    property color background: "#121316"
    property color error: "#ffb4ab"
    property color error_container: "#93000a"
    property color inverse_on_surface: "#2e3035"
    property color inverse_primary: "#3d7f96"
    property color inverse_surface: "#e8e8ea"
    property color on_background: "#e8e8ea"
    property color on_error: "#690005"
    property color on_error_container: "#ffdad6"
    property color on_primary: "#ffffff"
    property color on_primary_container: "#d8eef8"
    property color on_primary_fixed: "#04222e"
    property color on_primary_fixed_variant: "#2f6079"
    property color on_secondary: "#1a2529"
    property color on_secondary_container: "#d5e2e8"
    property color on_secondary_fixed: "#111c20"
    property color on_secondary_fixed_variant: "#3d4d53"
    property color on_surface: "#e8e8ea"
    property color on_surface_variant: "#c5c7cc"
    property color on_tertiary: "#382e1f"
    property color on_tertiary_container: "#f0e0cc"
    property color on_tertiary_fixed: "#241a0c"
    property color on_tertiary_fixed_variant: "#55452f"
    property color outline: "#8d9199"
    property color outline_variant: "#43474e"
    property color primary: "#5EA8CC"
    property color primary_container: "#1f4658"
    property color primary_fixed: "#b3e0f5"
    property color primary_fixed_dim: "#5EA8CC"
    property color scrim: "#000000"
    property color secondary: "#b6c2c8"
    property color secondary_container: "#3a4a50"
    property color secondary_fixed: "#d5e2e8"
    property color secondary_fixed_dim: "#b6c2c8"
    property color shadow: "#000000"
    property color source_color: "#5EA8CC"
    property color surface: "#121316"
    property color surface_bright: "#37393e"
    property color surface_container: "#1d1f22"
    property color surface_container_high: "#282a2e"
    property color surface_container_highest: "#33363a"
    property color surface_container_low: "#191a1d"
    property color surface_container_lowest: "#0c0d0f"
    property color surface_dim: "#121316"
    property color surface_tint: "#5EA8CC"
    property color surface_variant: "#3a3d42"
    property color tertiary: "#d0c4b0"
    property color tertiary_container: "#524536"
    property color tertiary_fixed: "#f0e0cc"
    property color tertiary_fixed_dim: "#d0c4b0"

    property var themeReader: Process {
        id: reader
        command: ["cat", Quickshell.env("HOME") + "/.config/ml4w/colors/colors.json"]
        
        // REQUIRED: Quickshell needs this to parse the binary stream into text
        stdout: StdioCollector {
            onStreamFinished: {
                // "this.text" contains the full output of the cat command
                var output = this.text.trim();
                
                if (output !== "") {
                    try {
                        var newColors = JSON.parse(output);
                        for (var key in newColors) {
                            if (root.hasOwnProperty(key) && key !== "objectName") {
                                root[key] = newColors[key];
                            }
                        }
                        console.log("Theme colors loaded successfully!");
                    } catch (e) {
                        console.log("Failed to parse theme JSON: " + e);
                    }
                }
            }
        }
    }

    function reloadTheme() {
        // Toggle false then true to guarantee Quickshell restarts the cat process
        reader.running = false;
        reader.running = true;
    }

    // Load the JSON colors automatically when Quickshell starts
    // Component.onCompleted: reloadTheme()
}
