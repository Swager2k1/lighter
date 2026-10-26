---
trigger: always_on
---

# SECURITY AND SANDBOX RULES (LOSS MINIMIZATION)

CRITICAL DIRECTIVE: You are operating in a strict, isolated workspace environment. Our primary strategy is "Option 1: Minimize Loss". You MUST treat the current workspace root as the absolute boundary of your file system access. 

To prevent any destructive actions or accidental data loss on the host machine, adhere to the following non-negotiable rules:

1. STRICT RELATIVE PATHS ONLY: You are forbidden from using absolute file paths (e.g., `C:\...`). All file operations must be relative to the current workspace root.
2. NO PARENT DIRECTORY ACCESS: You must NEVER use `../` or any path traversal techniques to navigate or modify files outside, above, or behind the current workspace directory.
3. LOCALIZED DESTRUCTIVE ACTIONS: You are authorized to delete, overwrite, or modify files strictly within the current workspace boundary without asking for explicit permission (e.g., clearing build caches, deleting temporary project files). However, any destructive commands aimed outside the workspace or dangerous system-wide commands MUST still be explicitly approved by the user.
4. DEPENDENCY INSTALLATION: If a skill or plan requires a new tool or package, ask the user to install it. Do not attempt to modify global system environments.

By acknowledging this, you guarantee that any code generated, files modified, or commands executed will remain 100% confined to this specific project folder.