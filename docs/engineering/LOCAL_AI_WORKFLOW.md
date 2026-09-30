# Optional Local AI Workflow

## Shared and Personal Responsibilities

`AGENTS.md`, accepted decisions, Git rules, and engineering tools describe project requirements. Contributors can satisfy them using their preferred tools or without AI. Models, reasoning efforts, named roles, delegation limits, and personal prompts are not shared contribution requirements.

Personal model choices, role definitions, permissions, and routing instructions remain on the user's machine and are not distributed with the repository. Back them up separately; a fresh clone does not reproduce a personal setup. The shared workflow never depends on one assistant's configuration directory.

## Instruction Loading

Use `AGENTS.md` and linked engineering guides as the common source for project instructions. Keep tool-specific settings in the assistant's supported local configuration. If an assistant needs a separate entry point, reference the common guidance instead of copying it into a second maintained document.

Personal routing supplements the project rules rather than replacing them. Check instruction loading, model access, and optional role discovery after switching tools or sessions. A syntactically valid configuration does not prove that instructions were loaded or a role was launched. If requested delegation tools are unavailable, report that limitation and leave independent AI review pending.

## Switching Assistants

Resume from the same task packet under `.local/harness/tasks/`, with its Goal, authorization, file ownership, unresolved work, and verification specification. Recheck Git and current evidence before acting. Preserve review responsibilities across tools; assign each role to an available person or assistant without assuming model identifiers, reasoning levels, or permissions are interchangeable. Chats and an assistant's private memory are not the project's authoritative task state.

## Integration

The maintainer arranges personal additional review checks. External contributors supply scope, validation, and required review evidence without installing the maintainer's AI workflow. Local reports cannot replace an eligible GitHub approval or grant merge authorization.

Consult the selected assistant's official documentation when configuring instruction loading, models, permissions, or delegation. Tool-specific setup belongs in local instructions; shared project rules remain here and in `AGENTS.md`.
