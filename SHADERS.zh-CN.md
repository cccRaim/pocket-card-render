# 反编译卡片着色器

> [English](SHADERS.md) · **简体中文**

这就是本仓库里 GLSL 的来历(`render/materials/*.js` 里的内联着色器 + `public/shaders/*.glsl` 的 exact port)。
**只有新增一个着色器**(某个新稀有度的效果)时才需要它——已有着色器都已作为 GLSL 提交。

游戏的着色器是 Unity sub-program blob:**lz4 压缩 → SMOL-V → SPIR-V**,且**uniform 名被抹掉**。
工具链:提取 SPIR-V → 转译成 GLSL → 恢复被抹掉的名字 → 移植。

## 工具

| 工具 | 安装 | 作用 |
|------|------|------|
| Python + UnityPy + lz4 | `pip install UnityPy lz4` | 读着色器 bundle,lz4 解压 |
| SMOL-V 解码器 | `build/shaderdec/smolv.py` + 固定版本的 upstream C++ oracle | SMOL-V → SPIR-V，全量差分 |
| **SPIRV-Cross** | [Vulkan SDK](https://vulkan.lunarg.com/) 或[独立版](https://github.com/KhronosGroup/SPIRV-Cross) | SPIR-V → GLSL(Khronos 官方权威转译器) |

你还需要**解密后的** `Common/Shader` bundle(`<DECRYPTED>` —— 见 [SETUP.zh-CN.md](SETUP.zh-CN.md) 第 1 步)。

Python decoder 会与 upstream `aras-p/smol-v` commit
`9dd54c379ac29fa148cb1b829bb939ba7381d8f4` 做全量差分：直接枚举 128 个 `Common/Shader` bundle 内的
588 个物理 SMOL-V record，并用 `spirv-val` 校验全部 380 个唯一输出。命令为
`npm run audit:official-smolv-corpus`。该结论只证明当前固定资产版本的 decoder 等价，不证明
Vulkan→WebGL 或官方运行时 draw 等价。

## 第 1 步 —— 提取 SPIR-V

正式 exact port 必须通过 selector-keyed generator 调用 `build/extract_official_selector_program.py`，连接键为
`selectorId + candidateWitnessId + subshader/pass`；Shader 名称和 module 大小都不是身份。

`dump_shader.py` 只保留为探索工具：

在 recipe 里找到着色器名(`scene.json` → `materials[*].shader`,如 `Frame-Holo-UR-New`),然后:

```bash
pip install UnityPy lz4
python build/shaderdec/dump_shader.py "Frame-Holo-UR-New" frameur \
    --shaders "<DECRYPTED>/Common/Shader" --out shaders_spv
# → shaders_spv/frameur_frag.spv  (+ frameur_vert.spv)
```

如果材质启用了编译期 Shader keyword，探索命令可以缩小候选范围，但仍不能因此成为 exact 证据：

```bash
python build/shaderdec/dump_shader.py Card_Parallax card_parallax \
    --keyword _UVASPECTRATIO_SQUARE \
    --shaders "<DECRYPTED>/Common/Shader" --out shaders_spv
```

正式 port 的 keyword 必须来自官方序列化 Material，而不是生成后的 recipe。同一个 Shader 名下的不同 variant
也可能包含不同数学逻辑。

## 第 2 步 —— SPIR-V → GLSL(用 SPIRV-Cross)

```bash
spirv-cross shaders_spv/frameur_frag.spv --version 300 --es --flatten-ubo > frameur_frag.glsl
```

- `--flatten-ubo` 把常量缓冲变成按**字节偏移**索引的 `uniform vec4 _NN[k]`。
- 采样器按**绑定顺序**出现(`_13`、`_205`… → 对应各自槽位的 `_FlowAMap`、`_ALightTex`…)。

## 第 3 步 —— 恢复被抹掉的 uniform 名

SPIRV-Cross 只能吐出匿名的 `_NN[k]`(因为名字被抹了)。通过读一个**保留了反射信息的同族**着色器变体,
把偏移映射回真实参数名:

```bash
python build/shaderdec/reflect.py "<同族着色器后缀>" --shaders "<DECRYPTED>/Common/Shader"
# 打印  @84 _SpecularIntensity   @88 _DiffractionIntensity   @96 _DiffractionPower  …
```

把这些字节偏移与第 2 步的 `_NN[k]` 布局交叉对照,即可标注每个参数(再去 recipe 的 `r.floats` /
`r.colors` 里取值)。若**没有**同族变体保留名字,那个参数就静态不可恢复——但先确认它对你的卡是否真的
生效。

## 第 4 步 —— 把 GLSL 移植进材质策略

浏览器运行时现在使用真正的双 attachment WebGL2 RenderTarget。官方 Shader pass 数据的
`rtSeparateBlend=false`，因此两路 attachment 共享各材质当前生效的 RT0 blend state；序列化的
`rtBlend1` 只是未启用的默认槽。`npm run test:mrt-runtime` 会在同一次 draw 中以数值方式验证两路输出，
不依赖截图。后处理运行时随后按解出的 `0,1,2,3,3,4,5` 图执行官方六个 Bloom program，包括五级固定尺寸
downsample、float32 atlas 权重、序列化 blend state，以及官方 `Rendering/CustomRenderer/Blit` 最终 pass；

Render-target descriptor 的证据范围必须分层写。官方 ARM64 constructor 与 CommandBuffer call 已固定
scene 的两路 ARGB32 color target、Depth24 和 Point filter；Bloom 中间 RT 则请求 ARGB32、Linear
read/write、Bilinear filter、Depth0、MSAA1、volume depth 1 和非 memoryless。浏览器把这些请求
显式映射为 RGBA8/unsigned-byte target、Nearest/Linear filter 及已测试的 WebGL2 depth/sample 设置。
这是浏览器适配，不能证明 Unity 经设备相关 `GetCompatibleFormat` 选出的 Vulkan color/depth
physical format。

Detail card 的 source RT 是另一阶段。`npm run audit:official-card-renderer` 已固定其方形
ARGB32/Depth24/AA1 constructor 和序列化 `_cardSize=6`，官方表将它映射到
`CardSizeType.Large` (734×1024)。官方
`roundToEven(pixelHeight / VerticalPercentageInRT * UICardQuality)` 公式在普通 Android 默认
`Middle=0.8` 下得到 `1122×1122`；`561×561` 只是反事实的 `Medium` 结果。同一官方公式还会得到
High=`1403×1403`、Low=`982×982`。设备实际持久化 quality 仍是运行时状态；浏览器默认使用 capture 的
Middle profile。浏览器默认 `auto` 按物理 drawing buffer 派生不小于显示面的 source RT，以避免桌面
二次放大；该查看尺寸不能当成 capture 的运行时证据。`quality=middle` 复现 capture，High、Low 保留
官方固定尺寸。

SPIRV-Cross 的输出用的是 Unity 约定。适配到 three.js:

- 别名化属性(`position` / `normal` / `uv`),`gl_Position` 用 `projectionMatrix * modelViewMatrix`;
- 用 `inverse(modelMatrix) * cameraPosition` 算相机相对基底(见 `render/glsl.js` 的共享 `VIEW_BASIS_VS`,
  就是干这个的);
- 在原始 MRT location 保留所有实际生效的颜色输出；不要通过第二遍渲染重放 emissive layer；
- 从 recipe 经 [RenderContext](public/render/context.js) 接 uniform(`ctx.layerTex(r, slot)`、`r.floats`、
  `r.colors`);
- 按纹理维度保留 ShaderLab 的隐式默认值；例如空 Cubemap 属性应使用 Unity 内置灰色 cube，
  不能借用 scene 中其他材质的环境图；
- 包成 `defineMaterial(kind, { requires, build })` —— 见 [CONTRIBUTING.zh-CN.md](CONTRIBUTING.zh-CN.md)。

**仓库里现成的范例:**

- `render/materials/ur.js` → `plate` 是从 `urplate_frag.spv` 字节追踪来的(注释标了来源)。
- `render/materials/holo.js` → `frameHolo` 是 `framh_frag.spv` 的完整 SSA 追踪(名字按第 3 步从同族恢复)。
- `public/shaders/glitter.*.glsl` 展示了在 `RawShaderMaterial` 中保留大型匿名 constant buffer 布局。
- `public/shaders/card_parallax*.glsl` 展示了把较小的官方程序适配成具名 three.js uniform，
  包括精确选择 keyword variant 和绑定 cube map。
- `npm run build:exact-frame-holo-ur` 会直接从官方 bundle 重新生成 `Frame-Holo-UR-New`。它保留
  location 1 的官方 emissive 表达式，并将其原样路由到 WebGL bloom pass；
  `npm run audit:exact-frame-holo-ur` 会逐字节核对仓库文件与重新生成的结果。
- `npm run build:exact-transparent-hologram-tuning` 会重新生成 DynamicUI 全息程序，同时保留
  location 1 的 alpha-only mask 输出和 Unity 隐式灰色 Cubemap 默认值。
- `npm run build:exact-basic-holograms` 会重新生成 `Card_Parallax_Hologram_Tuning` 和
  `Card_Hologram_Tuning`，覆盖完整 UBO 布局、sampler 绑定、顶点属性和 MRT 输出；
  `npm run audit:exact-basic-holograms` 会核对仓库内程序与官方 bundle 的重新生成结果。
- `npm run build:exact-classic-holograms` 会重新生成 `Frame-Holo-Tuning` 和
  `Opaque-Hologram_Tuning`。除 SPIR-V reflection 外，审计还会核对 Unity 编译结果中的
  `m_CommonParameters` texture / constant-buffer 绑定与运行时映射。
- `npm run build:exact-opaque-ur-oklab` 会选择启用四个 keyword 的 `Opaque-UR-Oklab` variant，
  并从官方 SPIR-V 重新生成。审计还会解析该 compiled variant 的 parameter blob，恢复全部 13 个
  texture binding 和两个具名 UBO layout；`npm run audit:exact-opaque-ur-oklab` 会逐字节核对提交产物。
- `npm run build:exact-ur-bg-hologram` 会重新生成只有一套 program 的
  `Card_Parallax_Hologram_UR_New`，并核对全部 6 个 compiled texture binding、两个 UBO layout，
  以及恒为零的第二 MRT 输出。
- `npm run build:exact-ur-plate` 会重新生成 `Card_UR_Plate`，包括 8 个 compiled texture binding、
  材质自身的 Cubemap 语义、两个 UBO layout，以及恒为零的第二 MRT 输出。
- `npm run build:exact-ur-lens-flare` 会重新生成无 keyword 的 `Card_UR_LensFlare` program，包括
  VAT 顶点路径和非零 secondary MRT emissive 输出。AssetRipper 保留了序列化的 flare transform，
  但丢失其 `unity default resources` Quad；运行时会按 scene recipe 恢复该 built-in mesh，无截图
  runtime test 则断言每张 UR 参考卡都有两个 flare draw。
- `npm run audit:official-shader-precision` 固定 14 个官方 program 的 precision decoration 与
  float-control opcode。Glitter 保留官方 mediump/highp 混合链；无截图 runtime probe 只把 SwiftShader
  的近似 FP32 mediump 提升记为 backend 条件结果，不外推到 Android GPU。
- `test:official-touch-rotation` 与 `test:official-clock` 覆盖 native 增量 drag quaternion、30 度 clamp、
  从完整层级得到的 Glitter forward、scaled delta、共享 LensFlare `_Time` 和 suspend 状态。
  `audit:official-android-lifecycle` 固定 8 个 Unity 官方 symbol 与 Android pause/延迟 resume 完整链，
  并在不使用截图的情况下验证浏览器 visibility adapter。
- `audit:official-texture-payload` 与 `test:texture-mip-runtime` 固定官方 object/payload identity，并显式
  上传全部 38 个官方 mip level；禁止浏览器隐式生成 mip。
- `npm run build:exact-bloom` 会从 APKM 内的官方 serialized Shader 重新生成全部六个
  `Hidden/CustomPostEffect/Bloom` program。`audit:official-bloom-program` 固定资产、pass mapping、binding 和
  render state；`audit:official-bloom-runtime` 固定 RT descriptor/尺寸、atlas 坐标、权重、blur 顺序、执行图，
  以及 pass 5 对 scene ColorRT 的直接 additive 写入。
- `npm run build:exact-final-blit` 会沿官方 ResourceManager → Material → Shader 链重新生成
  `Rendering/CustomRenderer/Blit`；审计固定 mip 0 显式采样、scale/bias、fixed-function state，并用非对称
  2×2 GPU draw/readback fixture 验证成对的 Vulkan→WebGL Y 适配。
- `npm run build:exact-side-back` 会从官方运行时 capture 实际观察到的 `INSTANCING_ON` Vulkan variant
  重新生成 `Side&Back`，包括 `_BaseTex`/`_Blend` fragment 计算和恒为零的 secondary MRT 输出。WebGL2
  适配会把已捕获的单实例数组折叠到第 0 项。`audit:official-side-back` 固定序列化材质槽位、两个 compiled
  variant、运行时 module hash、queue、depth/cull/blend state、朝向几何以及来源 hash。
- `npm run audit:official-vulkan-runtime-capture -- <capture-dir> <scene.json>` 不使用截图，直接导入原始
  JSONL/SPIR-V capture。它会按文件大小、SPIR-V magic、FNV-1a 和 SHA-256 校验每个 Shader 文件，重放
  pipeline/draw state，再在不把 scene queue 当身份 oracle 的前提下映射到官方 scene identity。当前 legacy
  伊布包包 capture 含 3 个已提交且匹配的 23-draw scope，23/23 个 vertex+fragment+specialization program
  字节一致；23 个 draw 中 19 个能唯一确定。两个等价的 `Frame-Holo-UR-New` draw 和两个等价的
  `Card_UR_LensFlare` draw 明确保留为 unresolved。由于该 capture 早于 manifest schema，其游戏/设备/GPU/driver
  provenance 仍不完整。
- `npm run audit:official-pass-partition` 不使用截图，直接固定官方 opaque/transparent renderer event、queue
  范围、sorting criteria、双 attachment/depth binding 和 ShaderTag 顺序。
- `npm run audit:official-draw-order-native` 与 `npm run test:official-draw-order` 固定 APKM/native
  Float32 distance key、量化 bucket、原始 Optimize/transparent comparator 分支和最终 ties。
  `npm run audit:official-unity-symbol-map` 会把这些游戏 byte range 映射到 Unity 官方 Android Build
  Support 的 public symbols，并校验源 installer 及两个 ELF payload 的 hash。
  `npm run audit:official-reference-sort-inputs` 独立固定四张官方 L prefab bundle 与原始 MeshRenderer
  对象，再核对 94 条 active draw identity 与 84 条 scene material row。
  `npm run audit:official-material-sort-inputs` 会独立重开官方 Face/CardNew Common/Shader bundle，不读取
  recipe，并把这些记录核对到 69 个序列化 Material 与 26 个序列化 Shader。
  运行时使用 exact distance/bucket 前缀和已证明的 MeshRenderer 0 offset；
  `npm run audit:official-pass-candidates` 证明 98 个参考 draw 均选择 pass 0 且 candidate ordinal 为 0；
  同前缀 Optimize tie 使用的运行期 identity 值仍是边界。
  raw prefab 审计还证明 78 个参考 MeshRenderer 全部不是 static batch、lightmap index 均为
  `65535/65535` 且没有 `LODGroup`；这些字段、material slot、Canvas order 与 non-LOD fade 已进入 scene
  sort descriptor；审计还解析出 7/7/9/9 个 Mesh identity 等价类和 native-default SortingGroup key。
  scene 还保留原始 queue、instancing 与 valid/invalid keyword 状态。
  `npm run audit:official-srp-batcher` 证明 26 个 canonical Shader 全部不兼容 SRP Batcher，因此 94 个 active
  draw 的该 bit 都是 0。`npm run audit:official-local-keyword-state` 会独立重建并核对 84 条 row 的有序 bitset
  与官方 seed XXH32 hash，因此最终 keyword state 已知。第一个尚未恢复的 Optimize 字段是 command 审计已
  证明走 hashed 分支的 entry `+0x08`；需要 capture 的输入是 Material `+0x17c` 与 Shader Object InstanceID
  低字节；若 state key 相等，同一个 probe 还会捕获 entry `+0x28`、RenderNodeQueue slot 与 candidate ordinal。
  四张 canonical 卡都走 non-static-batch comparator 分支。
  `npm run audit:official-sort-input-producers` 不读取 scene 或 recipe，固定 20 个 producer/helper symbol、
  107 条精确 AArch64 指令、普通 Renderer 与 BRG 各自独立的打包公式、SRP 返回路径、non-LOD zero relocation，以及
  `MeshRenderer` 的低 6 位 `RendererType=1` 向 `RenderNode+0xe8` 的传播链。
  `npm run audit:official-instance-id-remapper` 另行固定 136 条 official/game AArch64 指令、两套 InstanceID
  分配公式及写入 `Object+0x08` 的传播链；审计证明静态 `CAB:pathID` 无法脱离实时 Remapper allocation
  event stream 恢复低字节。
  `npm run audit:official-sort-command-branch` 证明官方 opaque/transparent pass command 都在 entry `+0x08`
  选择 hashed Material/Shader state-key 分支。
  `npm run audit:official-sort-prefix-collisions` 会在不运行浏览器或 renderer 的情况下输出逐字段决策表：
  17 个稳定碰撞组共涉及 36 个 draw，全部进入 OptimizeStateChanges，并在已知 Renderer/LOD/static/lightmap
  字段上相等；其运行期边界分类为 6 个只缺 Material `+0x17c`、3 个 shared-Shader 和 8 个 distinct-Shader 组。
  `npm run audit:official-sort-runtime-capture-tool` 会静态校验只读的 PTCGP 1.6.0 Frida probe；实际 capture
  仍需要 rooted arm64 测试设备。自动生成的 collision manifest、20,000-pair raw comparator 差分和原子 group
  resolver 是独立的无浏览器门禁。静态 PPtr identity 仅用于关联证据，不是替代排序键。
- `npm run audit:official-draw-state` 会在代表性 opaque、transparent、CullOff、stencil 和 shared-MRT
  WebGL2 draw call 处截取状态；当前 queried state 与 framebuffer 探针为 98/98 assertions 通过，
  其中包括官方 stencil write mask `4`。这只是 three.js r165/Chromium 下的选定 draw 覆盖，不证明
  每个材质、原生 Unity/Vulkan 状态、排序、Shader 数学或最终像素。
- `npm run build:exact-homography` 从 Vulkan SPIR-V 重新生成官方
  `Prerender/Homography(from RT)` 顶点/片元 program。审计固定 H/Hinv `float[9]` binding 与 IL2CPP upload
  contract；`npm run test:homography-runtime` 则对 identity、convex、degenerate 和 near-degenerate 输入验证
  ARM64 运算顺序的 Float32 H/Hinv helper。`audit:official-homography-wiring` 证明 `_clampParallax` 材质分支
  和 CardRenderer RT 到 `_DynamicUITex` 的路径；`audit:official-card-display` 则在 98 个官方材质引用上证明
  remaining-transmission alpha contract。`public/app.js` 现已接入固定 source MRT/camera、只作用于 source 的
  touch root、投影 keypoint、双 attachment Homography display MRT 和 FinalBlit。
  `test:texture-upload-runtime` 通过共享 Chromium texture loader 与 GPU readback 证明 hidden-RGB、
  部分透明 straight RGB 和 Y 方向保持不变。display-transfer 审计固定官方 Vulkan surface policy 与
  浏览器 compositor-input 字节。native RT 物理 Y、物理纹理格式，以及目标设备 swapchain/compositor/
  OS/面板 transfer 仍未证明。
- `npm run build:exact-ui-default-from-rt` 重新生成官方外层 RawImage display Shader，保留 vertex color ×
  `_Color`、`_MainTex_ST`、`_TextureSampleAdd`、`alpha = 1 - sample.a`、零 MRT1 和
  `One / OneMinusSrcAlpha`，且不翻转纹理 Y。运行期 `_TextureSampleAdd`、物理纹理格式和 Dynamic UI
  keyword state，以及 Canvas 最终解析的 color-mask/Z-test/stencil 值仍是明确边界；ShaderLab property
  占位值不能当作运行期 fixed-function 值。
- `npm run build:official-card-display-contract` 把官方 1122 方形 RT、camera、clear/alpha、keypoint 和
  display mode 事实编译到 `public/render/card-display-contract.json`。
- `npm run audit:official-rendertexture-contract` 固定 ARGB32/GF8/Vulkan、Depth24 compatible-format
  算法以及 Unity/Homography/FinalBlit Y 语义；实际设备 format 与 VkViewport 仍是 device state。
- `npm run audit:official-camera-transform` 还固定了普通 `CommonUICardDetailCard` 序列化 component 中的
  `_useGyro=false`。因此浏览器对该 view 刻意不实现设备 gyro 路径；通用 gyro-enabled view 的未证范围
  不能写成普通 detail 的缺失。

## 现实提醒(别手调)

- 小着色器从 SPIRV-Cross 几乎能 1:1 移植。大的那些(Frame-Holo ≈ 1219 条指令、ShadowBox ≈ 1306)**加上**
  名字被抹,是真的难——这正是 `render/materials/` 里那些策略存在的原因,直接复用。
- **靠数值验证,不靠眼睛。** 给真实 `.spv` 和你的 GLSL 喂相同输入再 diff 输出;用常量贴图能让对比变成
  纯算术。每个常量都必须能追溯到 recipe 或字节追踪——绝不拍脑袋。
