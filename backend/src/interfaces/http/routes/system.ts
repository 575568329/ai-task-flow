import { FastifyPluginAsync } from 'fastify';
// @ts-ignore - node-file-dialog 没有类型定义
import askdialog from 'node-file-dialog';

const systemRoutes: FastifyPluginAsync = async (fastify) => {
  // 选择文件夹
  fastify.post('/api/system/select-directory', async (req, reply) => {
    try {
      const result = await askdialog({ type: 'directory' });
      // askdialog 返回数组，取第一个
      const path = Array.isArray(result) ? result[0] : result;
      return { path: path || null };
    } catch (error) {
      fastify.log.error(error, 'Failed to open directory dialog');
      return { path: null, error: 'Failed to open directory dialog' };
    }
  });
};

export default systemRoutes;
