# webcode shell integration (bash) — OSC 133 semantic prompts + OSC 7 cwd.
# Sourced from a temp --rcfile after the user's ~/.bashrc has loaded.
# Uses the bash-preexec pattern (DEBUG trap + PROMPT_COMMAND) since bash has
# no native preexec/precmd hooks.
if [[ -n "$WEBCODE" && -z "$WEBCODE_SI_LOADED" ]]; then
  WEBCODE_SI_LOADED=1

  __webcode_osc7() {
    printf '\033]7;file://%s%s\033\\' "${HOSTNAME:-localhost}" "$PWD"
  }

  # Fires before drawing each prompt: close previous command (D;exit), emit
  # cwd (OSC 7) and prompt start (A). $? must be captured first.
  __webcode_prompt() {
    local exit=$?
    printf '\033]133;D;%s\033\\' "$exit"
    __webcode_osc7
    printf '\033]133;A\033\\'
    __webcode_preexec_armed=1
  }

  # DEBUG trap fires before each command runs → emit output start (C). Armed
  # once per prompt so it doesn't fire for PROMPT_COMMAND's own subshells.
  __webcode_preexec_armed=0
  __webcode_debug() {
    if [[ "$__webcode_preexec_armed" == 1 && "$BASH_COMMAND" != "__webcode_prompt" ]]; then
      __webcode_preexec_armed=0
      printf '\033]133;C\033\\'
    fi
  }

  # mark prompt end (B = command start region)
  PS1="$PS1"'\[\033]133;B\033\\\]'

  case "$PROMPT_COMMAND" in
    *__webcode_prompt*) ;;
    "") PROMPT_COMMAND="__webcode_prompt" ;;
    *) PROMPT_COMMAND="__webcode_prompt;$PROMPT_COMMAND" ;;
  esac
  trap '__webcode_debug' DEBUG
fi
