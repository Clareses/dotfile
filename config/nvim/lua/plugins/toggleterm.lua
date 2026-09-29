local map = vim.api.nvim_set_keymap
keymapopt = { noremap = true, silent = true }

return {
    "akinsho/toggleterm.nvim",

    -- options for plugin
    config = function()
        map('t', '<esc>', '<c-\\><c-n>', keymapopt)
        require('toggleterm').setup({
            size = 10,
            open_mapping = [[<M-=>]],
            hide_numbers = true,
            shade_filetypes = {},
            shade_terminals = true,
            shading_factor = 100,
            start_in_insert = true,
            persist_size = true,
            direction = 'horizontal',
            close_on_exit = true,
            shell = "fish",
            float_opts = {
                border = 'curved',
                width = math.floor(vim.o.columns * 0.8),
                height = math.floor(vim.o.lines * 0.8),
                winblend = 3,
                highlights = {
                    border = "Normal",
                    background = "Normal",
                }
            },
        })
    end
}
