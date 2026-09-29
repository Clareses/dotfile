vim.g.loaded_netrw       = 1
vim.g.loaded_netrwPlugin = 1

require("config.lazy")
require("config.options")
require("config.keymaps")

vim.cmd [[highlight BlinkCmpMenu guibg=None]]
vim.cmd [[highlight BlinkCmpMenuBorder guibg=None]]
