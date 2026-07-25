# 游戏渲染还原度

> [English](FIDELITY.md) | **简体中文**

本项目不再把“游戏还原度”定义成一个总百分比。即使某一层使用了官方资产和反编译出的 Shader
表达式，只要 texture decode、MRT 合成、blend、精度、后处理、相机状态或最终显示编码与游戏运行时
不同，最终卡面仍然可能明显错误。

## 证据向量

任何还原度结论都必须同时写明维度和范围：

| 维度 | 能证明什么 | 不能证明什么 |
|---|---|---|
| 数据来源 | mesh、texture、材质参数、keyword 和 layer 顺序来自指定版本的游戏数据 | 渲染器正确解释了这些数据 |
| Layer 实现覆盖 | 可见 layer 能分发到渲染策略 | Shader 等价或像素正确 |
| 官方 Shader 证据 | 实现受到官方 Shader bytecode 的约束 | 整条渲染管线或最终画面等价 |
| 渲染管线一致性 | texture transfer、精度、RT、MRT、blend、stencil、相机和后处理与官方运行时一致 | 没有官方对照图时就能证明卡面正确 |
| 受控视觉一致性 | 固定姿态、固定时间下的 layer 或整卡与官方采集结果一致 | 对采集范围之外的卡和状态也成立 |

百分比只能用于一个明确命名的 coverage 分母，例如 selector、Material slot 或审计义务。项目目前不发布
`officialShaderRestorationPercent`：缺少 official guest draw/descriptor/uniform/attachment 与独立的
Vulkan→WebGL 语义等价证明时，该字段固定为 `null`。coverage 不能被改称最终像素相似度或 `gameFidelity`。

## 版本化审计义务

`npm run audit:restoration` 使用固定且带版本号的分母，不再根据仓库“目前会审计什么”反向决定分母：

- 固定 10 个等权渲染维度，shader layer 数量不能掩盖文字或目标运行时缺口；
- 每个维度列出明确的官方渲染义务和推进成本；
- 主分数只计算 `exact` 证据；
- `inferred`、`runtime-required`、`missing`、`unknown` 保留在分母中并计 0；
- `partial-exact` 只计算其中逐项列明的 exact 子范围；
- fresh gate 只运行无浏览器的官方字节、对象和程序检查，不使用截图；
- fresh gate 失败时，审计义务完成率标记为不可发布；
- fresh gate 会递归拒绝 Playwright/Puppeteer/browser launch，浏览器数值探针必须显式单独运行。

报告输出 `auditObligationExactPercent` 与 `knownImplementationPercent`。前者也是审计定义内部的完成率，
后者还包含 inferred 工作；两者都不能称为官方 Shader 还原度。它们只描述四张固定
RR/SR/Trainer-UR/Pokemon-UR 参考卡的当前证据图，不代表全部卡牌、目标设备像素、compositor 输出或屏幕观感。

```bash
npm run audit:restoration
npm run audit:restoration:json
```

几何维度可用 `npm run audit:official-mesh-payload` 独立验证。在四张基准卡范围内，它解析
78 个官方 MeshFilter，单独标记 4 个 Unity 内置 Quad，并在显式 Unity→glTF 坐标转换后，
对 74 个资产 Mesh 节点、130 个 GLB primitive 和 81,606 个展开顶点逐字节比较。
Exporter 的顶点重映射与连续同材质 submesh 合并会按结构归一化，不会用数值容差掩盖差异。

DynamicUI/TMP 运行时检查同样不使用截图。依次用 `?auditrt=1` 打开四张固定参考卡，本地服务器会把
draw 数量以及 premultiplied/UI/holo RenderTarget readback 写入 `tmp-runtime-evidence.local.json`。
该文件已被 git 忽略，并绑定布局实现、prefab contract、生成文本、字体 manifest、TMP renderer
和官方 Shader 等实际输入的 SHA-256；任一输入变化时，
旧运行时证据就会自动失效。

```bash
npm run audit:official-tmp-mesh
npm run audit:tmp-runtime-evidence
```

这只能证明所采集参考卡的本地 WebGL 路径提交了官方程序 glyph draw，并产出了非空 RT；它不能替代
官方 Vulkan capture、目标 GPU 数值行为或最终显示对比。

卡面布局来源可用 `npm run build:official-card-ui-layout` 独立重建，并用
`npm run audit:official-card-ui-layout` 检查。该 contract 固定两个官方 prefab bundle 的哈希、
对象哈希，以及 512 个 RectTransform 和 68 个 TMP component 未四舍五入的序列化值。
它包含 spacing、margin、auto-size、wrapping、kerning、rich-text 和 alignment 字段；
`compose.mjs` 不再依赖跨仓库且会丢字段的 `card_ui_prefabs.json` 扫描产物。
这能证明序列化输入，但尚不能证明 TMP 3.0.6 `GenerateTextMesh` 的每个分支或 UGUI 运行时状态。

## 推进成本

成本由“工作类型 + 剩余范围”表示，不给没有依据的日历时间估算：

- `maintenance`：当前参考范围已经完成，只剩回归维护。
- `renderer-integration`：补齐 layer 分发或运行时绑定。
- `source-tracing-and-bytecode-audit`：补齐官方来源或 bytecode 证据。
- `shader-reverse-engineering`：提取/反编译官方程序、恢复绑定、移植并增加约束审计。
- `backend-semantic-equivalence`：证明 Vulkan SPIR-V 到 WebGL GLSL/固定管线适配在目标输入域内语义等价。
- `runtime-pipeline-research`：证明 format、MRT、精度、显示 transfer 等共享官方运行时行为。
- `textmeshpro-runtime-port`：从官方 IL2CPP 与 Unity 代码恢复并实现 TMP mesh/layout 行为。
- `target-runtime-capture`：采集并比较官方 draw state、descriptor、uniform 与 RenderTarget。
- `target-device-precision-probe`：证明目标 GPU 的精度、texture decode 与超越函数行为。
- `corpus-expansion`：把固定参考范围扩展到更多卡片与材质原型。
- `excluded-by-policy`：明确不进入自动审计。

当前官方 program proof graph 的可复核 coverage 为：

| 维度 | 当前状态 | 推进成本 | 剩余范围 |
|---|---:|---|---:|
| 官方 selector 已解析 | 77/77 | `maintenance` | 0 selector |
| stage-source-bound semantic executable | 26/76 | `shader-reverse-engineering` | 50 executable |
| backend-semantic complete closure | 0/76 | `backend-semantic-equivalence` | 76 executable |
| 五字段 exact obligation | 27/135 | `runtime-regression` / `target-runtime-capture` | 108 obligation |
| 官方 Material slot stage-source-bound | 46,810/58,057 | `shader-reverse-engineering` | 11,247 slot |
| 渲染管线一致性 | `not-proven` | `runtime-pipeline-research` | guest runtime 与 backend equivalence 未闭合 |
| 视觉一致性 | `unmeasured` | `excluded-by-policy` | 0 个自动工作单元 |

这些数字来自 hash-pinned 官方 AssetBundle/Shader proof graph 与 selector port contract。当前源码变化后四卡 runtime evidence
按 fail-closed 规则失效，必须重采后 runtime 字段才能恢复 exact credit。
`stage-source-bound` 表示官方 SPIR-V identity 与生成源码已绑定，不表示 Vulkan→WebGL 指令语义 exact。

渲染管线这一行还会拆成 12 个机器可读阶段。每个阶段分别报告 `proven`、`partial` 或 `not-proven`、
使用的官方证据、剩余子范围和相对推进成本。Shader 程序完整并不会自动证明外围 sampler、RT、相机、
时间或后处理也与官方一致。

## Shader 证据等级

- `E0 dispatch-only`：识别并渲染了该 layer，不声称与官方 bytecode 等价。
- `E1 partial-bytecode-guard`：手写移植对照了官方 bytecode 中选定的常量、表达式、输出或控制流；
  没有被约束的 Shader 行为仍然未知。
- `E2 transpiled-official-program`：运行时接入了由官方 Shader 经 SPIRV-Cross 转译得到的程序，并检查了
  输入绑定结构；WebGL 适配和外围渲染管线仍可能改变输出。

`E2` 的源代码证据强于 `E1`，但两者都不是视觉还原度，也都不能单独证明官方像素一致。

## 管线和视觉状态

只有 texture color space、alpha 约定、sampler、render-target format、MRT 路由、blend/stencil/depth、
精度、相机矩阵、动画时间、bloom、tone mapping 和最终显示 transfer 都有官方运行时证据时，管线状态
才可标记为 `proven`。仓库 audit 只能防止我们自己的假设漂移；检查“代码符合当前假设”不等于证明
“当前假设就是游戏逻辑”。

视觉状态分为：

- `unmeasured`：没有官方对照采集；
- `qualitative-only`：手机照片或非受控截图只能帮助判断外观，不能计算分数；
- `controlled-layer`：有固定姿态、固定时间的官方逐层采集；
- `controlled-final`：最终合成画面在规定的姿态和时间矩阵上完成对比。

受控采集必须记录游戏版本、卡片和资产版本、设备或渲染后端、分辨率、相机姿态、动画时间、语言，
以及图片是在显示处理前还是处理后得到。指标阈值要从多次官方采集的自然波动推导并记录依据，不能为了
让当前实现通过而手工选择。

## 项目声明规则

只有数据来源完整、所有可见 layer 都声明了 Shader 证据、共享渲染管线已证明一致，并且最终合成在
声明的姿态和时间矩阵上通过受控官方对比时，才能称某张卡“通过官方输出验证”。整张卡的状态取所有
维度中的最低等级；缺失证据必须报告为未知，不能估算成百分比。

查看当前证据：

```bash
npm run report:evidence
npm run report:evidence -- --json
```

只要管线一致性或受控视觉一致性仍缺失，旧证据报告仍会明确返回 `gameFidelity.score: null`；这与新的
`verifiedExactPercent` 证据下限不是同一个声明。

## 自动官方等价性审计

自动审计只使用官方资产、材质配置、Shader bytecode 和运行时绑定。截图与图像阈值被明确排除，因为采集
时序、相机、渲染后端、曝光和显示处理都会让它们成为不稳定证据。

```bash
npm run audit:official-equivalence
npm run audit:official-player-pipeline
npm run audit:official-texture-samplers
npm run test:texture-upload-runtime
npm run audit:official-texture-payload
npm run test:texture-mip-runtime
npm run audit:official-animation-timing
npm run audit:official-android-lifecycle
npm run audit:official-postprocess
npm run audit:official-bloom-program
npm run audit:official-bloom-runtime
npm run audit:official-final-blit
npm run audit:official-display-transfer
npm run test:display-transfer-runtime
npm run audit:official-shader-precision
npm run test:shader-precision-runtime
npm run test:official-touch-rotation
npm run test:official-clock
npm run audit:official-pass-partition
npm run audit:official-draw-state
npm run audit:official-camera-transform
npm run audit:official-card-renderer
npm run audit:official-rendertexture-contract
npm run audit:official-homography
npm run audit:exact-homography
npm run test:homography-runtime
npm run audit:official-mrt-outputs
npm run audit:exact-ur-lens-flare
npm run test:runtime
node build/audit-official-equivalence.mjs --json
```

命令会运行完整静态审计矩阵，并分别报告 layer 分发覆盖、官方程序转译覆盖、局部 bytecode 约束覆盖和推进成本。
只要官方运行时证据还不完整，渲染管线就报告为 `not-proven`，视觉一致性固定报告为 `unmeasured`。
命令通过只表示已声明的数据、源码和 bytecode 不变量成立，不代表最终画面存在一个可计算的还原度百分比。

sampler、动画和后处理命令直接从官方序列化对象、ARM64 原生代码和 Shader bytecode 提取证据。
`test:runtime` 在同一个浏览器进程内依次加载四张参考卡、推进确定性帧，并检查 console、网络和 mesh 数，
不生成截图。

`test:texture-upload-runtime` 使用 renderer 共享的 `HTMLImageElement -> THREE.Texture` loader 和非对称
2x2 PNG，通过 raw WebGL2 shader 与 `readPixels` 核对浏览器 decode、upload、sample、RT 存储后的 RGBA
字节；覆盖 alpha 为零时的非零 RGB、部分透明像素的 straight RGB 和 texture Y 方向，全程不截图。
它证明的是所选 Chromium/SwiftShader 浏览器路径，不能单独证明 Android native texture upload 实现。

texture-payload 审计通过 bundle、PathID、object hash 和 payload hash 标识全部 131 个 Texture2D。
四条官方 mip chain（38 级、解码后 11.2 MB RGBA8）从官方 payload 生成，以
`generateMipmaps=false` 显式上传，并通过 `textureLod` GPU readback 逐级验证。目标设备 ASTC/ETC
硬件解码与 anisotropy 仍是设备相关边界。

display-transfer 审计固定官方 Vulkan/Gamma surface-format policy，并通过数值 readback 验证浏览器
RGBA8、linear attachment、sRGB、opaque alpha 的 compositor 输入。Android 设备实际选中的 swapchain，
以及两端 compositor、OS 色彩管理和面板输出仍属于运行设备状态；报告会把这个最终子范围明确标为
本环境 `not-observable`。

precision 审计固定 14 个官方 SPIR-V program：所有数值类型都是 Float32，3,653 个结果带
`RelaxedPrecision`，且不存在 Float16 type、`OpQuantizeToF16`、`NoContraction` 或 float-control
execution mode。Glitter 已恢复官方 mediump/highp 混合 qualifier。SwiftShader 数值 probe 观察到
mediump 被提升为近似 FP32，但这只是 backend 条件结果；Adreno/Mali 仍需要目标真机 probe。

touch 与动画时间现在来自 native 证据，不再使用指针绝对位置 heuristic：增量 drag 累积、`qY * qX`、
去 roll、30 度 clamp、松手保持、完整层级的 Glitter `transform.forward`、共享 scaled `_Time`、
`maximumDeltaTime` 和 suspend/resume 均有数值测试。Android lifecycle 审计把 8 个 Unity 官方 symbol
映射回游戏 `libunity`：pause 进入 `UnityPause(1)`，resume 先走 `UnityPause(0)` 延迟分支，再由下一次
`UnityPlayerLoop` 完成 `SetPlayerPause(0,true)`。浏览器 visibility adapter 与恢复后首帧 zero-delta 另有
独立测试，因此 animation timing 在当前 renderer 范围已证明。

Bloom 审计固定全部六个官方 SPIR-V program、五级 RT 图、float32 atlas 布局与权重、blur 顺序和
fixed-function blend state。FinalBlit 审计沿官方 ResourceManager → Material → Shader 链，固定 mip 0
`textureLod` 最终呈现 pass，并用非对称 2×2 GPU draw/readback fixture 验证成对的 Vulkan→WebGL Y 适配。固定的 ARM64 constructor 与 `CommandBuffer.GetTemporaryRT` overload
证明 scene 路径请求两路 ARGB32 color target 加 Depth24，并使用 Point filter；Bloom 中间 RT
请求 ARGB32、Linear read/write、Bilinear filter、Depth0、MSAA1、volume depth 1 和非 memoryless。
浏览器会把这些请求显式映射为 RGBA8/unsigned-byte target，scene/Bloom 分别用 Nearest/Linear，
且 Bloom 无 depth、无 multisampling。这个 WebGL2 映射已测试，但它不能证明 Unity 经设备相关
`GetCompatibleFormat` 选出的 Vulkan color/depth physical format；后者仍未证明。
生成的 RenderTexture contract 现已固定选择算法本身：Gamma `ARGB32 -> GF8`，支持时为
`VK_FORMAT_R8G8B8A8_UNORM`，Depth24 则经官方 152 项 capability table 选择 GF92/GF94。
Unity top-origin、Homography sampling 与 FinalBlit `1-v` 已和目标设备实际 VkFormat、stencil aspect、
image layout、逐 pass VkViewport 分开记录。Pass 5 已直接绑定
scene MRT 并 additive 写入 ColorRT；WebGL2 适配对仍 active 的 EmissiveRT 输出零，在官方 shared
blend state 下是严格 no-op。因此报告中的 Bloom program/执行图阶段为 `proven (8/8)`，
但 render-target format 与整条 renderer pipeline 仍分别是 `partial` 和 `not-proven`。

MRT 输出审计会沿官方 prefab 的 Material PPtr 和完整 keyword 集合定位实际 Vulkan program，证明哪些
Shader 写 location 1 以及 RT1 的 replace 状态。Pass partition 审计固定官方 opaque/transparent renderer
event、queue 范围、sorting criteria、MRT/depth binding 和 ShaderTag 顺序。无截图的 legacy 伊布包包 Vulkan
capture 含 3 个已提交且匹配的 23-draw scope，23/23 个 vertex+fragment+specialization program 均按字节确定；
19 个 draw identity 唯一，Frame-Holo 与 LensFlare 各有一对保留为 unresolved。它还选出了生成 WebGL2
Side&Back program 所用的 `INSTANCING_ON` module。由于该 capture 早于 manifest schema，游戏/设备/GPU/driver
provenance 仍不完整，因此 MRT routing 保持 `partial`；它也不能证明尚未捕获的 RR、SR、宝可梦 UR 或
目标设备 physical format。

Draw ordering 仍是独立的高成本 `partial` 阶段。直接审计 APKM/native bytes 现已固定 Unity 的
`CommonOpaque`/`CommonTransparent` criteria、Float32 distance-key 运算、`QuantizedFrontToBack` 最高字节
bucket、原始 `OptimizeStateChanges` 分支、transparent ties，以及最终 visible-node/draw-candidate tie-break。
`audit:official-reference-sort-inputs` 会独立解码四张官方 L prefab bundle，固定原始 `MeshRenderer` 对象
hash，并逐项核对生成后的 scene sort descriptor。生成后的 scene 现在还带有 94 条 draw identity：每个 active draw
都回连到官方 Renderer、Material、Shader、Mesh 的 `CAB:pathID`；84 条 material row 同时保留原始 queue、
instancing 与 valid/invalid keyword 状态。`audit:official-material-sort-inputs` 会重新直接打开官方
Face/CardNew Common/Shader bundle，在不读取 recipe 的前提下把这 84 条记录逐项核对到 69 个序列化 Material
与 26 个序列化 Shader。生产排序现已使用官方 distance/bucket 前缀，以及这些
`MeshRenderer` 节点经 native 分支证明的 0 distance offset。`audit:official-pass-candidates` 会独立沿官方
prefab 的 Material PPtr 与 Shader asset，证明 98 个参考 draw 的 selected pass index 与 candidate ordinal
均为 0。`audit:official-srp-batcher` 会把官方 native 返回路径与 compiled Shader reflection 合并审计，证明
26 个 canonical Shader 全部不兼容 SRP Batcher，因此 94 个 active draw 的该 bit 都是 0。
`audit:official-local-keyword-state` 固定六个 official/game native 函数，按 Shader `m_KeywordNames` 顺序独立
重建序列化 keyword bitset，并应用官方 XXH32 seed；84 条 scene row 已逐项核对到 69 个 canonical Material，
因此最终 LocalKeywordState hash 不再是未知量。同前缀 ties 仍是近似实现；第一个尚未恢复的 Optimize key
已前移到 entry `+0x08`，并使用 command 审计证明的 hashed Material/Shader 公式。该 key 剩余未知量是
运行期 Material 原始字段 `+0x17c` 的低字节与 Shader Object InstanceID 低字节。
如果该 key 仍相等，这些 non-static-batched 参考 draw 会继续比较 packed lightmaps 与 entry `+0x28`，然后才是
CanvasOrder、压缩后的 RenderNodeQueue slot（VisibleNodeIndex）与 candidate ordinal；只读 probe 会一次性
捕获并按官方公式校验这段完整后缀。
同一 raw-prefab 审计还证明 78 个参考 MeshRenderer 全部不是 static batch、static/dynamic lightmap index
均为 `65535/65535`，且四张 prefab 均无 `LODGroup`。官方 bundle extractor 现已把这些字段、material slot、
native-zero Canvas order/LOD fade 写入每个 scene sort descriptor。extractor 还把四张卡的序列化 Mesh identity
解析为 7/7/9/9 个等价类，并证明所有 renderer 都使用 no-SortingGroup 默认 key `0xfffff000`。这些事实会把
transparent 在 Optimize 之前的 tie key 全部化简为已知常量，但仍不能确定上述运行期 identity 值。
`audit:official-sort-input-producers` 会独立固定 native 构造路径：20 个官方 producer/helper symbol、107 条
精确 AArch64 load/store/pack/control-flow 指令、comparator 使用的普通 Renderer entry/RenderNode offset、non-LOD native
zero relocation，以及独立的 BRG 公式。构造链还证明 `MeshRenderer` 传入 `RendererType=1`，将它写入
`Renderer+0x128` 低 6 位，再复制到 `RenderNode+0xe8`。无法从公开 C++ 资料证明的 private member 继续
保留 raw offset 名称，不做猜测。
`audit:official-instance-id-remapper` 还会在 Unity 官方 release binary 与游戏实包之间固定 136 条 AArch64
指令，证明普通与 contiguous 两套 InstanceID 分配公式，以及 ID 写入 `Object+0x08` 的传播链。它也证明了
静态边界：`CAB:pathID` 不含实时 Remapper base、既往 unique-key/duplicate-hit 历史与 load mode/order，
因此不能独立恢复 InstanceID 低字节。
`audit:official-sort-command-branch` 会固定官方 `DrawOpaquePass.Execute` 与
`DrawTransparentPass.Execute` 的 command setup，证明两个 pass 都写入 branch selector 0，因此 entry `+0x08`
选择 hashed Material/Shader state-key 公式。
`audit:official-unity-symbol-map` 还会把游戏函数映射到 Unity 官方 Android Build Support 附带的 public
symbols。完整 comparator 与 distance 函数分别逐字节匹配 `RenderObjectSorter::operator()` 和
`ComputeSortingDistance`；存在 relocation 的函数则由唯一指令前缀、精确 symbol 起点与精确 symbol 大小共同约束。
`audit:official-sort-prefix-collisions` 不运行 renderer，直接解析四张 canonical GLB 与 scene sort descriptor。
当前稳定得到 17 个碰撞组、涉及 36 个 draw；逐字段决策表证明 14 个 opaque 组和 3 个 transparent 组都会进入
`OptimizeStateChanges`，并在 RendererType、LOD fade、static-batch gate、packed lightmap 以及官方 SRP bit 0
上相等；第一个未知字段是 entry `+0x08` 的 hashed 分支。恢复后的 keyword hash 将 17 组精确分类为：
6 组只缺 Material `+0x17c`，3 组共用 Shader 但缺它的 InstanceID，8 组涉及不同 Shader（只有 top byte
相等时才继续比较 Material `+0x17c`）。
`audit:official-sort-runtime-capture-tool` 会把只读 Frida probe 静态固定到 PTCGP 1.6.0 `libunity.so` 的
3 个函数与 6 个 hook 指令字。实际运行它仍需要 rooted arm64 测试设备和匹配的 ADB/Frida；未取得设备 capture
之前不会把它计作已证明证据。严格 importer 会把每条 row 绑定到单一 session/release,重算两个 native packed
key,忽略屏幕上无关 draw,并保留有歧义的 Renderer 候选;其合成成功/失败矩阵已进入无浏览器审计,但合成 row
绝不算官方证据。静态 PPtr identity 只用于关联运行期 capture，绝不会
被当作替代排序键。
自动生成的 17-group/36-draw collision manifest 会反向核对静态审计。浏览器 resolver 要求 artifact 的
scene SHA-256 精确一致,并只按完整 group 原子启用 captured native suffix。对象 comparator 已在 20,000 组
确定性 opaque/transparent case 中与 raw native entry/node comparator 一致;部分 group 不会混用 capture
与 fallback key。

Fixed-function draw state 使用独立的无截图审计。审计会在代表性的官方 opaque、transparent、CullOff、
stencil 和 shared-MRT draw 的真实 WebGL2 draw call 处截取状态，并用 framebuffer 像素探针核对；目前
98/98 assertions 通过。该审计已发现并守护 three.js 的 `stencilWriteMask` 映射，包括官方非默认值 `4`。
这 98 条断言只覆盖 three.js r165 + Chromium/SwiftShader 下选定的代表性 draw，不证明每个材质、
原生 Unity/Vulkan 状态、draw ordering、Shader 数学或最终整卡视觉一致。

官方 `Prerender/Homography(from RT)` 顶点/片元 program 也已从 Vulkan SPIR-V 重新生成；H/Hinv
`float[9]` binding、IL2CPP producer/upload、material state 和 `alpha = 1 - sampled.a` 公式均已固定。
浏览器 H/Hinv helper 保留已审计的 ARM64 Float32 运算顺序，identity、convex、degenerate 与
near-degenerate case 的 bit pattern/runtime test 已通过。官方 IL2CPP 还证明了 `_clampParallax` 材质分支、
只作用于 source 的 touch root，以及 CardRenderer RT 到 `_DynamicUITex` property block 的完整路径；四张固定
prefab 的 98 个材质引用证明了 producer RT0 alpha 分类和 remaining-transmission contract。`public/app.js`
现已接入官方质量档 source MRT/camera（High 1403、Middle 1122、Low 982）、官方 Bloom、投影 keypoint、双 attachment Homography display MRT
和 FinalBlit。runtime probe 会检查 source/display 两级非空、外层 Quad 不跟随旋转且 keypoint 顺序未反射。
原生 RenderTexture 物理 Y、每次 draw 的 `_TextureSampleAdd`、物理纹理格式和目标设备 compositor/OS/面板
display transfer 仍未证明，因此整条 renderer 仍不能标成字节级完成。

Camera 审计固定了官方 local -Z camera、distance/FOV、parent `Ry(180°)`、render layer 21、keypoint
方形与顺序、累计 drag delta 的 `qY * qX` touch rotation（native 直接调用 `acosf`），以及 30 度
quaternion clamp。普通 `CommonUICardDetailCard` 的官方序列化 component 中
`_cardSize=6`，经官方映射表得到 `CardSizeType.Large` (734×1024)；按普通 Android 默认画质
`Middle=0.8` 代入官方方形 source RT 公式，结果是 `1122×1122`。`561×561` 只是把 card size
反事实地当成 `Medium` 才会得到的数，不是 detail view 尺寸。设备上已持久化的 quality override
仍是未证运行时状态；浏览器默认使用按物理 drawing buffer 派生的 `auto` source RT，避免桌面显示阶段
再次放大移动端 RT，但这个查看尺寸不能作为 capture 证据。`quality=middle` 精确复现 capture 的 1122
方形 source RT，High、Low 保留官方固定尺寸。各模式均使用 aspect-1 camera。
同一普通 component 的 `_useGyro=false`，所以浏览器对这个 view 刻意不启用设备 gyro。通用的
gyro-enabled 路径中仍未证的部分不阻塞普通 detail 路径。生成的 `card-display-contract.json` 已把官方
方形 RT、camera、clear/alpha、keypoint 和 display mode 事实汇总为无手调常量的运行时 contract。native RT
物理 Y 现在属于 render-target/backend 边界，不再是普通 detail camera transform 的未实现项。

`audit:official-player-pipeline` 会从官方 APKM 直接读取 `globalgamemanagers` 和 ARM64 `libil2cpp.so`
（可用 `PCR_APKM` 指定路径）。当前它证明 Unity Gamma 工作流、HDR/质量设置和卡片 RT 构造参数；
研究审计需要 Python 包 `UnityPy` 与 `capstone`，不会把派生 recipe 当作权威来源。
