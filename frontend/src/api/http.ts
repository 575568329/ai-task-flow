// frontend/src/api/http.ts
import axios, { type AxiosInstance } from 'axios';
import { ElMessage } from 'element-plus';

const http: AxiosInstance = axios.create({
  baseURL: '/api',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// 请求拦截器
http.interceptors.request.use(
  (config) => {
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// 响应拦截器
http.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    const message = error.response?.data?.error || error.message || '请求失败';
    ElMessage.error(message);
    return Promise.reject(error);
  }
);

export default http;
