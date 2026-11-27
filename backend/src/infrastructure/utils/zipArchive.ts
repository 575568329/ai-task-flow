// backend/src/infrastructure/utils/zipArchive.ts
// 极简 ZIP 打包:只写 deflate/store 两种方式,UTF-8 文件名,不写注释与扩展字段。
// 刻意不引第三方 zip 依赖:uTools 发行包要求 node_modules 尽量小且明文可读。
import { deflateRaw } from 'node:zlib';
import { promisify } from 'node:util';

/** 异步压缩:知识库可能几百 MB,同步 deflate 会把 Fastify 事件循环卡住 */
const deflateRawAsync = promisify(deflateRaw);

export interface ZipEntry {
  /** 压缩包内相对路径,统一用 '/' 分隔 */
  path: string;
  content: Buffer;
  /** 文件修改时间,写进 DOS 时间戳;缺省用打包时刻 */
  mtime?: Date;
}

/** ZIP 局部文件头 / 中央目录项签名 */
const LOCAL_HEADER_SIG = 0x04034b50;
const CENTRAL_HEADER_SIG = 0x02014b50;
const END_OF_CENTRAL_SIG = 0x06054b50;
/** ZIP 2.0:足够覆盖 deflate,现代解压工具都认 */
const VERSION_NEEDED = 20;
/** 通用标志位 bit 11:文件名为 UTF-8(中文路径必需) */
const FLAG_UTF8 = 0x0800;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** DOS 时间戳精度 2 秒,年份从 1980 起算 */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(date.getFullYear(), 1980);
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/** 打包成 zip 字节流;同样的输入(含 mtime)产出同样的字节 */
export async function buildZip(entries: ZipEntry[]): Promise<Buffer> {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.path, 'utf8');
    const uncompressed = entry.content;
    const deflated = await deflateRawAsync(uncompressed);
    // 压缩反而变大(已压缩内容)时退回 store,避免无意义膨胀
    const useDeflate = deflated.length < uncompressed.length;
    const payload = useDeflate ? deflated : uncompressed;
    const method = useDeflate ? METHOD_DEFLATE : METHOD_STORE;
    const checksum = crc32(uncompressed);
    const { time, date } = dosDateTime(entry.mtime ?? new Date());

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_HEADER_SIG, 0);
    local.writeUInt16LE(VERSION_NEEDED, 4);
    local.writeUInt16LE(FLAG_UTF8, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(uncompressed.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    localChunks.push(local, name, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_HEADER_SIG, 0);
    central.writeUInt16LE(VERSION_NEEDED, 4);
    central.writeUInt16LE(VERSION_NEEDED, 6);
    central.writeUInt16LE(FLAG_UTF8, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(uncompressed.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);

    centralChunks.push(central, name);
    offset += local.length + name.length + payload.length;
  }

  const centralDirectory = Buffer.concat(centralChunks);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_CENTRAL_SIG, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localChunks, centralDirectory, end]);
}
