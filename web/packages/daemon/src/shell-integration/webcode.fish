# webcode shell integration (fish) — OSC 133 semantic prompts + OSC 7 cwd.
# Dropped into a temp vendor_conf.d so fish auto-loads it after user config.
if test -n "$WEBCODE"; and not set -q WEBCODE_SI_LOADED
    set -g WEBCODE_SI_LOADED 1

    function __webcode_osc7 --on-variable PWD
        printf '\033]7;file://%s%s\033\\' (hostname) "$PWD"
    end

    # prompt start (A) + previous-command done (D;exit)
    function __webcode_prompt_start --on-event fish_prompt
        printf '\033]133;D;%s\033\\' $status
        __webcode_osc7
        printf '\033]133;A\033\\'
    end

    # command start (C)
    function __webcode_preexec --on-event fish_preexec
        printf '\033]133;C\033\\'
    end

    # mark prompt end (B) by wrapping fish_prompt
    functions -q __webcode_orig_fish_prompt; or functions -c fish_prompt __webcode_orig_fish_prompt
    function fish_prompt
        __webcode_orig_fish_prompt
        printf '\033]133;B\033\\'
    end
end
