precision highp float;
precision highp int;
uniform highp mat4 modelMatrix;
uniform float _GradationRotation;
uniform highp mat4 projectionMatrix;
uniform highp mat4 viewMatrix;
in vec3 position;
in vec2 uv;
out vec4 vs_TEXCOORD0;
vec4 _9;
vec4 _48;
mediump float _91;
mediump float _95;
mediump vec3 _101;
vec2 _120;

const highp mat4 pcrUnityFromThreeWorld = mat4(1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, -1.0, 0.0, 0.0, 0.0, 0.0, 1.0);
const highp mat4 pcrUnityFromGlbObject = mat4(-1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0);
highp vec2 pcrStoredUv(highp vec2 value) { return vec2(value.x, 1.0 - value.y); }
void main() {
    highp vec3 pcrUnityInput_position = vec3(-position.x, position.yz);
    highp vec2 pcrUnityInput_uv = vec2(uv.x, 1.0 - uv.y);
    highp mat4 pcrUnityInput_modelMatrix = pcrUnityFromThreeWorld * modelMatrix * pcrUnityFromGlbObject;
    highp mat4 pcrUnityInput_viewMatrix = viewMatrix * pcrUnityFromThreeWorld;
vec4 _11 = vec4(pcrUnityInput_position, 1.0);
vec2 _107 = pcrUnityInput_uv;
mat4 _ViewProjection = projectionMatrix * pcrUnityInput_viewMatrix;
    _9 = _11.yyyy * pcrUnityInput_modelMatrix[1];
    _9 = (pcrUnityInput_modelMatrix[0] * _11.xxxx) + _9;
    _9 = (pcrUnityInput_modelMatrix[2] * _11.zzzz) + _9;
    _9 += pcrUnityInput_modelMatrix[3];
    _48 = _9.yyyy * _ViewProjection[1];
    _48 = (_ViewProjection[0] * _9.xxxx) + _48;
    _48 = (_ViewProjection[2] * _9.zzzz) + _48;
    _9 = (_ViewProjection[3] * _9.wwww) + _48;
    gl_Position = _9;
    _9.x = _GradationRotation * 0.01745329238474369049072265625;
    _91 = sin(_9.x);
    _95 = cos(_9.x);
    _101.x = -_91;
    vec2 _111 = _107 + vec2(-0.5);
    _9 = vec4(_111.x, _111.y, _9.z, _9.w);
    _101.y = _95;
    _101.z = _91;
    _120.y = dot(_101.zy, _9.xy);
    _120.x = dot(_101.yx, _9.xy);
    vec2 _137 = _120 + vec2(0.5);
    vs_TEXCOORD0 = vec4(vs_TEXCOORD0.x, vs_TEXCOORD0.y, _137.x, _137.y);
    vs_TEXCOORD0 = vec4(_107.x, _107.y, vs_TEXCOORD0.z, vs_TEXCOORD0.w);

}
