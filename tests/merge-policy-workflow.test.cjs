const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('合并判定在 CI 之后单独运行，且只用 main 上的规则和脚本', () => {
  const policy = read('.github/workflows/merge-policy.yml');
  assert.match(policy, /workflow_run:\s*\n\s*workflows: \[CI\]/, '由 CI 完成触发');
  assert.match(policy, /conclusion == 'success'/, '只在 CI 全绿后判定');
  assert.match(policy, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/, '先取 main');
  assert.match(policy, /cp scripts\/classify-pr\.mjs "\$RUNNER_TEMP\/"/, '先把 main 的脚本存起来');
  assert.match(policy, /node "\$RUNNER_TEMP\/classify-pr\.mjs"/, '用存起来的 main 脚本判定');
  assert.match(policy, /--match-head-commit "\$HEAD_SHA"/, '只合并 CI 测过的那个提交');
});

test('自动合并不删分支；CI 本身不再包含合并步骤', () => {
  const policy = read('.github/workflows/merge-policy.yml');
  const ci = read('.github/workflows/ci.yml');
  assert.doesNotMatch(policy + ci, /--delete-branch/);
  assert.doesNotMatch(ci, /gh pr merge/);
  assert.doesNotMatch(ci, /classify-pr\.mjs/);
});
