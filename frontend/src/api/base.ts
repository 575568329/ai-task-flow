// frontend/src/api/base.ts
// API 基址注入:三种宿主形态统一走这一个常量。
// - dev(vite proxy)/同源托管:空串(相对路径 /api,行为不变)
// - uTools 插件包(file:// 加载):构建时 .env.utools 注入 VITE_API_BASE=http://127.0.0.1:3000
//   (file:// 下相对路径解析成 file:///api 全挂,必须绝对地址)
export const API_BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';
