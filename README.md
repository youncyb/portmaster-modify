# Portmaster Modify

> **说明**：本仓库是 [Safing/Portmaster](https://github.com/safing/portmaster) 的 **非官方修改版**（fork），在 GPL-3.0 下发布。  
> 与官方无隶属关系；商标与品牌归 Safing 所有。SPN 等云端付费服务仍以官方账号/套餐为准。

基于上游 Portmaster，本修改版主要调整如下。

## 本仓库修改说明

### 1. 免费启用原 Plus 能力（本地功能）

无需登录 Safing 账号、无需 Plus 套餐即可使用：

| 功能 | 官方 | 本修改版 |
|------|------|----------|
| **Bandwidth Visibility**（带宽可视） | Plus（`bw-vis`） | 默认可用 |
| **Network History**（网络历史） | Plus（`history`） | 默认可用（仍尊重应用内「启用历史」开关） |

> SPN 等依赖官方网络与订阅的功能 **未** 解锁。

### 2. Dashboard：近期带宽可视

- **Recent Top Consumers**：按应用汇总收/发流量（环形图）
- **Recent Bandwidth Usage**：近期总带宽时序（折线图）

![Recent Top Consumers 与 Recent Bandwidth Usage](docs/images/mod-recent-bandwidth.png)

### 3. Dashboard：按日 / 周 / 月的应用流量统计（新增）

新增 **App Bandwidth by Period**：

- 切换 **Day / Week / Month**
- 周期内 **总下载 / 总上传 / 合计**
- 按应用横向柱状图（绿=下载，蓝=上传）
- 显示应用图标与名称
- 数据持久化在本地 `history.bandwidth_app_daily`（`history.db`）

![App Bandwidth by Period（日/周/月）](docs/images/mod-app-bandwidth-period.png)

### 4. 联网 Prompt 通知更易识别

系统通知（Windows toast）调整：

- **标题**：应用名称（不再固定为 “Connection Prompt”）
- **正文**：精简可执行路径 + 目标（如 `父目录\程序.exe → example.com`）
- 路径过长时自动缩短，兼顾通知栏长度

### 5. 分支说明（本 fork）

| 分支 | 用途 |
|------|------|
| `development` | 跟踪官方干净基线 |
| `modify` | 仅包含本仓库改动 |
| `main` | 官方基线 + 本仓库改动（默认发布分支） |

同步上游示例：

```bash
git fetch origin
git checkout development && git merge origin/development
git checkout modify && git merge development
git checkout main && git merge modify
```

---

# Get Peace of Mind <br> with [Easy Privacy](https://safing.io/)

Portmaster is a free and open-source application firewall that does the heavy lifting for you.
Restore privacy and take back control over all your computer's network activity.

With great defaults your privacy improves without any effort. And if you want to configure and control everything down to the last detail - Portmaster has you covered too. Developed in the EU 🇪🇺, Austria.

__[Download for Free](https://safing.io/download/)__

__[About Us](https://safing.io/about/)__

![Portmaster User Interface](https://safing.io/assets/img/page-specific/landing/portmaster-thumbnail.png?)

_seen on:_  

[<img src="https://safing.io/assets/img/external/heise_online.svg" height="35">](https://www.heise.de/tests/Datenschutz-Firewall-Portmaster-im-Test-9611687.html)
&nbsp;&nbsp;&nbsp;
[![ghacks.net](https://safing.io/assets/img/external/ghacks.png)](https://www.ghacks.net/2022/11/08/portmaster-1-0-released-open-source-application-firewall/)
&nbsp;&nbsp;&nbsp;
[![Techlore](https://safing.io/assets/img/external/techlore.png)](https://www.youtube.com/watch?v=E8cTRhGtmcM)
&nbsp;&nbsp;&nbsp;
[![Lifehacker](https://safing.io/assets/img/external/logos/lifehacker.webp)](https://lifehacker.com/the-lesser-known-apps-everyone-should-install-on-a-new-1850223434)

## [Features](https://safing.io/features/)

1. Monitor All Network Activity
2. Full Control: Block Anything
3. Automatically Block Trackers & Malware
4. Set Global & Per‑App Settings
5. Secure DNS (Doh/DoT)
6. Record and Search Network Activity（本修改版默认可用；官方为 [$](https://safing.io/pricing/)）
7. Per-App Bandwidth Usage（本修改版默认可用，并增强日/周/月统计；官方为 [$](https://safing.io/pricing/)）
8. [SPN, our Next-Gen Privacy Network](https://safing.io/spn/) ([$$](https://safing.io/pricing/))

# Technical Introduction

Portmaster is a privacy suite for your Windows and Linux desktop.

### Base Technology

- Portmaster integrates into network stack using nfqueue on Linux and a kernel driver (WFP) on Windows.
- Packets are intercepted at the raw packet level - every packet is seen and can be stopped.
- Ownership of connections is found using eBPF and `/proc` on Linux and a kernel driver and the IP Helper API (`iphlpapi.dll`) on Windows.
- Most settings can be defined per app, which can be matched in different ways.
- Support for special processes with weird or concealed paths/actors:
  - Snap, AppImage and Script support on Linux
  - Windows Store apps and svchost.exe system services support on Windows
- Everything is 100% local on your device. (except the SPN, naturally)
  - Updates are fully signed and downloaded automatically.
  - Intelligence data (block lists, geoip) is downloaded and applied automatically.
- The Portmaster Core Service runs as a system service, the UI elements (App, Notifier) run in user context.
- The main UI still uses electron as a wrapper :/ - but this will change in the future. You can also open the UI in the browser

### Feature: Secure DNS

- Portmaster intercepts "astray" DNS queries and reroutes them to itself for seamless integration.
- DNS queries are resolved by the default or configured DoT/DoH resolvers.
- Full support for split horizon and horizon validation to defend against rebinding attacks.

### Feature: Privacy Filter

- Define allowed network scopes: Localhost, LAN, Internet, P2P, Inbound.
- Easy rules based on Internet entities: Domain, IP, Country and more.
- Filter Lists block common malware, ad, tracker domains etc.

### Feature: Network History ($)

- Record connections and their details in a local database and search all of it later
- Auto-delete old history or delete on demand

### Feature: Bandwidth Visibility ($)

- Monitor bandwidth usage per connection and app

### Feature: SPN - Safing Privacy Network ($$)

- A Privacy Network aimed at use cases "between" VPN and Tor.
- Uses onion encryption over multiple hops just like Tor.
- Routes are chosen to cover most distance within the network to increase privacy.
- Exits are chosen near the destination server. This automatically geo-unblocks in many cases.
- Exclude apps and domains/entities from using SPN.
- Change routing algorithm and focus per app.
- Nodes are hosted by Safing (company behind Portmaster) and the community.
- Speeds are pretty decent (>100MBit/s).
- Further Reading: [SPN Whitepaper](https://safing.io/files/whitepaper/Gate17.pdf)

## Documentation

All details and guides in the dedicated [wiki](https://wiki.safing.io/)

- [Getting Started](https://wiki.safing.io/en/Portmaster/App)
- Install
  - [on Windows](https://wiki.safing.io/en/Portmaster/Install/Windows)
  - [on Linux](https://wiki.safing.io/en/Portmaster/Install/Linux)
- [Contribute](https://wiki.safing.io/en/Contribute)
- [VPN Compatibility](https://wiki.safing.io/en/Portmaster/App/Compatibility#vpn-compatibly)
- [Software Compatibility](https://wiki.safing.io/en/Portmaster/App/Compatibility)
- [Architecture](https://wiki.safing.io/en/Portmaster/Architecture)
- [Settings Handbook](https://docs.safing.io/portmaster/settings)
- [Portmaster Developer API](https://docs.safing.io/portmaster/api)

# Build Portmaster Yourself (WIP)

1. [Install Earthly CLI](https://earthly.dev/get-earthly)
2. [Install Docker Engine](https://docs.docker.com/engine/install/)
3. Run `earthly +release`
4. Find artifacts in `./dist`
