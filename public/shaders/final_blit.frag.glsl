precision mediump float;
precision highp int;

uniform highp float _BlitMipLevel;

uniform highp sampler2D _BlitTexture;

layout(location = 0) out highp vec4 outColor;
in highp vec2 vUv;

void main()
{
    outColor = textureLod(_BlitTexture, vUv, _BlitMipLevel);
}
