# 山谷雪场

浏览器里的单板滑雪：一座按真实地形生成的雪山，87 条雪道、10 条索道，自由滑行、坐索道、看地图、开车、换装、看沙盘。Three.js + Vite。

玩法参考了 [Hemu Ski](https://eric1hua.github.io/hemu-ski/)，代码、模型、贴图和界面都是这个仓库里自己写、自己生成的，不包含对方的任何资源。

## 运行

```bash
npm install
npm run dev
```

仓库里已经带了生成好的地形（`public/data`）。想重新生成：

```bash
npm run terrain:osm   # 从 OpenStreetMap 下载雪道和索道，写到 scripts/cache/osm.json
npm run terrain       # 下载高程瓦片，生成 detail.u16 / backdrop.u16 / world.json
```

## 打包成单个 html

```bash
npm run build:single
```

产出 `release/山谷雪场.html`（约 1.7 MB）：脚本、样式、地形和雪道数据全在这一个文件里，不用起服务，双击用 Chrome / Edge 打开就能玩，也可以直接发给别人。只包含主页面，沙盘在里面按 B 看。

## 操作

| 按键 | 作用 |
| --- | --- |
| A / D（或左键按住画面左右） | 压刃转弯 |
| 鼠标右键 | 按住拖动转视角，松开回正 |
| W | 收腿加速，平地蹬板 |
| S | 横板搓雪减速 |
| 空格 | 按住蓄力，松开起跳；压着 A / D 起跳带转体，空中按住收紧转得更快，松开张开减速 |
| E | 乘索道（坐上去后按住 W 快进）、上下车 |
| M | 地图：点一下设目的地，滚轮缩放，拖动平移 |
| F | 脱板步行（Shift 跑） |
| R | 回到山顶 |
| B | 沙盘视角 |
| T | 把时间往后拨三小时 |
| Y | 换天气：晴 → 多云 → 小雪 → 暴雪 |

左侧菜单的装备面板可以换板面配色和图案、上衣颜色，并导入导出 `hemu-like-gear` JSON；喇叭按钮开关声音。

## 时间、天气、声音和碰撞

- **时间**：从上午 10 点开始。白天现实一分钟过游戏里一小时，夜里快三倍；7 点日出、19 点日落。天空、雾、雪面和灯光跟着太阳高度变色，夜里有月亮和星星。
- **天气**：晴、多云、小雪、暴雪四档，每隔几分钟自己变一次，也可以按 Y 手动换。天气改变云量、能见度、飘雪和风声，不改雪板的手感。
- **声音**：全部用 Web Audio 现场合成（风、板底、板刃、起跳落地、撞击、索道、脚步），没有音频文件。浏览器要求先点一下或按一下键才会出声。
- **碰撞**：树、木屋、索道站房和支架都会挡住人和车。蹭到会减速，迎面撞上会摔倒。

## 目录

- `scripts/`：数据管线（OSM 抓取、高程采样、雪道平整、世界描述）和单文件打包插件
- `src/world/`：地形、雪道查询与着色贴图、树和木屋、障碍表、时间与天气
- `src/render/`：雪面与天空着色器、卡通材质和描边
- `src/audio/`：程序合成的声音
- `src/player/`：滑行物理、程序生成的滑手和雪板
- `src/lift/`、`src/vehicle/`：索道和载具
- `src/map/`、`src/ui/`：小地图、大地图、装备面板
- `src/fx/`、`src/trail/`：雪雾、影子、飘雪、板痕

## 数据来源

- 高程：[AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/)（Mapzen Terrarium 格式）
- 雪道与索道：© [OpenStreetMap](https://www.openstreetmap.org/copyright) 贡献者，按 ODbL 授权

## 发布到 GitHub Pages

仓库 Settings → Pages → Source 选 GitHub Actions。推到 `main` 后，工作流会执行 `npm run build` 并部署 `dist/`。`vite` 的 `base` 已是 `./`，静态路径可直接打开。

本地预览构建结果：

```bash
npm run build
npm run preview
```
