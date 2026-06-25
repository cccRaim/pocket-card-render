# pocket-card-render

> [English](README.md) · **简体中文**

一个**数据驱动、字节级还原**的 **Pokémon TCG Pocket（宝可梦集换式卡牌 Pocket）** 卡面浏览器渲染器,
基于 [three.js](https://threejs.org/)。每一层——视差金箔、全息衍射、金属高光、闪粉、镂空窗口、稀有度
标记、全息边框——都是从游戏自身的材质数据 + 反编译的着色器字节码还原而来。**没有任何拍脑袋的魔法数字。**

> **教育 / 研究项目。** 本仓库**不附带任何游戏素材**。网格、贴图、字体、卡面文字、名称与图像均归
> The Pokémon Company / 任天堂 / Creatures / GAME FREAK / DeNA 所有。你需要自备解出来的数据——见
> [ASSETS.md](ASSETS.md)。

## 特性

- **忠于数据,而非近似。** 每个材质的着色器常量来自卡片 recipe 或对真实着色器的字节追踪——绝不手调。
- **以材质名为键。** 每个 glb 网格通过 `material.name` 匹配到 recipe,再经一次查表分发到对应的材质
  **策略(strategy)**——不靠脆弱的节点名猜测,不写逐着色器的 `if`。
- **视角相关效果**——全息衍射、金属环境反射、闪粉闪烁、视差窗口——由真实的相机相对数学驱动,并钳制
  到游戏的 30° 倾斜上限。
- **动态卡面文本**(名称 / HP / 招式 / 规则 / 插画师)从 masterdata 合成,使用免费 OFL 替代字体,并带
  语言切换(9 种语言)。
- **为扩展而设计**(Strategy + Registry)。新增一个稀有度约 3 处小改动,且**无需**改动渲染器核心——
  见 [CONTRIBUTING.md](CONTRIBUTING.md)。
- **运行时零依赖。** three.js 经 import map 从 CDN 加载;服务端是纯 Node。

## 快速开始

```bash
git clone https://github.com/cccRaim/pocket-card-render
cd pocket-card-render
npm install                          # 仅开发依赖(playwright/pngjs 用于无头截图);渲染器本身零依赖
npm run gather -- <导出根目录>        # 从你的游戏导出里把样例卡的网格+贴图收集进 public/game
npm run serve                        # → http://127.0.0.1:8011
```

`<导出根目录>` 是游戏的 **AssetRipper** 导出(包含 `Assets/` 的那个文件夹)。`gather` 会读取预置的
`public/scene.*.json`,**只**复制它们引用到的 `/game/...` 文件,所以你只需准备样例需要的那部分。
(游戏美术被 git 忽略、从不提交——见 [ASSETS.md](ASSETS.md)。)

> 📖 **完整端到端指南** —— 依赖版本、AssetRipper 精确导出配置、期望目录结构、以及如何为一张全新卡
> 生成数据:**[SETUP.zh-CN.md](SETUP.zh-CN.md)**。

## 样例卡

三张场景已预置好(只含渲染 recipe + 文本,美术在本地收集):

| 网址 | 卡片 | 稀有度 |
|-----|------|--------|
| `/` 或 `?scene=scene.pk.json` | 妙蛙花 ex（Venusaur ex） | RR |
| `?scene=scene.sr.json` | 叶子（Leaf） | SR |
| `?scene=scene.ur.json` | 伊布的背包（Eevee's Bag） | UR |

常用查询参数:`?scene=<文件>` 选卡 · `?only=<材质名>` 单独显示某一层 · `?nohud` 隐藏调试浮层 ·
右上角下拉菜单切换语言。

## 工作原理

```
  ┌──────────────── public/scene.*.json   渲染 recipe:每材质 { shader, queue, blend, floats, colors, textures }
  │  ┌───────────── public/game/…          网格(.glb)+ 贴图(.png) —— 本地收集,从不提交
  │  │  ┌────────── public/text|locales/…  按语言合成好的卡面文本(名称/HP/招式)
  ▼  ▼  ▼
public/app.js ──► 对每个 glb 网格:  recipe = scene.materials[mesh.material.name]
 (three.js)        cfg  = SHADER[recipe.shader]            // render/rarities.js(数据)
                   strat = getMaterial(cfg.kind)           // render/registry.js
                   mesh.material = strat.build(recipe, ctx)// render/materials/*.js(策略)
```

### 项目结构

```
public/
├── app.js                 渲染器:加载 scene+glb、逐网格分发、两遍 RT、倾斜、文本叠加
├── index.html             import map(three.js CDN)+ Google Fonts 替代字体
├── render/                材质系统(见 CONTRIBUTING.md)
│   ├── registry.js        策略注册表 —— defineMaterial(kind, {requires, build}) / getMaterial(kind)
│   ├── context.js         RenderContext(贴图/环境/动画)+ 混合与模板(stencil)辅助
│   ├── glsl.js            共享 GLSL 片段(view-basis 顶点着色器)
│   ├── rarities.js        数据:shader → { blend, kind, alphaTest, bg, defer },按稀有度分组
│   └── materials/         按家族分的策略:base.js · holo.js · ur.js
├── shaders/               精确的闪粉顶点+片段 GLSL(由游戏着色器经 SPIRV-Cross 转出)
├── scene.*.json           预置样例场景
└── game/                  (git 忽略)你收集的网格 + 贴图

build/                     离线工具(需你自己的游戏数据):build.mjs(recipe→scene)、
                           gather.mjs(收集美术)、compose.mjs/carddata.mjs(文本)、shot.mjs(截图)
server.mjs                 零依赖静态服务器,服务 public/ 与 public/game/
```

`app.js` 负责编排(scene/glb 加载、金箔背景的渲染目标 pass、鼠标倾斜、DynamicUI 文本画布);所有
逐材质着色逻辑都在 `render/` 里。

## 渲染其它卡 / 新增稀有度

- **样例之外的卡** —— 用你自己的数据构建它的 scene,再 `gather` 它的美术。见 [ASSETS.md](ASSETS.md)
  (scene/资产契约 + recipe 步骤)。
- **某个新稀有度的渲染逻辑** —— 加一个策略模块 + 一条稀有度数据,渲染器核心不动。逐步说明见
  [CONTRIBUTING.zh-CN.md](CONTRIBUTING.zh-CN.md)。
- **反编译一个新着色器**(拿到新效果需要的 GLSL)—— 提取 → SPIRV-Cross → 移植,工具在
  `build/shaderdec/`。完整流程见 [SHADERS.zh-CN.md](SHADERS.zh-CN.md)。

## 许可

源代码:**MIT**(见 [LICENSE](LICENSE))。游戏衍生素材(网格、贴图、字体、卡面文字)**不在**本许可
覆盖范围内,也**不**随仓库分发——请自备。
