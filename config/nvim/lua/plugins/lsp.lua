local first_run = true;

vim.o.updatetime = 250

vim.opt.pumblend = 0
vim.diagnostic.config({
    virtual_text = false
})

local function has_float_window()
    for _, win in ipairs(vim.api.nvim_list_wins()) do
        if vim.fn.win_gettype(win) == "popup" then
            return true
        end
    end
    return false
end

function open_float()
    local filetype = vim.bo.filetype
    if has_float_window() or filetype == "lean" then
        return
    end
    vim.diagnostic.open_float(nil, { focus = false })
end

vim.cmd [[autocmd! ColorScheme * highlight NormalFloat guibg=None]]
vim.cmd [[autocmd! ColorScheme * highlight FloatBorder guifg=white guibg=None]]
vim.cmd [[autocmd CursorHold,CursorHoldI * lua open_float()]]

local border = {
    { "╭", "FloatBorder" },
    { "─", "FloatBorder" },
    { "╮", "FloatBorder" },
    { "│", "FloatBorder" },
    { "╯", "FloatBorder" },
    { "─", "FloatBorder" },
    { "╰", "FloatBorder" },
    { "│", "FloatBorder" },
}


local orig_util_open_floating_preview = vim.lsp.util.open_floating_preview
function vim.lsp.util.open_floating_preview(contents, syntax, opts, ...)
    opts = opts or {}
    opts.border = opts.border or border
    return orig_util_open_floating_preview(contents, syntax, opts, ...)
end

function quickfix()
    vim.lsp.buf.code_action({
        filter = function(a) return a.isPreferred end,
        apply = true
    })
end

local map = vim.api.nvim_set_keymap
keymapopt = { noremap = true, silent = true }

local function ra_flycheck()
    print("Running flycheck")
    local clients = vim.lsp.get_clients({
        name = 'rust_analyzer',
    })
    for _, client in ipairs(clients) do
        local params = vim.lsp.util.make_text_document_params()
        client.notify('rust-analyzer/runFlycheck', params)
    end
end

return {
    {
        'neovim/nvim-lspconfig',

        config = function()
            -- keymap settings
            map('n', 'gD', '<cmd>lua vim.lsp.buf.definition()<CR>', keymapopt)
            map('n', '<LEADER>r', '<cmd>lua vim.lsp.buf.references()<CR>', keymapopt)
            map('n', '<LEADER>i', '<cmd>lua vim.lsp.buf.implementation()<CR>', keymapopt)
            map('n', 'K', '<cmd>lua vim.lsp.buf.hover()<CR>', keymapopt)
            map('n', '<LEADER>rn', '<cmd>lua vim.lsp.buf.rename()<CR>', keymapopt)
            map('n', '<LEADER>qf', "<cmd>lua quickfix()<CR>", keymapopt)

            require('lspconfig').clangd.setup {
                cmd = { "clangd" },
                on_attach = function(client, bufnr)
                    client.server_capabilities.documentFormattingProvider = false
                    client.server_capabilities.documentRangeFormattingProvider = false
                end
            }
            require('lspconfig').basedpyright.setup {
                settings = {
                    basedpyright = {
                        typeCheckingMode = "basic",
                        logLevel = "error",
                    },
                },
            }

            -- Optional: Only required if you need to update the language server settings
            -- require('lspconfig').ty.setup({
            --     settings = {
            --         ty = {
            --         }
            --     }
            -- })
            -- vim.lsp.enable('ty')
            --

            vim.lsp.enable('lean3ls')
            require('lspconfig').ruff.setup {}
            require('lspconfig').dartls.setup {}
            require('lspconfig').lua_ls.setup {}
            require('lspconfig').bashls.setup {}
            require('lspconfig').metals.setup {}
            require('lspconfig')['hls'].setup {
                filetypes = { 'haskell', 'lhaskell', 'cabal' },
                settings = {
                    haskell = {
                        formattingProvider = "stylish-haskell",
                        cabalFormattingProvider = "stylish-haskell"
                    }
                }
            }
            require 'lspconfig'.tinymist.setup {
                settings = {
                    formatterMode = "typstyle",
                    formatterIndentSize = 4,
                }
            }

            -- rust configuration{{{
            local capabilities = vim.lsp.protocol.make_client_capabilities()
            -- capabilities = require('cmp_nvim_lsp').default_capabilities(capabilities)
            capabilities.experimental = {}
            capabilities.experimental.commands = { commands = { 'rust-analyzer/runFlycheck' } }
            require('lspconfig').rust_analyzer.setup({
                on_attach = function()
                    vim.keymap.set('n', '<c-enter>', ra_flycheck)
                end,
                capabilities = capabilities,
                cmd = { "rustup", "run", "nightly", "rust-analyzer" },
                settings = {
                    ["rust-analyzer"] = {
                        numThreads = 4,
                        cargo = {
                            allFeatures = true,
                            extraArgs = { "--jobs", "4" },
                        },
                        files = {
                            excludeDirs = {
                                ".cargo",
                                ".direnv",
                                ".git",
                                "node_modules",
                                "target",
                            },
                        },
                        completion = {
                            limit = 100,
                            -- Don't really use this;
                            -- would use my own snippets instead
                            postfix = {
                                enable = false
                            },
                            snippets = {
                                custom = {}
                            },
                            -- Show private fields
                            -- in completion
                            privateEditable = {
                                enable = true,
                            },
                        },

                        checkOnSave = false,
                        diagnostics = {
                            enable = true,
                            experimental = {
                                enable = true,
                            },
                        },
                    },
                },
                -- }}}
            })
        end,
    },

    {
        'saghen/blink.cmp',
        -- optional: provides snippets for the snippet source
        dependencies = { 'rafamadriz/friendly-snippets' },

        -- use a release tag to download pre-built binaries
        version = '1.*',
        -- AND/OR build from source, requires nightly: https://rust-lang.github.io/rustup/concepts/channels.html#working-with-nightly-rust
        -- build = 'cargo build --release',
        -- If you use nix, you can build from source using latest nightly rust with:
        -- build = 'nix run .#build-plugin',
        config = function()
            require('blink-cmp').setup
            {
                -- 'default' (recommended) for mappings similar to built-in completions (C-y to accept)
                -- 'super-tab' for mappings similar to vscode (tab to accept)
                -- 'enter' for enter to accept
                -- 'none' for no mappings
                --
                -- All presets have the following mappings:
                -- C-space: Open menu or open docs if already open
                -- C-n/C-p or Up/Down: Select next/previous item
                -- C-e: Hide menu
                -- C-k: Toggle signature help (if signature.enabled = true)
                --
                -- See :h blink-cmp-config-keymap for defining your own keymap
                keymap = {
                    preset = 'default',
                    ['<Enter>'] = { 'select_and_accept', 'fallback' },
                },

                appearance = {
                    -- 'mono' (default) for 'Nerd Font Mono' or 'normal' for 'Nerd Font'
                    -- Adjusts spacing to ensure icons are aligned
                    use_nvim_cmp_as_default = false,
                    nerd_font_variant = "mono",
                },



                -- (Default) Only show the documentation popup when manually triggered
                completion = {
                    accept = { auto_brackets = { enabled = true } },

                    documentation = {
                        auto_show = true,
                        auto_show_delay_ms = 250,
                        treesitter_highlighting = true,
                        window = { border = "rounded" },
                    },

                    -- list = {
                    --     selection = function(ctx)
                    --         return ctx.mode == "cmdline" and "auto_insert" or "preselect"
                    --     end,
                    -- },

                    menu = {
                        border = "rounded",
                        cmdline_position = function()
                            if vim.g.ui_cmdline_pos ~= nil then
                                local pos = vim.g.ui_cmdline_pos -- (1, 0)-indexed
                                return { pos[1] - 1, pos[2] }
                            end
                            local height = (vim.o.cmdheight == 0) and 1 or vim.o.cmdheight
                            return { vim.o.lines - height, 0 }
                        end,

                        draw = {
                            -- We don't need label_description now because label and label_description are already
                            -- combined together in label by colorful-menu.nvim.
                            columns = { { "kind_icon" }, { "label", gap = 1 } },
                            components = {
                                label = {
                                    text = function(ctx)
                                        if first_run then
                                            vim.cmd [[highlight BlinkCmpMenu guibg=None]]
                                            vim.cmd [[highlight BlinkCmpMenuBorder guibg=None]]
                                            vim.cmd [[highlight BlinkCmpKind guibg=None]]
                                            first_run = false
                                        end
                                        return require("colorful-menu").blink_components_text(ctx)
                                    end,
                                    highlight = function(ctx)
                                        return require("colorful-menu").blink_components_highlight(ctx)
                                    end,
                                },
                            },
                        },
                    },
                },

                -- Default list of enabled providers defined so that you can extend it
                -- elsewhere in your config, without redefining it, due to `opts_extend`
                sources = {
                    default = { 'lsp', 'path', 'snippets', 'buffer' },
                },

                -- (Default) Rust fuzzy matcher for typo resistance and significantly better performance
                -- You may use a lua implementation instead by using `implementation = "lua"` or fallback to the lua implementation,
                -- when the Rust fuzzy matcher is not available, by using `implementation = "prefer_rust"`
                --
                -- See the fuzzy documentation for more information
                fuzzy = { implementation = "prefer_rust_with_warning" }
            }
        end,

        ---@module 'blink.cmp'
        ---@type blink.cmp.Config
        opts_extend = { "sources.default" }
    },

    -- {
    --     'hrsh7th/nvim-cmp',
    --
    --     dependencies = {
    --         "hrsh7sh/cmp-nvim-lsp",
    --         "hrsh7sh/cmp-buffer",
    --         "onsails/lspkind.nvim",
    --     },
    --
    --     config = function()
    --         local cmp = require('cmp')
    --         cmp.setup({
    --             preselect = 'item',
    --             completion = {
    --                 completeopt = 'menu,menuone,noinsert'
    --             },
    --             sources = {
    --                 { name = 'nvim_lsp' },
    --                 { name = 'buffer' },
    --             },
    --             mapping = cmp.mapping.preset.insert({
    --                 -- confirm completion
    --                 ['<cr>'] = cmp.mapping.confirm({ select = true }),
    --                 ['<C-u>'] = cmp.mapping.scroll_docs(-4),
    --                 ['<C-d>'] = cmp.mapping.scroll_docs(4),
    --             }),
    --             window = {
    --                 completion = cmp.config.window.bordered(),
    --                 documentation = cmp.config.window.bordered(),
    --             },
    --             formatting = {
    --                 format = require('lspkind').cmp_format({
    --                     mode = 'symbol',          -- show only symbol annotations
    --                     maxwidth = {
    --                         menu = 50,            -- leading text (labelDetails)
    --                         abbr = 50,            -- actual suggestion item
    --                     },
    --                     ellipsis_char = '...',    -- when popup menu exceed maxwidth, the truncated part would show ellipsis_char instead (must define maxwidth first)
    --                     show_labelDetails = true, -- show labelDetails in menu. Disabled by default
    --                     before = function(entry, vim_item)
    --                         return vim_item
    --                     end
    --                 })
    --             }
    --         })
    --     end
    -- },

    -- { 'hrsh7th/cmp-nvim-lsp' },
    -- { 'hrsh7th/cmp-buffer' },
    { 'onsails/lspkind.nvim' },
}
