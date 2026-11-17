import { fetchLatestWaWebVersion, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import { config } from '../config/config.js';
import { logger } from './logger.js';

/**
 * Error 405 "Connection Failure" saat handshake Baileys hampir selalu berarti
 * versi WhatsApp Web yang dipakai sudah ditolak oleh server WhatsApp — bukan
 * masalah kredensial atau kode kita. Ini terjadi karena WhatsApp sering merilis
 * versi baru, sementara versi default yang di-hardcode di dalam package Baileys
 * bisa jadi sudah kedaluwarsa duluan.
 *
 * Urutan resolusi versi (dari yang paling diutamakan):
 *   1. Override manual lewat env WA_BAILEYS_VERSION (format "2,3000,1234567890")
 *      — dipakai sebagai jalan pintas kalau langkah 2 & 3 masih dapat versi basi.
 *   2. fetchLatestWaWebVersion() — ambil versi real-time langsung dari WhatsApp Web.
 *   3. fetchLatestBaileysVersion() — fallback ke metadata versi bawaan Baileys.
 *   4. Versi default bawaan Baileys (dipakai apa adanya oleh makeWASocket kalau
 *      opsi `version` tidak diisi sama sekali).
 */
export async function resolveWaVersion() {
  const override = parseVersionOverride(config.whatsapp.baileysVersionOverride);
  if (override) {
    logger.info({ version: override, source: 'env' }, 'Memakai versi WA Web dari WA_BAILEYS_VERSION');
    return override;
  }

  try {
    const { version } = await fetchLatestWaWebVersion({});
    logger.info({ version, source: 'wa-web-live' }, 'Memakai versi WA Web terbaru (live)');
    return version;
  } catch (err) {
    logger.warn({ err: err.message }, 'fetchLatestWaWebVersion gagal, coba fetchLatestBaileysVersion');
  }

  try {
    const { version } = await fetchLatestBaileysVersion();
    logger.info({ version, source: 'baileys-metadata' }, 'Memakai versi dari metadata Baileys');
    return version;
  } catch (err) {
    logger.warn({ err: err.message }, 'fetchLatestBaileysVersion juga gagal, pakai versi default bawaan Baileys');
  }

  return undefined; // biarkan makeWASocket pakai default internalnya
}

function parseVersionOverride(raw) {
  if (!raw) return null;
  const parts = raw.split(',').map((p) => Number(p.trim()));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    logger.warn({ raw }, 'WA_BAILEYS_VERSION tidak valid, formatnya harus "mayor,minor,build"');
    return null;
  }
  return parts;
}
