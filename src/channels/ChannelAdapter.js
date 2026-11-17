/**
 * Kontrak minimal yang harus dipenuhi setiap channel (WhatsApp, Telegram, REST, dst).
 * Ini murni dokumentasi/JSDoc karena project pakai plain JS, bukan TypeScript —
 * tapi tetap berguna sebagai kontrak yang jelas antar channel.
 *
 * Sebuah channel wajib punya:
 *   - start(onMessage): Promise<any>
 *       Memulai koneksi channel. Setiap pesan masuk yang valid harus memanggil
 *       onMessage({ text, senderLabel, senderNumber, reply }) di mana reply(text) mengirim balasan.
 *   - stop(): Promise<void> (opsional)
 *       Menutup koneksi channel dengan bersih saat graceful shutdown.
 *   - sendMessage(recipient, text): Promise<boolean> (opsional)
 *       Mengirim pesan proaktif (mis. laporan otomatis terjadwal) ke nomor/JID tujuan.
 */
export class ChannelAdapter {
  async start(_onMessage) {
    throw new Error('start() belum diimplementasikan oleh channel ini');
  }

  async stop() {}

  async sendMessage(_recipient, _text) {
    throw new Error('sendMessage() belum diimplementasikan oleh channel ini');
  }
}
