precision highp float;
precision highp int;

in vec3 position;
in vec2 uv;
in vec2 uv2;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float _UseUv;
out vec2 vs_TEXCOORD0;

void main()
{
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    vs_TEXCOORD0 = (_UseUv * ((-uv) + uv2)) + uv;
}
