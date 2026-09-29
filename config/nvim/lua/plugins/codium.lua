-- add this to the file where you setup your other plugins:
return {
    "monkoose/neocodeium",
    event = "VeryLazy",
    config = function()
        local neocodeium = require("neocodeium")
        neocodeium.setup()
        vim.keymap.set("i", "<Tab>", (function()
            if neocodeium.visible() then
                return neocodeium.accept()
            else
                return "<Tab>"
            end
        end), { expr = true })
        vim.keymap.set("i", "<C-.>", (function()
            return neocodeium.cycle(1)
        end))
        vim.keymap.set("i", "<C-,>", (function()
            return neocodeium.cycle(-1)
        end))
    end,
}
