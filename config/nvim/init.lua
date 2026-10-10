vim.g.loaded_netrw       = 1
vim.g.loaded_netrwPlugin = 1

require("config.lazy")
require("config.options")
require("config.keymaps")

require("txtfmt").setup({ width = 40 })

vim.cmd [[highlight BlinkCmpMenu guibg=None]]
vim.cmd [[highlight BlinkCmpMenuBorder guibg=None]]
