set -g fish_greeting ""

if status is-interactive
    # Commands to run in interactive sessions can go here
end

fish_vi_key_bindings
fish_vi_cursor

alias ls=exa

function y
	set tmp (mktemp -t "yazi-cwd.XXXXXX")
	yazi $argv --cwd-file="$tmp"
	if read -z cwd < "$tmp"; and [ -n "$cwd" ]; and [ "$cwd" != "$PWD" ]
		builtin cd -- "$cwd"
	end
	rm -f -- "$tmp"
end

function setproxy
	set -xg http_proxy http://127.0.0.1:7897
	set -xg https_proxy http://127.0.0.1:7897
	set -xg all_proxy socks5://127.0.0.1:7897
end

function unsetproxy
	set -e http_proxy
	set -e https_proxy
	set -e all_proxy
end

# >>> conda initialize >>>
# !! Contents within this block are managed by 'conda init' !!

function conda_init
    if test -f $HOME/opt/miniconda/bin/conda
        eval $HOME/opt/miniconda/bin/conda "shell.fish" "hook" $argv | source
    else
        if test -f "$HOME/opt/miniconda/etc/fish/conf.d/conda.fish"
             source "$HOME/opt/miniconda/etc/fish/conf.d/conda.fish"
        else
            set -x PATH "$HOME/opt/miniconda/bin" $PATH
        end
    end
end

set -xg EDITOR nvim

alias chbg="qs -c noctalia-shell ipc call wallpaper random"

# pnpm
set -gx PNPM_HOME "$HOME/.local/share/pnpm"
if not string match -q -- $PNPM_HOME $PATH
  set -gx PATH "$PNPM_HOME" $PATH
end
# pnpm end

set -xg PATH "$HOME/opt/flutter/bin" $PATH
set -xg PATH "$HOME/go/bin" $PATH



# BEGIN opam configuration
# This is useful if you're using opam as it adds:
#   - the correct directories to the PATH
#   - auto-completion for the opam binary
# This section can be safely removed at any time if needed.
test -r "$HOME/.opam/opam-init/init.fish" && source "$HOME/.opam/opam-init/init.fish" > /dev/null 2> /dev/null; or true
# END opam configuration

# Created by `pipx` on 2026-04-14 05:53:56
set PATH $PATH $HOME/.local/bin

# bun
set --export BUN_INSTALL "$HOME/.bun"
set --export PATH $BUN_INSTALL/bin $PATH

set -xg PATH "$HOME/.ghcup/bin" $PATH

set -gx PATH $HOME/.npm-global/bin $PATH

set -xg OPENCODE_GO_WORKSPACE_ID wrk_01KKR7Q8SVVD35Y7GQTD12R2WR
set -xg OPENCODE_GO_AUTH_COOKIE "Fe26.2**1b913c3cba8ed0239a560759d6b7f0d6ffa38e4209ae968574949b18897a95a9*711ugK-zWAL2mwXVjOe_8Q*gpR2zEtsxLCrn41NUy8PkNtkoO2cdCDzdoOxfKhpIN4GLkdYF3_he_2bIKr7VozjmNaWsbfUqBU7JR_R21AxHXAJsLeucCHgVQ0ZnS5eJazCTcYA8nn8p8UEsaHlyEXjVbud1111eXOpRAT_LAyXkIh7VHLUNe4SrZHu3GVYzJeGj9-RXt_LYYIe71r29MNpGt8ggYozCdCyrwt40M05ziKHbO5KU4IUTYdmYo_ThbraMFYnd7sa9ZP58dDGuy4SRQGnUPVPv1t6kYItSGHAJfrR-pDSVEyqlLQkjqyvP_OJB-5Dk9uqIm--pWYriKate-SiWNV5SCt2my7kFNW0ng*1810881871632*5d497b877121442e1b325262ff6dcaa2331d2e65aa63bd6deea5c002321c5d99*K_wAPBJrs5p8ghTlStEP95ggW5EXGo-N7v2wZ8dIS4I"

setproxy

source ~/.config/fish/functions/hypr_win_pos.fish
