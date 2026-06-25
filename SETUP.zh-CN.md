# 安装与数据流水线

> [English](SETUP.md) · **简体中文**

本指南覆盖端到端全过程:安装依赖 → 导出素材(精确配置)→ 期望目录 → 生成渲染数据 → 启动。

两条路径:

- **路径 A —— 跑样例卡**(只需你的游戏素材导出 + Node)。从这里开始。
- **路径 B —— 渲染一张新卡**(完整数据流水线:AssetRipper + UnityPy)。

## 推荐版本

| 工具 | 推荐 | 说明 |
|------|------|------|
| **Node.js** | **18 LTS 或更新**(实测 20.19) | 运行渲染器的静态服务器 + 构建脚本 |
| npm | 随 Node 自带 | — |
| **Python** | **3.10 – 3.12**(实测 3.11) | 仅 recipe 步骤需要(路径 B) |
| **UnityPy** | 最新(`pip install UnityPy`) | 读取解密后的 Unity bundle |
| **AssetRipper** | 最新稳定版 GUI | 导出合成几何 + 贴图(路径 B) |
| .NET | 仅当你的 AssetRipper 是“依赖框架”版 → **.NET 8 运行时** | 多数 AssetRipper 发行版是自包含的 |
| three.js | 0.165.0 —— **经 CDN import map 固定,无需安装** | 见 `public/index.html` |
| 浏览器 | 任意较新的 Chrome / Edge / Firefox / Safari | 需 WebGL2 + import maps |

**运行时零 npm 依赖**;`npm install` 只拉开发工具(playwright/pngjs,用于无头截图)。

---

## 路径 A —— 跑样例卡

```bash
git clone https://github.com/cccRaim/pocket-card-render
cd pocket-card-render
npm install
```

三张样例 scene 已预置,但它们的**美术不提交**(那是游戏的)。请用**你自己**那份游戏的 AssetRipper
导出来提供美术(导出配置见*路径 B → 第 2 步*),然后只收集样例引用到的部分:

```bash
npm run gather -- /path/to/AssetRipper-export   # 把网格+贴图复制进 public/game/
npm run serve                                    # → http://127.0.0.1:8011
```

打开 <http://127.0.0.1:8011>,再加 `?scene=scene.pk.json` / `scene.sr.json` / `scene.ur.json`。

---

## 路径 B —— 渲染一张新卡(完整流水线)

```
 解密 (上游,与游戏相关)                   ── 由你提供解密后的 *_bundles
        │
        ├─► AssetRipper  ──► 合成 .glb 几何 + .png 贴图              (导出根)
        └─► UnityPy      ──► <illId>_render_full.json  材质 recipe   (dump_recipe.py)
                 │
                 ▼
          build/build.mjs  ──►  public/scene.<标签>.json
          build/gather.mjs ──►  public/game/…  (scene 引用的美术)
                 │
                 ▼
            npm run serve  ──►  ?scene=scene.<标签>.json
```

### 1. 解密 bundle(由你提供)

游戏的 Unity bundle 是加密的。解密是**与游戏相关的上游步骤——本仓库不包含**。你需要产出一个装着
**解密后的** `*_bundles` 文件的文件夹(记作 `<DECRYPTED>`),按游戏的结构摆放:

```
<DECRYPTED>/Common/CardNew/Face/<illId>/L/Prefabs/<illId>_L.prefab_bundles   # 该卡的 prefab
<DECRYPTED>/Common/CardNew/Common/…                                          # 共享网格/贴图
<DECRYPTED>/Common/Shader/…                                                  # 着色器
```

### 2. 用 AssetRipper 导出几何 + 贴图

安装 [AssetRipper](https://github.com/AssetRipper/AssetRipper)(免费)。加载你的 `<DECRYPTED>`
bundle,然后在 **Configuration(配置)** 里设置如下(只有标注的项要紧,其余保持默认):

| 选项 | 值 |
|------|----|
| 默认版本（Default Version） | **`2022.3.62f2`**（游戏抹掉了 Unity 版本,必须手动设) |
| 捆绑资源导出模式 | 直接导出（Direct Export） |
| **实验性 → 启用显示预制件轮廓** | **打开** ← 这就是产出合成 glb 的开关 |
| 图片导出格式 | **Png** |
| 着色器导出格式 | 虚拟着色器（Dummy Shader） |
| 音频 / 脚本 / 等 | 默认 |

导出到一个文件夹——那个(包含 `Assets/` 的)文件夹就是你的 **`<export-root>`**。

### 3. 导出后的期望目录

```
<export-root>/
└── Assets/
    ├── PrefabHierarchyObject/<illId>_L.glb        ← 合成好的卡片网格(几何 + 变换)
    ├── Texture2D/…*.png                           ← 贴图
    └── Lettuce/_Data/…/Textures/…*.png            ← 更多贴图(各自容器路径下)
```

> 若没有 `PrefabHierarchyObject/`,说明**启用显示预制件轮廓**没开。若只得到没有 `.mat` 的 JSON、
> 没有 glb,请复查默认版本 + 那个实验性开关。

### 4. 生成材质 recipe（UnityPy）

```bash
pip install UnityPy
mkdir -p recipes
python build/dump_recipe.py \
    "<DECRYPTED>/Common/CardNew/Face/<illId>/L" \
    --shared "<DECRYPTED>/Common/CardNew/Common" \
    --shared "<DECRYPTED>/Common/Shader" \
    --out "recipes/<illId>_render_full.json"
```

这会写出每材质的 recipe(`m_Floats`/`m_Colors`/`m_TexEnvs`、着色器名、queue、世界变换)。`--shared`
目录让跨 bundle 的贴图/着色器指针得以解析。(schema 见 [ASSETS.md](ASSETS.md)。)

### 5. 构建 scene

`build.mjs` 把 recipe + AssetRipper glb + 贴图合成为一个 `scene.json`。用环境变量指向你的两个根目录:

```bash
PCR_GAME_SRC="<export-root>" PCR_RECIPES="recipes" \
  node build/build.mjs <illId> "" scene.<标签>.json
```

(`PCR_GAME_SRC` = AssetRipper 导出根,`PCR_RECIPES` = 放 `<illId>_render_full.json` 的目录;
默认指向同级的 `../ptcg-apk-parser/apks/...` 检出。)

### 6. 把 scene 的美术收集进 `public/game`

```bash
node build/gather.mjs "<export-root>"      # 只复制 scene 引用到的 /game/… 文件
```

### 7.（可选)卡面文本

三张样例自带合成好的文本(`public/text/`、`public/locales/`)。给新卡重新生成文本需要游戏
**masterdata** + `build/compose.mjs` / `build/carddata.mjs`,是单独一步;没有它,卡也能渲染,只是
**没有**名称/HP/招式叠加(美术不受影响)。

### 8. 启动

```bash
npm run serve            # → http://127.0.0.1:8011/?scene=scene.<标签>.json
```

---

## 疑难排查

- **卡渲染了但没美术 / `/game/…` 404** —— 跑 `npm run gather -- <export-root>`(路径 A 那步)。
- **`dump_recipe.py` 打印 0 materials** —— `--shared` 目录不对,或 bundle 没解密。UnityPy 必须能看到
  `Material` 对象。
- **图层顺序不对** —— 用 `--shader-state` 提供 `card_shader_state.json`(可选;多数 recipe 已自带真实
  `renderQueue`)。
- **非样例卡没文本** —— 正常(见第 7 步);几何/金箔照常渲染。
