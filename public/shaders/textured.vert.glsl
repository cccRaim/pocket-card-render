precision highp float;
precision highp int;

in vec3 position;
in vec2 uv;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
out vec2 vs_TEXCOORD0;

void main()
{
    vs_TEXCOORD0 = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
