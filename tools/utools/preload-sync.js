/**
 * uTools 账号同步(明文可读)
 *
 * 方案:本地文件仍是运行时权威来源;uTools db 保存一份「压缩快照」。
 *  - 启动时先把云端较新的快照恢复到本地,再拉起 backend;
 *  - 运行中本地有变更时,防抖后推送快照;
 *  - 每次覆盖前都备份对手方数据到 ~/.ai-task-flow/sync-conflicts/,避免静默丢数据。
 *
 * 同步范围:worklog.json / conclusions.json / mindmaps.json + knowledge-base 下的文本文件。
 * 不同步:llm-config.json、claude-profiles.json(含密钥)、uploads 图片、logs、备份/索引缓存。
 * uTools db 限制:单文档 1MB,所以快照 gzip+base64 后按 600KB 分片,清单单独一个文档。
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const SYNC_SCHEMA = 1;
// 不用 "/" 做 doc id 分隔符,避免不同客户端对 ID 字符集的差异
const MANIFEST_ID = 'atf-sync-manifest';
const CHUNK_ID_PREFIX = 'atf-sync-chunk-';
const CHUNK_SIZE = 600_000;
const STATE_FILE = 'sync-state.json';
const CONFLICT_DIR = 'sync-conflicts';
const DATA_FILES = [
  ['worklog', 'worklog.json'],
  ['conclusions', 'conclusions.json'],
  ['mindmaps', 'mindmaps.json'],
];
const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.json', '.csv', '.yml', '.yaml', '.html']);
// 单篇知识库文件同步上限:与导入上限(5MB)同一口径,
// 否则 2–5MB 的文档能导入却永远不同步,用户会以为数据没跟着账号走。
const MAX_KNOWLEDGE_FILE_BYTES = 5 * 1024 * 1024;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dbApi() {
  const api = typeof utools !== 'undefined' ? utools : (typeof window !== 'undefined' ? window.utools : undefined);
  if (!api || !api.db) return null;
  return api.db.promises || api.db;
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function readState(dataDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir, STATE_FILE), 'utf8'));
  } catch {
    return null;
  }
}

function writeState(dataDir, state) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, STATE_FILE), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function ensureDeviceId(dataDir, state) {
  if (state?.deviceId) return state.deviceId;
  const deviceId = crypto.randomUUID();
  writeState(dataDir, { ...(state || {}), deviceId, lastHash: state?.lastHash || null, lastSyncedAt: state?.lastSyncedAt || 0 });
  return deviceId;
}

function readTextFile(abs) {
  try {
    return fs.readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
}

/** 知识库只同步文本;跳过隐藏文件/目录、二进制、超大文件 */
function collectKnowledge(root, rel = '', out = []) {
  let entries;
  try {
    entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const childRel = rel ? path.join(rel, entry.name) : entry.name;
    const abs = path.join(root, childRel);
    if (entry.isDirectory()) collectKnowledge(root, childRel, out);
    else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (!TEXT_EXTENSIONS.has(ext)) continue;
      try {
        if (fs.statSync(abs).size > MAX_KNOWLEDGE_FILE_BYTES) continue;
      } catch {
        continue;
      }
      const content = readTextFile(abs);
      if (content !== null) out.push({ path: childRel.split(path.sep).join('/'), content });
    }
  }
  return out;
}

function collectSnapshot(dataDir) {
  const files = {};
  for (const [key, name] of DATA_FILES) files[key] = readTextFile(path.join(dataDir, name));
  const knowledge = collectKnowledge(path.join(dataDir, 'knowledge-base')).sort((a, b) => a.path.localeCompare(b.path));
  // hash 只覆盖业务内容,generatedAt 不参与,保证同一份数据 hash 稳定
  const payload = { schema: SYNC_SCHEMA, files, knowledge };
  const canonical = JSON.stringify(payload);
  return {
    payload,
    snapshot: { ...payload, generatedAt: Date.now() },
    canonical,
    hash: sha256(canonical),
    hasData: Object.values(files).some(Boolean) || knowledge.length > 0,
  };
}

function emptyHash() {
  return sha256(JSON.stringify({ schema: SYNC_SCHEMA, files: { worklog: null, conclusions: null, mindmaps: null }, knowledge: [] }));
}

function backupCloud(dataDir, cloud, log) {
  const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  const target = path.join(dataDir, CONFLICT_DIR, `cloud-${stamp}.json.gz`);
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, zlib.gzipSync(Buffer.from(JSON.stringify(cloud.snapshot), 'utf8')));
    log('WARN', `同步冲突:账号云端快照已备份到 ${target}`);
  } catch (error) {
    log('ERROR', `备份云端快照失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function restoreSnapshot(dataDir, snapshot) {
  // 只在本地无数据或本地自上次同步后未变化时调用;此时覆盖/删除不会丢本地新改动
  for (const [key, name] of DATA_FILES) {
    if (!snapshot.files || !(key in snapshot.files)) continue;
    const content = snapshot.files[key];
    const abs = path.join(dataDir, name);
    if (typeof content === 'string') fs.writeFileSync(abs, content, 'utf8');
    else fs.rmSync(abs, { force: true });
  }

  const knowledgeRoot = path.join(dataDir, 'knowledge-base');
  const expected = new Set(
    (snapshot.knowledge || [])
      .filter((item) => item && typeof item.path === 'string' && typeof item.content === 'string')
      .map((item) => item.path),
  );
  // 删除云端已不存在的文本文件(图片/PDF 等未同步文件不动),让删除操作也能跨设备生效
  if (Array.isArray(snapshot.knowledge)) {
    for (const local of collectKnowledge(knowledgeRoot)) {
      if (!expected.has(local.path)) {
        fs.rmSync(path.resolve(knowledgeRoot, local.path), { force: true });
      }
    }
  }
  for (const item of snapshot.knowledge || []) {
    if (!item || typeof item.path !== 'string' || typeof item.content !== 'string') continue;
    const abs = path.resolve(knowledgeRoot, item.path);
    if (!abs.startsWith(path.resolve(knowledgeRoot) + path.sep)) continue;
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, item.content, 'utf8');
  }
}

async function waitCloud(db, log) {
  if (typeof db.replicateStateFromCloud !== 'function') return true;
  for (let i = 0; i < 20; i += 1) {
    let state;
    try {
      state = await db.replicateStateFromCloud();
    } catch (error) {
      log('WARN', `读取 uTools 云同步状态失败: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
    if (state === 0 || state === null || state === undefined) return true;
    await sleep(250);
  }
  // 云端仍在拉取:本轮不要用本地空数据反推云端,等下次打开再同步
  log('WARN', '等待 uTools 云同步超过 5 秒,本轮跳过同步以保证不覆盖云端');
  return false;
}

async function readCloud(db) {
  const manifest = await db.get(MANIFEST_ID);
  if (!manifest || !Array.isArray(manifest.chunks) || manifest.chunks.length === 0) return null;
  const docs = await db.allDocs(manifest.chunks);
  const byId = new Map(docs.map((doc) => [doc._id, doc]));
  const base64 = manifest.chunks.map((id) => byId.get(id)?.data || '').join('');
  if (!base64) return null;
  const snapshot = JSON.parse(zlib.gunzipSync(Buffer.from(base64, 'base64')).toString('utf8'));
  const payload = { schema: snapshot.schema, files: snapshot.files, knowledge: snapshot.knowledge };
  const hash = sha256(JSON.stringify(payload));
  if (hash !== manifest.hash) return null;
  return { hash, snapshot };
}

async function putChunks(db, base64, hash, log) {
  const ids = [];
  for (let index = 0, offset = 0; offset < base64.length; index += 1, offset += CHUNK_SIZE) {
    const id = `${CHUNK_ID_PREFIX}${hash.slice(0, 16)}-${index}`;
    ids.push(id);
    const existing = await db.get(id);
    if (!existing) {
      const result = await db.put({ _id: id, schema: SYNC_SCHEMA, data: base64.slice(offset, offset + CHUNK_SIZE) });
      if (!result?.ok) throw new Error(`写入同步分片失败: ${result?.message || 'unknown'}`);
    }
  }
  return ids;
}

async function writeManifest(db, manifest, deviceId, hash) {
  const existing = await db.get(MANIFEST_ID);
  if (existing?.hash === hash) return;
  const doc = {
    _id: MANIFEST_ID,
    schema: SYNC_SCHEMA,
    hash,
    updatedAt: Date.now(),
    deviceId,
    chunks: manifest.chunks,
    size: manifest.size,
    ...(existing?._rev ? { _rev: existing._rev } : {}),
  };
  let result = await db.put(doc);
  if (!result?.ok && existing?._rev) {
    // _rev 冲突:重新读一次再写,仍失败就交给上层记录
    const latest = await db.get(MANIFEST_ID);
    result = await db.put({ ...doc, ...(latest?._rev ? { _rev: latest._rev } : {}) });
  }
  if (!result?.ok) throw new Error(`写入同步清单失败: ${result?.message || 'unknown'}`);
}

async function push(db, dataDir, local, deviceId, log) {
  const compressed = zlib.gzipSync(Buffer.from(local.canonical, 'utf8')).toString('base64');
  const chunks = await putChunks(db, compressed, local.hash, log);
  await writeManifest(db, { chunks, size: compressed.length }, deviceId, local.hash);
  writeState(dataDir, { deviceId, lastHash: local.hash, lastSyncedAt: Date.now() });
  log('INFO', `已上传快照 hash=${local.hash.slice(0, 12)} chunks=${chunks.length}`);
}

/**
 * 启动时同步:云端新 → 恢复到本地;本地新 → 推送;双方都变 → 备份后本地优先。
 * 不阻塞启动超过云同步等待上限;失败只记录,继续用本地数据。
 */
async function syncOnce(dataDir, log) {
  const db = dbApi();
  if (!db) {
    log('INFO', 'uTools 数据库不可用,跳过账号同步');
    return false;
  }
  const state = readState(dataDir);
  const deviceId = ensureDeviceId(dataDir, state);
  if (!(await waitCloud(db, log))) return false;

  let cloud;
  let local;
  try {
    cloud = await readCloud(db);
    local = collectSnapshot(dataDir);
  } catch (error) {
    log('WARN', `读取同步数据失败,跳过本轮同步: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }

  const lastHash = state?.lastHash || null;
  if (!cloud) {
    if (local.hasData) {
      await push(db, dataDir, local, deviceId, log);
    }
    return true;
  }

  if (cloud.hash === local.hash) {
    writeState(dataDir, { deviceId, lastHash: local.hash, lastSyncedAt: Date.now() });
    return true;
  }

  // 只有云端变了:恢复云端(切换设备的主路径);本地自上次同步未变化,覆盖安全
  if (lastHash && lastHash === local.hash) {
    restoreSnapshot(dataDir, cloud.snapshot);
    writeState(dataDir, { deviceId, lastHash: cloud.hash, lastSyncedAt: Date.now() });
    log('INFO', `已从账号同步云端快照 hash=${cloud.hash.slice(0, 12)}`);
    return true;
  }

  // 只有本地变了:推送
  if (lastHash && lastHash === cloud.hash) {
    await push(db, dataDir, local, deviceId, log);
    return true;
  }

  // 首次同步或双方都变了:新设备(本地空)拉云端;否则保留本机并备份云端
  if (!local.hasData) {
    restoreSnapshot(dataDir, cloud.snapshot);
    writeState(dataDir, { deviceId, lastHash: cloud.hash, lastSyncedAt: Date.now() });
    log('INFO', '本地无数据,已从账号恢复云端快照');
    return true;
  }

  if (cloud.hash === emptyHash()) {
    await push(db, dataDir, local, deviceId, log);
    return true;
  }

  backupCloud(dataDir, cloud, log);
  await push(db, dataDir, local, deviceId, log);
  log('WARN', '本地与云端首次同步不一致:保留本机数据并备份云端,请检查 sync-conflicts');
  return true;
}

/** 运行期:本地有变更、防抖 2 秒后推送;云端同时在变时先备份云端再本地优先 */
function startWatcher(dataDir, log) {
  const db = dbApi();
  if (!db) return () => {};
  let timer = null;
  let syncing = false;
  let stopped = false;

  const tick = async () => {
    if (stopped || syncing) return;
    syncing = true;
    try {
      const state = readState(dataDir) || {};
      const deviceId = ensureDeviceId(dataDir, state);
      const local = collectSnapshot(dataDir);
      // 还没有同步基线且本地空:不要用空快照覆盖云端(新设备首次云端拉取未完成时)
      if (!state.lastHash && !local.hasData) return;
      if (local.hash === state.lastHash) return;
      const cloud = await readCloud(db).catch(() => null);
      if (cloud && cloud.hash !== state.lastHash && cloud.hash !== local.hash) {
        backupCloud(dataDir, cloud, log);
      }
      await push(db, dataDir, local, deviceId, log);
    } catch (error) {
      log('WARN', `同步推送失败(稍后重试): ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      syncing = false;
    }
  };

  // 本地文件写盘是原子的;2 秒足够避开连续编辑
  const timerId = setInterval(() => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      void tick();
    }, 2000);
  }, 4000);

  return () => {
    stopped = true;
    clearInterval(timerId);
    if (timer) clearTimeout(timer);
  };
}

module.exports = { syncOnce, startWatcher, collectSnapshot };
