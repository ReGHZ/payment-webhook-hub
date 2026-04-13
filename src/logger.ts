import pino from 'pino'

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  // Compatible with Promtail pipeline (Winston-style fields)
  messageKey: 'message',
  timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
  formatters: {
    level(label) {
      return { level: label }
    }
  }
})

export default logger