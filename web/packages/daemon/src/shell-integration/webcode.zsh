# webcode shell integration (zsh) — emits OSC 133 semantic prompts + OSC 7 cwd.
# Sourced from a temp ZDOTDIR .zshrc after the user's own rc has loaded.
# Guarded so it only runs inside webcode and only once.
if [[ -n "$WEBCODE" && -z "$WEBCODE_SI_LOADED" ]]; then
  WEBCODE_SI_LOADED=1

  __webcode_osc7() {
    printf '\033]7;file://%s%s\033\\' "$HOST" "$PWD"
  }

  # prompt start (A) + previous-command done (D;exit) live in precmd;
  # command start (C) lives in preexec.
  __webcode_precmd() {
    local exit=$?
    printf '\033]133;D;%s\033\\' "$exit"
    __webcode_osc7
    printf '\033]133;A\033\\'
  }

  __webcode_preexec() {
    printf '\033]133;C\033\\'
  }

  # mark the end of the prompt (B = command start region) by appending to PS1
  PS1="$PS1"$'%{\033]133;B\033\\%}'

  autoload -Uz add-zsh-hook 2>/dev/null
  if (( $+functions[add-zsh-hook] )); then
    add-zsh-hook precmd __webcode_precmd
    add-zsh-hook preexec __webcode_preexec
  else
    precmd_functions+=(__webcode_precmd)
    preexec_functions+=(__webcode_preexec)
  fi
fi
