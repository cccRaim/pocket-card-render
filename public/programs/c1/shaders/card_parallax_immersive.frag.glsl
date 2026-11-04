precision mediump float;
precision highp int;

uniform highp float _IllustAlpha;

uniform mediump sampler2D _13;

in highp vec2 vs_TEXCOORD0;
layout(location = 0) out highp vec4 _21;
layout(location = 1) out highp vec4 _43;
vec4 _9;

const highp mat4 pcrUnityFromThreeWorld = mat4(1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, -1.0, 0.0, 0.0, 0.0, 0.0, 1.0);
const highp mat4 pcrUnityFromGlbObject = mat4(-1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0);
highp vec2 pcrStoredUv(highp vec2 value) { return vec2(value.x, 1.0 - value.y); }
void main()
{

    _9 = texture(_13, pcrStoredUv( vs_TEXCOORD0));
    _21.w = _9.w * _IllustAlpha;
    _21 = vec4(_9.xyz.x, _9.xyz.y, _9.xyz.z, _21.w);
    _43 = vec4(0.0);
}
