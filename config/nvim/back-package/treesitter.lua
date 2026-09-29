return {
    'nvim-treesitter/nvim-treesitter',
    branch = "main",
    config = function()
        require 'nvim-treesitter'.setup {
            -- 安装 language parser
            -- :TSInstallInfo 命令查看支持的语言
            -- ensure_installed = { "vim", "lua", "c", "cpp", "rust", "java", "python", "racket", "c_sharp", "css", "html", "typescript", "javascript", "dart" },
            -- 启用代码高亮功能
            highlight = {
                enable = true,
                additional_vim_regex_highlighting = false
            },
            -- 启用增量选择
            incremental_selection = {
                enable = false,
                keymaps = {
                    init_selection = '<CR>',
                    node_incremental = '<CR>',
                    node_decremental = '<BS>',
                    scope_incremental = '<TAB>',
                },
                indent = {
                    enable = true
                }
            },
        }
        -- 开启 Folding
        vim.wo.foldmethod = 'expr'
        vim.wo.foldexpr = 'nvim_treesitter#foldexpr()'
    end
}
