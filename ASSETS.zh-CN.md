# 资产契约 —— 自备游戏数据

> [English](ASSETS.md) · **简体中文**

本渲染器**不附带任何游戏素材**。要渲染一张卡,你需要提供两样东西,两者都源自**你自己**的游戏数据:

1. 一份 **scene recipe** —— `public/scene.<标签>.json`
2. 它引用到的**美术** —— `public/game/` 下的网格 + 贴图

## 1. scene recipe（`scene.*.json`）

scene 是渲染器消费的“每次绘制调用”清单。结构如下:

```jsonc
{
  "card":      { "id": "cTR_20_000670_00_IIBUINOBAKKU_UR", "name": "...", "rarity": "UR", ... },
  "prefabGlb": "/game/Assets/PrefabHierarchyObject/<illId>_L.glb",
  "materials": {
    "<material.name>": {                 // 以 glb 网格的材质名为键（权威、唯一）
      "shader":  "Card_UR_Plate",        // 着色器名 → app.js 的 SHADER{} 表选出渲染 kind
      "queue":   2200,                    // 解析后的渲染队列（画家顺序）
      "clip":    "card" | "window",       // 模板（stencil）区域
      "stencil": 2 | null,
      "floats":  { "_FakeSpecularPower": 1.0, ... },   // 材质 m_Floats（驱动着色器）
      "colors":  { "_BaseColor": [r,g,b,a], ... },     // 材质 m_Colors
      "keywords":[ ... ],
      "textures":{ "_MainTex": { "name": "...", "url": "/game/Assets/.../foo.png" }, ... }
    }
  },
  "textures":  { "<name>": "/game/Assets/.../foo.png", ... },   // 名称 → url,供 gather 与 alpha 使用
  "alphaMode": { "<name>": "straight" | "premult" | "opaque" }
}
```

每个 `url` 都是一个 `/game/<相对路径>`,服务器会把它解析到 `public/game/<相对路径>`。这个
`<相对路径>` 镜像 AssetRipper 的导出布局（`Assets/...`）。

## 2. 美术（`public/game/`）

`public/game/` 镜像那些 `/game/` 网址:例如 `/game/Assets/PrefabHierarchyObject/X_L.glb` →
`public/game/Assets/PrefabHierarchyObject/X_L.glb`。两类资产:

- **网格** —— `<illId>_L.glb`:**已合成**的预制件（完整层级 + 世界变换,每个材质都是一个命名子网格）。
  用 **AssetRipper**（免费版即可）导出,设置:默认 Unity 版本 `2022.3.62f2`,实验性
  **“启用显示预制件轮廓（Enable Prefab Outline）”** 打开 → 产出 `Assets/PrefabHierarchyObject/*.glb`。
- **贴图** —— `.png`,放在 `Assets/` 下它们真实的容器路径里。

`npm run gather -- <导出根目录>` 会精确复制预置 scene 引用到的那些文件,所以你只需准备需要的部分。

## 为一张**新卡**生成 scene

`build/build.mjs` 从一份**材质 recipe**（`<illId>_render_full.json`）+ AssetRipper glb + 贴图构建 scene:

```bash
node build/build.mjs <illId> "" scene.<标签>.json
```

材质 recipe（每材质的 `m_Floats`/`m_Colors`/`m_TexEnvs`、着色器名、渲染队列）是**唯一不来自** AssetRipper
glb 的那块（glb 只带几何 + 材质*名称*）。它单独生成——见下面的工具链——再作为 `scene.*.json` 的一部分提交到这里。

## 数据准备工具链

需要两个工具,因为**单独任何一个都不够**(经执行验证):

| 工具 | 产出 | 说明 |
|------|------|------|
| **AssetRipper**（.NET,免费） | **合成好的** glb 几何 + 贴图 | 设置同上。它把预制件层级（每卡的 Face prefab + 共享的 Template prefab）实例化成一个 glb,每个材质都是命名子网格——这是其它工具复刻不出来的几何。 |
| **UnityPy**（Python） | **材质 recipe**（`m_Floats`/`m_Colors`/`m_TexEnvs`、着色器名、渲染队列） | 加载**解密后的** Unity 材质 bundle（`UnityPy.config.FALLBACK_UNITY_VERSION = "2022.3.62f2"`),解析跨 bundle 的 PPtr,按上面的 schema 写出每层 recipe。渲染器需要它;glb 只有材质*名称*。 |

> **需要 AssetStudio 吗?不需要。** 几何来自 AssetRipper;**材质*和*着色器**都来自 UnityPy。
> (AssetStudio 的 CLI 连 `Material` 都 dump 不了——`-m dump` 只产出 Mesh / Texture2D / MonoBehaviour /
> Shader。)着色器 SPIR-V 用 `build/shaderdec/dump_shader.py`(UnityPy)提取、由 SPIRV-Cross 转译——见
> [SHADERS.zh-CN.md](SHADERS.zh-CN.md)。AssetStudio 不在本流水线里。

两个准备工具都针对**你自己的**解密游戏数据运行,且都在**本仓库之外**;本仓库自始至终只消费产出的
`scene.json` + `public/game/` 美术。(解密是上游、与具体游戏相关的步骤,同样不包含在此。)
