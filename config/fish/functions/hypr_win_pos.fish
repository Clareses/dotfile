function is_edge_window
    if test (count $argv) -lt 1
        echo "Usage: is_screen_edge left|right [threshold]"
        return 2
    end

    set threshold 100
    if test (count $argv) -ge 2
        set threshold $argv[2]
    end

    set active (hyprctl activewindow -j)

    set mon (echo $active | jq '.monitor')
    set x   (echo $active | jq '.at[0]')
    set w   (echo $active | jq '.size[0]')

    set moninfo (hyprctl monitors -j | jq ".[] | select(.id==$mon)")
    set monx (echo $moninfo | jq '.x')
    set monw (echo $moninfo | jq '.width')

    switch $argv[1]
        case left
            test $x -le 100

        case right
            set right (math "$x + $w")
            set monright (math "$monx + $monw")
            test $right -ge (math "$monright - $threshold")

        case '*'
            echo "Usage: is_screen_edge left|right [threshold]"
            return 2
    end
end
