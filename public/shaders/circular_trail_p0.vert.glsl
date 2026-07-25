precision highp float;
precision highp int;

uniform highp mat4 modelMatrix;
uniform highp mat4 viewMatrix;
uniform highp mat4 projectionMatrix;
uniform float _CenterMoveByTilt;
uniform float _CircularDefaultAngle;
uniform float _AdjustRadiusScale;
in vec3 position;
out vec2 vs_TEXCOORD0;
in vec2 uv;
vec4 _9;
mediump float _27;
mediump float _31;
mediump vec3 _37;
vec2 _80;
vec4 _120;

void main()
{
    vec4 _51 = vec4(position, 1.0);
    vec2 _180 = uv;
    mat4 _ObjectToWorld = modelMatrix;
    mat4 _ViewProjection = projectionMatrix * viewMatrix;
    _9.x = _CircularDefaultAngle * 0.01745329238474369049072265625;
    _27 = sin(_9.x);
    _31 = cos(_9.x);
    _37.x = -_27;
    _37.y = _31;
    _37.z = _27;
    _9.y = dot(_37.zy, _51.xy);
    _9.x = dot(_37.yx, _51.xy);
    vec2 _76 = (_9.xy * vec2(vec2(_AdjustRadiusScale, _AdjustRadiusScale))) + _9.xy;
    _9 = vec4(_76.x, _76.y, _9.z, _9.w);
    _80.x = dot(-_ObjectToWorld[2].xyz, -_ObjectToWorld[2].xyz);
    _80.x = inversesqrt(_80.x);
    _80 = _80.xx * (-_ObjectToWorld[2].xy);
    vec2 _117 = (_80 * vec2(vec2(_CenterMoveByTilt, _CenterMoveByTilt))) + _9.xy;
    _9 = vec4(_117.x, _117.y, _9.z, _9.w);
    _120 = _9.yyyy * _ObjectToWorld[1];
    _9 = (_ObjectToWorld[0] * _9.xxxx) + _120;
    _9 = (_ObjectToWorld[2] * _51.zzzz) + _9;
    _9 += _ObjectToWorld[3];
    _120 = _9.yyyy * _ViewProjection[1];
    _120 = (_ViewProjection[0] * _9.xxxx) + _120;
    _120 = (_ViewProjection[2] * _9.zzzz) + _120;
    gl_Position = (_ViewProjection[3] * _9.wwww) + _120;
    vs_TEXCOORD0 = _180;
}
