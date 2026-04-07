/**
 * 简易日志系统 — debug 模式下输出详细信息到 stderr
 * （MCP Stdio 模式下 stdout 被协议占用，日志必须走 stderr）
 */

let debugEnabled = false;

export function enableDebug(enabled: boolean) {
  debugEnabled = enabled;
}

export function isDebug(): boolean {
  return debugEnabled;
}

export function logDebug(tag: string, ...args: any[]) {
  if (!debugEnabled) return;
  const ts = new Date().toISOString();
  console.error(`[${ts}] [DEBUG] [${tag}]`, ...args);
}

export function logInfo(tag: string, ...args: any[]) {
  const ts = new Date().toISOString();
  console.error(`[${ts}] [INFO] [${tag}]`, ...args);
}

export function logError(tag: string, ...args: any[]) {
  const ts = new Date().toISOString();
  console.error(`[${ts}] [ERROR] [${tag}]`, ...args);
}
