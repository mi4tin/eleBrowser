#!/usr/bin/env node
// GAPA sessionStart hook — 注入上下文加载指引
const output = {
  additional_context: `如果当前用户消息是实质性任务（代码编写、bug修复、功能实现等，而非简单问答或闲聊），请先读取 .gapa/memory.md 的最近 10 条记录，检查是否有相关的行动项可以应用到当前任务。如果任务涉及已知的 skill 领域，也读取对应的 .gapa/skills/ 文件。如果是简单问答则跳过。
`
};
process.stdout.write(JSON.stringify(output));
process.exit(0);
