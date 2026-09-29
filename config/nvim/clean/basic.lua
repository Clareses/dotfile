-- require('user/options')
-- require('user/keymaps')

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
