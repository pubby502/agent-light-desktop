#!/usr/bin/env node
/**
 * cursor-bridge.js — Cursor Agent 状态 → 红绿灯挂件桥接
 *
 * 从 agent-light.js 重构而来，使用 bridge-core.js 共享模块。
 * 由 Cursor Hooks 调用，解析 HOOK_INPUT 环境变量，通过 WebSocket 发状态给桌面挂件。
 *
 * 用法:
 *   node cursor-bridge.js <action>
 *
 * action 来自 hooks.json 绑定的 Cursor Hook 事件:
 *   turn-start, thinking, busy, stop, idle, plan-detect, plan-file, plan-created, denied, alarm-shell, await-user
 */

const bridge = require('./bridge-core');

// ── 主逻辑 ────────────────────────────────────────────

async function main() {
  bridge.init({ agent: 'cursor' });

  const action = process.argv[2];
  if (!action) {
    console.error('Usage: node cursor-bridge.js <action>');
    process.exit(1);
  }

  const input = await bridge.readHookInput();
  const { toolName, toolInput, filePath, text, status, failureType } = input;

  bridge.updateHeartbeat();

  // 调试
  if (!status && action === 'stop') {
    const rawEnv = process.env.HOOK_INPUT;
    bridge.log(`DEBUG stop raw: env=${rawEnv ? rawEnv.substring(0, 200) : '(none)'}`);
  }

  bridge.log(`action=${action} tool=${toolName || '-'} status=${status || '-'}`);

  switch (action) {
    // ── 用户提交 Prompt / Agent 开始思考 ──
    case 'turn-start': {
      const g = bridge.gateCheck('turn-start', 'thinking');
      if (g.send) await bridge.sendToWidget(g.mode);
      break;
    }

    // ── Agent 思考中 ──
    case 'thinking': {
      const g = bridge.gateCheck('thinking', 'thinking');
      if (g.send) await bridge.sendToWidget(g.mode);
      break;
    }

    // ── 等待用户 (AskQuestion) ──
    case 'await-user': {
      bridge.setStateFlag('awaitingUser', true);
      const g = bridge.gateCheck('await-user', 'alarm');
      if (g.send) {
        await bridge.sendToWidget(g.mode);
        bridge.log('await-user -> alarm (AskQuestion / Questions UI)');
      }
      break;
    }

    // ── 工具调用 (busy) — 含三层防御检测 ──
    case 'busy': {
      // 第一层防御：检测提问类工具
      if (bridge.isAskTool(toolName)) {
        bridge.setStateFlag('awaitingUser', true);
        const g = bridge.gateCheck('await-user', 'alarm');
        if (g.send) {
          await bridge.sendToWidget(g.mode);
          bridge.log(`busy: tool=${toolName} is ask tool → alarm`);
        }
        break;
      }

      // 第一层防御：检测需要用户授权的高风险工具 → 直接转入 alarm
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

      // Plan 写入检测
      if (bridge.toolIsPlanWrite(toolName, input)) {
        bridge.setStateFlag('planTouched', true);
        bridge.setStateFlag('awaitingBuild', true);
        bridge.log(`busy: plan write -> awaiting Build (tool=${toolName})`);
      }
      // 用户已点 Build 开始执行
      else if (bridge.getStateFlag('awaitingBuild') && toolName !== 'CreatePlan') {
        bridge.setStateFlag('awaitingBuild', false);
        bridge.setStateFlag('buildStarted', true);
        bridge.log(`busy: cleared awaiting_build, build_started (tool=${toolName || 'unknown'})`);
      }
      // 执行类工具
      else if (bridge.isExecTool(toolName, input)) {
        bridge.setStateFlag('buildStarted', true);
        bridge.log(`busy: build_started (exec tool=${toolName})`);
      }

      const g = bridge.gateCheck('busy', 'busy');
      if (g.send) await bridge.sendToWidget(g.mode);
      break;
    }

    // ── Plan 创建后 (CreatePlan) ──
    case 'plan-created': {
      bridge.setStateFlag('planTouched', true);
      bridge.setStateFlag('awaitingBuild', true);
      const g = bridge.gateCheck('await-user', 'alarm');
      if (g.send) {
        await bridge.sendToWidget(g.mode);
        bridge.log('plan-created (CreatePlan) awaiting_build=true -> alarm');
      }
      break;
    }

    // ── Plan 模式检测 ──
    case 'plan-detect': {
      if (bridge.getStateFlag('buildStarted')) {
        bridge.log('plan-detect skip (build already started)');
        break;
      }
      if (bridge.looksLikePlanAwaiting(text)) {
        bridge.setStateFlag('planTouched', true);
        bridge.setStateFlag('awaitingBuild', true);
        const g = bridge.gateCheck('await-user', 'alarm');
        if (g.send) {
          await bridge.sendToWidget(g.mode);
          bridge.log('plan-detect awaiting_build=true -> alarm');
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
      if (bridge.getStateFlag('buildStarted')) {
        bridge.log('plan-file skip (build already started)');
        break;
      }
      if (bridge.isPlanFilePath(filePath)) {
        bridge.setStateFlag('planTouched', true);
        bridge.setStateFlag('awaitingBuild', true);
        const g = bridge.gateCheck('await-user', 'alarm');
        if (g.send) {
          await bridge.sendToWidget(g.mode);
          bridge.log(`plan-file awaiting_build=true path=${path.basename(filePath)} -> alarm`);
        }
      }
      break;
    }

    // ── Agent 停止 — 含第二层防御：静默窗口检测 ──
    case 'stop': {
      const effectiveStatus = status || (bridge.getStateFlag('buildStarted') ? 'completed' : 'completed');
      bridge.log(`stop status=${status || '(empty)'} → effective=${effectiveStatus}`);

      switch (effectiveStatus) {
        case 'completed': {
          if (bridge.getStateFlag('awaitingUser') || bridge.getStateFlag('authPending')) {
            const g = bridge.gateCheck('stop-success', 'alarm');
            if (g.send) {
              await bridge.sendToWidget(g.mode);
              bridge.log('stop -> alarm (awaiting user input/authorization)');
            }
          } else if (bridge.getStateFlag('buildStarted')) {
            const g = bridge.gateCheck('stop-success', 'success');
            if (g.send) {
              await bridge.sendToWidget(g.mode);
              bridge.log('stop -> success (build started)');
            }
          } else if (bridge.getStateFlag('awaitingBuild')) {
            const g = bridge.gateCheck('stop-success', 'alarm');
            if (g.send) {
              await bridge.sendToWidget(g.mode);
              bridge.log('stop -> alarm (awaiting Build)');
            }
          } else if (bridge.getStateFlag('planTouched') || bridge.hasRecentPlanAwaiting()) {
            const recentPlan = bridge.hasRecentPlanAwaiting();
            bridge.setStateFlag('awaitingBuild', true);
            const g = bridge.gateCheck('stop-success', 'alarm');
            if (g.send) {
              await bridge.sendToWidget(g.mode);
              bridge.log(`stop -> alarm (plan ready, await Build${recentPlan ? ', file=' + recentPlan : ''})`);
            }
          } else {
            // 第三层防御：检查心跳超时
            if (bridge.checkSilenceAlarm()) {
              const g = bridge.gateCheck('stop-success', 'alarm');
              if (g.send) {
                await bridge.sendToWidget(g.mode);
                bridge.log('stop -> alarm (silence detected, user may need to act)');
              }
            } else {
              const g = bridge.gateCheck('stop-success', 'success');
              if (g.send) {
                await bridge.sendToWidget(g.mode);
                bridge.log('stop -> success');
              }
            }
          }
          break;
        }

        case 'error':
        case 'aborted': {
          const g = bridge.gateCheck('stop-error', 'error');
          if (g.send) {
            await bridge.sendToWidget(g.mode);
            bridge.log('stop -> error');
          }
          break;
        }

        default:
          bridge.log('stop no mode change');
      }
      break;
    }

    // ── 工具调用失败 (含授权拒绝) ──
    case 'denied': {
      // 判断是否为用户授权拒绝
      const isPermissionDenied = failureType === 'permission_denied' || failureType === 'tool_denied';
      if (isPermissionDenied) {
        // 用户拒绝了授权 — Agent 可能在想替代方案
        bridge.setStateFlag('authPending', false);
        bridge.setStateFlag('awaitingUser', false);
        const g = bridge.gateCheck('denied-thinking', 'thinking');
        if (g.send) await bridge.sendToWidget(g.mode);
        bridge.log(`denied: permission_denied → thinking (agent reconsidering)`);
      } else {
        const g = bridge.gateCheck('denied-error', 'error');
        if (g.send) await bridge.sendToWidget(g.mode);
        bridge.log('denied → error');
      }
      break;
    }

    // ── 会话结束 → 空闲 — 含第三层防御：心跳超时检测 ──
    case 'idle': {
      if (bridge.getStateFlag('awaitingBuild') || bridge.getStateFlag('awaitingUser') || bridge.getStateFlag('authPending')) {
        const g = bridge.gateCheck('idle', 'alarm');
        if (g.send) {
          await bridge.sendToWidget(g.mode);
          bridge.log('idle -> alarm (still awaiting user/build action)');
        }
      } else {
        // 第三层防御：最终检查
        if (bridge.checkSilenceAlarm()) {
          const g = bridge.gateCheck('idle', 'alarm');
          if (g.send) {
            await bridge.sendToWidget(g.mode);
            bridge.log('idle: silence alarm (user may need to act)');
          }
        } else {
          const g = bridge.gateCheck('idle', 'idle');
          if (g.send) await bridge.sendToWidget(g.mode);
        }
      }
      break;
    }

    default:
      bridge.log(`unknown action=${action}`);
  }
}

const path = require('path');

main().catch((e) => {
  bridge.log(`FATAL: ${e.message}\n${e.stack}`);
  process.exit(1);
});
