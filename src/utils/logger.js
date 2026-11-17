import pino from 'pino';
import { config } from '../config/config.js';

export const logger = pino({
  level: config.logLevel,
  transport: {
    target: 'pino-pretty',
    options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' },
  },
});

/**
 * Helper untuk logging setiap tahap alur pesan, agar kalau ada error
 * kita tahu persis di step mana gagal (Incoming -> Parser -> Validation -> Sheets -> Reply).
 */
export function stepLogger(traceId) {
  return {
    step(name, data = {}) {
      logger.info({ traceId, step: name, ...data }, `[${traceId}] ${name}`);
    },
    error(name, err, data = {}) {
      logger.error({ traceId, step: name, err: err?.message, stack: err?.stack, ...data }, `[${traceId}] GAGAL di step: ${name}`);
    },
  };
}
