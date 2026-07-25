precision highp float;
precision highp int;

uniform highp vec4 _BlitScaleBias;

out highp vec2 vUv;
uvec4 _9;
vec3 _30;

void main()
{
    _9.x = (uint(gl_VertexID) & 1u) << 1u;
    _9.w = uint(gl_VertexID) & 2u;
    vec2 _35 = vec2(_9.xw);
    _30 = vec3(_35.x, _35.y, _30.z);
    vec2 _51 = (_30.xy * vec2(2.0)) + vec2(-1.0);
    gl_Position = vec4(_51.x, _51.y, gl_Position.z, gl_Position.w);
    _30.z = _30.y;
    vUv = (_30.xz * _BlitScaleBias.xy) + _BlitScaleBias.zw;
    gl_Position = vec4(gl_Position.x, gl_Position.y, vec2(1.0).x, vec2(1.0).y);
}
