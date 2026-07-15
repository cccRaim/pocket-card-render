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

百分比只能用于某个明确维度的覆盖率，例如“官方程序转译覆盖 64 个参考 layer 中的 59 个”。不能把
这个数字改名、加权或宣传成“游戏还原度”。

## 推进成本

成本由“工作类型 + 剩余范围”表示，不给没有依据的日历时间估算：

- `maintenance`：当前参考范围已经完成，只剩回归维护。
- `renderer-integration`：补齐 layer 分发或运行时绑定。
- `source-tracing-and-bytecode-audit`：补齐官方来源或 bytecode 证据。
- `shader-reverse-engineering`：提取/反编译官方程序、恢复绑定、移植并增加约束审计。
- `runtime-pipeline-research`：证明 format、MRT、精度、显示 transfer 等共享官方运行时行为。
- `excluded-by-policy`：明确不进入自动审计。

当前 64 个可见 layer 的报告结果为：

| 维度 | 当前状态 | 推进成本 | 剩余范围 |
|---|---:|---|---:|
| Layer 分发 | 64/64 | `maintenance` | 0 layer |
| 官方程序转译 | 59/64 | `shader-reverse-engineering` | 5 layer / 4 个 Shader family |
| E1 局部约束推进到 E2 | 5 个 E1 layer | `shader-reverse-engineering` | 与上一行相同的 5 layer / 4 family，不能重复相加 |
| 任意官方源证据 | 64/64 | `maintenance` | 0 layer |
| 渲染管线一致性 | `not-proven` | `runtime-pipeline-research` | 11 个共享阶段，影响全部 64 layer |
| 视觉一致性 | `not-evaluated` | `excluded-by-policy` | 0 个自动工作单元 |

这些数字由当前加载的参考 scene 自动生成；新增 scene 或把某个 Shader 提升到 E2 后，`report:evidence`
和 `audit:official-equivalence` 会自动更新成本。

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

只要管线一致性或受控视觉一致性仍缺失，报告就会明确返回 `gameFidelity.score: null`。

## 自动官方等价性审计

自动审计只使用官方资产、材质配置、Shader bytecode 和运行时绑定。截图与图像阈值被明确排除，因为采集
时序、相机、渲染后端、曝光和显示处理都会让它们成为不稳定证据。

```bash
npm run audit:official-equivalence
node build/audit-official-equivalence.mjs --json
```

命令会运行完整静态审计矩阵，并分别报告 layer 分发覆盖、官方程序转译覆盖、局部 bytecode 约束覆盖和推进成本。
只要官方运行时证据还不完整，渲染管线就报告为 `not-proven`，视觉一致性固定报告为 `not-evaluated`。
命令通过只表示已声明的数据、源码和 bytecode 不变量成立，不代表最终画面存在一个可计算的还原度百分比。
