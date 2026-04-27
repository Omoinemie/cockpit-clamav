# Cockpit ClamAV

Cockpit Web UI 插件，用于管理 ClamAV 防病毒服务。

![Cockpit](https://img.shields.io/badge/Cockpit-276+-blue)
![ClamAV](https://img.shields.io/badge/ClamAV-Required-green)
![License](https://img.shields.io/badge/License-GPL--2.0-orange)

## 功能

- **安全仪表板** — 实时查看系统安全状态、扫描统计、病毒库版本
- **病毒扫描** — 快速扫描预设（系统/用户/Web/临时/全盘/内存）+ 自定义路径扫描
- **实时防护** — 通过 clamav-daemon 守护进程实时监控文件系统
- **隔离区** — 管理被隔离的恶意文件（恢复/删除/清空）
- **扫描记录** — 所有扫描操作的历史记录
- **病毒库管理** — 查看病毒库状态、手动更新（freshclam）
- **ClamAV 配置** — 在线编辑 `/etc/clamav/clamd.conf`
- **定时扫描** — 应用内调度器，支持简单模式（每天/每周/每月）和 Cron 表达式，含实时进度和运行记录
- **多语言** — 中文简体 / English
- **主题** — 明亮 / 暗黑 / 跟随系统，支持自定义主题色

## 安装

### 从 deb 包安装

```bash
sudo dpkg -i cockpit-clamav_*.deb
```

### 依赖

- `cockpit` >= 276
- `clamav`
- `clamav-daemon`

```bash
# Debian/Ubuntu
sudo apt install cockpit clamav clamav-daemon

# 安装插件后重启 cockpit
sudo systemctl restart cockpit
```

### 手动安装

将插件文件复制到 Cockpit 插件目录：

```bash
sudo cp -r cockpit-clamav /usr/share/cockpit/cockpit-clamav
sudo systemctl restart cockpit
```

## 卸载

```bash
sudo dpkg -r cockpit-clamav
```

完全清除（包括配置和日志）：

```bash
sudo dpkg --purge cockpit-clamav
```

## 构建 deb 包

```bash
cd cockpit-clamav
bash build-deb.sh
```

构建时从 `version` 文件读取版本号，同步更新 `manifest.json` 和 `index.html` 页脚。

输出：`cockpit-clamav_<version>_amd64.deb`

## 项目结构

```
cockpit-clamav/
├── index.html              # 主页面
├── manifest.json           # Cockpit 插件清单
├── build-deb.sh            # deb 打包脚本
├── version                 # 版本号
├── lang/
│   ├── zh-CN.json          # 中文语言包
│   └── en.json             # 英文语言包
└── static/
    ├── css/
    │   ├── variables.css   # CSS 变量（主题/颜色）
    │   ├── reset.css       # 样式重置
    │   ├── layout.css      # 布局（导航/侧栏/主内容）
    │   └── components.css  # 组件（按钮/卡片/弹窗/进度条等）
    └── js/
        ├── bridge.js       # Cockpit D-Bus systemd 桥接层
        ├── services.js     # ClamAV 服务代理（daemon/freshclam）
        └── app.js          # 应用主逻辑
```

## 架构

- **前端**：纯 HTML/CSS/JS，无框架依赖，通过 Cockpit API 与系统交互
- **bridge.js**：封装 Cockpit D-Bus systemd1 接口，提供 ServiceProxy 类
- **services.js**：管理 clamav-daemon 和 clamav-freshclam 两个 systemd 服务
- **app.js**：应用逻辑（扫描、调度、i18n、主题、状态管理）
- **定时扫描**：应用内 setInterval 调度器，每 15 秒检查到期任务，通过 cockpit.spawn 执行 clamscan

## 配置文件路径

| 文件 | 说明 |
|------|------|
| `/etc/clamav/clamd.conf` | ClamAV 守护进程配置 |
| `/etc/cockpit/cockpit-clamav/setting.json` | 插件用户设置 |
| `/var/log/cockpit-clamav-scan.log` | 扫描日志 |

## 许可证

GPL-2.0
