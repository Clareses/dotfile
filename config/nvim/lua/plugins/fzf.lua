local map = vim.api.nvim_set_keymap

keymapopt = { noremap = true, silent = true }


return {
    "ibhagwan/fzf-lua",
    dependencies = { "nvim-tree/nvim-web-devicons" },
    -- opts = {}
    config = function()
        map('n', '<LEADER>f', '<cmd>FzfLua grep_project<CR>', keymapopt)
        map('n', '<LEADER>o', '<cmd>FzfLua lsp_document_symbols<CR>', keymapopt)
        map('n', '<LEADER>s', '<cmd>FzfLua lsp_workspace_symbols<CR>', keymapopt)
        map('n', '<LEADER>a', '<cmd>FzfLua lsp_code_actions<CR>', keymapopt)
        map('n', '<LEADER>d', '<cmd>FzfLua diagnostics_document<CR>', keymapopt)
        map('n', 'gi', '<cmd>FzfLua lsp_implementations<CR>', keymapopt)
        map('n', 'gr', '<cmd>FzfLua lsp_references<CR>', keymapopt)
        map('n', 'gt', '<cmd>FzfLua lsp_typedefs<CR>', keymapopt)
        -- map('n', 'gd', '<cmd>FzfLua lsp_definitions<CR>', keymapopt)
        map('n', 'gd', '<cmd>lua GOTO_DEFINITION()<CR>', keymapopt)
        map('n', '<LEADER>c', '<cmd>FzfLua commands<CR>', keymapopt)

        local fzf_lua = require('fzf-lua')

        function GOTO_DEFINITION()
            local function on_list(options)
                vim.fn.setqflist({}, ' ', options)
                vim.cmd.cfirst()
            end
            vim.lsp.buf.definition({ on_list = on_list })
        end

        fzf_lua.setup {
            keymap = {
                -- Below are the default binds, setting any value in these tables will override
                -- the defaults, to inherit from the defaults change [1] from `false` to `true`
                builtin = {
                    -- neovim `:tmap` mappings for the fzf win
                    -- true,        -- uncomment to inherit all the below in your custom config
                    ["<M-Esc>"]  = "hide", -- hide fzf-lua, `:FzfLua resume` to continue
                    ["<F1>"]     = "toggle-help",
                    ["<F2>"]     = "toggle-fullscreen",
                    -- Only valid with the 'builtin' previewer
                    ["<F3>"]     = "toggle-preview-wrap",
                    ["<F4>"]     = "toggle-preview",
                    -- Rotate preview clockwise/counter-clockwise
                    ["<F5>"]     = "toggle-preview-ccw",
                    ["<F6>"]     = "toggle-preview-cw",
                    -- `ts-ctx` binds require `nvim-treesitter-context`
                    ["<F7>"]     = "toggle-preview-ts-ctx",
                    ["<F8>"]     = "preview-ts-ctx-dec",
                    ["<F9>"]     = "preview-ts-ctx-inc",
                    ["<S-Left>"] = "preview-reset",
                    ["<c-f>"]    = "preview-page-down",
                    ["<c-b>"]    = "preview-page-up",
                    ["<c-j>"]    = "preview-down",
                    ["<c-k>"]    = "preview-up",
                },
                fzf = {
                    -- fzf '--bind=' options
                    -- true,        -- uncomment to inherit all the below in your custom config
                    ["ctrl-z"]     = "abort",
                    ["ctrl-u"]     = "unix-line-discard",
                    ["ctrl-f"]     = "half-page-down",
                    ["ctrl-b"]     = "half-page-up",
                    ["ctrl-a"]     = "beginning-of-line",
                    ["ctrl-e"]     = "end-of-line",
                    ["alt-a"]      = "toggle-all",
                    ["alt-g"]      = "first",
                    ["alt-G"]      = "last",
                    -- Only valid with fzf previewers (bat/cat/git/etc)
                    ["f3"]         = "toggle-preview-wrap",
                    ["f4"]         = "toggle-preview",
                    ["shift-down"] = "preview-page-down",
                    ["shift-up"]   = "preview-page-up",
                },
            }
        }
    end
}
