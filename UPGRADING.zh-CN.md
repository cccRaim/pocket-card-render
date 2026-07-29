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
   任一触发域未闭合时必须失败。
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
6. 重建 canonical scene、文字/TMP/UGUI/RT 契约，完成静态审计后再采集一批新的
   official guest runtime evidence。
7. `npm run audit:official-version-migration` 与 `npm run audit:all` 都通过后，
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

因此，renderer 架构和大部分 Shader adaptation 可以跨版本保留，并不需要整体重做。
但迁移尚未完成：仍缺匹配的 Unity Android release player/symbols、完整 candidate
canonical corpus、Unity 6 TMP/UGUI/RT/default 复验，以及全部 guest runtime/display
新证据。
