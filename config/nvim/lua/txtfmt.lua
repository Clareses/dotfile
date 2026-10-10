-- txtfmt: 把一段文字重新折行到指定宽度（按“显示宽度”逐字判断，CJK/全角算 2）。
--         默认会先把原有的换行“接上”（段内合并再重排，类似 gq）；
--         如果切点正好落在一个连续英文单词中间，就把整个单词挪到下一行。
--
-- 纯函数部分：
--   require("txtfmt").wrap_line(line, width) -> { "第一行", "第二行", ... }
-- 作用于 buffer：
--   require("txtfmt").format(line1, line2, width, join)  -- join 默认 true
-- 用户命令（setup 后）：
--   :Txtfmt        -- 合并原换行后重排（默认宽度 40）
--   :Txtfmt 60     -- 同上，宽度 60
--   :Txtfmt! 60    -- 不合并，逐行硬切（旧行为）
--   :%Txtfmt 60    -- 整个文件
--   :'<,'>Txtfmt   -- 可视选区

local M = {}

local DEFAULT_WIDTH = 40

-- 单个字符的显示宽度：-- ASCII 直接 1；其余交给 nvim 判断（CJK、emoji 等）。
-- tab 特殊处理为 1，避免按 tabstop 拉出一大段空白。
local function cp_width(cp)
  if cp < 0x80 then
    return 1 -- 含 tab
  end
  return vim.fn.strdisplaywidth(vim.fn.list2str({ cp }))
end

-- 视为“英文单词字符”的码点：A-Z a-z 0-9 _ ' （ASCII 下判断，够用且快）
local function is_word_cp(cp)
  return (cp >= 65 and cp <= 90)   -- A-Z
      or (cp >= 97 and cp <= 122)  -- a-z
      or (cp >= 48 and cp <= 57)   -- 0-9
      or cp == 95                  -- _
      or cp == 39                  -- '
end

-- 把码点区间 [a, b] 还原成 UTF-8 字符串
local function cps_to_str(cps, a, b)
  local t = {}
  for k = a, b do
    t[#t + 1] = cps[k]
  end
  return vim.fn.list2str(t)
end

local function trim_right(s)
  return (s:gsub("[ \t]+$", ""))
end

local function is_blank(s)
  return s:match("^%s*$") ~= nil
end

-- 单个码点是否为“宽字符”（CJK/全角/emoji）
local function is_wide(cp)
  return cp ~= nil and vim.fn.strdisplaywidth(vim.fn.list2str({ cp })) >= 2
end

local function first_cp(s)
  local l = vim.fn.str2list(s)
  return l[1]
end

local function last_cp(s)
  local l = vim.fn.str2list(s)
  return l[#l]
end

-- 把若干行合并成一段：先去掉续行缩进和行尾空白；
-- 只在“两个字符都不是宽字符”时才补一个空格（中文之间不塞空格）。
local function join_block(block)
  local out = block[1]
  for k = 2, #block do
    local nxt = (block[k]:gsub("^%s+", ""))
    if nxt ~= "" then
      local prev = trim_right(out)
      local sep = " "
      local a, b = last_cp(prev), first_cp(nxt)
      if a == nil or is_wide(a) or is_wide(b) then
        sep = ""
      end
      out = prev .. sep .. nxt
    end
  end
  return trim_right(out)
end

-- 把一行按 width 切成多行，返回字符串列表
function M.wrap_line(line, width)
  width = (width and width > 0) and width or (tonumber(vim.g.txtfmt_width) or DEFAULT_WIDTH)

  local cps = vim.fn.str2list(line)
  local n = #cps
  if n == 0 then
    return { "" }
  end

  local out = {}
  local i = 1
  local first = true

  while i <= n do
    -- 续行跳过行首空白
    if not first then
      while i <= n and (cps[i] == 32 or cps[i] == 9) do
        i = i + 1
      end
      if i > n then
        break
      end
    end

    -- 贪心装字符，直到再加一个就超宽
    local w = 0
    local j = i
    while j <= n do
      local cw = cp_width(cps[j])
      if w + cw > width then
        break
      end
      w = w + cw
      j = j + 1
    end

    if j > n then
      -- 剩下的都能放下
      out[#out + 1] = cps_to_str(cps, i, n)
      break
    end

    -- j 是第一个放不下的字符 => 下一行从这里开始
    local brk = j

    -- 关键：切点若落在英文单词中间，就把整个单词推下去（“多切一点”）
    if brk > i and is_word_cp(cps[brk]) and is_word_cp(cps[brk - 1]) then
      local k = brk
      while k > i and is_word_cp(cps[k - 1]) do
        k = k - 1
      end
      if k > i then
        brk = k
      end
    end

    -- 兜底：单个字符本身就超宽时，至少消费一个，避免死循环
    if brk <= i then
      brk = i + 1
    end

    out[#out + 1] = cps_to_str(cps, i, brk - 1)
    i = brk
    first = false
  end

  for idx = 1, #out do
    out[idx] = trim_right(out[idx])
  end
  return out
end

-- 对 [l1, l2] 范围（1-based，闭区间）重排，并写回 buffer。
-- join=true（默认）：按空行分段，段内合并原换行后整体重排。
-- join=false：保持原来的逐行硬切。
function M.format(l1, l2, width, join)
  if join == nil then
    join = true
  end
  l1 = l1 or vim.fn.line(".")
  l2 = l2 or l1
  local buf = vim.api.nvim_get_current_buf()
  local lines = vim.api.nvim_buf_get_lines(buf, l1 - 1, l2, false)

  local new = {}
  if not join then
    for _, line in ipairs(lines) do
      for _, seg in ipairs(M.wrap_line(line, width)) do
        new[#new + 1] = seg
      end
    end
  else
    local i = 1
    while i <= #lines do
      if is_blank(lines[i]) then
        new[#new + 1] = lines[i]
        i = i + 1
      else
        local j = i
        while j <= #lines and not is_blank(lines[j]) do
          j = j + 1
        end
        local block = {}
        for k = i, j - 1 do
          block[#block + 1] = lines[k]
        end
        for _, seg in ipairs(M.wrap_line(join_block(block), width)) do
          new[#new + 1] = seg
        end
        i = j
      end
    end
  end

  -- 没变化就不动 buffer
  local same = #new == #lines
  if same then
    for k = 1, #lines do
      if new[k] ~= lines[k] then
        same = false
        break
      end
    end
  end
  if not same then
    vim.api.nvim_buf_set_lines(buf, l1 - 1, l2, false, new)
  end
end

-- 注册命令；opts.width 设置默认宽度，opts.keymap 可选绑定
function M.setup(opts)
  opts = opts or {}
  if opts.width then
    vim.g.txtfmt_width = opts.width
  end

  -- 允许重复 setup（热重载不报错）
  pcall(vim.api.nvim_del_user_command, "Txtfmt")

  vim.api.nvim_create_user_command("Txtfmt", function(args)
    local width = nil
    if args.args ~= "" then
      width = tonumber(args.args)
      if not width or width <= 0 then
        vim.notify("Txtfmt: 宽度无效: " .. args.args, vim.log.levels.ERROR)
        return
      end
    end
    local l1, l2
    if args.range and args.range > 0 then
      l1, l2 = args.line1, args.line2
    else
      l1 = vim.fn.line(".")
      l2 = l1
    end
    M.format(l1, l2, width, not args.bang)
  end, {
    range = true,
    nargs = "?",
    bang = true,
    desc = "按显示宽度重排（默认 40，合并原换行；! 则逐行硬切）",
  })

  if opts.keymap then
    vim.keymap.set("n", opts.keymap, "<cmd>Txtfmt<cr>", { desc = "txtfmt" })
    vim.keymap.set("x", opts.keymap, ":Txtfmt<cr>", { desc = "txtfmt", silent = true })
  end
end

return M
