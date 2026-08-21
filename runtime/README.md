# runtime

Desktop Release 的 Harness Runtime 构建工程。Runtime 不是用户可单独订阅的更新产品，
而是完整 Desktop App 的内部载荷：

```text
@deepseek-ai/dsh + Desktop Extension Pack + Compatibility Fix
```

`build-runtime.ts` 固定 Harness 版本并生成 ZIP、manifest 和 SHA256；
`verify-runtime.ts` 使用全新 `DSH_HOME` 执行 Compatibility Gate。

自动发布顺序为：

```text
upstream-watch
  → runtime-build
  → Compatibility Gate
  → desktop-release（嵌入同一 Artifact）
  → 更新 runtime/.known-version
```

Runtime 产物只在 GitHub Actions 内部传递，不创建独立 Release 或更新通道。
