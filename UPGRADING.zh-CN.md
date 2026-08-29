# 官方版本升级

渲染器实现与官方证据必须分开看待。Unity 或游戏升级不会自动推翻 three.js
架构，但会立即使旧版本绑定的 APK、native RVA、ShaderProgram、Material、
serialized asset 和 runtime capture 失去对新版本的证明力。

## 版本唯一事实源

- `build/official-samples/current.json` 只负责选择当前样本。
- `build/official-samples/candidate.json` 只负责选择正在迁移的候选样本。
- `build/official-samples/<sample>.json` 是不可变的版本快照，记录游戏/Unity
  版本、关键二进制 hash、资产规模、shader proof graph 和 canonical scenes。
- `build/official-sample.mjs` 是 Node 工具的统一读取与 schema 校验入口。
- runtime evidence 的 source-set hash 包含指针和实际 manifest；切换版本会自动
  使旧 capture 失效。

不要直接覆盖旧 manifest。新版本应新增一个 `status: "candidate"` 的文件，迁移期间
只更新 `candidate.json` 指针；完成迁移后把 manifest 改为 `baseline`，最后再修改
`current.json`。

## 升级流程

1. 复制当前 manifest 为候选文件，让 `candidate.json` 指向它，填写新 APK/split、
   Unity build、二进制 hash 和初始 inventory，不要先改 `current.json`。易变下载放在
   `.output`，版本固定的全量输入保存到 `.output-full`。
2. 运行：

   ```bash
   npm run verify:official-sample-inputs -- \
     --manifest build/official-samples/<candidate>.json \
     --splits <candidate-split-directory> \
     --metadata-plaintext <candidate-global-metadata.dat>
   npm run report:official-version-migration
   ```

   第一条命令逐字节校验 split 以及其中的 libunity、libil2cpp、
   encrypted metadata、boot.config 和 globalgamemanagers；若不可变来源是 APKM，
   则改用 `--apkm <candidate.apkm>`。第二条只负责按
   `package-native`、`unity-runtime`、`serialized-assets`、
   `shader-programs`、`runtime-evidence`、`documentation` 列出失效计划，迁移未完成时
   也允许成功。`npm run audit:official-version-migration` 是严格 fail-closed gate，
   任一触发域未闭合时必须失败。strict gate 采用 shallow-first：先执行低成本
   readiness preflight，只有全部 shallow 义务闭合后才进行昂贵的 deep 重提取；
   shallow 未完成时跳过 deep，但仍以非零状态退出。
3. 重新提取 APK/IL2CPP/metadata，重定位 native producer；RVA 和旧函数签名只能
   当定位线索，不能沿用为新版本事实。
4. 重新生成资产 inventory、Material/program proof graph 和 selector port
   contract。按 semantic executable hash 将 port 分成 unchanged、changed、
   added、removed；只有 unchanged 且所有依赖 hash 都闭合的 port 才可复用。静态迁移证据用以下命令复现：

   ```bash
   npm run build:official-program-migration
   npm run audit:official-program-migration
   npm run analyze:official-program-migration
   ```

5. 对 changed/added port 重新生成 WebGL 产物和数据派生 witness 子语料，并运行 gate：

   ```bash
   npm run build:candidate-changed-ports
   npm run audit:candidate-changed-ports
   npm run build:candidate-static-port-reuse
   npm run build:candidate-program-port-contract
   npm run audit:candidate-program-migration
   ```

   changed-route 子语料只证明对应 selector/Material witness 范围，不是完整 candidate
   canonical corpus，也不是 runtime evidence。
   static reuse 完全由数据派生：当前分母是 68 条 formal manifest 加 1 条
   engine-owned runtime boundary。聚合 program-migration audit 会从 candidate 官方字节
   重新提取全部可复用 route，并验证完整的 78-formal-port contract。
   使用 `npm run report:candidate-migration-readiness` 获取可执行的逐域进度报告。
   它会运行 candidate package/native 与 changed-port verifier，核对 `.output-full`
   快照绑定，并报告 `pass`、`partial` 或 `blocked`。该报告描述迁移义务完成情况，
   不是 Shader 还原度或视觉还原度百分比。
6. 重建 canonical scene、文字/TMP/UGUI/RT 契约。所有 generator 停止后，原子采集完整
   candidate 本地 WebGL/TMP batch，再独立审计版本化的 official guest 分母：

   ```bash
   npm run audit:full-runtime-evidence:require
   npm run audit:tmp-runtime-evidence:require
   npm run audit:runtime-display-fidelity
   npm run audit:candidate-official-guest-runtime-batch
   npm run probe:candidate-guest-vulkan
   npm run convert:candidate-guest-vulkan -- \
     --trace <card-frame.gfxr> \
     --output <artifact-root>/<cardId>/capture
   npm run audit:candidate-guest-platform-blocker
   ```

   probe 是只读的：不启动目标 app、不安装包、不修改 Android settings，也不生成 capture；
   它只报告 ADB/root、package ABI/native bridge 和 Vulkan layer 前提。BlueStacks host
   compositor capture 不是 official guest evidence。只有观察到目标进程内 capture layer
   初始化并取得真实 trace 才能称 guest capture；probe ready 本身不贡献 fidelity 证据。
   production `user` build 上只有 root 权限并不足以授权 external Vulkan layer；target 必须
   debuggable、显式启用 `com.android.graphics.injectLayers.enable`，或运行在已授权且 rooted
   的 `userdebug`/`eng` build。

   当前已在 BlueStacks Pie64 上测试 hash 匹配的 1.7.0 candidate。该 ARM translation
   路径是 tested-platform dead end：production `user` build 无法向 non-debuggable target
   注入 layer，clean candidate launch 又在形成稳定可捕获卡面前崩溃于 `libhoudini.so`。
   GFXReconstruct 未映射、未初始化，也没有生成 `.gfxr`。使用
   `npm run audit:candidate-guest-platform-blocker` 校验这份 hash-bound、
   tested-platform-only 报告；它既不闭合 official guest runtime，也不闭合 native display，
   fidelity contribution 必须为 0。后续 guest capture 只能转到真 ARM64 设备，或可授权
   external layer 的 ARM64 `userdebug`/`eng` 环境。
7. 每个设备 `.gfxr` 必须在桌面端通过哈希绑定的 `gfxrecon-convert` 与
   `gfxrecon-extract` 转换。桥接器先保留 raw trace、官方 JSONL、导出的 SPIR-V 与
   conversion manifest，再生成 importer 消费的严格 `events.jsonl`；遇到同族但未支持
   的 Vulkan 命令必须 fail closed。事件 schema 之外的其余 Vulkan 调用必须由版本化
   `gfxreconstruct-state-boundary-contract` 全部分族计数，覆盖 memory mapping、
   buffer/image payload、descriptor/layout、command、synchronization、presentation、
   query 与 fallback；九卡验证器必须直接从 raw 官方 JSONL 独立复算，禁止 conversion
   manifest 在同步重算哈希后隐藏已观察但未重建的调用。该步骤只证明事件转录，当前明确
   不重建 framebuffer 像素、mapped/device-local buffer 内容，因此不能单独闭合 display
   或 uniform value 义务。
   正式转换必须匹配 `build/gfxreconstruct-toolchain.json` 的平台、版本、文件大小与 SHA-256；
   九卡批次还会重新校验 `trace.gfxr`、官方 JSONL、conversion manifest、`events.jsonl`
   和每个 SPIR-V。单卡只有 program dispatch、pipeline state、descriptor bindings、
   uniform values、attachment descriptors、attachment layouts、vertex bindings 与
   draw submission 八类证据全部 exact，才可进入 complete 分母。
   program dispatch 还必须让每个 inventory execution 以
   `selectorId + candidateWitnessId + subshader + pass` join candidate port contract；
   只匹配 SPIR-V 不够。import artifact 必须绑定 contract SHA，并在 expected/assigned
   draw 上保留 semantic executable 与 stage/parameter/pass/common identity fields。
   九卡 batch 还会逐一校验 78 个 candidate port manifest 的文件 SHA、复合 route、
   executable/pass identity，并把排序后的 manifest inventory 聚合为
   `programPortManifestSetSha256`；该集合变化会使旧 capture/import 自动失效。
   Pipeline 对照器按 Material property → Shader property default → serialized pass
   literal 解析 pass state，再与 draw-effective Vulkan state 逐字段比较。动态状态缺少
   对应 `vkCmdSet*`、advanced BlendOp、separate blend、非零 depth bias、未知 enum 或
   `pNext` 未解释时必须 fail closed。Unity BlendFactor 按语义映射，ColorWriteMask
   从 Unity ABGR 位序 remap 到 Vulkan RGBA，并核对全部 MRT attachment。可比字段全部
   相等仍只是 partial evidence；在 Unity Vulkan backend lowering 与 render-pass
   compatibility 未独立闭合前，`pipelineState` 必须保持 runtime-required。
   即使尚无 `.gfxr`，batch 也会先把九卡编译为 232 个 expected draw：214 个 formal
   pipeline expectation 与 18 个 engine-runtime-boundary draw；任何 unresolved
   expectation 都会在采集前失败。这一静态分母不贡献 fidelity。
   Unity 6 draw sort 的静态部分应单独报告：当前 `distanceKey` 与四个无外部调用的
   sorting/light-probe getter 已通过保留字段偏移和直接调用的严格规范化；复杂
   `sortInputBuilder`、comparator live inputs、job output 与 guest input state 仍须运行时证据。
8. `npm run audit:official-version-migration` 与 `npm run audit:all` 都通过后，
   把候选 manifest 改为 `baseline`，切换 `current.json`，再次运行完整 gate。

## Fail-closed 规则

- 新版本迁移期间，旧版本的 `exact` 只能描述旧样本；不得外推到候选版本。
- shader 名称相同、SPIR-V stage hash 相同或画面相似都不足以保留 complete exact。
- Unity patch 升级也必须重验 serialized layout、variant selection、pass/common
  bindings、guest descriptor/uniform/attachment 与 engine default。
- Unity major、Built-in/SRP 或 graphics API 变化时，优先判定为 pipeline/backend
  迁移，不假设 Vulkan 到 WebGL 的旧 substitution 仍成立。
- 截图只用于末端视觉回归，不参与版本迁移的 official fidelity 计分。

## 1.6.0 到 1.7.0 的实际变化

当前 candidate `ptcgp-1.7.0-unity-6000.0.69f1-candidate` 将 Unity 从
`2022.3.62f2` 升级到 `6000.0.69f1`；游戏 ARM64
player 的内嵌身份为 `6000.0.69f1_5f8607f5118b`。

- canonical Face bundle 从 3,191 增至 3,546，唯一 Material 从 8,460 增至
  9,395，Material slot usage 从 58,057 增至 64,738。
- 静态 program inventory 从 80 条 route 变为 79 条：9 条发生变化、0 条新增、
  1 条旧 route 移除。
- 9 条变化中，6 条只是 engine uniform layout 变化，3 条包含 Shader 逻辑变化；
  另有 1 条本来可复用的 route 因 serialized Shader property default 改变而被拒绝。
- 69 条完整验证为可复用的 route 中，68 条是 formal WebGL port，另 1 条是
  engine-owned `Side&Back` runtime variant boundary。加上 10 条 changed/default-sensitive
  port，候选版本的正确分母是 78 条 formal port 加 1 条 runtime boundary。
- Shader variant 的 native score 与同分规则已从 Unity 6 游戏 `libunity.so` 重新证明；
  没有把旧 RVA 当作新版本事实沿用。
- 匹配的 Unity Android Build Support release player 与 symbols 已独立取得，并绑定到
  changeset `5f8607f5118b`。
- candidate RenderTexture 证据按 producer family 拆分。detail-card 的
  `_cardSize/_useMipMap` 字节通过 candidate serialized-UI corpus 正式 join；
  游戏自定义 `BloomPass.Execute` 仍是 command-buffer 路径，并没有整体迁入
  RenderGraph。候选 IL2CPP 已固定 5 个 `GetTemporaryRT`、5 个 release、ARGB32
  base descriptor 与 Bilinear filter。匹配 release player 的 29×2
  RenderTextureFormat→GraphicsFormat 表、readWrite overload、native helper、
  icall wrapper、`RenderTextureDesc`/`RenderTexture` constructor 已与 candidate
  `libunity.so` 逐字节/函数形状绑定；managed constructor 链证明当前
  `ARGB32 + Default + Gamma` 请求 `R8G8B8A8_UNorm`，默认 descriptor 为
  MSAA 1、volumeDepth 1、memoryless None。`SystemInfo.GetCompatibleFormat(Render)`
  的设备返回、legacy depth conversion、live descriptor、physical Y、Unity allocation
  与 guest attachment 仍是 runtime-required，禁止把请求格式或 constructor 默认值
  表述为物理 GPU 资源已还原。
- Unity 6 scene MRT 的 RenderGraph 路径不再只是“架构已迁移、尚未解码”，现为
  partial-exact。4 个 candidate ARM64 方法及其 metadata layout 证明 emissive target
  使用 `R8G8B8A8_UNorm`、无 depth，宽高为 `GetBufferSize` 结果各乘 2；opaque 与
  transparent raster pass 都把 active color 绑定到 attachment 0、emissive 绑定到
  attachment 1，访问标志为 `AccessFlags.Write`。继承的 live `TextureDesc` 字段、
  `BloomVolume` 状态、Unity allocation/aliasing，以及 guest Vulkan attachment、
  layout 和 submission 证据仍为 runtime-required。
- UnityPy 对 candidate 的 852-byte `PlayerSettings` object 报告只消费 848 bytes，
  但这不再被误判为缺少字段。游戏实际 `libunity.so` 与匹配的 Unity release
  player/symbols 都证明
  `PlayerSettings::Transfer<GenerateTypeTreeTransfer>` 和
  `PlayerSettings::Transfer<SafeBinaryRead>` 在
  `androidVulkanAllowFilterList` 后立即返回；最后 4 个零字节作为官方 Transfer
  边界之外的 raw suffix 单独保留并哈希。5 个相关 PlayerSettings 字段分别绑定
  object offset、原始字节和游戏两条 transfer xref。该例外只对当前哈希固定样本精确
  成立；suffix、terminal member、member offset、返回路径、player 函数体或 build ID
  任一变化都必须 fail closed。
- 三条卡面 UGUI producer 已从 candidate ARM64 `libil2cpp.so` 重新定位并绑定函数体
  hash：`FontGroupConditions.GetFontGroup`、`CardDynamicUIView.Apply` 和
  `CardDynamicUIViewExtensions.Apply`。Il2CppDumper 只提供地址；字段读取、分支、
  字符串比较和 `SetActive` dispatch 都重新核对 manifest 匹配的候选字节。静态控制流
  为 exact，但 live `CardData`、枚举器内容/顺序、GameObject 名称及激活结果仍为
  runtime-required。
- Unity 6 TextCore SDFAA FontEngine producer 已通过游戏 `libunity.so` 与匹配的
  release player/symbols 独立重证。9 个 native 函数全部 exact：其中 8 个按规范化
  完整函数体唯一对应，`RenderGlyphToTextureJob` 则固定游戏链接器插入的
  literal-load thunk、分支和 rejoin window。这里闭合的只是 native producer identity；
  guest glyph request 顺序、dynamic atlas 像素/metrics、生成的 TMP mesh/descriptor
  以及实际提交的 draw binding 仍为 runtime-required。
- candidate canonical corpus 已是 9 张：4 张 baseline regression 加覆盖全部
  changed/default-sensitive route 的 5 张最小集合。当前 TMP evidence 为 9/9。
  full-runtime schema v6 还会通过 RGB occupancy 与 energy 拒绝 opaque-black
  MRT/display frame，不能再把非零 alpha 当成可见输出。当前 source-current local
  batch 为 9/9，display evidence 为 54/57；剩余 3 项是 emulator-host、guest Vulkan
  card frame 与 native-device display 外部边界。
- release player、symbols、release-support identity 与 canonical corpus 均已解析。
  原始 APKM container 因不可变输入以 raw split APK 交付而保持 unresolved，但 split 与
  其中的 native identity 已闭合；剩余执行边界是符合条件的 guest/native ARM64 capture
  device。

因此，renderer 架构和大部分 Shader adaptation 可以跨版本保留，并不需要整体重做。
但迁移尚未完成：Unity 6 guest TMP 输出/UGUI/physical-RT/default submission、9 卡 official
guest Vulkan batch、Vulkan 到 WebGL backend semantic equivalence 与真机 display
transfer 仍需新证据。本地 runtime evidence 禁止改名为 official guest evidence，
official guest batch 当前仍为 0/9；BlueStacks blocker 不满足其中任何一张卡，也不贡献
fidelity。当前仍不能发布官方 Shader 或视觉 fidelity 百分比。
