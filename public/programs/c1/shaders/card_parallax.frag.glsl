precision mediump float;
precision highp int;

uniform mediump sampler2D _13;

in highp vec2 vs_TEXCOORD0;
layout(location = 0) out highp vec4 _29;
layout(location = 1) out highp vec4 _40;
vec4 _9;
vec3 _22;

const highp mat4 pcrUnityFromThreeWorld = mat4(1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, -1.0, 0.0, 0.0, 0.0, 0.0, 1.0);
const highp mat4 pcrUnityFromGlbObject = mat4(-1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0);
highp vec2 pcrStoredUv(highp vec2 value) { return vec2(value.x, 1.0 - value.y); }
void main()
{

    _9 = texture(_13, pcrStoredUv( vs_TEXCOORD0));
    _22 = _9.www * _9.xyz;
    _29.w = _9.w;
    _29 = vec4(_22.x, _22.y, _22.z, _29.w);
    _40 = vec4(0.0);
}
