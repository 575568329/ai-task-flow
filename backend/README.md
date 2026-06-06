# @ai-task-flow/backend

HTTP + MCP backend server for [AI Task Flow](https://github.com/575568329/ai-task-flow). 含编译产物 + 前端打包静态文件。

> ⚠️ This is the backend runtime. End users should install [`@ai-task-flow/cli`](https://www.npmjs.com/package/@ai-task-flow/cli) instead.

## Programmatic Usage

```ts
import { startApp } from '@ai-task-flow/backend';

await startApp({
  port: 3000,
  host: '0.0.0.0',
  // 单端口托管前端 SPA(必须是绝对路径,含 index.html)
  frontendDist: '/path/to/dist',
});
```

## License

MIT © yufj
