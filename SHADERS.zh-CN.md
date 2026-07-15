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
| SMOL-V 解码器 | 已随仓库:`build/shaderdec/smolv.py`(纯 Python) | SMOL-V → SPIR-V |
| **SPIRV-Cross** | [Vulkan SDK](https://vulkan.lunarg.com/) 或[独立版](https://github.com/KhronosGroup/SPIRV-Cross) | SPIR-V → GLSL(Khronos 官方权威转译器) |

你还需要**解密后的** `Common/Shader` bundle(`<DECRYPTED>` —— 见 [SETUP.zh-CN.md](SETUP.zh-CN.md) 第 1 步)。

## 第 1 步 —— 提取 SPIR-V

在 recipe 里找到着色器名(`scene.json` → `materials[*].shader`,如 `Frame-Holo-UR-New`),然后:

```bash
pip install UnityPy lz4
python build/shaderdec/dump_shader.py "Frame-Holo-UR-New" frameur \
    --shaders "<DECRYPTED>/Common/Shader" --out shaders_spv
# → shaders_spv/frameur_frag.spv  (+ frameur_vert.spv)
```

如果材质启用了编译期 Shader keyword，必须选择对应 sub-program，不能继续依赖“取最大 module”的默认规则：

```bash
python build/shaderdec/dump_shader.py Card_Parallax card_parallax \
    --keyword _UVASPECTRATIO_SQUARE \
    --shaders "<DECRYPTED>/Common/Shader" --out shaders_spv
```

keyword 必须来自该材质 recipe。同一个 Shader 名下的不同 variant 也可能包含不同数学逻辑。

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

SPIRV-Cross 的输出用的是 Unity 约定。适配到 three.js:

- 别名化属性(`position` / `normal` / `uv`),`gl_Position` 用 `projectionMatrix * modelViewMatrix`;
- 用 `inverse(modelMatrix) * cameraPosition` 算相机相对基底(见 `render/glsl.js` 的共享 `VIEW_BASIS_VS`,
  就是干这个的);
- 保留所有实际生效的颜色输出；如果 WebGL 不能直接暴露官方 MRT 布局，就把未改写的官方输出路由到
  对应 renderer pass，并对这层适配做显式审计；
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

## 现实提醒(别手调)

- 小着色器从 SPIRV-Cross 几乎能 1:1 移植。大的那些(Frame-Holo ≈ 1219 条指令、ShadowBox ≈ 1306)**加上**
  名字被抹,是真的难——这正是 `render/materials/` 里那些策略存在的原因,直接复用。
- **靠数值验证,不靠眼睛。** 给真实 `.spv` 和你的 GLSL 喂相同输入再 diff 输出;用常量贴图能让对比变成
  纯算术。每个常量都必须能追溯到 recipe 或字节追踪——绝不拍脑袋。
