precision highp float;
precision highp int;
uniform highp mat4 modelMatrix;
uniform float _HighlightRotate;
uniform float _HighlightScale;
uniform vec2 _HighlightTranslate;
uniform highp mat4 projectionMatrix;
uniform highp mat4 viewMatrix;
in vec3 position;
in vec2 uv;
out vec4 vs_TEXCOORD0;
vec4 _9;
vec4 _49;
vec2 _107;
mediump float _115;
mediump float _119;
mediump vec3 _125;

const highp mat4 pcrUnityFromThreeWorld = mat4(1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, -1.0, 0.0, 0.0, 0.0, 0.0, 1.0);
const highp mat4 pcrUnityFromGlbObject = mat4(-1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0);
highp vec2 pcrStoredUv(highp vec2 value) { return vec2(value.x, 1.0 - value.y); }
void main() {
    highp vec3 pcrUnityInput_position = vec3(-position.x, position.yz);
    highp vec2 pcrUnityInput_uv = vec2(uv.x, 1.0 - uv.y);
    highp mat4 pcrUnityInput_modelMatrix = pcrUnityFromThreeWorld * modelMatrix * pcrUnityFromGlbObject;
    highp mat4 pcrUnityInput_viewMatrix = viewMatrix * pcrUnityFromThreeWorld;
vec4 _11 = vec4(pcrUnityInput_position, 1.0);
vec2 _85 = pcrUnityInput_uv;
mat4 _ViewProjection = projectionMatrix * pcrUnityInput_viewMatrix;
    _9 = _11.yyyy * pcrUnityInput_modelMatrix[1];
    _9 = (pcrUnityInput_modelMatrix[0] * _11.xxxx) + _9;
    _9 = (pcrUnityInput_modelMatrix[2] * _11.zzzz) + _9;
    _9 += pcrUnityInput_modelMatrix[3];
    _49 = _9.yyyy * _ViewProjection[1];
    _49 = (_ViewProjection[0] * _9.xxxx) + _49;
    _49 = (_ViewProjection[2] * _9.zzzz) + _49;
    _9 = (_ViewProjection[3] * _9.wwww) + _49;
    gl_Position = _9;
    vec2 _89 = _85 + vec2(-0.5);
    _9 = vec4(_89.x, _89.y, _9.z, _9.w);
    vec2 _103 = _9.xy * vec2(vec2(_HighlightScale, _HighlightScale));
    _9 = vec4(_103.x, _103.y, _9.z, _9.w);
    _107.x = _HighlightRotate * 0.01745329238474369049072265625;
    _115 = sin(_107.x);
    _119 = cos(_107.x);
    _125.x = -_115;
    _125.y = _119;
    _125.z = _115;
    _107.y = dot(_125.zy, _9.xy);
    _107.x = dot(_125.yx, _9.xy);
    vec2 _153 = _107 + vec2(_HighlightTranslate.x, _HighlightTranslate.y);
    _9 = vec4(_153.x, _153.y, _9.z, _9.w);
    vec2 _161 = _9.xy + vec2(0.5);
    vs_TEXCOORD0 = vec4(vs_TEXCOORD0.x, vs_TEXCOORD0.y, _161.x, _161.y);
    vs_TEXCOORD0 = vec4(_85.x, _85.y, vs_TEXCOORD0.z, vs_TEXCOORD0.w);

}
