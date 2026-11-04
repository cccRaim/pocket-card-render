precision mediump float;
precision highp int;

uniform mediump sampler2D _13;

layout(location = 0) out highp vec4 _9;
in highp vec2 vs_TEXCOORD0;
layout(location = 1) out highp vec4 _20;

const highp mat4 pcrUnityFromThreeWorld = mat4(1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, -1.0, 0.0, 0.0, 0.0, 0.0, 1.0);
const highp mat4 pcrUnityFromGlbObject = mat4(-1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0);
highp vec2 pcrStoredUv(highp vec2 value) { return vec2(value.x, 1.0 - value.y); }
void main()
{

    _9 = texture(_13, pcrStoredUv( vs_TEXCOORD0));
    _20 = vec4(0.0);
}
