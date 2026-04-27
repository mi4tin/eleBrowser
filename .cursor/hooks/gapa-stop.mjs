#!/usr/bin/env node
// GAPA stop hook — 任务完成后触发评估
let input = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    if (data.status === 'completed') {
      process.stdout.write(JSON.stringify({
        followup_message: `刚才的任务已完成。现在执行 GAPA 评估流程（如果刚才是简单问答、闲聊，或者是 IDE 自动化流程如 spec run all tasks 的执行过程，跳过整个流程）：

先读取 .gapa/gapa-rules.md 获取评估规则，然后：

1. **任务评估：** 按 gapa-rules.md 中的 5 个维度评估，将结果追加到 .gapa/memory.md（包含「提炼 skill」和「偏好更新」字段）
2. **工作流提炼：** 如果本次任务的工作流有复用价值，提炼为 .gapa/skills/{name}.md
3. **偏好更新：** 如果观察到新的用户偏好或习惯，更新 .gapa/preferences.md

评估要诚实具体，行动项要可执行，skill 提炼要克制。
`
      }));
    } else {
      process.stdout.write(JSON.stringify({}));
    }
  } catch {
    process.stdout.write(JSON.stringify({}));
  }
  process.exit(0);
});
