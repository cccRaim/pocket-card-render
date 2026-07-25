precision highp float;
precision highp int;

uniform highp mat4 modelMatrix;
uniform highp mat4 viewMatrix;
uniform highp mat4 projectionMatrix;
uniform highp float _InvHomographyMatrix[9];

layout(location = 0) in vec2 uv;
out highp vec2 vHomographyUv;
out highp vec4 vSourcePosition;
vec4 _9;
float _52;
vec4 _72;

void main()
{
    vec2 _12 = uv;
    mat4 _ObjectToWorld = modelMatrix;
    mat4 _ViewProjection = projectionMatrix * viewMatrix;
    _9.x = _12.y * _InvHomographyMatrix[1];
    _9.x = (_InvHomographyMatrix[0] * _12.x) + _9.x;
    _9.x += _InvHomographyMatrix[2];
    _52 = _12.y * _InvHomographyMatrix[7];
    _52 = (_InvHomographyMatrix[6] * _12.x) + _52;
    _52 += _InvHomographyMatrix[8];
    _72.x = _9.x / _52;
    _9.x = _12.y * _InvHomographyMatrix[4];
    _9.x = (_InvHomographyMatrix[3] * _12.x) + _9.x;
    _9.x += _InvHomographyMatrix[5];
    _72.y = _9.x / _52;
    vec2 _111 = _72.xy + vec2(-0.5);
    _9 = vec4(_111.x, _111.y, _9.z, _9.w);
    vHomographyUv = _72.xy;
    _72 = _9.yyyy * _ObjectToWorld[1];
    _72 = (_ObjectToWorld[0] * _9.xxxx) + _72;
    vSourcePosition = vec4(_9.xy.x, _9.xy.y, vSourcePosition.z, vSourcePosition.w);
    _9 = _72 + _ObjectToWorld[3];
    _72 = _9.yyyy * _ViewProjection[1];
    _72 = (_ViewProjection[0] * _9.xxxx) + _72;
    _72 = (_ViewProjection[2] * _9.zzzz) + _72;
    gl_Position = (_ViewProjection[3] * _9.wwww) + _72;
    vSourcePosition = vec4(vSourcePosition.x, vSourcePosition.y, vec2(0.0, 1.0).x, vec2(0.0, 1.0).y);
}
