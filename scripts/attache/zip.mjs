/**
 * SIRAL — archive ZIP à entrées STOCKÉES (sans compression), en pur Node.
 *
 * Source unique partagée par le constructeur de `.skill` (scripts/build-skill.mjs)
 * et le « dossier de rédaction » du service attaché (redaction.mjs). Lisible
 * par tout outil zip standard et par l'import de skills de SIRAL.
 */

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b }

/** ZIP à entrées stockées : [{ name, data }] → Buffer. Noms en UTF-8 (drapeau 0x0800). */
export function zipStore(entries) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8')
    const crc = crc32(data)
    const local = Buffer.concat([
      Buffer.from('PK\x03\x04', 'binary'), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
      u32(crc), u32(data.length), u32(data.length), u16(nameBuf.length), u16(0), nameBuf, data,
    ])
    centrals.push(Buffer.concat([
      Buffer.from('PK\x01\x02', 'binary'), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
      u32(crc), u32(data.length), u32(data.length), u16(nameBuf.length), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(offset), nameBuf,
    ]))
    locals.push(local)
    offset += local.length
  }
  const centralDir = Buffer.concat(centrals)
  const eocd = Buffer.concat([
    Buffer.from('PK\x05\x06', 'binary'), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(centralDir.length), u32(offset), u16(0),
  ])
  return Buffer.concat([...locals, centralDir, eocd])
}
