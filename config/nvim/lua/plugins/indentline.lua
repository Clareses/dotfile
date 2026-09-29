-- to load default colors
function load_colors()
    local highlight = {
        "RainbowRed",
        "RainbowYellow",
        "RainbowBlue",
        "RainbowOrange",
        "RainbowGreen",
        "RainbowViolet",
        "RainbowCyan",
    }

    local hooks = require "ibl.hooks"
    ---- create the highlight groups in the highlight setup hook, so they are reset
    ---- every time the colorscheme changes
    hooks.register(
        hooks.type.HIGHLIGHT_SETUP,
        function()
            vim.api.nvim_set_hl(0, "RainbowRed", { fg = "#E06C75" })
            vim.api.nvim_set_hl(0, "RainbowYellow", { fg = "#E5C07B" })
            vim.api.nvim_set_hl(0, "RainbowBlue", { fg = "#61AFEF" })
            vim.api.nvim_set_hl(0, "RainbowOrange", { fg = "#D19A66" })
            vim.api.nvim_set_hl(0, "RainbowGreen", { fg = "#98C379" })
            vim.api.nvim_set_hl(0, "RainbowViolet", { fg = "#C678DD" })
            vim.api.nvim_set_hl(0, "RainbowCyan", { fg = "#00C0B0" })
            vim.api.nvim_set_hl(0, "RainbowWhite", { fg = "#70B0B0" })
            vim.api.nvim_set_hl(0, "RainbowGray", { fg = "#606060" })
        end
    )
end

-- install and config
return {
    "lukas-reineke/indent-blankline.nvim",
    -- options for plugin
    main = "ibl",
    ---@module "ibl"
    ---@type ibl.config
    ---
    config = function()
        load_colors()
        require("ibl").setup({
            indent = {
                highlight = "RainbowGray",
                char = '▏',
            },
            scope = {
                highlight = "RainbowWhite",
            },
        })
    end,
}
