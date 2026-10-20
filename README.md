# dsh-plugin

DeepSeek Harness（dsh）插件集合。每个插件独立一个子目录，可单独安装。

## 插件

| 目录 | 包名 | 说明 |
|---|---|---|
| `dsh-trajectory-workflow` | `dsh-trajectory-workflow` | 在「轨迹」之外增加「工作流」视图，按用户轮次展示模型请求、响应与工具调用链路 |

## 安装

需要 dsh `0.2.1-rc.2` 及 Node.js 24。

```sh
# 桌面客户端：设置 → 插件，输入包名，或使用命令行
dsh plugin --profile desktop add github:<owner>/dsh-plugin#path:dsh-trajectory-workflow

# Web profile
dsh plugin --profile web add github:<owner>/dsh-plugin#path:dsh-trajectory-workflow
```

安装后需完全退出并重新打开 dsh，客户端插件清单只在启动时读取。

## 关于 `dsh-trajectory-workflow`

该插件适配自 [xuanyuanzhifeng/dsh-plugin-agent-workflow](https://github.com/xuanyuanzhifeng/dsh-plugin-agent-workflow)（MIT），在保留其功能的基础上做了三处改动：

1. 包名与模块 ID 由 `dsh-plugin-agent-workflow` 改为 `dsh-trajectory-workflow`；
2. 依赖与 peer 声明对齐 dsh `0.2.1-rc.2`，可直接安装；
3. 修复视图在悬浮输入框模式下被遮挡、无法滚动到底部的问题（按宿主 `--dsh-composer-height` 预留底部净空）。

原项目的设计与实现版权归原作者所有，详见该目录下的 `LICENSE` 与 `README.md`。

## 开发

```sh
cd dsh-trajectory-workflow
pnpm install
pnpm run build
pnpm test
pnpm pack      # 生成可安装的 .tgz
```

## 许可

各插件随其目录内的 `LICENSE` 授权。
