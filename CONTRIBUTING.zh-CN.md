# 贡献指南 —— 渲染架构 & 如何新增一个稀有度

> [English](CONTRIBUTING.md) · **简体中文**

渲染器是**数据驱动**且**字节级忠实**的:每一层的外观都从游戏自身的材质数据 + 着色器字节码还原而来。
没有拍脑袋的魔法数字。两条规则:

1. **对着数据验证,不靠感觉。** 新材质的常量来自 recipe（`scene.json`）或对着色器的字节追踪——
   绝不手调。在注释里写明来源。
2. **不许回归。** 任何渲染改动后,对三张样例卡做截图像素 diff(见下方*验证*)。

## 架构（`public/render/`）

```
render/
├── registry.js        策略注册表 —— defineMaterial(kind, {requires, build}) / getMaterial(kind)
├── context.js         RenderContext(已解析的贴图、环境立方体贴图、动画列表)+ 混合/模板辅助
├── glsl.js            共享 GLSL 片段(view-basis 顶点着色器等)
├── rarities.js        SHADER 表:着色器名 → { blend, kind, alphaTest, bg, defer },按稀有度分组
└── materials/
    ├── index.js       导入每个材质模块(注册所有策略)
    ├── base.js        textured / depthParallax / effect / frameOutline   (全稀有度共享)
    ├── holo.js        holo / frameHolo / exHolo / rarity / sbHolo          (虹彩家族)
    └── ur.js          plate / parallax / flare / metal / glitter           (UR 金箔家族)
```

渲染器（`app.js`）**不做逐着色器分支**。对每个 glb 网格,它查出 recipe,找到
`cfg = SHADER[shader]`,然后查表分发:

```js
const strat = getMaterial(cfg.kind);
if (!strat || !strat.requires(r, ctx)) return;   // 门槛:缺贴图等情况直接跳过
const mat = strat.build(r, ctx);                  // 返回 three.js 材质
```

**策略(strategy)** 是纯函数——接收 `(r, ctx)`,返回一个 `THREE.Material`:

- `r` —— 材质 recipe（`scene.json.materials[name]`）:`shader`、`queue`、`floats`、`colors`、
  `textures`、`keywords`、`clip`。
- `ctx` —— [RenderContext](public/render/context.js):`layerTex(r, slot)`、`layerTexRepeat`、
  `texStraight(name)`、`envCubeTex`、`exactGlit`、`animMats`、`exactGlitMats`、`dynUITex`、`foilTex`、
  `exHoloMats`。
- 若该层的主贴图是 straight-alpha,设 `mat.userData.straight = true`（分发器据此选择混合因子)。
  需要每帧 `uTime` 的材质,push 进 `ctx.animMats`。

## 新增一个稀有度

假设新稀有度 **SAR** 引入一个新着色器 `Card_SAR_Prism`,外加一些与 UR 共享的着色器。

1. **实现新材质**,放进它自己的模块 —— `public/render/materials/sar.js`:

   ```js
   import * as THREE from "three";
   import { defineMaterial } from "../registry.js";
   import { VIEW_BASIS_VS } from "../glsl.js";

   defineMaterial("prism", {
     requires: (r, ctx) => !!ctx.layerTex(r, "_MainTex"),
     build(r, ctx) {
       const f = r.floats;
       return new THREE.ShaderMaterial({
         uniforms: { mainTex: { value: ctx.layerTex(r, "_MainTex") }, uPower: { value: f._PrismPower ?? 1 } },
         vertexShader: VIEW_BASIS_VS,
         fragmentShader: `/* byte-traced from prism_frag.spv ... */`,
         side: THREE.DoubleSide, toneMapped: false,
       });
     },
   });
   ```

   如果该着色器只是某个家族的改名版,**复用已有的 `kind`** 即可（角色由数据——哪个网格 + 哪些贴图槽
   ——决定,而非着色器名）。

   > **片段 GLSL 从哪来** —— 对真实着色器的字节追踪。用 `build/shaderdec/dump_shader.py`(UnityPy)提取
   > 它的 SPIR-V,用 SPIRV-Cross 转译,恢复被抹掉的 uniform 名,然后移植。完整步骤见
   > **[SHADERS.zh-CN.md](SHADERS.zh-CN.md)**。本仓库已有的着色器就是这么来的。

2. **注册模块** —— 在 [`materials/index.js`](public/render/materials/index.js) 加一行:

   ```js
   import "./sar.js";
   ```

3. **映射着色器** —— 在 [`rarities.js`](public/render/rarities.js) 新增一个 `SAR` 组:

   ```js
   const SAR = {
     "Card_SAR_Prism":     { blend: "add_a", kind: "prism" },
     "Card_Parallax_UR":   { blend: "premult", kind: "parallax", bg: true },  // 与 UR 共享
   };
   export const SHADER = { ...BASE, ...SR, ...UR, ...SAR };
   ```

   给任何要合成进金箔背景 RT pass 的层加 `bg: true`——该 pass 会自动识别(没有硬编码列表)。
   `defer: true` 隐藏某一层(卡背/卡边)。

**就这些。** 不需要改 `app.js`、分发器或背景 pass。(开闭原则。)

## 验证（不许回归）

三张样例卡覆盖了 RR / SR / UR 路径。改动前后各渲染一次,做像素 diff:

```bash
npm run gather -- <你的导出根目录>           # 确保 public/game 已填充
node server.mjs 8011 &
node build/shot.mjs "http://127.0.0.1:8011/?scene=scene.pk.json&nohud" before.png
# … 做你的改动 …
node build/shot.mjs "http://127.0.0.1:8011/?scene=scene.pk.json&nohud" after.png
```

一次忠实的改动会让你没碰到的卡保持**像素一致**(SR 卡没有动画层 → diff 应为 0%;UR 闪粉 + CJK 文本
抗锯齿会产生不到 1% 的差异,那是时序而非逻辑)。用 `?only=<材质名>` 单独看某层,`?nohud` 出干净截图。
