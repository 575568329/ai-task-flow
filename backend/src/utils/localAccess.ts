// backend/src/utils/localAccess.ts
/**
 * 判断请求 IP 是否来自本机回环。
 * 用于 gate 危险操作(spawn 终端 / bypass 权限 / storage 清理):本机个人工具风险可控,
 * 非本机访问(同网段 / 反代)应拒绝,作为「host 收敛到 127.0.0.1」之外的纵深防御。
 *
 * 注意:未考虑 trustProxy——若前置反代,request.ip 会是反代 IP 而非真实客户端。
 * 本项目定位本地直连、不挂反代;若将来引入反代,需在此扩展 X-Forwarded-For 解析。
 */
export function isLocalAccess(ip: string): boolean {
  return (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip === '::ffff:127.0.0.1' ||
    ip === 'localhost'
  );
}
