type LogLevel = "INFO" | "ERROR" | "WARN"

function formatLog(level: LogLevel, scope: string, message: string) {
  return `${new Date().toISOString()} ${level} [${scope}] ${message}`
}

export function logInfo(scope: string, message: string, details?: unknown) {
  if (details === undefined) {
    console.log(formatLog("INFO", scope, message))
    return
  }

  console.log(formatLog("INFO", scope, message), details)
}

export function logWarn(scope: string, message: string, details?: unknown) {
  if (details === undefined) {
    console.warn(formatLog("WARN", scope, message))
    return
  }

  console.warn(formatLog("WARN", scope, message), details)
}

export function logError(scope: string, message: string, details?: unknown) {
  if (details === undefined) {
    console.error(formatLog("ERROR", scope, message))
    return
  }

  console.error(formatLog("ERROR", scope, message), details)
}
