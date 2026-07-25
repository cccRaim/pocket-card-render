# 官方版本升级

渲染器实现与官方证据必须分开看待。Unity 或游戏升级不会自动推翻 three.js
架构，但会立即使旧版本绑定的 APK、native RVA、ShaderProgram、Material、
serialized asset 和 runtime capture 失去对新版本的证明力。

## 版本唯一事实源

- `build/official-samples/current.json` 只负责选择当前样本。
- `build/official-samples/<sample>.json` 是不可变的版本快照，记录游戏/Unity
  版本、关键二进制 hash、资产规模、shader proof graph 和 canonical scenes。
- `build/official-sample.mjs` 是 Node 工具的统一读取与 schema 校验入口。
- runtime evidence 的 source-set hash 包含指针和实际 manifest；切换版本会自动
  使旧 capture 失效。

不要直接覆盖旧 manifest。新版本应新增一个 `status: "candidate"` 的文件，完成
迁移后改为 `baseline`，最后只修改 `current.json` 的指针。

## 升级流程

1. 复制当前 manifest 为候选文件，填写新 APK、Unity build、二进制 hash 和初始
   inventory，不要先改 `current.json`。
2. 运行：

   ```bash
   npm run verify:official-sample-inputs -- \
     --manifest build/official-samples/<candidate>.json \
     --apkm <candidate.apkm>
   npm run audit:official-version-migration -- build/official-samples/<candidate>.json
   ```

   第一条命令逐字节校验 APKM、split 以及其中的 libunity、libil2cpp、
   encrypted metadata、boot.config 和 globalgamemanagers。第二条输出按
   `package-native`、`unity-runtime`、`serialized-assets`、
   `shader-programs`、`runtime-evidence`、`documentation` 列出失效域。
3. 重新提取 APK/IL2CPP/metadata，重定位 native producer；RVA 和旧函数签名只能
   当定位线索，不能沿用为新版本事实。
4. 重新生成资产 inventory、Material/program proof graph 和 selector port
   contract。按 semantic executable hash 将 port 分成 unchanged、changed、
   added、removed；只有 unchanged 且所有依赖 hash 都闭合的 port 才可复用。
5. 对 changed/added port 重新生成 WebGL 产物并运行 generator/verifier gate。
6. 重建 canonical scene、文字/TMP/UGUI/RT 契约，完成静态审计后再采集一批新的
   official guest runtime evidence。
7. `npm run audit:all` 通过后，把候选 manifest 改为 `baseline`，切换
   `current.json`，再次运行完整 gate。

## Fail-closed 规则

- 新版本迁移期间，旧版本的 `exact` 只能描述旧样本；不得外推到候选版本。
- shader 名称相同、SPIR-V stage hash 相同或画面相似都不足以保留 complete exact。
- Unity patch 升级也必须重验 serialized layout、variant selection、pass/common
  bindings、guest descriptor/uniform/attachment 与 engine default。
- Unity major、Built-in/SRP 或 graphics API 变化时，优先判定为 pipeline/backend
  迁移，不假设 Vulkan 到 WebGL 的旧 substitution 仍成立。
- 截图只用于末端视觉回归，不参与版本迁移的 official fidelity 计分。
