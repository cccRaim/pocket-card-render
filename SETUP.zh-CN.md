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
| **UnityPy** | 最新(`pip install UnityPy`) | 读取 Unity bundle 和官方 PlayerSettings |
| **capstone** | 最新(`pip install capstone`) | 为管线审计解码官方 ARM64 渲染方法 |
| **lz4** | 最新(`pip install lz4`) | 解压官方序列化 Bloom Shader 数据块 |
| **freetype-py** | FreeType 2.13.x（`pip install freetype-py`） | 独立审计全部官方 TMP glyph metrics |
| **Pillow** | 最新（`pip install Pillow`） | 读取并核对官方 TMP atlas 像素 |
| **unicorn** | 最新（`pip install unicorn`） | 执行固定版本的 ARM64 Unity SDFAA glyph 路径，进行逐字节 atlas 审计 |
| **AssetRipper** | 最新稳定版 GUI | 导出合成几何 + 贴图(路径 B) |
| .NET | 仅当你的 AssetRipper 是“依赖框架”版 → **.NET 8 运行时** | 多数 AssetRipper 发行版是自包含的 |
| three.js | 0.165.0 —— **经 CDN import map 固定,无需安装** | 见 `public/index.html` |
| 浏览器 | 任意较新的 Chrome / Edge / Firefox / Safari | 需 WebGL2 + import maps |

**运行时零 npm 依赖**；`npm install` 只拉开发工具（playwright/pngjs，用于无头截图与无截图运行时 smoke test）。

可选的官方运行时审计还需要你自己游戏安装包中的 APKM。设置 `PCR_APKM=/path/to/package.apkm` 后运行
`npm run audit:official-player-pipeline`；该命令直接读取安装包，不把生成的 recipe 当作渲染器证据。

如果已经从自己的目标设备会话取得原始 Vulkan capture，可以完全不使用截图地导入和审计：

```bash
npm run test:official-vulkan-runtime-import
npm run audit:official-vulkan-runtime-capture -- /path/to/capture public/scene.<card>.json
PCR_OFFICIAL_VULKAN_CAPTURE=/path/to/capture npm run report:evidence
```

capture 目录是本地证据，刻意不提交。一次通过只证明被捕获的卡、设备和运行时范围，不能代替尚未捕获的
稀有度或设备。

> **AssetStudio 这里完全不用。** 几何 = AssetRipper;材质*和*着色器 = UnityPy。
> (新增稀有度时反编译着色器同样是 UnityPy + SPIRV-Cross——见 [SHADERS.zh-CN.md](SHADERS.zh-CN.md)。)

---

## 路径 A —— 跑样例卡

```bash
git clone https://github.com/cccRaim/pocket-card-render
cd pocket-card-render
npm install
```

全局最小的 112 张机制覆盖 scene、5 张最小按稀有度补充 witness 与 6 张补充回归 scene
均已预置，但它们的**美术不提交**（那是游戏的）。请用**你自己**那份游戏的 AssetRipper
导出来提供美术（导出配置见*路径 B → 第 2 步*），然后只收集样例引用到的部分：

```bash
npm run gather -- /path/to/AssetRipper-export   # 把网格+贴图复制进 public/game/
npm run serve                                    # → http://127.0.0.1:8011
```

`gather` 还会用 UnityPy 重新读取官方 Unity Mesh，并恢复 AssetRipper/SharpGLTF
转换后的 GLB accessor。这会保留官方 float32 position、normal、tangent 和 UV payload，
同时沿用 exporter 生成的层级与材质 primitive。运行
`npm run audit:official-mesh-payload` 可把四张基准卡的 prefab 按展开后的有序三角形流逐字节对比；
该审计不使用截图或图像阈值。

打开 <http://127.0.0.1:8011> 并使用选卡菜单。菜单包含 112 张全局最小机制覆盖卡、
5 张按稀有度补充 witness 和 6 张补充回归卡。只有在对应 `/game/` 资产完成 `gather`
后条目才可选择；服务端不会把通用 fallback recipe 当成已就绪的内置样例。

---

## 路径 B —— 渲染一张新卡(完整流水线)

```
 解密 (上游,与游戏相关)                   ── 由你提供解密后的 *_bundles
        │
        ├─► AssetRipper  ──► 合成 .glb 几何 + .png 贴图              (导出根)
        └─► UnityPy      ──► <illId>_render_full.json  材质 recipe   (dump_recipe.py)
                 │
                 ▼
          build/build.mjs  ──►  public/scene.<illId>.json
          build/gather.mjs ──►  public/game/…  (scene 引用的美术)
                 │
                 ▼
            npm run serve  ──►  ?scene=scene.<illId>.json
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

这会写出每材质的 recipe(`m_Floats`/`m_Colors`/`m_TexEnvs`、着色器名、queue、世界变换)，并保留官方
Renderer/Material/Shader/Mesh 的 `CAB:pathID` identity，以及 native draw sorting 使用的序列化
Material/Shader keyword 输入。脚本还会解析 compiled Shader parameter reflection：只有发现
`UnityPerDraw` 外的决定性 per-renderer property 时才写入 `srpBatcherCompatible: 0`；没有见证则保留
`null`，不做猜测。`--shared` 目录让跨 bundle 的贴图/着色器指针得以解析。
(schema 见 [ASSETS.md](ASSETS.md)。)

### 5. 构建 scene

`build.mjs` 把 recipe + AssetRipper glb + 贴图合成为 `scene.<illId>.json`。用环境变量指向你的两个根目录:

```bash
PCR_GAME_SRC="<export-root>" PCR_RECIPES="recipes" \
  node build/build.mjs <illId>
```

(`PCR_GAME_SRC` = AssetRipper 导出根,`PCR_RECIPES` = 放 `<illId>_render_full.json` 的目录;
默认指向同级的 `../ptcg-apk-parser/apks/...` 检出。)
只有在你明确需要非规范输出名时,才传第三个参数覆盖。

### 6. 把 scene 的美术收集进 `public/game`

```bash
node build/gather.mjs "<export-root>"      # 只复制 scene 引用到的 /game/… 文件
```

### 7.（可选)卡面文本

全部内置样例自带合成好的文本（`public/text/`、`public/locales/`）。给新卡重新生成文本需要游戏
**masterdata** + `build/compose.mjs` / `build/carddata.mjs`,是单独一步;没有它,卡也能渲染,只是
**没有**名称/HP/招式叠加(美术不受影响)。

### 8. 启动

```bash
npm run serve            # → http://127.0.0.1:8011/?scene=scene.<illId>.json
```

### 9.（高级、可选)捕获官方运行期 draw-sort 字段

同前缀 draw order 剩余输入属于进程 session 状态,不是序列化资产数据。捕获它们需要固定的 PTCGP
`1.6.0 (293311)` arm64 版本、rooted 测试设备、ADB 与版本匹配的 `frida-server`。先验证只读 probe
仍与本机官方 `libunity.so` 完全匹配:

```powershell
npm run audit:official-sort-runtime-capture-tool
frida -U -f jp.pokemon.pokemontcgp -l build/capture-official-sort-runtime.js |
  Tee-Object sort-capture.log
```

在官方游戏里打开目标卡,捕获稳定帧后停止 Frida。再把这一份 session 与精确 scene 关联;导入器会拒绝
混合 session/版本,独立重算 entry `+0x08` 与 `+0x28`,忽略屏幕上无关 draw,并保留有歧义的 Renderer
候选而不猜测:

```powershell
npm run import:official-sort-runtime-capture -- sort-capture.log public/scene.<illId>.json public/sort-import.<illId>.json
npm run test:official-sort-runtime-import
```

用 `?scene=scene.<illId>.json&sortCapture=sort-import.<illId>.json` 显式加载。renderer 会校验原始 scene
SHA-256,并且只在 collision group 的每个成员都有精确 draw mapping 时启用 captured ordering;不完整 group
会整体 fallback。

生成物是 session-bound 证据。不要跨冷启动或游戏版本复用;在重复 capture 证明相关低字节稳定前,
也不要把它发布成通用 draw-order 数据。

---

## 疑难排查

- **卡渲染了但没美术 / `/game/…` 404** —— 跑 `npm run gather -- <export-root>`(路径 A 那步)。
- **`dump_recipe.py` 打印 0 materials** —— `--shared` 目录不对,或 bundle 没解密。UnityPy 必须能看到
  `Material` 对象。
- **图层顺序不对** —— 用 `--shader-state` 提供 `card_shader_state.json`(可选;多数 recipe 已自带真实
  `renderQueue`)。
- **非样例卡没文本** —— 正常(见第 7 步);几何/金箔照常渲染。
