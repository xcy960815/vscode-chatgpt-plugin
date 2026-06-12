module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // 允许中英文混合的 scope
    'scope-case': [0],
    // subject 长度放宽，中文描述容易超限
    'subject-max-length': [1, 'always', 100],
    // type 枚举保持默认: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert
  },
};
