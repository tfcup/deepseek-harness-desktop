# runtime

Harness Runtime 构建工程（设计文档 §5 / §6 / §7）。独立于 Desktop App 版本，一个 Runtime
是完整发行单元：

```text
Harness + Extension Pack + Node + Compatibility Fix
```

## 目录规划

```text
runtime/
├── package.json        # 固定 @deepseek-ai/dsh 版本 + 安装 Extension Pack
├── pnpm-lock.yaml
├── scripts/
│   ├── detect-upstream.ts   # 检测官方新版本（Phase 4）
│   ├── build-runtime.ts     # 构建 runtime zip + sha256 + manifest（Phase 4）
│   ├── verify-runtime.ts    # 本地验证（Phase 4）
│   └── publish-runtime.ts   # 发布到 channel（Phase 4）
└── tests/
    ├── smoke/               # 启动 + health check（Phase 4）
    ├── api/                 # API compatibility（Phase 4）
    └── compatibility/       # UI / Client Plugin / workflow（Phase 4）
```

## 状态

- [ ] Phase 4：runtime 构建脚本与 Compatibility Gate
