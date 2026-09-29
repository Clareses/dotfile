local function open_nvim_tree(data)
    local directory = vim.fn.isdirectory(data.file) == 1
    if not directory then
        return
    end
    vim.cmd.cd(data.file)
    require("nvim-tree.api").tree.open()
end

vim.api.nvim_create_autocmd({ "VimEnter" }, { callback = open_nvim_tree })

vim.cmd [[autocmd! BufRead,BufNewFile *.ixx set filetype=cpp]]



local o = vim.o
local wo = vim.wo
local bo = vim.bo

local opt = vim.opt

-- buffer options

-- window options
wo.number = true
wo.relativenumber = true
wo.cursorline = true
wo.cursorlineopt = 'both'
wo.wrap = true
wo.foldmethod = 'indent'
wo.foldlevel = 99


-- global options
o.showcmd = true
o.wildmenu = true
o.hlsearch = true
o.ignorecase = true
o.smartcase = true
o.mouse = 'a'
o.scrolloff = 5
o.autochdir = true

o.tabstop = 4
o.shiftwidth = 0
o.softtabstop = -1

o.expandtab = true

o.autoindent = true
o.jumpoptions = 'stack'

-- o.cmdheight = 0



-- Always show the signcolumn, otherwise it would shift the text each time
-- diagnostics appeared/became resolved
vim.opt.signcolumn = "yes"

vim.opt.scroll = 10

vim.filetype.add({ extension = { typ = 'typst' } })


-- vim.g.indentLine_char_list = {'│'}

-- vim.g.indentLine_color_gui = '#5C6773'

-- vim.opt.foldmethod = 'marker'
-- vim.opt.foldmarker = '{{{,}}}'
-- vim.opt.foldenable = true
-- vim.opt.foldlevelstart = 0

local buffer_autoformat = function(bufnr)
    local group = 'lsp_autoformat'
    vim.api.nvim_create_augroup(group, { clear = false })
    vim.api.nvim_clear_autocmds({ group = group, buffer = bufnr })

    vim.api.nvim_create_autocmd('BufWritePre', {
        buffer = bufnr,
        group = group,
        desc = 'LSP format on save',
        callback = function()
            -- note: do not enable async formatting
            vim.lsp.buf.format({ async = false, timeout_ms = 10000 })
        end,
    })
end

vim.api.nvim_create_autocmd('LspAttach', {
    callback = function(event)
        local id = vim.tbl_get(event, 'data', 'client_id')
        local client = id and vim.lsp.get_client_by_id(id)
        if client == nil then
            return
        end

        -- make sure there is at least one client with formatting capabilities
        if client.supports_method('textDocument/formatting') then
            buffer_autoformat(event.buf)
        end
    end
})
