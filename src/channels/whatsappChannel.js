import fs from 'fs';
import os from 'os';
import path from 'path';
import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import { Boom } from '@hapi/boom';
import { config, normalizePhoneNumber } from '../config/config.js';
import { logger } from '../utils/logger.js';
import { resolveWaVersion } from '../utils/waVersionResolver.js';
import { ChannelAdapter } from './ChannelAdapter.js';

const MAX_RECONNECT_DELAY_MS = 30_000;
export const HEALTH_FILE_PATH = path.join(os.tmpdir(), 'wa-expense-health.json');

/**
 * Adapter WhatsApp berbasis Baileys. Ini hanya "pintu masuk/keluar" pesan —
 * tidak ada business logic di sini sama sekali. Semua pesan masuk yang valid
 * diteruskan ke callback onMessage({ text, senderLabel, senderNumber, reply })
 * yang dihubungkan ke MessageController.
 */
export class WhatsAppChannel extends ChannelAdapter {
  #reconnectAttempt = 0;
  #sock = null;
  #reconnectTimer = null;
  #isStopping = false;
  #isConnected = false;

  #writeHealthStatus(status, extra = {}) {
    try {
      fs.writeFileSync(
        HEALTH_FILE_PATH,
        JSON.stringify({ status, updatedAt: new Date().toISOString(), ...extra })
      );
    } catch {
      // Abaikan jika gagal menulis file health sementara
    }
  }

  #cleanupSocket() {
    this.#isConnected = false;
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
    if (this.#sock) {
      try {
        this.#sock.ev.removeAllListeners();
        this.#sock.end(undefined);
      } catch {
        // Abaikan error saat menutup socket lama
      }
      this.#sock = null;
    }
  }

  async stop() {
    this.#isStopping = true;
    this.#writeHealthStatus('stopped');
    this.#cleanupSocket();
  }

  async sendMessage(recipient, text) {
    if (!text) return false;
    if (!this.#sock || !this.#isConnected) {
      throw new Error('WhatsApp belum terhubung');
    }
    const raw = String(recipient || '').trim();
    if (!raw) {
      throw new Error('Penerima pesan kosong');
    }
    const jid = raw.includes('@') ? raw : `${normalizePhoneNumber(raw)}@s.whatsapp.net`;
    await this.#sock.sendMessage(jid, { text });
    return true;
  }

  async start(onMessage) {
    this.#isStopping = false;
    this.#cleanupSocket();

    const { state, saveCreds } = await useMultiFileAuthState(config.whatsapp.authFolder);
    const version = await resolveWaVersion();

    const sock = makeWASocket({
      auth: state,
      version, // penting: mencegah error 405 "Connection Failure" akibat versi WA Web basi
      printQRInTerminal: false,
      logger: logger.child({ module: 'baileys' }),
    });
    this.#sock = sock;
    this.#writeHealthStatus('starting');

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
      if (this.#isStopping) return;
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        this.#reconnectAttempt = 0; // QR muncul berarti handshake versi sudah benar
        this.#writeHealthStatus('awaiting_qr');
        console.log('\nScan QR code berikut dengan WhatsApp (Linked Devices):\n');
        qrcode.generate(qr, { small: true });
      }

      if (connection === 'close') {
        this.#isConnected = false;
        const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        logger.warn({ statusCode }, 'Koneksi WhatsApp terputus');

        if (!shouldReconnect) {
          this.#writeHealthStatus('logged_out', { statusCode });
          logger.error('Sesi logout. Hapus folder auth_session dan scan ulang QR.');
          return;
        }

        if (statusCode === 405) {
          logger.error(
            'Error 405 (Connection Failure) — biasanya berarti versi WA Web yang dipakai sudah ditolak WhatsApp. ' +
              'Kalau ini terus berulang, set WA_BAILEYS_VERSION di .env dengan versi terbaru (cek README bagian Troubleshooting).'
          );
        }

        this.#writeHealthStatus('reconnecting', { statusCode });

        // Reconnect dengan backoff, bukan langsung tanpa jeda —
        // supaya tidak spam handshake ke WhatsApp saat error berulang (mis. 405).
        this.#reconnectAttempt += 1;
        const delay = Math.min(1000 * 2 ** this.#reconnectAttempt, MAX_RECONNECT_DELAY_MS);
        logger.info({ delayMs: delay, attempt: this.#reconnectAttempt }, 'Mencoba menyambung ulang...');
        this.#reconnectTimer = setTimeout(() => this.start(onMessage), delay);
      } else if (connection === 'open') {
        this.#isConnected = true;
        this.#reconnectAttempt = 0;
        this.#writeHealthStatus('connected');
        logger.info('WhatsApp terhubung.');
      }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify' || this.#isStopping) return;

      for (const msg of messages) {
        if (!msg.message || msg.key.fromMe) continue;

        const remoteJid = msg.key.remoteJid || '';
        if (!remoteJid || remoteJid === 'status@broadcast' || remoteJid.endsWith('@newsletter')) {
          continue;
        }

        const isGroup = remoteJid.endsWith('@g.us');
        if (isGroup && !config.whatsapp.allowGroups) {
          continue;
        }

        // Untuk chat grup, nomor pengirim ada di msg.key.participant; untuk chat pribadi ada di remoteJid.
        const rawSenderJid = isGroup ? msg.key.participant || '' : remoteJid;
        const senderNumber = extractCleanNumber(rawSenderJid);

        const { allowedNumbers } = config.whatsapp;
        if (allowedNumbers.length > 0 && !allowedNumbers.includes(senderNumber)) {
          logger.warn({ senderNumber, isGroup }, 'Pesan ditolak: nomor tidak ada di WA_ALLOWED_NUMBERS');
          continue;
        }

        const text =
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          msg.message.imageMessage?.caption ||
          '';
        if (!text.trim()) continue;

        // Label pengirim (nama kontak kalau ada, kalau tidak pakai nomor) —
        // dipakai MessageController & BudgetService untuk mengenali Suami / Istri.
        const senderLabel = msg.pushName || senderNumber;

        await onMessage({
          text,
          senderLabel,
          senderNumber,
          reply: async (replyText) => {
            if (!replyText) return; // null = sengaja tidak membalas
            await sock.sendMessage(remoteJid, { text: replyText });
          },
        });
      }
    });

    return sock;
  }
}

function extractCleanNumber(jid) {
  if (!jid) return '';
  const userPart = jid.split('@')[0] || '';
  const withoutDevice = userPart.split(':')[0] || '';
  return normalizePhoneNumber(withoutDevice);
}
