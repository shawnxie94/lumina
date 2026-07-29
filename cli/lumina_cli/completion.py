from __future__ import annotations

from textwrap import dedent


COMMAND_TREE = {
    "version": [],
    "init": ["--non-interactive", "--base-url", "--token", "--bridge-port", "--project-path", "--provider"],
    "profile": ["list", "show", "use", "create", "delete"],
    "config": ["path", "get", "set", "unset", "validate"],
    "auth": ["status", "token"],
    "whoami": ["--local-only"],
    "bridge": ["install", "update", "start", "stop", "restart", "status", "logs", "doctor", "serve"],
    "knowledge": [
        "providers",
        "provider",
        "status",
        "use",
        "set-path",
        "init",
        "start",
        "stop",
        "restart",
        "doctor",
    ],
    "sync": ["status", "full", "incremental", "article"],
    "status": [],
    "doctor": ["--strict"],
    "up": ["--install"],
    "down": ["--all"],
    "articles": ["list", "get"],
    "topics": ["list", "get"],
    "api": ["get", "post", "put", "call"],
    "logs": ["bridge"],
    "update": ["cli", "bridge"],
    "completion": ["bash", "zsh", "fish"],
}

GLOBAL_FLAGS = [
    "--profile",
    "--base-url",
    "--token",
    "--output",
    "--yes",
    "--verbose",
    "--quiet",
    "--config",
]

CONFIG_KEYS = [
    "active_profile",
    "active_project",
    "lumina.base_url",
    "lumina.token",
    "lumina.timeout_sec",
    "bridge.host",
    "bridge.port",
    "bridge.token",
    "bridge.root",
    "bridge.autostart",
    "project.provider",
    "project.path",
    "project.name",
    "defaults.output",
    "defaults.sync_mode",
]


def render_completion(shell: str) -> str:
    name = (shell or "").strip().lower()
    if name == "bash":
        return _bash()
    if name == "zsh":
        return _zsh()
    if name == "fish":
        return _fish()
    raise ValueError(f"unsupported shell: {shell}")


def _bash() -> str:
    tops = " ".join(sorted(COMMAND_TREE))
    globals_ = " ".join(GLOBAL_FLAGS)
    config_keys = " ".join(CONFIG_KEYS)
    bridge = " ".join(COMMAND_TREE["bridge"])
    knowledge = " ".join(COMMAND_TREE["knowledge"])
    sync = " ".join(COMMAND_TREE["sync"])
    profile = " ".join(COMMAND_TREE["profile"])
    config = " ".join(COMMAND_TREE["config"])
    auth = " ".join(COMMAND_TREE["auth"])
    articles = " ".join(COMMAND_TREE["articles"])
    topics = " ".join(COMMAND_TREE["topics"])
    api = " ".join(COMMAND_TREE["api"])
    logs = " ".join(COMMAND_TREE["logs"])
    update = " ".join(COMMAND_TREE["update"])
    completion = " ".join(COMMAND_TREE["completion"])
    return dedent(
        f"""
        # lumina bash completion
        _lumina() {{
          local cur prev words cword
          COMPREPLY=()
          cur="${{COMP_WORDS[COMP_CWORD]}}"
          prev="${{COMP_WORDS[COMP_CWORD-1]}}"
          local cmd=""
          local i
          for ((i=1; i<COMP_CWORD; i++)); do
            case "${{COMP_WORDS[i]}}" in
              --profile|--base-url|--token|--output|--config) ((i++)) ;;
              --yes|--verbose|--quiet) ;;
              -*) ;;
              *) cmd="${{COMP_WORDS[i]}}"; break ;;
            esac
          done
          if [[ -z "$cmd" ]]; then
            COMPREPLY=( $(compgen -W "{tops} {globals_}" -- "$cur") )
            return 0
          fi
          case "$cmd" in
            bridge) COMPREPLY=( $(compgen -W "{bridge} {globals_}" -- "$cur") ) ;;
            knowledge)
              if [[ "$prev" == "provider" ]]; then
                COMPREPLY=( $(compgen -W "show install doctor" -- "$cur") )
              elif [[ "$prev" == "use" ]]; then
                COMPREPLY=( $(compgen -W "llm_wiki generic_fs" -- "$cur") )
              else
                COMPREPLY=( $(compgen -W "{knowledge} {globals_}" -- "$cur") )
              fi
              ;;
            sync) COMPREPLY=( $(compgen -W "{sync} {globals_}" -- "$cur") ) ;;
            profile) COMPREPLY=( $(compgen -W "{profile} {globals_}" -- "$cur") ) ;;
            config)
              if [[ "$prev" == "get" || "$prev" == "set" || "$prev" == "unset" ]]; then
                COMPREPLY=( $(compgen -W "{config_keys}" -- "$cur") )
              else
                COMPREPLY=( $(compgen -W "{config} {globals_}" -- "$cur") )
              fi
              ;;
            auth)
              if [[ "$prev" == "token" ]]; then
                COMPREPLY=( $(compgen -W "set show" -- "$cur") )
              else
                COMPREPLY=( $(compgen -W "{auth} {globals_}" -- "$cur") )
              fi
              ;;
            articles) COMPREPLY=( $(compgen -W "{articles} {globals_}" -- "$cur") ) ;;
            topics) COMPREPLY=( $(compgen -W "{topics} {globals_}" -- "$cur") ) ;;
            api) COMPREPLY=( $(compgen -W "{api} {globals_}" -- "$cur") ) ;;
            logs) COMPREPLY=( $(compgen -W "{logs} {globals_}" -- "$cur") ) ;;
            update) COMPREPLY=( $(compgen -W "{update} {globals_}" -- "$cur") ) ;;
            completion) COMPREPLY=( $(compgen -W "{completion}" -- "$cur") ) ;;
            doctor) COMPREPLY=( $(compgen -W "--strict {globals_}" -- "$cur") ) ;;
            up) COMPREPLY=( $(compgen -W "--install {globals_}" -- "$cur") ) ;;
            down) COMPREPLY=( $(compgen -W "--all {globals_}" -- "$cur") ) ;;
            *) COMPREPLY=( $(compgen -W "{globals_}" -- "$cur") ) ;;
          esac
        }}
        complete -F _lumina lumina
        """
    ).strip() + "\n"


def _zsh() -> str:
    tops = " ".join(sorted(COMMAND_TREE))
    globals_ = " ".join(GLOBAL_FLAGS)
    config_keys = " ".join(CONFIG_KEYS)
    return dedent(
        f"""
        #compdef lumina
        _lumina() {{
          local -a commands globals config_keys
          commands=({tops})
          globals=({globals_})
          config_keys=({config_keys})
          local context state line
          typeset -A opt_args
          _arguments -C \\
            '1:command:->cmds' \\
            '*::arg:->args'
          case $state in
            cmds)
              _describe 'command' commands
              _describe 'global' globals
              ;;
            args)
              case $words[1] in
                bridge)
                  _values 'bridge' install update start stop restart status logs doctor serve $globals
                  ;;
                knowledge)
                  if [[ $words[2] == provider ]]; then
                    _values 'provider-action' show install doctor
                  elif [[ $words[2] == use ]]; then
                    _values 'provider' llm_wiki generic_fs
                  else
                    _values 'knowledge' providers provider status use set-path init start stop restart doctor $globals
                  fi
                  ;;
                sync)
                  _values 'sync' status full incremental article $globals
                  ;;
                profile)
                  _values 'profile' list show use create delete $globals
                  ;;
                config)
                  if [[ $words[2] == (get|set|unset) ]]; then
                    _values 'config-key' $config_keys
                  else
                    _values 'config' path get set unset validate $globals
                  fi
                  ;;
                auth)
                  if [[ $words[2] == token ]]; then
                    _values 'token' set show
                  else
                    _values 'auth' status token $globals
                  fi
                  ;;
                articles)
                  _values 'articles' list get $globals
                  ;;
                topics)
                  _values 'topics' list get $globals
                  ;;
                api)
                  _values 'api' get post put call $globals
                  ;;
                logs)
                  _values 'logs' bridge $globals
                  ;;
                update)
                  _values 'update' cli bridge $globals
                  ;;
                completion)
                  _values 'shell' bash zsh fish
                  ;;
                doctor)
                  _values 'doctor' --strict $globals
                  ;;
                up)
                  _values 'up' --install $globals
                  ;;
                down)
                  _values 'down' --all $globals
                  ;;
                *)
                  _values 'global' $globals
                  ;;
              esac
              ;;
          esac
        }}
        _lumina
        """
    ).strip() + "\n"


def _fish() -> str:
    lines = [
        "# lumina fish completion",
        "complete -c lumina -f",
    ]
    for flag in GLOBAL_FLAGS:
        lines.append(f"complete -c lumina -l {flag.lstrip('-')} -d 'global flag'")
    for cmd, subs in sorted(COMMAND_TREE.items()):
        lines.append(f"complete -c lumina -n '__fish_use_subcommand' -a {cmd} -d '{cmd}'")
        for sub in subs:
            if sub.startswith("-"):
                lines.append(
                    f"complete -c lumina -n '__fish_seen_subcommand_from {cmd}' -l {sub.lstrip('-')} -d '{sub}'"
                )
            else:
                lines.append(
                    f"complete -c lumina -n '__fish_seen_subcommand_from {cmd}' -a {sub} -d '{sub}'"
                )
    lines.append(
        "complete -c lumina -n '__fish_seen_subcommand_from knowledge; and __fish_seen_subcommand_from use' -a 'llm_wiki generic_fs'"
    )
    lines.append(
        "complete -c lumina -n '__fish_seen_subcommand_from knowledge; and __fish_seen_subcommand_from provider' -a 'show install doctor'"
    )
    for key in CONFIG_KEYS:
        lines.append(
            f"complete -c lumina -n '__fish_seen_subcommand_from config; and __fish_seen_subcommand_from get set unset' -a {key}"
        )
    return "\n".join(lines) + "\n"
