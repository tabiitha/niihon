# Optional Local AI Workflow

## Shared and Personal Responsibilities

`AGENTS.md`, accepted decisions, Git rules, and engineering tools describe project requirements. Contributors can satisfy them using their preferred tools or without AI. Models, reasoning efforts, named roles, delegation limits, and personal prompts are not shared contribution requirements.

The maintainer keeps active Codex configuration in ignored `.codex/config.toml`, role definitions in `.codex/agents/`, and personal routing instructions in `.codex/README.md`. These files remain on the maintainer's machine and are absent from the final versioned tree. Back them up separately; a fresh clone does not reproduce that setup.

## Instruction Loading

For a trusted project, Codex can use project-local configuration. The maintainer's top-level `developer_instructions` explicitly asks Codex to read the local workflow for the Niihon remote and supplement shared `AGENTS.md` rules. Keep this setting outside TOML section tables and preserve unrelated configuration.

Do not use an override file that replaces shared instructions just to add personal routing. Check configuration loading, model access, and named-role discovery in a new trusted session. A parsed TOML file does not prove that a role was discovered or launched. If delegation tools are unavailable, report that limitation and leave requested independent AI review pending.

## Integration

The maintainer arranges personal additional review checks. External contributors supply scope, validation, and required review evidence without installing the maintainer's AI workflow. Local reports cannot replace an eligible GitHub approval or grant merge authorization.

Official references: [configuration layers](https://learn.chatgpt.com/docs/config-file/config-basic), [additional developer instructions](https://learn.chatgpt.com/docs/config-file/config-reference), and [custom subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents).
