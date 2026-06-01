#!/usr/bin/env node
/**
 * claude-bridge.js — Claude Code Agent 状态 → 红绿灯挂件桥接
 *
 * 使用 bridge-core.js 共享模块。
 * 由 Claude Code Hooks 调用，解析 HOOK_INPUT 环境变量，通过 WebSocket 发状态给桌面挂件。
 *
 * Claude Code Hook 事件 (hooks 配置在 ~/.claude/settings.json 或 CLAUDE.md):
 *   UserPromptSubmit  → turn-start
 *   PreToolUse        → busy / await-user (AskUserQuestion → alarm)
 *   PostToolUse       → plan-created (CreatePlan)
 *   PostToolUseFailure → denied
 *   Stop              → stop
 *   SessionEnd        → idle
 *   Notification      → plan-detect (via afterAgentResponse)
 *
 * 用法:
 *   node claude-bridge.js <action>
 */

const bridge = require('./bridge-core');

async function main() {
  bridge.init({ agent: 'claude' });

  const action = process.argv[2];
  if (!action) {
    console.error('Usage: node claude-bridge.js <action>');
    process.exit(1);
  }

  const input = await bridge.readHookInput();
  const { toolName, toolInput, filePath, text, status, failureType } = input;

  bridge.updateHeartbeat();
  bridge.log(`action=${action} tool=${toolName || '-'} status=${status || '-'}`);

  switch (action) {
    // ── 用户提交 Prompt ──
    case 'turn-start': {
      const g = bridge.gateCheck('turn-start', 'thinking');
      if (g.send) await bridge.sendToWidget(g.mode);
      break;
    }

    // ── 等待用户 (AskUserQuestion / 提问类工具) ──
    case 'await-user': {
      bridge.setStateFlag('awaitingUser', true);
      const g = bridge.gateCheck('await-user', 'alarm');
      if (g.send) {
        await bridge.sendToWidget(g.mode);
        bridge.log('await-user -> alarm (AskUserQuestion)');
      }
      break;
    }

    // ── 工具调用 ──
    case 'busy': {
      // 检测提问类工具
      if (bridge.isAskTool(toolName)) {
        bridge.setStateFlag('awaitingUser', true);
        const g = bridge.gateCheck('await-user', 'alarm');
        if (g.send) {
          await bridge.sendToWidget(g.mode);
          bridge.log(`busy: tool=${toolName} is ask tool → alarm`);
        }
        break;
      }

      // 检测需要授权的高风险工具 → 直接转入 alarm（用户需批准才能继续）
      if (bridge.isAuthRequiredTool(toolName, input)) {
        bridge.setStateFlag('authPending', true);
        bridge.setStateFlag('awaitingUser', true);
        const g = bridge.gateCheck('await-user', 'alarm');
        if (g.send) {
          await bridge.sendToWidget(g.mode);
          bridge.log(`busy: auth-required tool=${toolName} → alarm`);
        }
        break;
      }

      // 非 Ask / 非 Auth 工具：说明之前的授权已通过，清除 authPending
      if (bridge.getStateFlag('awaitingUser')) {
        bridge.setStateFlag('awaitingUser', false);
      }
      if (bridge.getStateFlag('authPending')) {
        bridge.setStateFlag('authPending', false);
        bridge.log('busy: cleared stale authPending (non-auth tool follows)');
      }

      // Plan 写入检测 (Claude Code 也可能写 .plan.md)
      if (bridge.toolIsPlanWrite(toolName, input)) {
        bridge.setStateFlag('planTouched', true);
        bridge.setStateFlag('awaitingBuild', true);
        bridge.log(`busy: plan write -> awaiting Build`);
      } else if (bridge.getStateFlag('awaitingBuild') && toolName !== 'CreatePlan') {
        bridge.setStateFlag('awaitingBuild', false);
        bridge.setStateFlag('buildStarted', true);
      } else if (bridge.isExecTool(toolName, input)) {
        bridge.setStateFlag('buildStarted', true);
      }

      const g = bridge.gateCheck('busy', 'busy');
      if (g.send) await bridge.sendToWidget(g.mode);
      break;
    }

    // ── Plan 创建后 ──
    case 'plan-created': {
      bridge.setStateFlag('planTouched', true);
      bridge.setStateFlag('awaitingBuild', true);
      const g = bridge.gateCheck('await-user', 'alarm');
      if (g.send) {
        await bridge.sendToWidget(g.mode);
        bridge.log('plan-created -> alarm');
      }
      break;
    }

    // ── Agent 回复文本检测 plan ──
    case 'plan-detect': {
      if (bridge.getStateFlag('buildStarted')) {
        bridge.log('plan-detect skip (build started)');
        break;
      }
      if (bridge.looksLikePlanAwaiting(text)) {
        bridge.setStateFlag('planTouched', true);
        bridge.setStateFlag('awaitingBuild', true);
        const g = bridge.gateCheck('await-user', 'alarm');
        if (g.send) {
          await bridge.sendToWidget(g.mode);
          bridge.log('plan-detect -> alarm');
        }
      } else if (bridge.looksLikeUserAwaiting(text)) {
        bridge.setStateFlag('awaitingUser', true);
        const g = bridge.gateCheck('await-user', 'alarm');
        if (g.send) {
          await bridge.sendToWidget(g.mode);
          bridge.log('plan-detect awaiting_user=true -> alarm');
        }
      }
      break;
    }

    // ── 文件编辑检测 plan ──
    case 'plan-file': {
      if (bridge.getStateFlag('buildStarted')) break;
      if (bridge.isPlanFilePath(filePath)) {
        bridge.setStateFlag('planTouched', true);
        bridge.setStateFlag('awaitingBuild', true);
        const g = bridge.gateCheck('await-user', 'alarm');
        if (g.send) {
          await bridge.sendToWidget(g.mode);
          bridge.log(`plan-file -> alarm`);
        }
      }
      break;
    }

    // ── Agent 停止 ──
    case 'stop': {
      // 先检测 plan 模式 (Claude Code 无 afterAgentResponse 事件，在 Stop 中检测)
      if (!bridge.getStateFlag('buildStarted')) {
        if (bridge.looksLikePlanAwaiting(text)) {
          bridge.setStateFlag('planTouched', true);
          bridge.setStateFlag('awaitingBuild', true);
          const g = bridge.gateCheck('await-user', 'alarm');
          if (g.send) {
            await bridge.sendToWidget(g.mode);
            bridge.log('stop: plan detected in response → alarm');
          }
          break;
        }
        if (bridge.looksLikeUserAwaiting(text)) {
          bridge.setStateFlag('awaitingUser', true);
          const g = bridge.gateCheck('await-user', 'alarm');
          if (g.send) {
            await bridge.sendToWidget(g.mode);
            bridge.log('stop: awaiting user detected in response → alarm');
          }
          break;
        }
      }

      const effectiveStatus = status || 'completed';
      bridge.log(`stop status=${status || '(empty)'} → ${effectiveStatus}`);

      switch (effectiveStatus) {
        case 'completed': {
          if (bridge.getStateFlag('awaitingUser') || bridge.getStateFlag('authPending')) {
            const g = bridge.gateCheck('stop-success', 'alarm');
            if (g.send) await bridge.sendToWidget(g.mode);
          } else if (bridge.getStateFlag('buildStarted')) {
            const g = bridge.gateCheck('stop-success', 'success');
            if (g.send) await bridge.sendToWidget(g.mode);
          } else if (bridge.getStateFlag('awaitingBuild')) {
            const g = bridge.gateCheck('stop-success', 'alarm');
            if (g.send) await bridge.sendToWidget(g.mode);
          } else {
            const g = bridge.gateCheck('stop-success', 'success');
            if (g.send) await bridge.sendToWidget(g.mode);
          }
          break;
        }
        case 'error':
        case 'aborted': {
          const g = bridge.gateCheck('stop-error', 'error');
          if (g.send) await bridge.sendToWidget(g.mode);
          break;
        }
        default:
          bridge.log('stop no mode change');
      }
      break;
    }

    // ── 工具失败 ──
    case 'denied': {
      const isPermissionDenied = failureType === 'permission_denied';
      if (isPermissionDenied) {
        bridge.setStateFlag('authPending', false);
        bridge.setStateFlag('awaitingUser', false);
        const g = bridge.gateCheck('denied-thinking', 'thinking');
        if (g.send) await bridge.sendToWidget(g.mode);
      } else {
        const g = bridge.gateCheck('denied-error', 'error');
        if (g.send) await bridge.sendToWidget(g.mode);
      }
      break;
    }

    // ── 会话空闲 ──
    case 'idle': {
      if (bridge.getStateFlag('awaitingBuild') || bridge.getStateFlag('awaitingUser') || bridge.getStateFlag('authPending')) {
        const g = bridge.gateCheck('idle', 'alarm');
        if (g.send) await bridge.sendToWidget(g.mode);
      } else {
        const g = bridge.gateCheck('idle', 'idle');
        if (g.send) await bridge.sendToWidget(g.mode);
      }
      break;
    }

    default:
      bridge.log(`unknown action=${action}`);
  }
}

main().catch((e) => {
  bridge.log(`FATAL: ${e.message}\n${e.stack}`);
  process.exit(1);
});
