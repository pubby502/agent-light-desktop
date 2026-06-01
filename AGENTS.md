## Agent skills

### Issue tracker

GitHub Issues — issues 通过 `gh` CLI 管理，仓库为 `pubby502/agent-light-desktop`。详见 `docs/agents/issue-tracker.md`。

### Triage labels

默认标签：`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`。Agent 可认领所有类型 issue（含视觉/硬件类），但需人工验证闭合。详见 `docs/agents/triage-labels.md`。

### Domain docs

单上下文 — `CONTEXT.md` + `docs/adr/` 位于仓库根目录。详见 `docs/agents/domain.md`。

### Traffic Light 状态灯

Traffic Light 挂件通过 `cursor-bridge.js` / `claude-bridge.js` 自动接收 Agent 状态，无需手动发送。
