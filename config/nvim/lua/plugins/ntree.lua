local function my_on_attach(bufnr)
    local api = require "nvim-tree.api"

    local function opts(desc)
        return { desc = "nvim-tree: " .. desc, buffer = bufnr, noremap = true, silent = true, nowait = true }
    end

    -- default mappings
    api.config.mappings.default_on_attach(bufnr)

    -- custom mappings
    vim.keymap.set('n', 'b', api.tree.change_root_to_parent, opts('Up'))
    vim.keymap.set('n', 'c', api.tree.change_root_to_node, opts('In'))
    vim.keymap.set('n', '?', api.tree.toggle_help, opts('Help'))
end

return {
    {
        'nvim-tree/nvim-tree.lua',

        dependencies = {
            "nvim-tree/nvim-web-devicons",
        },

        keys = {
            { "tt", "<cmd>NvimTreeToggle<cr>", desc = "toggle nvim-tree" }
        },

        init = function()
            vim.o.shiftwidth = 0
            vim.o.tabstop = 4
            vim.o.softtabstop = -1
            vim.o.expandtab = true
        end,

        opts = {
            on_attach = my_on_attach,
            sort_by = "case_sensitive",
            view = {
                adaptive_size = true,
            },
            filters = {
                dotfiles = true,
            },
            disable_netrw = true,
            hijack_netrw = true,
            renderer = {
                add_trailing = false,
                group_empty = false,
                highlight_git = false,
                full_name = false,
                highlight_opened_files = "none",
                highlight_modified = "none",
                root_folder_label = ":~:s?$?/..?",
                indent_width = 2,
                indent_markers = {
                    enable = false,
                    inline_arrows = true,
                    icons = {
                        corner = "└",
                        edge = "│",
                        item = "│",
                        bottom = "─",
                        none = " ",
                    },
                },
                icons = {
                    webdev_colors = true,
                    git_placement = "before",
                    modified_placement = "after",
                    padding = " ",
                    symlink_arrow = " ➛ ",
                    show = {
                        file = true,
                        folder = true,
                        folder_arrow = true,
                        git = true,
                        modified = true,
                    },
                    glyphs = {
                        default = "",
                        symlink = "",
                        bookmark = "",
                        modified = "●",
                        folder = {
                            arrow_closed = "",
                            arrow_open = "",
                            default = "",
                            open = "",
                            empty = "",
                            empty_open = "",
                            symlink = "",
                            symlink_open = "",
                        },
                        git = {
                            unstaged = "✗",
                            staged = "✓",
                            unmerged = "",
                            renamed = "➜",
                            untracked = "★",
                            deleted = "",
                            ignored = "◌",
                        },
                    },
                },
                special_files = { "Cargo.toml", "Makefile", "README.md", "readme.md" },
                symlink_destination = true,
            }
        }
    },

    {
        'nvim-tree/nvim-web-devicons',
    },

}
