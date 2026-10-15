# 笺墨 Jianmo

一页空白，容得下每一种想法。

笺墨是一款以文稿为中心、桌面优先的 Markdown 编辑器，支持直接编辑、源码模式和本机存储。

- **版本**：v0.2.0
- **开发者**：陈领
- **技术栈**：React、TypeScript、Tauri 2、Rust

## 直接体验

### 桌面版

运行打包生成的 `release/Jianmo-0.2.0.exe`。程序内嵌前端资源，无需启动开发服务器；运行电脑需要 WebView2 Runtime。

### 便携 Web 版

先按下方“便携 Web 构建”步骤生成 `jianmo-app-preview.html`，再双击打开。这是由 React 源码构建的实际 Web 应用，包含运行依赖，无需联网；生成文件不纳入源码仓库。

浏览器打开本地文件时，草稿存储是否可用取决于浏览器策略；失败时界面会提示保存文件。

## 主要功能

### 书写与文档管理

- 直接在文稿中编辑，通过菜单或快捷键切换源码模式。窗口顶部提供传统菜单栏和右键操作。
- 侧栏直接显示文件夹与笔记。在目录空白处右键新建目录、新建笔记或刷新目录。
- 支持嵌套目录导航、路径返回和跨目录收藏；再次点击“我的收藏”返回原目录。
- 笔记创建后直接写入当前目录，重启后仍关联原子目录。
- 文件和目录可通过右键菜单或 `F2` 重命名，保留草稿及保存关联。
- 删除的文件和目录进入笺墨回收站，可通过“工具 → 回收站”恢复当前目录的删除内容。
- 关闭标签保留文稿与草稿，关闭最后一篇后显示欢迎页。
- 保存提示在顶部显示 2 秒，底部保留字数、编码和字号。

### 图片、公式、代码块与表格

- 通过“格式”菜单插入图片、公式和代码块，双击已插入内容可重新编辑。
- 支持本机 PNG、JPEG、GIF、WebP 图片，以及 HTTP/HTTPS 图片地址。
- 图片支持像素宽高、等比缩放、25% / 50% / 75% 比例预设及恢复原始尺寸；尺寸通过 Markdown 内嵌 `img` 标签保存。
- 图片和表格支持左对齐、居中、右对齐。
- 通过“段落 → 插入表格”设置行列数，可使用加减按钮或直接输入数字。预览表头可直接改名，增减列数会保留已填写的名称。
- 点击表格单元格显示增减行列工具，最后一格按 `Tab` 新增行。
- 表格提供“简洁”“网格”“条纹”样式，默认简洁；对齐与样式随 Markdown 中的 HTML 标记保存。
- 公式支持 `$行内公式$` 和以独立 `$$` 行分隔的 LaTeX 公式。
- 应用不设文档打开、插入和保存的大小上限。

### 偏好设置

支持笔记目录、主题、阅读字号、正常页 / 宽页、启动视图与拼写检查。帮助菜单提供“关于笺墨”和“版本说明”。

### 常用快捷键

| 操作 | 快捷键 |
| --- | --- |
| 保存文件 | `Ctrl / ⌘ + S` |
| 切换源码模式 | `Ctrl / ⌘ + E` |
| 关闭当前标签 | `Ctrl / ⌘ + W` |
| 重命名文件或目录 | `F2` |
| 列表降一级 | `Tab` |
| 列表升一级 | `Shift + Tab` |

空列表项按 `Enter` 退回上一级，一级空项退出列表。源码模式支持连续列表与有序编号。

## 启动开发

建议使用 Node.js 24 LTS，最低版本以 [package.json](package.json) 及依赖的 `engines` 为准。

在项目根目录执行：

```powershell
npm install
npm run dev
```

然后访问 [本机开发页面](http://localhost:1420)。

## 检查与构建

```powershell
npm run typecheck
npm test
npm run build
npm run preview
```

受限环境无法启动测试子进程时：

```powershell
node --import ./tests/register.mjs --test --test-isolation=none tests/*.test.ts
```

### 便携 Web 构建

在 Windows 上执行：

```powershell
powershell -File scripts/build-portable.ps1
node scripts/check-portable.mjs
```

便携构建会单独合并 CSS。esbuild 提示忽略 CSS bare import 是预期的，生成页面会内嵌完整 CSS。

### 桌面开发

先按 [Tauri 环境准备说明](https://v2.tauri.app/start/prerequisites/) 配置 Rust 和操作系统依赖。

- Windows：Microsoft C++ Build Tools、WebView2。
- macOS：Xcode Command Line Tools。

```powershell
npm run desktop:setup
npm run desktop:dev
cargo test --manifest-path src-tauri/Cargo.toml
npm run desktop:build
```

`desktop:setup` 会安装 Tauri CLI 并更新锁文件，联网环境完成后应提交锁文件。

当前 `bundle.active=false`，只构建程序。安装包、签名、公证、更新与应用商店发布尚未配置。应用标识为 `app.jianmo.editor`，正式发布前应确认所有权与发布标识。

### Windows EXE 一键打包

双击项目根目录的 [build-exe.cmd](build-exe.cmd)，或者执行：

```powershell
npm run desktop:exe
```

也可从任意工作目录执行 [scripts/build-exe.ps1](scripts/build-exe.ps1) 的完整路径。

脚本依次运行类型检查、前端测试、Rust 测试、前端构建和原生 Release 构建，任一步失败立即停止。依赖缺失时先执行 `npm ci`；本机需安装 Rust MSVC 工具链及 Microsoft C++ Build Tools。

输出文件：

```text
release/
├── Jianmo-0.2.0.exe
└── Jianmo-0.2.0.exe.sha256
```

文件名自动使用当前版本号。EXE 内嵌前端资源，无需开发服务器；运行电脑需要 WebView2 Runtime。这是可直接运行的程序，不是安装向导。脚本不会自动安装、替换或关闭已运行的应用。

## 项目目录

| 目录 | 用途 |
| --- | --- |
| `src/core/` | 文档、草稿恢复、格式插入、Markdown 解析与清理 |
| `src/platform/` | 浏览器文件导入下载和 Tauri 命令接口 |
| `src/components/` | 共享界面组件 |
| `src/styles/` | 语义设计 token、界面及文稿样式 |
| `src-tauri/` | Rust 文件接口、原子写入、外部修改检测及桌面配置 |
| `tests/` | 核心逻辑、安全预览、设计一致性和 React DOM 交互测试 |
| `design/` | 现有设计资料、原型和规范 |
| `docs/` | 实现说明、验证记录与待办 |

### 设计规范更新

修改 `design/design-tokens.json` 后运行：

```powershell
python design/build-design-system.py
npm run tokens
```

不要直接修改 `src/styles/tokens.css`。

## 文档与数据存储

### 笔记目录

桌面版默认使用系统“文档”下的“笺墨”目录；网页版默认使用浏览器本机存储。可在偏好设置中选择普通磁盘目录，后续新文档默认保存到该目录。网页版“另存为”会下载文件。

目录设置会保留，更换目录不会搬移旧文件。文件句柄只在当前启动会话有效；目录笔记重启后保存时，会先比对原文件并恢复关联。浏览器目录权限失效时需要重新授权。目录改名后，内部笔记继续保存到新路径。

### 独立软件数据目录

图片附件和笺墨回收站独立存放，不混入笔记目录。

| 运行方式 | 数据位置 |
| --- | --- |
| Windows 桌面版 | `%LOCALAPPDATA%/app.jianmo.editor/storage` |
| 浏览器版 | OPFS 中的 `jianmo-data` 目录 |

偏好设置会显示实际位置。新图片以二进制文件保存，Markdown 记录 `jianmo-asset` 附件引用，不写入 Base64。

读取笔记目录时，会自动迁移旧 `.assets` 附件和 `.jianmo-trash-*` 项目，并保持旧图片引用可读。跨位置复制经完整校验后才清理原项目；失败时保留原文件并显示错误。旧版内嵌 Base64 图片仍兼容读取。

笺墨回收站不是系统回收站。删除目录时，子目录与文件会一并移入；草稿仍保留，可从当前目录的“工具 → 回收站”恢复。

**备份时请同时保留笔记与软件数据。** 清除浏览器站点数据会清除浏览器中的附件和回收站。

### 草稿与兼容性

- 草稿存储键为 `jianmo-workspace-v1`，每次文档或偏好更新后保存本机草稿。
- 草稿损坏时不覆盖旧数据，界面提示另存文件。清除浏览器或应用数据会删除草稿。
- 同一存储源中存在旧原型 `jianmo-prototype-v1` 数据时，会读取旧版 `docs/body` 字段迁移。
- 不同网址、文件路径或桌面应用之间的浏览器存储不会自动互通，需用 Markdown 文件导入。

## 实现与验证记录

- [v0.2.0 实现与验证](docs/v0.2.0实现与验证.txt)：当前进度、验证结果和限制。
- [v0.1.0 历史记录](docs/实现与验证.txt)：早期实现与验证说明。
