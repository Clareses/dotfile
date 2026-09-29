-- map leader
vim.g.mapleader = " "

-- map('mode', 'key', 'value', {flags})
-- mode could be n, i, v, c
-- flags: noremap, silent...

local map = vim.api.nvim_set_keymap

-- direction control
--map('n', 'j', 'h', { noremap = true, silent = true, nowait = true})
--map('n', 'l', 'l', { noremap = true, silent = true, nowait = true})
--map('n', 'k', 'j', { noremap = true, silent = true, nowait = true})
--map('n', 'i', 'k', { noremap = true, silent = true, nowait = true})
--map('n', 'J', 'b', { noremap = true, silent = true, nowait = true})
--map('n', 'L', 'w', { noremap = true, silent = true, nowait = true})
-- map('n', 'K', '5gk',{ noremap = true, silent = true, nowait = true})
-- map('n', 'J', '5gj',{ noremap = true, silent = true, nowait = true})
-- map('n', 'k', 'gk',{ noremap = true, silent = true, nowait = true})
-- map('n', 'j', 'gj',{ noremap = true, silent = true, nowait = true})
--map('v', 'j', 'h', { noremap = true, silent = true, nowait = true})
--map('v', 'l', 'l', { noremap = true, silent = true, nowait = true})
--map('v', 'k', 'j', { noremap = true, silent = true, nowait = true})
--map('v', 'i', 'k', { noremap = true, silent = true, nowait = true})
--map('v', 'J', 'b', { noremap = true, silent = true, nowait = true})
--map('v', 'L', 'w', { noremap = true, silent = true, nowait = true})
-- map('v', 'K', '5k',{ noremap = true, silent = true, nowait = true})
-- map('v', 'J', '5j',{ noremap = true, silent = true, nowait = true})
-- map('s', 'j', 'j', { noremap = true, silent = true, nowait = true})
-- map('s', 'l', 'l', { noremap = true, silent = true, nowait = true})
-- map('s', 'k', 'k', { noremap = true, silent = true, nowait = true})
-- map('s', 'i', 'i', { noremap = true, silent = true, nowait = true})
-- map('s', 'J', 'J', { noremap = true, silent = true, nowait = true})
-- map('s', 'L', 'L', { noremap = true, silent = true, nowait = true})
-- map('s', 'K', 'K', { noremap = true, silent = true, nowait = true})
-- map('s', 'I', 'I', { noremap = true, silent = true, nowait = true})
-- map('n', 'I', 'I', { noremap = true, silent = true, nowait = true})

-- jump to match pair
vim.cmd([[
   exec "map <LEADER>p %"
]])


-- screen split
map('n', 'sh', ':set nosplitright<CR>:vsp<CR>', { noremap = true, silent = true })
map('n', 'sl', ':set splitright<CR>:vsp<CR>', { noremap = true, silent = true })
map('n', 'sj', ':set nosplitbelow<CR>:sp<CR>', { noremap = true, silent = true })
map('n', 'sk', ':set splitbelow<CR>:sp<CR>', { noremap = true, silent = true })

-- screen diff
map('n', 'dsl', ':vert diffsplit ', { noremap = true, silent = false })

-- move between screens
map('', '<LEADER>k', '<C-w>k', { silent = true, noremap = true })
map('', '<LEADER>j', '<C-w>j', { silent = true, noremap = true })
map('', '<LEADER>h', '<C-w>h', { silent = true, noremap = true })
map('', '<LEADER>l', '<C-w>l', { silent = true, noremap = true })

-- resize the screen
map('', '<up>', ':resize +1<CR>', { silent = true })
map('', '<down>', ':resize -1<CR>', { silent = true })
map('', '<left>', ':vertical resize+1<CR>', { silent = true })
map('', '<right>', ':vertical resize-1<CR>', { silent = true })

-- tabs control
map('', 'tu', ':tabe<CR>', {})
map('', 'tn', ':+tabnext<CR>', {})
map('', 'ti', ':-tabnext<CR>', {})

-- insert Mappings
--map('n', 'a', 'i', {noremap = true})
--map('n', 'h', 'a', {noremap = true})
--map('n', 'A', 'I', {noremap = true})
--map('n', 'H', 'A', {noremap = true})

-- quick save and quick quit
map('', 's', '<NOP>', {})
map('', 'S', ':w<CR>', { silent = true })
map('', 'Q', ':q<CR>', {})
map('', 'R', ':e!<CR>', {})

-- search leap
map('n', '<LEADER><CR>', ':noh<CR>', { noremap = true })

-- buffer switch
map('n', '<C-W>', ':bd<CR>', { noremap = true })
-- map('n', '<C-E>', ':bn<CR>', {noremap = true})
-- map('n', '<C-Q>', ':bp<CR>', {noremap = true})
map('n', '<C-Tab>', ':bn<CR>', { noremap = true })
map('n', '<C-S-Tab>', ':bp<CR>', { noremap = true })


-- map('n', '<LEADER>F', ':FZF<CR>', {noremap = true})

map('n', 'zf', ':foldclose<CR>', { noremap = true })


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
-- o.scrolloff = 5
o.autochdir = true

o.tabstop = 4
o.shiftwidth = 0
o.softtabstop = -1

o.expandtab = true

o.autoindent = true

-- o.cmdheight = 0



-- Always show the signcolumn, otherwise it would shift the text each time
-- diagnostics appeared/became resolved
vim.opt.signcolumn = "yes"

vim.filetype.add({ extension = { typ = 'typst' } })


-- vim.g.indentLine_char_list = {'│'}

-- vim.g.indentLine_color_gui = '#5C6773'


vim.cmd([[
    syntax on
    filetype on
    filetype plugin on
    set mouse=a
    set encoding=utf-8
    let &t_ut=''
    set conceallevel=0
]])

vim.cmd([[
autocmd BufEnter * call CustomBufferOpen()

function! CustomBufferOpen()
    set shiftwidth=4
    set tabstop=4
    set expandtab
endfunction
]])

vim.opt.background = "dark"                         -- 或者 light
vim.opt.termguicolors = true                        -- 启用真彩色
vim.cmd("highlight Normal ctermbg=NONE guibg=NONE") -- 设置正常背景为透明
